"""
Inter-Market Divergence Detection Engine
Detects when historically correlated instruments begin to diverge
"""
from dataclasses import dataclass
from enum import Enum
from typing import List, Dict, Optional, Tuple, Any
import numpy as np
from datetime import datetime


class DivergenceType(Enum):
    """Types of inter-market divergences"""
    CORRELATION_BREAKDOWN = "correlation_breakdown"  # Normally correlated, now diverging
    SPREAD_EXTREME = "spread_extreme"               # Spread at historical extremes
    RELATIVE_STRENGTH_SHIFT = "rs_shift"            # RS ratio breaking trend
    ROTATION_SIGNAL = "rotation"                    # Money rotating between assets


@dataclass
class InterMarketDivergence:
    """Represents a detected inter-market divergence"""
    symbol_a: str
    symbol_b: str
    divergence_type: DivergenceType

    # Current state
    correlation_current: float      # Current rolling correlation
    correlation_baseline: float     # Historical average correlation
    correlation_zscore: float       # How many std devs from normal

    # Performance divergence
    perf_a: Dict[str, Optional[float]]  # {"1d": %, "5d": %, "20d": %, "60d": %}
    perf_b: Dict[str, Optional[float]]
    spread: Dict[str, Optional[float]]  # Difference in performance

    # RS ratio
    rs_ratio: float                # Current A/B ratio
    rs_ma: float                   # RS ratio moving average
    rs_direction: str              # "strengthening", "weakening", "neutral"

    # Signal strength
    strength: float                # 0-1 signal strength
    confidence: str                # "high", "medium", "low"

    # Metadata
    timestamp: datetime
    message: str

    def to_dict(self) -> dict:
        return {
            "symbol_a": self.symbol_a,
            "symbol_b": self.symbol_b,
            "type": self.divergence_type.value,
            "correlation": {
                "current": float(round(self.correlation_current, 3)) if self.correlation_current is not None else None,
                "baseline": float(round(self.correlation_baseline, 3)) if self.correlation_baseline is not None else None,
                "zscore": float(round(self.correlation_zscore, 2)) if self.correlation_zscore is not None else None,
            },
            "performance": {
                "symbol_a": {k: float(round(v, 2)) if v is not None else None for k, v in self.perf_a.items()},
                "symbol_b": {k: float(round(v, 2)) if v is not None else None for k, v in self.perf_b.items()},
                "spread": {k: float(round(v, 2)) if v is not None else None for k, v in self.spread.items()},
            },
            "relative_strength": {
                "ratio": float(round(self.rs_ratio, 4)) if self.rs_ratio is not None else None,
                "ma": float(round(self.rs_ma, 4)) if self.rs_ma is not None else None,
                "direction": self.rs_direction,
            },
            "strength": float(round(self.strength, 2)),
            "confidence": self.confidence,
            "timestamp": self.timestamp.isoformat(),
            "message": self.message,
        }


def calculate_returns(prices: np.ndarray) -> np.ndarray:
    """Calculate log returns from price series"""
    if len(prices) < 2:
        return np.array([])
    return np.diff(np.log(prices))


def calculate_rolling_correlation(
    prices_a: np.ndarray,
    prices_b: np.ndarray,
    window: int = 20
) -> np.ndarray:
    """
    Calculate rolling correlation between two price series.

    Args:
        prices_a: Price array for symbol A
        prices_b: Price array for symbol B
        window: Rolling window size

    Returns:
        Array of correlation values (NaN for insufficient data)
    """
    n = len(prices_a)
    correlations = np.full(n, np.nan)

    if n < window + 1 or len(prices_b) != n:
        return correlations

    returns_a = calculate_returns(prices_a)
    returns_b = calculate_returns(prices_b)

    if len(returns_a) < window:
        return correlations

    for i in range(window - 1, len(returns_a)):
        slice_a = returns_a[i - window + 1:i + 1]
        slice_b = returns_b[i - window + 1:i + 1]

        # Handle NaN values
        valid = ~np.isnan(slice_a) & ~np.isnan(slice_b)
        if np.sum(valid) >= window // 2:
            corr = np.corrcoef(slice_a[valid], slice_b[valid])[0, 1]
            correlations[i + 1] = corr

    return correlations


def calculate_relative_strength(
    prices_a: np.ndarray,
    prices_b: np.ndarray
) -> np.ndarray:
    """
    Calculate RS ratio (A/B) series.

    Args:
        prices_a: Price array for symbol A
        prices_b: Price array for symbol B

    Returns:
        Array of A/B ratios
    """
    with np.errstate(divide='ignore', invalid='ignore'):
        rs = prices_a / prices_b
        rs[~np.isfinite(rs)] = np.nan
    return rs


