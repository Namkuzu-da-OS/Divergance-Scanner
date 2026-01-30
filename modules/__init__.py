"""
Divergence Scanner Modules
Core algorithms for relative strength, divergence detection, and rotation
"""
from .relative_strength import (
    RSRanking,
    calculate_performance,
    calculate_rs_score,
    calculate_trend,
    create_ranking,
    rank_universe,
    identify_leaders_laggards,
    filter_by_category,
    get_category_summary,
)

from .intermarket_divergence import (
    DivergenceType,
    InterMarketDivergence,
    calculate_rolling_correlation,
    calculate_relative_strength,
    detect_correlation_breakdown,
    detect_rs_shift,
    analyze_pair,
    analyze_all_pairs,
    get_correlation_matrix,
)

from .rotation_detector import (
    RotationPhase,
    RotationSignal,
    MarketRegime,
    detect_rotation_signals,
    determine_market_regime,
    get_sector_flow_summary,
)

__all__ = [
    # Relative Strength
    "RSRanking",
    "calculate_performance",
    "calculate_rs_score",
    "calculate_trend",
    "create_ranking",
    "rank_universe",
    "identify_leaders_laggards",
    "filter_by_category",
    "get_category_summary",
    # Divergence
    "DivergenceType",
    "InterMarketDivergence",
    "calculate_rolling_correlation",
    "calculate_relative_strength",
    "detect_correlation_breakdown",
    "detect_rs_shift",
    "analyze_pair",
    "analyze_all_pairs",
    "get_correlation_matrix",
    # Rotation
    "RotationPhase",
    "RotationSignal",
    "MarketRegime",
    "detect_rotation_signals",
    "determine_market_regime",
    "get_sector_flow_summary",
]
