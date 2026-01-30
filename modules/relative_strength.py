"""
Relative Strength Ranking System
Calculates and ranks instruments by performance across multiple timeframes
"""
from dataclasses import dataclass
from typing import List, Dict, Optional, Any
import numpy as np
from datetime import datetime


@dataclass
class RSRanking:
    """Single instrument's relative strength data"""
    symbol: str
    name: str
    category: str

    # Current price data
    price: float
    change_1d: float
    change_1d_pct: float

    # Performance by timeframe (percentage)
    perf_1d: Optional[float]
    perf_5d: Optional[float]
    perf_20d: Optional[float]
    perf_60d: Optional[float]

    # Composite RS score
    rs_score: float          # Weighted average of timeframes
    rs_rank: int = 0         # Rank within universe (set by rank_universe)
    rs_percentile: float = 0 # Percentile (0-100)

    # Trend indicators
    above_20sma: bool = False
    above_50sma: bool = False
    trend: str = "neutral"   # "strong_up", "up", "neutral", "down", "strong_down"

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "category": self.category,
            "price": float(round(self.price, 2)),
            "change_1d": float(round(self.change_1d, 2)),
            "change_1d_pct": float(round(self.change_1d_pct, 2)),
            "performance": {
                "1d": float(round(self.perf_1d, 2)) if self.perf_1d is not None else None,
                "5d": float(round(self.perf_5d, 2)) if self.perf_5d is not None else None,
                "20d": float(round(self.perf_20d, 2)) if self.perf_20d is not None else None,
                "60d": float(round(self.perf_60d, 2)) if self.perf_60d is not None else None,
            },
            "rs_score": float(round(self.rs_score, 2)),
            "rs_rank": int(self.rs_rank),
            "rs_percentile": float(round(self.rs_percentile, 1)),
            "above_20sma": bool(self.above_20sma),
            "above_50sma": bool(self.above_50sma),
            "trend": self.trend,
        }


def calculate_performance(
    closes: np.ndarray,
    periods: List[int] = [1, 5, 20, 60]
) -> Dict[str, Optional[float]]:
    """
    Calculate performance over multiple timeframes.

    Args:
        closes: Array of closing prices (oldest first)
        periods: List of lookback periods in days

    Returns:
        Dictionary mapping period string to percentage change
    """
    result = {}
    if len(closes) == 0:
        return {f"{p}d": None for p in periods}

    current = closes[-1]

    for period in periods:
        key = f"{period}d"
        if len(closes) > period:
            past = closes[-(period + 1)]
            if past > 0:
                result[key] = ((current / past) - 1) * 100
            else:
                result[key] = None
        else:
            result[key] = None

    return result


def calculate_rs_score(
    perf_1d: Optional[float],
    perf_5d: Optional[float],
    perf_20d: Optional[float],
    perf_60d: Optional[float],
    weights: Optional[Dict[str, float]] = None
) -> float:
    """
    Calculate weighted composite RS score.

    Default weights favor medium-term performance (20d) but include all timeframes:
    - 1D: 10% (too noisy for more)
    - 5D: 25% (short-term momentum)
    - 20D: 35% (monthly trend)
    - 60D: 30% (quarterly trend)

    Args:
        perf_1d through perf_60d: Performance percentages
        weights: Optional custom weights

    Returns:
        Composite RS score
    """
    if weights is None:
        weights = {
            "1d": 0.10,
            "5d": 0.25,
            "20d": 0.35,
            "60d": 0.30,
        }

    score = 0.0
    total_weight = 0.0

    if perf_1d is not None:
        score += perf_1d * weights["1d"]
        total_weight += weights["1d"]

    if perf_5d is not None:
        score += perf_5d * weights["5d"]
        total_weight += weights["5d"]

    if perf_20d is not None:
        score += perf_20d * weights["20d"]
        total_weight += weights["20d"]

    if perf_60d is not None:
        score += perf_60d * weights["60d"]
        total_weight += weights["60d"]

    # Normalize if some timeframes are missing
    if total_weight > 0:
        score = score / total_weight * sum(weights.values())

    return score


def calculate_trend(
    closes: np.ndarray,
    current_price: float
) -> tuple[str, bool, bool]:
    """
    Determine trend based on price vs moving averages.

    Args:
        closes: Array of closing prices
        current_price: Current price

    Returns:
        (trend_string, above_20sma, above_50sma)
    """
    above_20sma = False
    above_50sma = False

    if len(closes) >= 20:
        sma_20 = np.mean(closes[-20:])
        above_20sma = bool(current_price > sma_20)

    if len(closes) >= 50:
        sma_50 = np.mean(closes[-50:])
        above_50sma = bool(current_price > sma_50)

    # Determine trend string
    if above_20sma and above_50sma:
        trend = "strong_up"
    elif above_20sma:
        trend = "up"
    elif not above_20sma and not above_50sma:
        trend = "strong_down"
    elif not above_20sma:
        trend = "down"
    else:
        trend = "neutral"

    return trend, above_20sma, above_50sma


