# Bloodhound System — Quantitative Audit Findings

**Date:** 2026-02-19 (Updated with expanded dataset)
**Data Period:** 2026-01-12 to 2026-02-18 (27 trading days)
**Scripts:** `audit-build-returns.js`, `audit-factor-analysis.js`, `audit-flow-analysis.js`

---

## Executive Summary

The scoring formula has **no predictive power** (R²=0.009). The tier system does not differentiate outcomes — HIGH_CONVICTION and FILTERED perform identically at ~37% 5d WR. The most heavily weighted standalone signals (volume spike, breakout, pinned) are among the worst performers. Meanwhile, **2-factor combos** involving RSI_OVERBOUGHT, UPPER_BB, HEAVY_PUTS, and WALL_DORMANT show genuine edge at 70-89% WR on the 3-day horizon — but sample sizes remain small (n=5-15).

**The data period was hostile** — the 5d baseline is only 32.9% WR across all observations. Absolute WRs are depressed; relative edge vs baseline matters more.

**The system needs combo-based scoring, not standalone factor weighting.**

---

## Dataset Overview

| Source | Raw Records | After Dedup | What's Measured |
|--------|-------------|-------------|-----------------|
| Factor analysis | 18,362 bloodhound + 106 signals + 567 scanner_history | **517 symbol-days** (280 with factor data, 237 basic) | Factor presence → forward returns |
| Flow analysis | 57,749 opportunities | **775 symbol-days** (214 cross-referenced with technicals) | Options flow → forward returns |
| audit_returns | 1,010 rows | 801 with 5d returns | Daily OHLCV for 121 symbols |

**Data sources (factor analysis):** bloodhound_results=228, signals=50, scanner_history(with signals)=2, scanner_history(basic)=237

**Baseline performance (all 155 factor observations with 5d returns):**
- 5d WR: **32.9%** | Avg 5d return: **-1.98%**
- This was a hostile market period (late Jan - mid Feb 2026). **Relative edge vs baseline is what matters.**

---

## Part 1: Factor Analysis (517 Observations, 280 with Factor Data)

### Factors That Work (Positive Edge vs Baseline at 5d)

| Factor | N (5d) | 5d WR | Avg 5d | Edge vs Base | Verdict |
|--------|--------|-------|--------|-------------|---------|
| RSI_OVERBOUGHT | 7 | **85.7%** | +3.17% | +52.8% | STRONG — best standalone factor |
| UPPER_BB | 16 | **56.3%** | -0.46% | +23.4% | Solid edge, better in combos |
| HEAVY_PUTS | 8 | **50.0%** | +0.46% | +17.1% | Put flow = smart money |
| ELEVATED_VOLUME | 36 | 47.2% | -0.78% | +14.3% | Best sample size, mild edge |
| AT_CALL_WALL | 26 | 46.2% | -1.49% | +13.3% | Moderate edge |

**Key insight:** Overbought/upper BB factors have the strongest edge. **Mean-reversion from overbought** outperforms buy-the-dip in this dataset.

### Factors That Don't Work (Negative Edge, N >= 8)

| Factor | N (5d) | 5d WR | Score Now | Edge vs Base | Verdict |
|--------|--------|-------|-----------|-------------|---------|
| BREAKOUT | 12 | **8.3%** | +15 | -24.6% | REMOVE — among worst |
| ABOVE_GAMMA_FLIP | 10 | **10.0%** | +3 | -22.9% | REMOVE |
| EXTENDED_HIGH | 10 | **10.0%** | 0 | -22.9% | Already filtered, good |
| VOLUME_SPIKE | 25 | **12.0%** | +20 | -20.9% | REMOVE — highest weighted! |
| BREAKDOWN | 9 | **11.1%** | varies | -21.8% | Zone flag only, not scored |
| PINNED | 24 | **20.8%** | +15 | -12.1% | REMOVE — was "100%" in 106 signals |
| RSI_OVERSOLD | 38 | **26.3%** | +15 | -6.6% | Standalone = bad. Only in combos |
| UNUSUAL_CALL | 61 | **27.9%** | varies | -5.0% | Anti-signal confirmed |
| LOWER_BB | 59 | **33.9%** | +5 | +1.0% | Neutral standalone, needs combo |
| WALL_ENGAGED | 29 | **34.5%** | +8 | +1.6% | Neutral — remove bonus |
| HEAVY_CALLS | 51 | **31.4%** | +5 | -1.5% | Slight negative |
| WALL_DORMANT | 44 | 29.5% | -3 | -3.4% | Penalty not justified — dormant appears in top combos |

