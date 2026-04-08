"""
Polling Service
Background task that fetches data and broadcasts updates via WebSocket.

Uses a rolling fetch pattern: instead of blasting all API calls at once,
fetches one symbol at a time spread evenly across the scan interval.
This keeps a steady, low load on the upstream API.
"""
import asyncio
import logging
import time
from typing import Optional, Dict, List
import numpy as np

from backend.core.config import get_settings
from backend.core.symbols import ALL_SYMBOLS, SYMBOL_UNIVERSE, DIVERGENCE_PAIRS, get_symbol_info
from backend.services.data_client import get_data_client
from backend.api.websocket import get_connection_manager
from backend.api.routes.alerts import add_alert, AlertType, AlertSeverity, get_unread_alerts, determine_severity
from backend.db.models import DivergenceEvent, AlertSettings, RSSnapshot
from modules.relative_strength import create_ranking, rank_universe
from modules.intermarket_divergence import analyze_all_pairs
from modules.rotation_detector import detect_rotation_signals, determine_market_regime

logger = logging.getLogger(__name__)
settings = get_settings()


class PollingService:
    """
    Background service that polls the data server and broadcasts updates.

    Rolling fetch pattern:
      - Spreads history fetches evenly across the scan interval
      - Interleaves quote broadcasts for WebSocket clients
      - Computes rankings + divergences once per cycle using shared cache
      - Never bursts — steady 1 call every ~8-10s
    """

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._previous_rankings = []
        self._cache = {
            'rankings': {'data': None, 'timestamp': 0},
            'regime': {'data': None, 'timestamp': 0},
            'divergences': {'data': None, 'timestamp': 0},
        }

    def get_cached(self, key: str):
        """Get cached data by key. Returns (data, timestamp) or (None, 0)."""
        entry = self._cache.get(key, {})
        return entry.get('data'), entry.get('timestamp', 0)

    def start(self):
        """Start the polling service"""
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._poll_loop())
            logger.info("Polling service started")

    def stop(self):
        """Stop the polling service"""
        self._running = False
        if self._task:
            self._task.cancel()
            logger.info("Polling service stopped")

    async def _poll_loop(self):
        """
        Main polling loop — spreads API calls evenly, never bursts.

        Each cycle:
          1. Fetch history for each symbol one at a time (~8s apart)
          2. Interleave quote broadcasts during the fetch phase
          3. After all history is fetched, grab fresh quotes
          4. Compute rankings, divergences, rotations from cached data
          5. If cycle finished early, idle with periodic quote updates
        """
        symbols = list(ALL_SYMBOLS)
        num_symbols = len(symbols)

        # Spread history fetches across 80% of the scan interval
        fetch_window = settings.divergence_scan_interval * 0.8
        spacing = max(fetch_window / num_symbols, 2.0)

        logger.info(
            f"Rolling fetch: {num_symbols} symbols, "
            f"{settings.divergence_scan_interval:.0f}s cycle, "
            f"{spacing:.1f}s between history fetches, "
            f"quotes every {settings.quote_poll_interval:.0f}s"
        )

        last_quote_time = 0

        while self._running:
            try:
                cycle_start = time.time()
                history_cache: Dict[str, List] = {}

                # --- Phase 1: Rolling history fetch ---
                for symbol in symbols:
                    if not self._running:
                        break

                    try:
                        client = get_data_client()
                        result = await client.get_price_history(
                            symbol, period_type="month", period=6
                        )
                        if result:
                            history_cache[symbol] = result.get("candles", [])
                        else:
                            history_cache[symbol] = []
                    except Exception as e:
                        logger.error(f"History fetch error ({symbol}): {e}")
                        history_cache[symbol] = []

                    # Interleave quote broadcasts during the long fetch phase
                    now = time.time()
                    if now - last_quote_time >= settings.quote_poll_interval:
                        last_quote_time = now
                        await self._update_quotes()

                    await asyncio.sleep(spacing)

                if not self._running:
                    break

                # --- Phase 2: Fresh quotes for computation ---
                client = get_data_client()
                quotes = await client.get_quotes(symbols)
                last_quote_time = time.time()

                # Broadcast these quotes too
                if quotes:
                    manager = get_connection_manager()
                    await manager.broadcast_to_channel("quotes", quotes)

                # --- Phase 3: Compute rankings ---
                await self._compute_rankings(history_cache, quotes)

                # --- Phase 4: Compute divergences (reuses same history) ---
                await self._compute_divergences(history_cache)

                # --- Phase 5: Rotation + alerts (no API calls) ---
                await self._update_rotations()
                await self._broadcast_alerts()

                elapsed = time.time() - cycle_start
                logger.info(
                    f"Scan cycle complete: {len(history_cache)} symbols "
                    f"in {elapsed:.0f}s"
                )

                # --- Idle phase: wait for next cycle, keep quotes flowing ---
                remaining = settings.divergence_scan_interval - elapsed
                if remaining > 0:
                    idle_end = time.time() + remaining
                    while self._running and time.time() < idle_end:
                        now = time.time()
                        if now - last_quote_time >= settings.quote_poll_interval:
                            last_quote_time = now
                            await self._update_quotes()
                        await asyncio.sleep(1)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(10)

    async def _update_quotes(self):
        """Fetch and broadcast quote updates (single bundled API call)"""
        try:
            client = get_data_client()
            quotes = await client.get_quotes(ALL_SYMBOLS)

            if quotes:
                manager = get_connection_manager()
                await manager.broadcast_to_channel("quotes", quotes)

        except Exception as e:
            logger.error(f"Error updating quotes: {e}")

    async def _compute_rankings(self, history_cache: Dict[str, List], quotes: Dict):
        """Compute RS rankings from pre-fetched history and quotes"""
        try:
            rankings = []
            for symbol in ALL_SYMBOLS:
                info = get_symbol_info(symbol)
                candles = history_cache.get(symbol, [])
                quote = quotes.get(symbol)

                ranking = create_ranking(
                    symbol=symbol,
                    name=info.get("name", symbol),
                    category=info.get("category", "unknown"),
                    candles=candles,
                    quote=quote
                )
                rankings.append(ranking)

            ranked = rank_universe(rankings)
            rankings_data = [r.to_dict() for r in ranked]

            # Save RS snapshots every 15 minutes for trend analysis
            current_minute = int(time.time() / 60)
            if current_minute % 15 == 0:
                for r in ranked:
                    snapshot = RSSnapshot(
                        id=None,
                        symbol=r.symbol,
                        rs_score=r.rs_score,
                        rs_rank=r.rs_rank,
                        performance_1d=r.perf_1d,
                        performance_5d=r.perf_5d,
                        performance_20d=r.perf_20d,
                        performance_60d=r.perf_60d,
                    )
                    snapshot.save()
                logger.info(f"Saved RS snapshots for {len(ranked)} symbols")

            # Store for rotation detection
            self._previous_rankings = rankings_data

            # Cache for API routes
            self._cache['rankings'] = {'data': rankings_data, 'timestamp': time.time()}

            # Broadcast
            manager = get_connection_manager()
            await manager.broadcast_to_channel("rankings", rankings_data)

        except Exception as e:
            logger.error(f"Error computing rankings: {e}")

    async def _compute_divergences(self, history_cache: Dict[str, List]):
        """Compute divergences from pre-fetched history (no additional API calls)"""
        try:
            # Convert cached history to numpy arrays for divergence pairs
            price_data = {}
            symbols_needed = set()
            for a, b in DIVERGENCE_PAIRS:
                symbols_needed.add(a)
                symbols_needed.add(b)

            for symbol in symbols_needed:
                candles = history_cache.get(symbol, [])
                if candles:
                    prices = np.array([c.get("close", 0) for c in candles])
                    if len(prices) > 0:
                        price_data[symbol] = prices

            # Load alert settings for threshold determination
            alert_settings = AlertSettings.load()

            # Analyze all pairs
            divergences = analyze_all_pairs(
                DIVERGENCE_PAIRS,
                price_data,
                correlation_threshold=alert_settings.correlation_threshold,
                rs_threshold=alert_settings.rs_threshold
            )

            divergences_data = [d.to_dict() for d in divergences]

            # Track divergence events and create alerts with 3-tier severity
            from datetime import datetime
            for div in divergences:
                severity = determine_severity(
                    zscore=div.correlation_zscore,
                    rs_direction=div.rs_direction,
                    settings=alert_settings
                )

                existing_event = DivergenceEvent.find_active(div.symbol_a, div.symbol_b)
                if existing_event:
                    if div.strength > (existing_event.peak_strength or 0):
                        existing_event.peak_strength = div.strength
                    if abs(div.correlation_zscore) > abs(existing_event.peak_zscore or 0):
                        existing_event.peak_zscore = div.correlation_zscore
                    existing_event.save()
                else:
                    event = DivergenceEvent(
                        id=None,
                        symbol_a=div.symbol_a,
                        symbol_b=div.symbol_b,
                        type=div.divergence_type.value,
                        detected_at=datetime.now(),
                        initial_zscore=div.correlation_zscore,
                        initial_strength=div.strength,
                        peak_zscore=div.correlation_zscore,
                        peak_strength=div.strength,
                    )
                    event.save()

                    if severity in [AlertSeverity.WARNING, AlertSeverity.CRITICAL]:
                        add_alert(
                            alert_type=AlertType.CORRELATION_BREAKDOWN if div.divergence_type.value == "correlation_breakdown" else AlertType.RS_SHIFT,
                            severity=severity,
                            symbol=f"{div.symbol_a}-{div.symbol_b}",
                            message=div.message,
                            data=div.to_dict()
                        )

            # Cache for API routes
            self._cache['divergences'] = {'data': divergences_data, 'timestamp': time.time()}

            # Broadcast
            manager = get_connection_manager()
            await manager.broadcast_to_channel("divergences", divergences_data)

        except Exception as e:
            logger.error(f"Error computing divergences: {e}")

    async def _update_rotations(self):
        """Detect and broadcast rotation signals"""
        try:
            if not self._previous_rankings:
                return

            sector_rankings = [r for r in self._previous_rankings if r.get("category") == "sectors"]

            if not sector_rankings:
                return

            regime = determine_market_regime(sector_rankings)

            # Cache for API routes
            self._cache['regime'] = {'data': regime.to_dict(), 'timestamp': time.time()}

            manager = get_connection_manager()
            await manager.broadcast_to_channel("rotations", {
                "regime": regime.to_dict(),
                "sector_rankings": sector_rankings,
            })

        except Exception as e:
            logger.error(f"Error updating rotations: {e}")

    async def _broadcast_alerts(self):
        """Broadcast unread alerts"""
        try:
            unread = get_unread_alerts()
            if unread:
                manager = get_connection_manager()
                await manager.broadcast_to_channel("alerts", [a.to_dict() for a in unread[:10]])
        except Exception as e:
            logger.error(f"Error broadcasting alerts: {e}")


# Singleton instance
_polling_service: Optional[PollingService] = None


def get_polling_service() -> PollingService:
    """Get the singleton polling service"""
    global _polling_service
    if _polling_service is None:
        _polling_service = PollingService()
    return _polling_service