def create_ranking(
    symbol: str,
    name: str,
    category: str,
    candles: List[Dict[str, Any]],
    quote: Optional[Dict[str, Any]] = None
) -> RSRanking:
    """
    Create an RS ranking for a single symbol from candle data.

    Args:
        symbol: Ticker symbol
        name: Display name
        category: Category (indices, sectors, commodities, fixed_income)
        candles: List of candles with 'close' key
        quote: Optional current quote with 'price', 'change', 'change_pct'

    Returns:
        RSRanking dataclass
    """
    # Extract closes
    if candles:
        closes = np.array([c.get("close", 0) for c in candles])
    else:
        closes = np.array([])

    # Get current price from quote or last candle
    if quote:
        price = quote.get("price", 0)
        change_1d = quote.get("change", 0)
        change_1d_pct = quote.get("change_pct", 0)
    elif len(closes) > 0:
        price = closes[-1]
        change_1d = closes[-1] - closes[-2] if len(closes) > 1 else 0
        change_1d_pct = (change_1d / closes[-2] * 100) if len(closes) > 1 and closes[-2] != 0 else 0
    else:
        price = 0
        change_1d = 0
        change_1d_pct = 0

    # Calculate performance
    perf = calculate_performance(closes)

    # Calculate RS score
    rs_score = calculate_rs_score(
        perf.get("1d"),
        perf.get("5d"),
        perf.get("20d"),
        perf.get("60d")
    )

    # Calculate trend
    trend, above_20sma, above_50sma = calculate_trend(closes, price)

    return RSRanking(
        symbol=symbol,
        name=name,
        category=category,
        price=price,
        change_1d=change_1d,
        change_1d_pct=change_1d_pct,
        perf_1d=perf.get("1d"),
        perf_5d=perf.get("5d"),
        perf_20d=perf.get("20d"),
        perf_60d=perf.get("60d"),
        rs_score=rs_score,
        above_20sma=above_20sma,
        above_50sma=above_50sma,
        trend=trend,
    )


def rank_universe(rankings: List[RSRanking]) -> List[RSRanking]:
    """
    Assign ranks and percentiles to all instruments.

    Args:
        rankings: List of RSRanking objects

    Returns:
        Same list with rs_rank and rs_percentile populated, sorted by rs_score descending
    """
    # Sort by RS score descending
    sorted_rankings = sorted(rankings, key=lambda x: x.rs_score, reverse=True)
    n = len(sorted_rankings)

    for i, ranking in enumerate(sorted_rankings):
        ranking.rs_rank = i + 1
        ranking.rs_percentile = ((n - i) / n) * 100 if n > 0 else 50

    return sorted_rankings


def identify_leaders_laggards(
    rankings: List[RSRanking],
    top_n: int = 5
) -> Dict[str, List[RSRanking]]:
    """
    Identify top performers and worst performers.

    Args:
        rankings: List of RSRanking objects (should already be sorted)
        top_n: Number of leaders/laggards to return

    Returns:
        Dictionary with "leaders" and "laggards" keys
    """
    sorted_by_score = sorted(rankings, key=lambda x: x.rs_score, reverse=True)

    return {
        "leaders": sorted_by_score[:top_n],
        "laggards": sorted_by_score[-top_n:] if len(sorted_by_score) >= top_n else sorted_by_score,
    }


def filter_by_category(
    rankings: List[RSRanking],
    category: str
) -> List[RSRanking]:
    """Filter rankings to a specific category"""
    return [r for r in rankings if r.category == category]


def get_category_summary(rankings: List[RSRanking]) -> Dict[str, Dict]:
    """
    Get summary statistics by category.

    Returns:
        Dictionary mapping category to stats (avg_score, count, best, worst)
    """
    from collections import defaultdict

    by_category = defaultdict(list)
    for r in rankings:
        by_category[r.category].append(r)

    summary = {}
    for category, items in by_category.items():
        if items:
            scores = [r.rs_score for r in items]
            sorted_items = sorted(items, key=lambda x: x.rs_score, reverse=True)
            summary[category] = {
                "avg_score": float(round(np.mean(scores), 2)),
                "count": len(items),
                "best": sorted_items[0].symbol,
                "worst": sorted_items[-1].symbol,
            }

    return summary
