"""
Sector Rotation Detection
Identifies money flow between sectors and asset classes
"""
from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import datetime
from enum import Enum


class RotationPhase(Enum):
    """Market cycle phases based on sector leadership"""
    EARLY_CYCLE = "early_cycle"      # Recovery: Financials, Consumer Disc lead
    MID_CYCLE = "mid_cycle"          # Expansion: Tech, Industrials lead
    LATE_CYCLE = "late_cycle"        # Peak: Energy, Materials lead
    RECESSION = "recession"          # Contraction: Utilities, Healthcare, Staples lead
    UNKNOWN = "unknown"


@dataclass
class RotationSignal:
    """Detected rotation signal"""
    from_sector: str
    to_sector: str
    from_symbol: str
    to_symbol: str
    strength: float          # 0-1
    confidence: str          # "high", "medium", "low"
    timeframe: str          # "short_term", "medium_term"

    # Supporting evidence
    from_rs_change: float   # RS score change (negative = weakening)
    to_rs_change: float     # RS score change (positive = strengthening)
    from_rank_change: int   # Rank change (negative = dropped)
    to_rank_change: int     # Rank change (positive = improved)

    # Actionable info
    recommended_action: str  # "rotate", "watch", "hold"
    message: str
    timestamp: datetime

    def to_dict(self) -> dict:
        return {
            "from_sector": self.from_sector,
            "to_sector": self.to_sector,
            "from_symbol": self.from_symbol,
            "to_symbol": self.to_symbol,
            "strength": round(self.strength, 2),
            "confidence": self.confidence,
            "timeframe": self.timeframe,
            "from_rs_change": round(self.from_rs_change, 2),
            "to_rs_change": round(self.to_rs_change, 2),
            "from_rank_change": self.from_rank_change,
            "to_rank_change": self.to_rank_change,
            "recommended_action": self.recommended_action,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class MarketRegime:
    """Current market regime analysis"""
    phase: RotationPhase
    confidence: float
    leading_sectors: List[str]
    lagging_sectors: List[str]
    phase_scores: Dict[str, float]
    message: str

    def to_dict(self) -> dict:
        return {
            "phase": self.phase.value,
            "confidence": round(self.confidence, 2),
            "leading_sectors": self.leading_sectors,
            "lagging_sectors": self.lagging_sectors,
            "phase_scores": {k: round(v, 2) for k, v in self.phase_scores.items()},
            "message": self.message,
        }


# Sector to phase mapping - which sectors lead in which phase
PHASE_SECTORS = {
    RotationPhase.EARLY_CYCLE: ["XLF", "XLY", "XLI"],      # Financials, Consumer Disc, Industrials
    RotationPhase.MID_CYCLE: ["XLK", "XLI", "XLB"],        # Tech, Industrials, Materials
    RotationPhase.LATE_CYCLE: ["XLE", "XLB", "XLV"],       # Energy, Materials, Healthcare
    RotationPhase.RECESSION: ["XLU", "XLV", "XLP"],        # Utilities, Healthcare, Staples
}


def detect_rotation_signals(
    current_rankings: List[Dict],
    previous_rankings: List[Dict],
    min_rank_change: int = 2,
    min_score_change: float = 1.0
) -> List[RotationSignal]:
    """
    Detect rotation by comparing RS rank changes.

    Args:
        current_rankings: Current RS rankings (list of dicts with symbol, rs_rank, rs_score, name)
        previous_rankings: Previous RS rankings
        min_rank_change: Minimum rank improvement/decline to flag
        min_score_change: Minimum RS score change to consider

    Returns:
        List of RotationSignal objects
    """
    signals = []

    if not current_rankings or not previous_rankings:
        return signals

    # Build lookup for previous rankings
    prev_lookup = {r["symbol"]: r for r in previous_rankings}

    # Find significant movers
    movers = []
    for curr in current_rankings:
        symbol = curr.get("symbol", "")
        if symbol in prev_lookup:
            prev = prev_lookup[symbol]
            rank_change = prev.get("rs_rank", 0) - curr.get("rs_rank", 0)  # Positive = improved
            score_change = curr.get("rs_score", 0) - prev.get("rs_score", 0)
            movers.append({
                "symbol": symbol,
                "name": curr.get("name", symbol),
                "category": curr.get("category", "unknown"),
                "rank_change": rank_change,
                "score_change": score_change,
                "current_rank": curr.get("rs_rank", 0),
                "current_score": curr.get("rs_score", 0),
            })

    # Sort by rank improvement
    movers.sort(key=lambda x: x["rank_change"], reverse=True)

    # Top improvers (money flowing TO)
    top_gainers = [m for m in movers if m["rank_change"] >= min_rank_change and m["score_change"] >= min_score_change][:5]

    # Top decliners (money flowing FROM)
    top_losers = [m for m in movers if m["rank_change"] <= -min_rank_change and m["score_change"] <= -min_score_change][-5:]

    # Generate rotation signals
    for gainer in top_gainers:
        for loser in top_losers:
            # Calculate strength based on combined rank changes
            combined_change = abs(gainer["rank_change"]) + abs(loser["rank_change"])
            strength = min(combined_change / 10.0, 1.0)

            if strength >= 0.3:  # Only report meaningful rotations
                # Determine confidence
                if strength >= 0.7:
                    confidence = "high"
                elif strength >= 0.5:
                    confidence = "medium"
                else:
                    confidence = "low"

                # Determine action
                if strength >= 0.6:
                    action = "rotate"
                elif strength >= 0.4:
                    action = "watch"
                else:
                    action = "hold"

                signals.append(RotationSignal(
                    from_sector=loser["name"],
                    to_sector=gainer["name"],
                    from_symbol=loser["symbol"],
                    to_symbol=gainer["symbol"],
                    strength=strength,
                    confidence=confidence,
                    timeframe="short_term",
                    from_rs_change=loser["score_change"],
                    to_rs_change=gainer["score_change"],
                    from_rank_change=loser["rank_change"],
                    to_rank_change=gainer["rank_change"],
                    recommended_action=action,
                    message=f"Rotation detected: {loser['name']} ({loser['symbol']}) -> {gainer['name']} ({gainer['symbol']})",
                    timestamp=datetime.now(),
                ))

    # Sort by strength and deduplicate
    signals.sort(key=lambda s: s.strength, reverse=True)

    return signals[:10]  # Return top 10 signals


def determine_market_regime(
    sector_rankings: List[Dict]
) -> MarketRegime:
    """
    Determine market cycle phase based on sector leadership.

    Args:
        sector_rankings: List of sector rankings sorted by RS score descending

    Returns:
        MarketRegime object
    """
    if not sector_rankings:
        return MarketRegime(
            phase=RotationPhase.UNKNOWN,
            confidence=0,
            leading_sectors=[],
            lagging_sectors=[],
            phase_scores={},
            message="Insufficient data for regime detection"
        )

    # Get top 3 and bottom 3 sectors
    top_3 = [r["symbol"] for r in sector_rankings[:3]]
    bottom_3 = [r["symbol"] for r in sector_rankings[-3:]]

    # Score each phase based on how many of its sectors are in top 3
    scores = {}
    for phase, sectors in PHASE_SECTORS.items():
        score = sum(1 for s in top_3 if s in sectors)
        scores[phase.value] = score

    # Find dominant phase
    max_score = max(scores.values()) if scores else 0
    if max_score == 0:
        dominant_phase = RotationPhase.UNKNOWN
    else:
        for phase, sectors in PHASE_SECTORS.items():
            if scores[phase.value] == max_score:
                dominant_phase = phase
                break
        else:
            dominant_phase = RotationPhase.UNKNOWN

    # Calculate confidence (0-1)
    confidence = max_score / 3.0

    # Generate message from the ACTUAL leaders driving the call, not a canned
    # per-phase sector list. The old static strings could contradict the live
    # arrays (2026-07-29: phase=RECESSION printed "Utilities and Healthcare
    # leading" while XLU sat in lagging_sectors).
    phase_prefix = {
        RotationPhase.EARLY_CYCLE: "Early cycle recovery",
        RotationPhase.MID_CYCLE: "Mid cycle expansion",
        RotationPhase.LATE_CYCLE: "Late cycle",
        RotationPhase.RECESSION: "Defensive rotation",
    }
    if dominant_phase == RotationPhase.UNKNOWN:
        message = "Mixed signals - No clear regime detected"
    else:
        names = {r["symbol"]: r.get("name", r["symbol"]) for r in sector_rankings[:3]}
        drivers = [s for s in top_3 if s in PHASE_SECTORS[dominant_phase]] or top_3
        lead_names = [names.get(s, s) for s in drivers[:2]]
        message = phase_prefix[dominant_phase] + " - " + " and ".join(lead_names) + " leading"

    return MarketRegime(
        phase=dominant_phase,
        confidence=confidence,
        leading_sectors=top_3,
        lagging_sectors=bottom_3,
        phase_scores=scores,
        message=message,
    )


def get_sector_flow_summary(
    current_rankings: List[Dict],
    previous_rankings: List[Dict]
) -> Dict:
    """
    Get a summary of money flow between sectors.

    Returns:
        Dictionary with inflows, outflows, and net flow for each sector
    """
    if not current_rankings or not previous_rankings:
        return {}

    prev_lookup = {r["symbol"]: r for r in previous_rankings}
    flow_summary = {}

    for curr in current_rankings:
        symbol = curr.get("symbol", "")
        if symbol in prev_lookup:
            prev = prev_lookup[symbol]
            rank_change = prev.get("rs_rank", 0) - curr.get("rs_rank", 0)
            score_change = curr.get("rs_score", 0) - prev.get("rs_score", 0)

            flow_summary[symbol] = {
                "name": curr.get("name", symbol),
                "rank_change": rank_change,
                "score_change": round(score_change, 2),
                "current_rank": curr.get("rs_rank", 0),
                "flow": "inflow" if rank_change > 0 else ("outflow" if rank_change < 0 else "neutral"),
            }

    return flow_summary
