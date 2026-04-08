"""
Rotation API Routes
Sector rotation detection endpoints

All endpoints serve from the polling service cache.
The polling service computes rankings, regime, and divergences on a cycle
and stores the results. These routes just read the cache — no Schwab API calls.
"""
from fastapi import APIRouter, HTTPException
from typing import Optional

from backend.services.polling_service import get_polling_service
from backend.services.data_client import get_data_client
from backend.core.symbols import SYMBOL_UNIVERSE, get_symbol_info
from modules.relative_strength import create_ranking, rank_universe
from modules.rotation_detector import detect_rotation_signals, determine_market_regime, get_sector_flow_summary

router = APIRouter(prefix="/rotation", tags=["Rotation"])

# Store previous rankings for rotation signal detection
_previous_rankings = []


def _get_from_cache(key: str):
    """Get data from polling service cache. Returns data or None."""
    service = get_polling_service()
    data, timestamp = service.get_cached(key)
    return data


async def _fetch_sector_rankings_live():
    """Fallback: fetch fresh from Schwab (cold start only)."""
    client = get_data_client()
    sector_symbols = list(SYMBOL_UNIVERSE["sectors"].keys())
    history = await client.get_batch_history(sector_symbols, period_type="month", period=3)
    quotes = await client.get_quotes(sector_symbols)

    rankings = []
    for symbol in sector_symbols:
        info = get_symbol_info(symbol)
        candles = history.get(symbol, [])
        quote = quotes.get(symbol)
        ranking = create_ranking(
            symbol=symbol,
            name=info.get("name", symbol),
            category="sectors",
            candles=candles,
            quote=quote
        )
        rankings.append(ranking)

    ranked = rank_universe(rankings)
    return [r.to_dict() for r in ranked]


@router.get("/signals")
async def get_rotation_signals():
    """
    Get current rotation signals based on RS rank changes.
    """
    global _previous_rankings

    # Try cache first
    cached = _get_from_cache("rankings")
    if cached:
        current_rankings = [r for r in cached if r.get("category") == "sectors"]
    else:
        current_rankings = await _fetch_sector_rankings_live()

    signals = []
    if _previous_rankings:
        signals = detect_rotation_signals(current_rankings, _previous_rankings)

    _previous_rankings = current_rankings

    return {
        "signals": [s.to_dict() for s in signals],
        "count": len(signals),
    }


@router.get("/regime")
async def get_market_regime():
    """
    Get current market regime (cycle phase) based on sector leadership.
    Serves from polling cache — instant response, no Schwab API calls.
    """
    # Try cache first (populated by polling service)
    cached = _get_from_cache("regime")
    if cached:
        return cached

    # Cold start fallback — fetch live (slow, but only happens once)
    sector_rankings = await _fetch_sector_rankings_live()
    regime = determine_market_regime(sector_rankings)
    return regime.to_dict()


@router.get("/flow-summary")
async def get_flow_summary():
    """
    Get money flow summary for all sectors.
    """
    global _previous_rankings

    # Try cache first
    cached = _get_from_cache("rankings")
    if cached:
        current_rankings = [r for r in cached if r.get("category") == "sectors"]
    else:
        current_rankings = await _fetch_sector_rankings_live()

    if _previous_rankings:
        flow = get_sector_flow_summary(current_rankings, _previous_rankings)
    else:
        flow = {r["symbol"]: {"name": r["name"], "flow": "neutral", "rank_change": 0, "score_change": 0} for r in current_rankings}

    _previous_rankings = current_rankings

    return {
        "flow": flow,
        "inflows": [s for s, f in flow.items() if f.get("flow") == "inflow"],
        "outflows": [s for s, f in flow.items() if f.get("flow") == "outflow"],
    }


@router.get("/sector-rankings")
async def get_sector_rankings():
    """
    Get RS rankings for sectors only.
    """
    cached = _get_from_cache("rankings")
    if cached:
        sector_rankings = [r for r in cached if r.get("category") == "sectors"]
        return {
            "rankings": sector_rankings,
            "count": len(sector_rankings),
        }

    # Fallback
    sector_rankings = await _fetch_sector_rankings_live()
    return {
        "rankings": sector_rankings,
        "count": len(sector_rankings),
    }