def calculate_performance(
    prices: np.ndarray,
    periods: List[int] = [1, 5, 20, 60]
) -> Dict[str, Optional[float]]:
    """Calculate performance over multiple timeframes"""
    result = {}
    current = prices[-1] if len(prices) > 0 else 0

    for period in periods:
        key = f"{period}d"
        if len(prices) > period and prices[-period - 1] != 0:
            past = prices[-period - 1]
            result[key] = ((current / past) - 1) * 100
        else:
            result[key] = None

    return result


def detect_correlation_breakdown(
    correlation_series: np.ndarray,
    baseline_window: int = 60,
    current_window: int = 5,
    threshold_zscore: float = 2.0
) -> Tuple[bool, float, float, float]:
    """
    Detect if correlation has broken down significantly.

    Args:
        correlation_series: Array of rolling correlations
        baseline_window: Window for calculating baseline correlation
        current_window: Window for current correlation average
        threshold_zscore: Z-score threshold for breakdown detection

    Returns:
        (is_breakdown, current_corr, baseline_corr, zscore)
    """
    # Filter out NaN values
    valid = correlation_series[~np.isnan(correlation_series)]

    if len(valid) < baseline_window:
        return False, 0, 0, 0

    baseline = valid[-baseline_window:-current_window] if len(valid) > baseline_window else valid[:-current_window]
    current = valid[-current_window:]

    if len(baseline) < 10 or len(current) < 2:
        return False, 0, 0, 0

    baseline_mean = np.mean(baseline)
    baseline_std = np.std(baseline)
    current_mean = np.mean(current)

    if baseline_std == 0 or baseline_std < 0.01:
        return False, current_mean, baseline_mean, 0

    zscore = (current_mean - baseline_mean) / baseline_std
    is_breakdown = abs(zscore) >= threshold_zscore

    return is_breakdown, current_mean, baseline_mean, zscore


def detect_rs_shift(
    rs_series: np.ndarray,
    ma_period: int = 20,
    threshold_pct: float = 5.0
) -> Tuple[str, float, float]:
    """
    Detect relative strength direction change.

    Args:
        rs_series: RS ratio series
        ma_period: Moving average period
        threshold_pct: Percentage threshold for direction determination

    Returns:
        (direction, current_rs, rs_ma)
        direction: "strengthening", "weakening", or "neutral"
    """
    valid_rs = rs_series[~np.isnan(rs_series)]

    if len(valid_rs) < ma_period + 5:
        return "neutral", 0, 0

    rs_ma = np.mean(valid_rs[-ma_period:])
    current_rs = valid_rs[-1]

    if rs_ma == 0:
        return "neutral", current_rs, rs_ma

    pct_above_ma = ((current_rs / rs_ma) - 1) * 100

    if pct_above_ma > threshold_pct:
        return "strengthening", current_rs, rs_ma
    elif pct_above_ma < -threshold_pct:
        return "weakening", current_rs, rs_ma
    else:
        return "neutral", current_rs, rs_ma


