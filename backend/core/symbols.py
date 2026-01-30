"""
Symbol Universe for the Divergence Scanner
Defines all symbols to track and their relationships
"""
from typing import Dict, List, Tuple

# Symbol categories with metadata
SYMBOL_UNIVERSE: Dict[str, Dict[str, Dict]] = {
    "indices": {
        "SPY": {"name": "S&P 500", "benchmark": True},
        "QQQ": {"name": "Nasdaq 100", "benchmark": False},
        "IWM": {"name": "Russell 2000", "benchmark": False},
        "DIA": {"name": "Dow Jones", "benchmark": False},
    },
    "sectors": {
        "XLK": {"name": "Technology", "weight": "growth"},
        "XLV": {"name": "Healthcare", "weight": "defensive"},
        "XLE": {"name": "Energy", "weight": "cyclical"},
        "XLF": {"name": "Financials", "weight": "cyclical"},
        "XLI": {"name": "Industrials", "weight": "cyclical"},
        "XLP": {"name": "Consumer Staples", "weight": "defensive"},
        "XLU": {"name": "Utilities", "weight": "defensive"},
        "XLRE": {"name": "Real Estate", "weight": "rate_sensitive"},
        "XLC": {"name": "Communications", "weight": "growth"},
        "XLB": {"name": "Materials", "weight": "cyclical"},
        "XLY": {"name": "Consumer Disc.", "weight": "cyclical"},
    },
    "international": {
        "EFA": {"name": "Developed Markets", "region": "eafe"},
        "EEM": {"name": "Emerging Markets", "region": "em"},
    },
    "commodities": {
        "GLD": {"name": "Gold", "type": "precious_metal"},
        "SLV": {"name": "Silver", "type": "precious_metal"},
        "GDX": {"name": "Gold Miners", "type": "equity"},
        "USO": {"name": "Oil", "type": "energy"},
        "UNG": {"name": "Natural Gas", "type": "energy"},
    },
    "fixed_income": {
        "SHY": {"name": "1-3 Year Treasury", "duration": "short"},
        "IEF": {"name": "7-10 Year Treasury", "duration": "intermediate"},
        "TLT": {"name": "20+ Year Treasury", "duration": "long"},
        "HYG": {"name": "High Yield", "credit": "junk"},
        "LQD": {"name": "Investment Grade", "credit": "ig"},
    },
    "currency": {
        "UUP": {"name": "US Dollar Index", "type": "dollar_bull"},
    },
}

# Key pairs to monitor for divergence
# These are instruments that typically correlate and divergence is meaningful
DIVERGENCE_PAIRS: List[Tuple[str, str]] = [
    # Index divergences
    ("SPY", "QQQ"),     # Large cap vs Tech - PRIMARY
    ("SPY", "IWM"),     # Large cap vs Small cap
    ("QQQ", "IWM"),     # Tech vs Small cap
    ("SPY", "DIA"),     # S&P vs Dow

    # International divergences
    ("SPY", "EFA"),     # US vs Developed International
    ("SPY", "EEM"),     # US vs Emerging Markets
    ("EFA", "EEM"),     # Developed vs Emerging

    # Sector divergences
    ("XLK", "XLF"),     # Tech vs Financials
    ("XLE", "XLK"),     # Energy vs Tech
    ("XLY", "XLP"),     # Consumer Disc vs Staples (risk on/off)
    ("XLU", "XLK"),     # Utilities vs Tech (defensive vs growth)
    ("XLV", "XLK"),     # Healthcare vs Tech (defensive vs growth rotation)
    ("XLF", "XLI"),     # Financials vs Industrials

    # Duration curve (yield curve proxy)
    ("SHY", "IEF"),     # Short vs Intermediate duration
    ("IEF", "TLT"),     # Intermediate vs Long duration
    ("SHY", "TLT"),     # Short vs Long (full curve)

    # Cross-asset divergences
    ("GLD", "TLT"),     # Gold vs Bonds
    ("HYG", "TLT"),     # High Yield vs Treasuries (credit spread proxy)
    ("SPY", "GLD"),     # Equities vs Gold
    ("SPY", "TLT"),     # Equities vs Bonds

    # Currency relationships
    ("GLD", "UUP"),     # Gold vs Dollar (typically inverse)
    ("EEM", "UUP"),     # Emerging Markets vs Dollar (inverse)

    # Commodity relationships
    ("GLD", "GDX"),     # Gold vs Miners
    ("USO", "XLE"),     # Oil vs Energy stocks
]

# Market regime mapping (which sectors lead in which regime)
REGIME_SECTORS = {
    "early_cycle": ["XLF", "XLY", "XLI"],      # Financials, Consumer Disc, Industrials
    "mid_cycle": ["XLK", "XLI", "XLB"],        # Tech, Industrials, Materials
    "late_cycle": ["XLE", "XLB", "XLV"],       # Energy, Materials, Healthcare
    "recession": ["XLU", "XLV", "XLP"],        # Utilities, Healthcare, Staples
}

# All symbols as a flat list
ALL_SYMBOLS: List[str] = []
for category in SYMBOL_UNIVERSE.values():
    ALL_SYMBOLS.extend(category.keys())


def get_symbol_info(symbol: str) -> Dict:
    """Get metadata for a symbol"""
    for category, symbols in SYMBOL_UNIVERSE.items():
        if symbol in symbols:
            return {
                "symbol": symbol,
                "category": category,
                **symbols[symbol]
            }
    return {"symbol": symbol, "category": "unknown", "name": symbol}


def get_symbols_by_category(category: str) -> List[str]:
    """Get all symbols in a category"""
    if category in SYMBOL_UNIVERSE:
        return list(SYMBOL_UNIVERSE[category].keys())
    return []
