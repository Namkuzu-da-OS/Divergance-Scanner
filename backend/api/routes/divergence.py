"""
Divergence API Routes
Inter-market divergence detection endpoints
"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
import numpy as np

from backend.services.data_client import get_data_client
from backend.core.symbols import DIVERGENCE_PAIRS, ALL_SYMBOLS, get_symbol_info
from backend.core.config import get_settings
from modules.intermarket_divergence import analyze_all_pairs, analyze_pair, get_correlation_matrix

router = APIRouter(prefix="/divergence", tags=["Divergence"])
settings = get_settings()


@router.get("/scan")
async def scan_divergences(
    pairs: Optional[str] = Query(None, description="Specific pairs to scan, comma-separated (e.g., SPY-QQQ,SPY-IWM)")
):
    """
    Scan for inter-market divergences across all configured pairs.

    Returns divergences sorted by strength.
    """
    client = get_data_client()

    # Parse pairs if provided
    if pairs:
        parsed_pairs = [tuple(p.strip().split("-")) for p in pairs.split(",")]
    else:
        parsed_pairs = DIVERGENCE_PAIRS

    # Get all unique symbols needed
    symbols_needed = set()
    for a, b in parsed_pairs:
        symbols_needed.add(a.upper())
        symbols_needed.add(b.upper())

    # Fetch price history - need 6 months for proper correlation baseline (60+ data points)
    history = await client.get_batch_history(
        list(symbols_needed),
        period_type="month",
        period=6,
        frequency_type="daily",
        frequency=1
    )

    # Convert to numpy arrays
    price_data = {}
    for symbol, candles in history.items():
        if candles:
            prices = np.array([c.get("close", 0) for c in candles])
            if len(prices) > 0:
                price_data[symbol] = prices

    # Analyze all pairs
    divergences = analyze_all_pairs(
        parsed_pairs,
        price_data,
        correlation_threshold=settings.correlation_breakdown_threshold,
        rs_threshold=settings.rs_change_threshold
    )

    return {
        "divergences": [d.to_dict() for d in divergences],
        "count": len(divergences),
        "pairs_scanned": len(parsed_pairs),
    }


@router.get("/pair/{symbol_a}/{symbol_b}")
async def get_pair_analysis(
    symbol_a: str,
    symbol_b: str
):
    """
    Get detailed divergence analysis for a specific pair.
    """
    symbol_a = symbol_a.upper()
    symbol_b = symbol_b.upper()

    client = get_data_client()

    # Fetch history for both symbols - need 6 months for proper correlation baseline
    history = await client.get_batch_history(
        [symbol_a, symbol_b],
        period_type="month",
        period=6,
        frequency_type="daily",
        frequency=1
    )

    candles_a = history.get(symbol_a, [])
    candles_b = history.get(symbol_b, [])

    if not candles_a or not candles_b:
        raise HTTPException(
            status_code=404,
            detail=f"Insufficient data for {symbol_a} or {symbol_b}"
        )

    prices_a = np.array([c.get("close", 0) for c in candles_a])
    prices_b = np.array([c.get("close", 0) for c in candles_b])

    # Align arrays
    min_len = min(len(prices_a), len(prices_b))
    prices_a = prices_a[-min_len:]
    prices_b = prices_b[-min_len:]

    # Analyze the pair
    divergence = analyze_pair(
        symbol_a, symbol_b, prices_a, prices_b,
        correlation_threshold=settings.correlation_breakdown_threshold,
        rs_threshold=settings.rs_change_threshold
    )

    if divergence:
        return {
            "divergence": divergence.to_dict(),
            "has_divergence": True,
        }
    else:
        # Return basic stats even if no divergence
        from modules.intermarket_divergence import (
            calculate_rolling_correlation,
            calculate_relative_strength,
            calculate_performance
        )

        corr_series = calculate_rolling_correlation(prices_a, prices_b)
        valid_corr = corr_series[~np.isnan(corr_series)]
        current_corr = valid_corr[-1] if len(valid_corr) > 0 else 0

        rs_series = calculate_relative_strength(prices_a, prices_b)
        current_rs = rs_series[-1] if len(rs_series) > 0 else 0

        perf_a = calculate_performance(prices_a)
        perf_b = calculate_performance(prices_b)

        return {
            "has_divergence": False,
            "correlation": {
                "current": round(current_corr, 3),
            },
            "relative_strength": {
                "ratio": round(current_rs, 4),
            },
            "performance": {
                "symbol_a": {k: round(v, 2) if v else None for k, v in perf_a.items()},
                "symbol_b": {k: round(v, 2) if v else None for k, v in perf_b.items()},
            },
            "symbol_a": symbol_a,
            "symbol_b": symbol_b,
        }


@router.get("/correlation-matrix")
async def get_correlation_matrix_endpoint(
    symbols: Optional[str] = Query(None, description="Comma-separated symbols (defaults to indices and sectors)"),
    period: int = Query(20, ge=5, le=100, description="Correlation period in days")
):
    """
    Get correlation matrix for multiple symbols.
    """
    client = get_data_client()

    # Parse symbols or use defaults
    if symbols:
        symbol_list = [s.strip().upper() for s in symbols.split(",")]
    else:
        # Default to indices and sectors
        from backend.core.symbols import SYMBOL_UNIVERSE
        symbol_list = list(SYMBOL_UNIVERSE["indices"].keys()) + list(SYMBOL_UNIVERSE["sectors"].keys())

    # Fetch history - 6 months for consistent data
    history = await client.get_batch_history(
        symbol_list,
        period_type="month",
        period=6,
        frequency_type="daily",
        frequency=1
    )

    # Convert to numpy arrays
    price_data = {}
    for symbol, candles in history.items():
        if candles:
            prices = np.array([c.get("close", 0) for c in candles])
            if len(prices) > 0:
                price_data[symbol] = prices

    # Calculate correlation matrix
    matrix = get_correlation_matrix(symbol_list, price_data, window=period)

    return {
        "matrix": matrix,
        "symbols": symbol_list,
        "period": period,
    }


@router.get("/configured-pairs")
async def get_configured_pairs():
    """
    Get the list of configured divergence pairs.
    """
    pairs = []
    for a, b in DIVERGENCE_PAIRS:
        info_a = get_symbol_info(a)
        info_b = get_symbol_info(b)
        pairs.append({
            "symbol_a": a,
            "symbol_b": b,
            "name_a": info_a.get("name", a),
            "name_b": info_b.get("name", b),
            "category_a": info_a.get("category", "unknown"),
            "category_b": info_b.get("category", "unknown"),
        })

    return {"pairs": pairs, "count": len(pairs)}