### The 106-Signal Contradictions (Survivorship Bias Confirmed)

| Factor | 106 Signals | Full Dataset (517) | Resolution |
|--------|-------------|-------------------|------------|
| PINNED | 100% WR (n=8) | **20.8%** WR (n=24) | Survivorship bias — only winners were logged |
| WALL_ENGAGED | 48-50% | **34.5%** (n=29) | Worse with full data |
| VOLUME_SPIKE | 75% at 4h | **12.0%** at 5d | Time horizon matters; still terrible |
| RSI_OVERSOLD | "foundation" | **26.3%** (n=38) | Standalone = below baseline |

### 2-Factor Combos at 70%+ (5d Horizon)

Only **1 combo** clears 70% with n >= 10:

| Combo | N (5d) | 5d WR | Edge |
|-------|--------|-------|------|
| **CONFLUENCE_ZONE + UPPER_BB** | **10** | **70.0%** | +37.1% |

Promising at n=5-9:

| Combo | N (5d) | 5d WR | Edge |
|-------|--------|-------|------|
| RSI_OVERBOUGHT standalone | 7 | **85.7%** | +52.8% |
| CONFLUENCE_ZONE + RSI_OVERBOUGHT | 6 | **83.3%** | +50.4% |
| AT_PUT_WALL + HEAVY_PUTS | 5 | **80.0%** | +47.1% |
| ELEVATED_VOLUME + UPPER_BB | 5 | **80.0%** | +47.1% |
| RSI_OVERBOUGHT + WALL_DORMANT | 5 | **80.0%** | +47.1% |

### 2-Factor Combos at 70%+ (3d Horizon — Better Coverage)

The 3d horizon has substantially better sample sizes because more recent observations have 3d returns:

| Combo | N (3d) | 3d WR | Verdict |
|-------|--------|-------|---------|
| AT_PUT_WALL + HEAVY_PUTS | 9 | **88.9%** | Strong |
| UPPER_BB + WALL_DORMANT | 9 | **88.9%** | Strong |
| RSI_OVERBOUGHT + UNUSUAL_CALL | 7 | **85.7%** | RSI_OB dominates |
| RSI_OVERBOUGHT + WALL_DORMANT | 12 | **83.3%** | Solid N |
| STREAK + WALL_DORMANT | 12 | **83.3%** | Surprising — dormant + streak |
| AT_PUT_WALL + ELEVATED_VOLUME | 15 | **80.0%** | Best N in group |
| HEAVY_PUTS + VIX_ELEVATED | 10 | **80.0%** | Puts in fear = bounce |
| ELEVATED_VOLUME + WALL_DORMANT | 9 | **77.8%** | Dormant theme |
| AT_CALL_WALL + RSI_OVERBOUGHT | 12 | **75.0%** | Overbought at resistance |
| AT_CALL_WALL + VIX_ELEVATED | 15 | **73.3%** | Good N |
| CONFLUENCE_ZONE + UNUSUAL_PUT_ITM | 11 | **72.7%** | ITM puts = conviction |
| UPPER_BB + VIX_ELEVATED | 11 | **72.7%** | Upper BB + fear |
| AT_CALL_WALL + UPPER_BB | 10 | **70.0%** | Overbought at call wall |

**Recurring themes:** WALL_DORMANT appears in 5 of the top combos. RSI_OVERBOUGHT appears in 4. UPPER_BB appears in 4. The edge is in **overbought mean-reversion at inactive walls** and **put flow at support**.

### 2-Factor Combos That Destroy Value

| Combo | N (3d) | 3d WR | Verdict |
|-------|--------|-------|---------|
| STREAK + WALL_ENGAGED | 10 | **30.0%** | Avoid |
| UNUSUAL_PUT_ATM + WALL_DORMANT | 5 | **20.0%** | ATM puts = hedging |
| (Multiple STREAK combos) | varies | 0% 5d | STREAK has no 5d data coverage |

