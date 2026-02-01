"""
Polling Service
Background task that fetches data and broadcasts updates via WebSocket
"""
import asyncio
import logging
import time
from typing import Optional
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
    """

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._previous_rankings = []

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
        """Main polling loop"""
        quote_counter = 0
        divergence_counter = 0
        history_counter = 0

        while self._running:
            try:
                quote_counter += 1
                divergence_counter += 1
                history_counter += 1

                # Quotes every 5 seconds
                if quote_counter >= settings.quote_poll_interval:
                    quote_counter = 0
                    await self._update_quotes()

                # Rankings and divergences every 60 seconds
                if divergence_counter >= settings.divergence_scan_interval:
                    divergence_counter = 0
                    await self._update_rankings()
                    await self._update_divergences()
                    await self._update_rotations()
                    await self._broadcast_alerts()

                await asyncio.sleep(1)  # Check every second

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Polling error: {e}")
                await asyncio.sleep(5)  # Back off on error

    async def _update_quotes(self):
        """Fetch and broadcast quote updates"""
        try:
            client = get_data_client()
            quotes = await client.get_quotes(ALL_SYMBOLS)

            if quotes:
                manager = get_connection_manager()
                await manager.broadcast_to_channel("quotes", quotes)

        except Exception as e:
            logger.error(f"Error updating quotes: {e}")

    async def _update_rankings(self):
        """Fetch and broadcast RS rankings"""
        try:
            client = get_data_client()

            # Fetch data
            history = await client.get_batch_history(ALL_SYMBOLS, period_type="month", period=6)
            quotes = await client.get_quotes(ALL_SYMBOLS)

            # Create rankings
            rankings = []
            for symbol in ALL_SYMBOLS:
                info = get_symbol_info(symbol)
                candles = history.get(symbol, [])
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
                        performance_1d=r.performance.get('1d'),
                        performance_5d=r.performance.get('5d'),
                        performance_20d=r.performance.get('20d'),
                        performance_60d=r.performance.get('60d'),
                    )
                    snapshot.save()
                logger.info(f"Saved RS snapshots for {len(ranked)} symbols")

            # Store for rotation detection
            self._previous_rankings = rankings_data

            # Broadcast
            manager = get_connection_manager()
            await manager.broadcast_to_channel("rankings", rankings_data)

        except Exception as e:
            logger.error(f"Error updating rankings: {e}")

    async def _update_divergences(self):
        """Detect and broadcast divergences with 3-tier alert system"""
        try:
            client = get_data_client()

            # Get all unique symbols from pairs
            symbols_needed = set()
            for a, b in DIVERGENCE_PAIRS:
                symbols_needed.add(a)
                symbols_needed.add(b)

            # Fetch history
            history = await client.get_batch_history(list(symbols_needed), period_type="month", period=6)

            # Convert to numpy arrays
            price_data = {}
            for symbol, candles in history.items():
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
            for div in divergences:
                # Determine severity using 3-tier system
                severity = determine_severity(
                    zscore=div.correlation_zscore,
                    rs_direction=div.rs_direction,
                    settings=alert_settings
                )

                # Track divergence event in database
                existing_event = DivergenceEvent.find_active(div.symbol_a, div.symbol_b)
                if existing_event:
                    # Update peak values if current is stronger
                    if div.strength > (existing_event.peak_strength or 0):
                        existing_event.peak_strength = div.strength
                    if abs(div.correlation_zscore) > abs(existing_event.peak_zscore or 0):
                        existing_event.peak_zscore = div.correlation_zscore
                    existing_event.save()
                else:
                    # Create new divergence event
                    from datetime import datetime
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

                    # Only create alert for new divergences with WARNING or CRITICAL severity
                    if severity in [AlertSeverity.WARNING, AlertSeverity.CRITICAL]:
                        add_alert(
                            alert_type=AlertType.CORRELATION_BREAKDOWN if div.divergence_type.value == "correlation_breakdown" else AlertType.RS_SHIFT,
                            severity=severity,
                            symbol=f"{div.symbol_a}-{div.symbol_b}",
                            message=div.message,
                            data=div.to_dict()
                        )

            # Broadcast
            manager = get_connection_manager()
            await manager.broadcast_to_channel("divergences", divergences_data)

        except Exception as e:
            logger.error(f"Error updating divergences: {e}")

    async def _update_rotations(self):
        """Detect and broadcast rotation signals"""
        try:
            if not self._previous_rankings:
                return

            # Filter to sectors only
            sector_rankings = [r for r in self._previous_rankings if r.get("category") == "sectors"]

            if not sector_rankings:
                return

            # Detect rotation signals (would need previous-previous rankings for real comparison)
            # For now, just broadcast the sector rankings sorted by RS
            regime = determine_market_regime(sector_rankings)

            # Broadcast
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
