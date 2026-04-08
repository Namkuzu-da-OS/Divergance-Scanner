"""
Relative Strength API Routes
"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional

from backend.services.data_client import get_data_client
from backend.core.symbols import ALL_SYMBOLS, SYMBOL_UNIVERSE, get_symbol_info
from modules.relative_strength import create_ranking, rank_universe, identify_leaders_laggards, filter_by_category, get_category_summary

router = APIRouter(prefix="/relative-strength", tags=["Relative Strength"])


@router.get("/rankings")
async def get_rankings(
    category: Optional[str] = Query(None, description="Filter by category: indices, sectors, commodities, fixed_income")
):
    """
    Get RS rankings for all tracked symbols.
    Serves from polling cache — instant response, no Schwab API calls.
    """
    # Try cache first
    from backend.services.polling_service import get_polling_service
    service = get_polling_service()
    data, timestamp = service.get_cached('rankings')

    if data is not None:
        results = data
        if category:
            results = [r for r in results if r.get('category') == category]
        return {
            "rankings": results,
            "count": len(results),
            "timestamp": None,
        }

    # Cold start fallback — fetch live
    client = get_data_client()

    history = await client.get_batch_history(
        ALL_SYMBOLS,
        period_type="month",
        period=3,
        frequency_type="daily",
        frequency=1
    )

    quotes = await client.get_quotes(ALL_SYMBOLS)

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

    if category:
        ranked = filter_by_category(ranked, category)

    return {
        "rankings": [r.to_dict() for r in ranked],
        "count": len(ranked),
        "timestamp": rankings[0].to_dict().get("timestamp") if rankings else None,
    }


@router.get("/leaders-laggards")
async def get_leaders_laggards(
    top_n: int = Query(5, ge=1, le=10, description="Number of leaders/laggards to return")
):
    """
    Get the top performers (leaders) and worst performers (laggards).
    """
    client = get_data_client()

    history = await client.get_batch_history(ALL_SYMBOLS, period_type="month", period=3)
    quotes = await client.get_quotes(ALL_SYMBOLS)

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
    result = identify_leaders_laggards(ranked, top_n)

    return {
        "leaders": [r.to_dict() for r in result["leaders"]],
        "laggards": [r.to_dict() for r in result["laggards"]],
    }


@router.get("/category-summary")
async def get_category_summary_endpoint():
    """
    Get summary statistics by category.
    """
    client = get_data_client()

    history = await client.get_batch_history(ALL_SYMBOLS, period_type="month", period=3)
    quotes = await client.get_quotes(ALL_SYMBOLS)

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
    summary = get_category_summary(ranked)

    return summary


@router.get("/symbol/{symbol}")
async def get_symbol_ranking(symbol: str):
    """
    Get RS ranking for a single symbol.
    """
    symbol = symbol.upper()
    info = get_symbol_info(symbol)

    client = get_data_client()

    history = await client.get_price_history(symbol, period_type="month", period=3)
    quotes = await client.get_quotes([symbol])

    if not history or not history.get("candles"):
        raise HTTPException(status_code=404, detail=f"No data found for {symbol}")

    ranking = create_ranking(
        symbol=symbol,
        name=info.get("name", symbol),
        category=info.get("category", "unknown"),
        candles=history.get("candles", []),
        quote=quotes.get(symbol)
    )

    return ranking.to_dict()