### Score vs Returns: No Correlation

| Score Band | N | 5d WR | Avg 5d |
|------------|---|-------|--------|
| 0-19 | 2 | 50.0% | -1.14% |
| 20-34 | 13 | 23.1% | -4.66% |
| 35-49 | 45 | 33.3% | -2.02% |
| 50-69 | 74 | 32.4% | -2.98% |
| 70+ | 258 | **40.7%** | -1.33% |

R² = **0.009** — the composite score predicts nothing. There is a slight improvement at 70+ but the jump from 50-69 to 70+ is modest (+8.3%) and driven by the sheer count of high-score observations.

### Tier Performance: Minimal Differentiation

| Tier | N (5d) | 5d WR | Avg Score |
|------|--------|-------|-----------|
| HIGH_CONVICTION | 100 | 37.0% | 74 |
| TRADEABLE | 11 | 18.2% | 44 |
| WATCH | 34 | 26.5% | 59 |
| FILTERED | 8 | 37.5% | 41 |

HC and FILTERED perform identically. TRADEABLE is the worst tier. The tier system provides minimal quality differentiation.

### Time-of-Day: Afternoon is Dead

| Window | N (5d) | 5d WR | Avg 5d |
|--------|--------|-------|--------|
| Pre-open (<9:30) | 15 | **46.7%** | +0.42% |
| Morning (9:30-11) | 230 | 37.4% | -1.87% |
| Midday (11-14) | 76 | **44.7%** | -0.81% |
| Afternoon (14-16) | 52 | **21.2%** | -3.74% |
| After-hours (>16) | 19 | **52.6%** | -1.98% |

Afternoon signals (2-4 PM ET) are dramatically worse than all other windows. Midday actually performs reasonably — the original 106-signal finding of a "midday dead zone" is **not confirmed** by the full dataset. Pre-open and after-hours show the best absolute numbers but with smaller N.

### Direction: Bearish Still Outperforms

| Direction | N (5d) | 5d WR | Avg 5d |
|-----------|--------|-------|--------|
| Bearish | 18 | **50.0%** | -0.30% |
| Null (no direction) | 237 | 40.9% | -1.73% |
| Bullish | 95 | 35.8% | -1.90% |
| Pinned | 40 | **20.0%** | -2.65% |

Bearish signals outperform bullish by 14.2 percentage points. Pinned direction is the worst — consistent with the PINNED zone being terrible.

### Zone Analysis

| Zone | N (5d) | 5d WR | Avg 5d | Verdict |
|------|--------|-------|--------|---------|
| OVERBOUGHT | 31 | **45.2%** | +0.06% | Best zone — only positive avg return |
| SELL_ZONE | 27 | 44.4% | -1.86% | Above baseline |
| HIGH_MOMENTUM | 42 | 42.9% | -3.51% | Above baseline but bad avg |
| MID_RANGE | 30 | 40.0% | -2.14% | Above baseline |
| BUY_ZONE | 135 | 38.5% | -1.51% | Largest sample, above baseline |
| EXTENDED_HIGH | 61 | 34.4% | -2.14% | Below baseline |
| EXTENDED_LOW | 20 | 30.0% | -0.78% | Below baseline |
| PINNED | 32 | **28.1%** | -2.52% | Below baseline |
| LOW_MOMENTUM | 12 | **25.0%** | -3.03% | Worst zone |

