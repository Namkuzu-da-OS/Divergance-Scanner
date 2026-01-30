"""
Rotation API Routes
Sector rotation detection endpoints
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from backend.services.data_client import get_data_client
from backend.core.symbols import SYMBOL_UNIVERSE, get_symbol_info
from modules.relative_strength import create_ranking, rank_universe
from modules.rotation_detector import detect_rotation_signals, determine_market_regime, get_sector_flow_summary

router = APIRouter(prefix="/rotation", tags=["Rotation"])

# Store previous rankings for rotation detection
_previous_rankings = []


@router.get("/signals")
async def get_rotation_signals():
    """
    Get current rotation signals based on RS rank changes.
    """
    global _previous_rankings

    client = get_data_client()
    sector_symbols = list(SYMBOL_UNIVERSE["sectors"].keys())

    # Fetch data
    history = await client.get_batch_history(sector_symbols, period_type="month", period=3)
    quotes = await client.get_quotes(sector_symbols)

    # Create current rankings
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
    current_rankings = [r.to_dict() for r in ranked]

    # Detect rotation signals
    signals = []
    if _previous_rankings:
        signals = detect_rotation_signals(current_rankings, _previous_rankings)

    # Update previous rankings for next comparison
    _previous_rankings = current_rankings

    return {
        "signals": [s.to_dict() for s in signals],
        "count": len(signals),
    }


@router.get("/regime")
async def get_market_regime():
    """
    Get current market regime (cycle phase) based on sector leadership.
    """
    client = get_data_client()
    sector_symbols = list(SYMBOL_UNIVERSE["sectors"].keys())

    # Fetch data
    history = await client.get_batch_history(sector_symbols, period_type="month", period=3)
    quotes = await client.get_quotes(sector_symbols)

    # Create rankings
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
    sector_rankings = [r.to_dict() for r in ranked]

    # Determine regime
    regime = determine_market_regime(sector_rankings)

    return regime.to_dict()


@router.get("/flow-summary")
async def get_flow_summary():
    """
    Get money flow summary for all sectors.
    """
    global _previous_rankings

    client = get_data_client()
    sector_symbols = list(SYMBOL_UNIVERSE["sectors"].keys())

    # Fetch data
    history = await client.get_batch_history(sector_symbols, period_type="month", period=3)
    quotes = await client.get_quotes(sector_symbols)

    # Create current rankings
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
    current_rankings = [r.to_dict() for r in ranked]

    # Get flow summary
    if _previous_rankings:
        flow = get_sector_flow_summary(current_rankings, _previous_rankings)
    else:
        # No previous data, show neutral flow
        flow = {r["symbol"]: {"name": r["name"], "flow": "neutral", "rank_change": 0, "score_change": 0} for r in current_rankings}

    # Update previous rankings
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
    client = get_data_client()
    sector_symbols = list(SYMBOL_UNIVERSE["sectors"].keys())

    # Fetch data
    history = await client.get_batch_history(sector_symbols, period_type="month", period=3)
    quotes = await client.get_quotes(sector_symbols)

    # Create rankings
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

    return {
        "rankings": [r.to_dict() for r in ranked],
        "count": len(ranked),
    }