def analyze_pair(
    symbol_a: str,
    symbol_b: str,
    prices_a: np.ndarray,
    prices_b: np.ndarray,
    correlation_threshold: float = 2.0,
    rs_threshold: float = 5.0
) -> Optional[InterMarketDivergence]:
    """
    Full inter-market divergence analysis for a symbol pair.

    Args:
        symbol_a: First symbol
        symbol_b: Second symbol
        prices_a: Price array for symbol A (oldest first)
        prices_b: Price array for symbol B (oldest first)
        correlation_threshold: Z-score threshold for correlation breakdown
        rs_threshold: Percentage threshold for RS shift

    Returns:
        InterMarketDivergence if divergence detected, None otherwise
    """
    if len(prices_a) != len(prices_b) or len(prices_a) < 60:
        return None

    # Calculate correlation
    corr_series = calculate_rolling_correlation(prices_a, prices_b)
    is_breakdown, curr_corr, base_corr, zscore = detect_correlation_breakdown(
        corr_series, threshold_zscore=correlation_threshold
    )

    # Calculate RS ratio
    rs_series = calculate_relative_strength(prices_a, prices_b)
    rs_direction, curr_rs, rs_ma = detect_rs_shift(rs_series, threshold_pct=rs_threshold)

    # Calculate performance
    perf_a = calculate_performance(prices_a)
    perf_b = calculate_performance(prices_b)
    spread = {}
    for key in perf_a.keys():
        if perf_a[key] is not None and perf_b[key] is not None:
            spread[key] = perf_a[key] - perf_b[key]
        else:
            spread[key] = None

    # Determine if this is actionable
    if not is_breakdown and rs_direction == "neutral":
        return None  # No significant divergence

    # Calculate signal strength (0-1)
    # Higher z-score = stronger signal
    # RS direction adds to strength
    strength = min(abs(zscore) / 3.0, 1.0) * 0.6
    if rs_direction != "neutral":
        strength += 0.4

    # Determine confidence
    if abs(zscore) > 3.0 and rs_direction != "neutral":
        confidence = "high"
    elif abs(zscore) > 2.0 or rs_direction != "neutral":
        confidence = "medium"
    else:
        confidence = "low"

    # Determine divergence type
    if is_breakdown:
        div_type = DivergenceType.CORRELATION_BREAKDOWN
    else:
        div_type = DivergenceType.RELATIVE_STRENGTH_SHIFT

    # Generate message
    if rs_direction == "strengthening":
        leader = symbol_a
        laggard = symbol_b
    else:
        leader = symbol_b
        laggard = symbol_a

    if is_breakdown:
        message = f"Correlation breakdown: {symbol_a}/{symbol_b} at {curr_corr:.2f} (baseline: {base_corr:.2f}, z-score: {zscore:.1f})"
    else:
        message = f"{leader} outperforming {laggard}: RS ratio {rs_direction}"

    return InterMarketDivergence(
        symbol_a=symbol_a,
        symbol_b=symbol_b,
        divergence_type=div_type,
        correlation_current=curr_corr,
        correlation_baseline=base_corr,
        correlation_zscore=zscore,
        perf_a=perf_a,
        perf_b=perf_b,
        spread=spread,
        rs_ratio=curr_rs,
        rs_ma=rs_ma,
        rs_direction=rs_direction,
        strength=strength,
        confidence=confidence,
        timestamp=datetime.now(),
        message=message,
    )


def analyze_all_pairs(
    pairs: List[Tuple[str, str]],
    price_data: Dict[str, np.ndarray],
    correlation_threshold: float = 2.0,
    rs_threshold: float = 5.0
) -> List[InterMarketDivergence]:
    """
    Analyze all configured pairs for divergences.

    Args:
        pairs: List of (symbol_a, symbol_b) tuples
        price_data: Dictionary mapping symbol -> price array
        correlation_threshold: Z-score threshold
        rs_threshold: RS percentage threshold

    Returns:
        List of detected divergences (only actionable ones)
    """
    divergences = []

    for symbol_a, symbol_b in pairs:
        if symbol_a not in price_data or symbol_b not in price_data:
            continue

        prices_a = price_data[symbol_a]
        prices_b = price_data[symbol_b]

        if len(prices_a) == 0 or len(prices_b) == 0:
            continue

        # Align arrays to same length
        min_len = min(len(prices_a), len(prices_b))
        prices_a = prices_a[-min_len:]
        prices_b = prices_b[-min_len:]

        divergence = analyze_pair(
            symbol_a, symbol_b, prices_a, prices_b,
            correlation_threshold, rs_threshold
        )

        if divergence:
            divergences.append(divergence)

    # Sort by strength descending
    divergences.sort(key=lambda d: d.strength, reverse=True)

    return divergences


def get_correlation_matrix(
    symbols: List[str],
    price_data: Dict[str, np.ndarray],
    window: int = 20
) -> Dict[str, Dict[str, float]]:
    """
    Calculate correlation matrix for multiple symbols.

    Args:
        symbols: List of symbols
        price_data: Dictionary mapping symbol -> price array
        window: Correlation window

    Returns:
        Nested dictionary: matrix[symbol_a][symbol_b] = correlation
    """
    matrix = {}

    for symbol_a in symbols:
        matrix[symbol_a] = {}
        for symbol_b in symbols:
            if symbol_a == symbol_b:
                matrix[symbol_a][symbol_b] = 1.0
                continue

            if symbol_a not in price_data or symbol_b not in price_data:
                matrix[symbol_a][symbol_b] = None
                continue

            prices_a = price_data[symbol_a]
            prices_b = price_data[symbol_b]

            # Align arrays
            min_len = min(len(prices_a), len(prices_b))
            if min_len < window + 1:
                matrix[symbol_a][symbol_b] = None
                continue

            prices_a = prices_a[-min_len:]
            prices_b = prices_b[-min_len:]

            corr_series = calculate_rolling_correlation(prices_a, prices_b, window)
            valid_corr = corr_series[~np.isnan(corr_series)]

            if len(valid_corr) > 0:
                matrix[symbol_a][symbol_b] = float(round(valid_corr[-1], 3))
            else:
                matrix[symbol_a][symbol_b] = None

    return matrix