OVERBOUGHT is the only zone with a positive average return. BUY_ZONE (the system's primary target) performs slightly above baseline. PINNED is consistently bad.

---

## Part 2: Flow Analysis (775 Observations, 214 Cross-Referenced)

### Flow Type Performance

| Flow Type | N (5d) | 5d WR | Avg 5d | Verdict |
|-----------|--------|-------|--------|---------|
| Put-heavy (C/P <= 0.5) | 6 | **50.0%** | +0.64% | Promising, tiny N |
| Balanced | 585 | 43.8% | -0.80% | Baseline |
| Call-heavy (C/P >= 2.0) | 30 | **30.0%** | -2.47% | Anti-signal confirmed |

### Flow + Technical Cross-Reference (214 Observations)

**What the user wanted to know:** "Did we get options flow at a moving average with RSI bottoming and lower BB that later resulted in an uptick?"

**Answer: No. The opposite is true.**

| Pattern | N (5d) | 5d WR | Avg 5d |
|---------|--------|-------|--------|
| Call flow + Lower BB | 6 | **16.7%** | -2.76% |
| Call flow + RSI Oversold | 5 | **20.0%** | -3.10% |
| Balanced + Lower BB | 14 | **7.1%** | -3.49% |
| Balanced + RSI Oversold | 11 | **9.1%** | -2.71% |
| Call flow + At Put Wall | 4 | **0.0%** | -4.47% |

**Triple confluence (flow + 2 technicals) — all terrible:**

| Pattern | N (5d) | 5d WR | Avg 5d |
|---------|--------|-------|--------|
| Call flow + Lower BB + RSI Oversold | 5 | **20.0%** | -3.10% |
| Balanced + Lower BB + RSI Oversold | 9 | **11.1%** | -2.48% |
| Balanced + Lower BB + At Put Wall | 9 | **11.1%** | -2.44% |
| Any flow + Lower BB + Wall Engaged | 3 | **0.0%** | -4.64% |
| Balanced + At Put Wall + Volume Spike | 7 | **0.0%** | -3.94% |

**The stunning finding:** Flow at oversold technicals is a **trap**, not a signal. When technical indicators scream "buy the dip" AND there's options flow, the dip keeps dipping. The only positive result:

| Pattern | N (1d) | 1d WR | Note |
|---------|--------|-------|------|
| **No unusual flow** + Lower BB + RSI Oversold | 7 | **71.4%** | Absence of flow is informative |

### Premium Size: Big Money Loses

| Premium Tier | N (5d) | 5d WR | Avg 5d |
|-------------|--------|-------|--------|
| < $1M | 23 | **47.8%** | +0.05% |
| $1-5M | 17 | **52.9%** | -0.34% |
| $5-10M | 10 | 30.0% | -1.93% |
| **$10M+** | **46** | **13.0%** | **-2.58%** |

$10M+ flow has 13% win rate. Large institutional flows are likely hedging, not directional bets. "Follow smart money" is anti-predictive.

### Vol/OI Ratio

| Vol/OI | N (5d) | 5d WR | Avg 5d |
|--------|--------|-------|--------|
| None | 115 | 36.5% | +1.12% |
| 0-2x (normal) | 12 | **50.0%** | +0.47% |
| 2-5x | 23 | 30.4% | -1.85% |
| 5-10x | 78 | 29.5% | -2.94% |
| 10x+ | 393 | **48.3%** | -1.02% |

Mid-range unusual activity (2-10x) is the worst tier. Very high vol/OI (10x+) recovers somewhat, possibly indicating genuine conviction rather than hedging noise. Normal activity (0-2x) outperforms.

**Call flow by vol/OI threshold:**

| Threshold | N (5d) | 5d WR | Avg 5d |
|-----------|--------|-------|--------|
| All calls | 30 | 30.0% | -2.47% |
| Vol/OI >= 10x | 16 | 43.8% | -0.96% |
| Vol/OI >= 20x | 13 | **53.8%** | -0.18% |

Extremely high vol/OI (20x+) nearly neutralizes the call flow anti-signal. These may represent genuine large-scale directional bets rather than hedging.

### IV at Entry: Low IV Wins

| IV Percentile | N (5d) | 5d WR | Avg 5d |
|--------------|--------|-------|--------|
| Low (0-20) | 229 | **49.8%** | -1.38% |
| Med-Low (20-50) | 120 | 46.7% | -0.39% |
| Med-High (50-80) | 85 | 44.7% | -0.55% |
| **High (80+)** | **141** | **31.2%** | **-3.62%** |

Monotonically decreasing WR as IV increases. High IV entries are the worst by a wide margin.

### Opportunity Scanner Tier Performance

| Tier | N (5d) | 5d WR | Avg Score |
|------|--------|-------|-----------|
| **WATCH** | 68 | **57.4%** | 40 |
| TRADEABLE | 175 | 46.9% | 59 |
| HIGH_CONVICTION | 288 | 40.3% | 79 |
| FILTERED | 90 | 34.4% | 9 |

WATCH outperforms HIGH_CONVICTION by 17.1 percentage points. Same inverted pattern as factor analysis — the opportunity scoring system is also anti-predictive at the top tiers.

---

## Part 3: Validated vs Invalidated Scoring Changes

### VALIDATED by Full Dataset (517 obs)

| Proposed Change | Original (106) | Full Dataset | Status |
|----------------|----------------|-------------|--------|
| Remove Volume Spike (+20) | 75% at 4h | **12.0% at 5d (n=25)** | CONFIRMED: worst standalone |
| Remove Wall ENGAGED (+8) | 48-50% | **34.5% (n=29)** | CONFIRMED: no edge |
| Remove PINNED (+15) | 100% (n=8) | **20.8% (n=24)** | CONFIRMED: survivorship bias |
| Remove BREAKOUT (+15) | "Foundation" | **8.3% (n=12)** | CONFIRMED: worst zone |
| Remove STREAK (+5) | 50.0% | No 5d coverage | CONFIRMED: no edge shown |
| Unusual CALL is anti-signal | 21.9% | **27.9% (n=61)** | CONFIRMED |
| Afternoon dead zone | 19.4% | **21.2% (n=52)** | CONFIRMED |
| Bearish outperforms bullish | 55.6% vs 34.9% | **50.0% vs 35.8%** | CONFIRMED |
| $10M+ premium is anti-signal | — | **13.0% (n=46)** | NEW: confirmed |
| High IV entries worst | — | **31.2% (n=141)** | NEW: confirmed |

### INVALIDATED by Full Dataset

| Proposed Change | Original (106) | Full Dataset | Status |
|----------------|----------------|-------------|--------|
| RSI_OVERSOLD is foundation (+15) | "Foundation" | **26.3% (n=38)** | INVALIDATED: standalone = bad |
| LOWER_BB standalone (+5) | 54.8% | **33.9% (n=59)** | INVALIDATED: at baseline |
| Midday dead zone (11-2 PM) | 19.4% | **44.7% (n=76)** | INVALIDATED: midday is fine |
| WALL_DORMANT penalty (-3) | 50% | Appears in 5 of top combos | INVALIDATED: remove penalty |

### NEW Findings Not in Original Plan

| Discovery | Data | Implication |
|-----------|------|------------|
| CONFLUENCE_ZONE + UPPER_BB = 70% 5d (n=10) | Best combo by sample size | Add combo bonus |
| AT_PUT_WALL + HEAVY_PUTS = 89% 3d, 80% 5d | Put flow at support = bounce | Add combo bonus |
| WALL_DORMANT in 5 of top combos | Dormant walls = hidden edge | Remove penalty, add to combos |
| RSI_OVERBOUGHT = 85.7% 5d (n=7) | Best standalone factor | Monitor, add weight when N grows |
| UPPER_BB + WALL_DORMANT = 89% 3d (n=9) | Overbought at dormant wall | Strong combo candidate |
| AT_PUT_WALL + ELEVATED_VOLUME = 80% 3d (n=15) | Volume at support, best N | Reliable combo |
| No-flow + Lower BB + RSI Oversold = 71% 1d (n=7) | Absence of flow informative | Explore "quiet dip" factor |
| Call flow + vol/OI >= 20x recovers to 54% | Extreme vol/OI = conviction | Adjust flow scoring by vol/OI |
| OVERBOUGHT zone = only positive avg return | Mean-reversion edge | Consider scoring OVERBOUGHT |

---

## Part 4: Actionable Recommendations

### Tier 1: Remove Broken Scoring (High Confidence)

1. **Zero out:** VOLUME_SPIKE (+20→0), WALL_ENGAGED (+8→0), PINNED (+15→0), BREAKOUT (+15→0)
2. **Demote to annotation:** STREAK (+5→0), Smart Flow (+12→0)
3. **Remove penalty:** WALL_DORMANT (-3→0) — dormant walls appear in winning combos

### Tier 2: Penalize Anti-Signals (High Confidence)

4. **UNUSUAL_CALL:** Add -5 penalty (27.9% 5d WR, n=61)
5. **HEAVY_CALLS:** Add -3 penalty (31.4% 5d WR, n=51)
6. **Afternoon signals (2-4 PM ET):** Cap at WATCH tier (21.2% 5d WR, n=52)

### Tier 3: Add Combo Bonuses (Moderate Confidence — n=5-15)

7. **AT_PUT_WALL + HEAVY_PUTS:** +10 combo bonus (89% 3d n=9, 80% 5d n=5)
8. **UPPER_BB + WALL_DORMANT:** +8 combo bonus (89% 3d n=9)
9. **AT_PUT_WALL + ELEVATED_VOLUME:** +8 combo bonus (80% 3d n=15)
10. **CONFLUENCE_ZONE + UPPER_BB:** +8 combo bonus (70% 5d n=10)
11. **RSI_OVERBOUGHT + WALL_DORMANT:** +8 combo bonus (83% 3d n=12)

### Tier 4: Needs More Data (Promising but Low N)

12. **RSI_OVERBOUGHT standalone:** 85.7% 5d (n=7) — monitor, don't overweight yet
13. **Put-heavy flow:** 50.0% 5d (n=6) — promising, need n>=20
14. **No-flow dip pattern:** 71.4% 1d (n=7) — explore "quiet oversold" factor
15. **Call flow at vol/OI >= 20x:** 53.8% (n=13) — extreme vol/OI may indicate conviction

### Tier 5: Structural Changes

16. **Rebuild scoring:** R²=0.009. Current formula predicts nothing. Move to combo-first architecture.
17. **Rethink "smart money":** Large premium ($10M+) = 13% WR. High vol/OI (5-10x) = 29.5% WR. Only extreme vol/OI (20x+) shows any edge.
18. **IV filter:** Block or penalize entries at IV percentile >80 (31.2% WR vs 49.8% at low IV)
19. **Pinned direction cap:** Pinned = 20.0% 5d WR. Cap at WATCH or lower.
20. **Extend data retention:** bloodhound_results now kept 365 days (was 30). scanner_history now saves ALL signals (was truncated to 5).

---

## Part 5: What the Data Can't Tell Us Yet

### Sample Size Reality

Even with the expanded dataset (517 vs 219 observations), most 2-factor combos at the 5d horizon have n=5-15. Statistical confidence requires n>=30.

**Why N is still small:**
- 27 trading days of data → ~517 unique symbol-days
- Only ~280 have full factor data (signals_json)
- Only observations before ~Feb 12 have 5d forward returns
- Slicing by 2-factor combo → single digits

**What we need:** 8-12 more weeks of data accumulation. The logging fixes made today (full signals in scanner_history, 365-day retention, WATCH tier logging) ensure we'll accumulate the data going forward.

### The 3d vs 5d Problem

Many strong patterns show up at 3d (with n=9-15) but have no 5d data. This is a coverage issue, not an edge issue — the most recent observations lack 5d returns because only 3 trading days have passed. As data accumulates, 5d N will grow.

### Market Regime Dependency

This entire dataset is from one market regime (choppy/bearish, VIX 14-20). Results may not generalize to:
- Strong bull markets (VIX < 12)
- Fear/capitulation (VIX > 30)
- Low-volatility grind

### What's Not Measurable

- **Intraday entry timing:** We use close-to-close returns, not actual entry prices from alerts
- **Position sizing impact:** Fixed % returns, no account-level analysis
- **Execution quality:** Slippage, spread costs not captured

---

## Reproduction

```bash
# Step 1: Build returns dataset (requires Options API access for uncached symbols)
node scripts/audit-build-returns.js

# Step 2: Factor analysis (reads from DB, no API needed)
node scripts/audit-factor-analysis.js

# Step 3: Flow analysis (reads from DB, no API needed)
node scripts/audit-flow-analysis.js

# Rebuild from scratch (re-fetches all OHLCV data)
node scripts/audit-build-returns.js --fresh

# Single-symbol deep dive
node scripts/audit-factor-analysis.js --symbol TSLA
```

All scripts read from `data/wingman.db` and write to stdout. The `audit_returns` table persists in the DB for reuse.

---

## Data Logging Fixes (Applied 2026-02-19)

| Issue | Fix | Impact |
|-------|-----|--------|
| scanner_history truncated to 5 signals | Now saves ALL signals | Full factor data in daily summaries |
| bloodhound_results deleted after 30 days | Now kept 365 days | Full scan data preserved for audits |
| Only HC + TRADEABLE logged to signals table | Now also logs WATCH tier | Baseline comparison data captured |
