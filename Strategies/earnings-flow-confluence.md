# Earnings Flow Confluence Strategy

## Overview

This strategy identifies pre-earnings run-up opportunities by combining:
1. **Oversold technicals** (RSI < 30)
2. **Unusual call accumulation** (C/P ratio > 2x)
3. **PREM window timing** (7-14 days before earnings)
4. **Options flow confluence** (net bullish premium)

When all four factors align, we look for pullbacks to high OI strike support for entries, targeting the call wall.

---

## The Formula

```
ENTRY = Oversold + Call Accumulation + PREM Window + Pullback to High OI Strike
TARGET = Call Wall / Max Pain
STOP = Below Confluence Zone
```

---

## Case Study: AAPL (January 26, 2026)

### Setup Identification

**Morning Briefing Signals (Pre-Market):**

| Factor | Value | Signal |
|--------|-------|--------|
| Days to Earnings | 10 | In PREM window (optimal 7-10 days) |
| RSI | 11.87 | Extremely oversold |
| C/P Ratio | 6.83x | Heavy call accumulation |
| Net Premium | +$40.5M | Strong bullish positioning |
| IV Rank | 76% | Elevated IV into earnings |
| Trend | Strong downtrend | Oversold bounce setup |

**Confluence Score:** 85/100 (HIGH_CONVICTION)

### Key Levels Identified

| Level | Price | Source |
|-------|-------|--------|
| High OI Support | $249.74 | Confluence zone from scanner |
| Gamma Flip | $252.66 | Dealer hedging flip point |
| Call Wall | $255.00 | Max open interest |
| Max Pain | $255.00 | Options expiration magnet |

### Price Action Sequence

```
Pre-Market: Gapped up from $248.04 close
                    ↓
Morning: Pulled back to test $249.74 (High OI confluence zone)
                    ↓
Bounce: Held $249.74 support exactly
                    ↓
Rally: Broke gamma flip at $252.66
                    ↓
Target: Approached call wall at $255.00
```

### Why It Worked

1. **Smart money positioning**: 6.83x C/P ratio and $40.5M net call premium showed institutional accumulation
2. **Oversold bounce**: RSI 11.87 meant mean reversion was highly probable
3. **PREM window**: 10 days before earnings is the "sweet spot" for pre-earnings run-ups
4. **High OI support held**: The $249.74 level we identified held perfectly as support
5. **Gamma mechanics**: Breaking gamma flip ($252.66) triggered dealer buying, accelerating move to call wall

---

## Entry Criteria Checklist

Before entering an Earnings Flow Confluence trade:

- [ ] **RSI < 30** - Must be technically oversold
- [ ] **C/P Ratio > 2x** - Confirms call accumulation
- [ ] **7-14 days to earnings** - In the PREM window
- [ ] **Net call premium > $1M** - Real money, not noise
- [ ] **High OI strike support below** - Defines your entry level
- [ ] **Call wall above** - Defines your target

---

## Trade Management

### Entry
- Wait for pullback to identified High OI strike support
- Don't chase gaps - let price come to you
- Entry on bounce confirmation (higher low, volume)

### Stop Loss
- Below the High OI confluence zone
- Typically 1-2% below entry
- If support breaks, thesis is invalid

### Target
- Primary: Call wall (highest call OI)
- Secondary: Max pain
- Extended: Next resistance if momentum strong

### Position Sizing
- Use standard risk rules (1% account risk)
- Consider elevated IV for options plays
- Calls or call spreads work well in PREM window

---

## What Makes This Strategy Work

### The "Smart Money" Thesis

When we see Vol >> Open Interest in calls 7-14 days before earnings:
- **New positions are being opened** (not closed)
- **Institutional buyers are accumulating** before the crowd
- **IV is expanding** but hasn't peaked yet
- **Risk/reward favors early entry** vs chasing day before

### The Gamma Acceleration

Once price breaks above gamma flip:
1. Dealers who sold calls must buy stock to hedge
2. This buying accelerates the move
3. Price gets "pulled" toward call wall
4. Max pain acts as an expiration magnet

### The Oversold Bounce

RSI < 30 + positive catalyst (earnings anticipation):
- Mean reversion probability increases
- Short covering adds fuel
- Momentum traders pile in on break of resistance

---

## Risk Factors

- Earnings date could move (always verify)
- Market-wide selloff can override stock-specific signals
- IV crush after earnings if holding through
- Call wall can shift as new positions open

---

## Related Scanners

This strategy is surfaced by:
- **Morning Briefing** → Earnings Flow Confluence section
- **Opportunity Scanner** → Unusual call activity
- **Earnings Scanner** → PREM window timing
- **Bloodhound** → Zone identification and scores

---

## Historical Notes

**First documented case:** AAPL, January 26, 2026
- Entry zone: $249.74
- Target: $255.00 (call wall)
- Result: Validated - price held support and rallied to call wall

---

*Strategy documented from live market observation. Past performance does not guarantee future results.*
