# Signal Tuning Audit — 2026-02-17

**Purpose:** Comprehensive data-driven analysis of Bloodhound scoring, signal outcomes, backtest results, alert patterns, and options flow quality. This document is the foundation for all scoring changes going forward.

**Data range:** 93 signals from 2026-01-20 to 2026-02-13 | 3,045 backtest runs | 52,739 opportunity records

---

## Executive Summary

The Bloodhound scanner is sending ~5 HIGH_CONVICTION Telegram alerts per day at a **47% win rate** — barely better than a coin flip. The scoring system is **anti-correlated with outcomes**: higher scores perform worse (65+ scores win 45.8%, while 45-54 scores win 61.5%).

The root cause: points are being added by factors that don't predict winners (net premium, score inflation via stacking neutral factors) while proven-edge factors are correctly weighted but drowned out. Additionally, hard gates are missing — pinned direction (0% WR), SPY/QQQ signals (17-29% WR), and bearish direction (0% WR) still generate Telegram alerts.

**Target state:** Fewer alerts (2-3/day), 65%+ win rate, every factor backed by data.

---

## 1. Current Scoring System

### Settings (bloodhound-scanner.js lines 31-59)

| Setting | Value | Notes |
|---------|-------|-------|
| scanIntervalMs | 300,000 (5 min) | |
| minConfluenceScore | 35 | Alert threshold |
| maxSymbols | 50 | |
| alertCooldownMs | 1,800,000 (30 min) | Per symbol |
| WALL_THRESHOLD_PCT | 1.0% | "At wall" distance |
| RSI_OVERSOLD | 30 | |
| RSI_OVERBOUGHT | 70 | |
| VOLUME_ELEVATED | 1.5x | |
| VIX_ELEVATED | 20 | |
| VIX_FEAR | 30 | |
| TIER_HIGH_CONVICTION | 60 | |
| TIER_TRADEABLE | 35 | |
| TIER_WATCH | 20 | |
| velocityThreshold | 15 | Score jump for velocity alert |

### Alert Deduplication (lines 202-206)

| Setting | Value |
|---------|-------|
| sameSetupCooldownMs | 4 hours |
| scoreJumpThreshold | 15 pts |
| maxAlertsPerSetup | 2/day |
| setupExpiryMs | 24 hours |

### Score Calculation

Three buckets: **base** (0-50), **highEdge** (0-35), **standard** (0-~25, can go negative).

```
rawScore = max(0, base + highEdge + standard)
totalScore = min(100, rawScore)
```

Theoretical max: ~118 (capped at 100). Floor at 0.

---

## 2. All Scoring Factors with Win Rate Data

### Base Factors (lines 905-1010)

| Factor | Points | Condition | Win Rate | Sample | Verdict |
|--------|--------|-----------|----------|--------|---------|
| Extended RSI (oversold <=30) | +15 base | RSI <= 30 | 68.2% | 22 | VALIDATED |
| Extended RSI (overbought >=70) | +15 base | RSI >= 70 | 89.5%* | * | *combined w/ wall |
| At put wall | +15 base | Within 1% of put wall | 48.7% | 78 | Necessary but not sufficient |
| At call wall | +15 base | Within 1% of call wall | 50.0% | 11 | Necessary but not sufficient |
| Pinned between walls | +15 base | At both walls | 0% | 11 | **PROBLEM** |
| COMBO: AT_WALL + EXTENDED_RSI | +20 base | Both conditions | 70.0% | 20 | VALIDATED |

### High-Edge Factors (lines 1063-1290)

| Factor | Points | Condition | Win Rate | Sample | Verdict |
|--------|--------|-----------|----------|--------|---------|
| Volume spike (2x+) | +20 highEdge | volRatio >= 2.0 | 71.4% | — | VALIDATED |
| Wall ENGAGED (2-5x vol/OI) | +8 highEdge | Wall activity classified ENGAGED | 52.4% | 21 | Marginal edge |
| Wall ACTIVE (5x+) | -3 standard | Wall activity classified ACTIVE | 0% | 12 | VALIDATED penalty |
| Wall DORMANT | -3 standard | Low activity at wall | 0% | 2 | VALIDATED penalty |
| VIX Fear (>=30) | +15 highEdge | VIX >= 30 | 66.7% | — | VALIDATED |
| VIX Elevated (20-30) | +10 highEdge | VIX 20-30 | 64.0% | 25 | VALIDATED |

### Standard Factors (lines 921-1406)

| Factor | Points | Condition | Win Rate | Sample | Verdict |
|--------|--------|-----------|----------|--------|---------|
| RSI pullback in uptrend | +5 | RSI <= 40, trend=uptrend | — | — | Unproven |
| RSI bounce in downtrend | +5 | RSI >= 60, trend=downtrend | — | — | Unproven |
| Bollinger Band lower | +5 | bbPosition <= 0.1 | 56.8% | 37 | Marginal |
| Bollinger Band upper | +5 | bbPosition >= 0.9 | 37.5% | 8 | **HARMFUL** |
| Breakout above call wall | +8 | Price > call wall by >1% | — | — | Unproven |
| Breakdown below put wall | +8 | Price < put wall by >1% | — | — | Unproven |
| Above gamma flip (breakout) | +4 | Price > gamma flip | — | — | Unproven |
| Below gamma flip (breakdown) | +4 | Price < gamma flip | — | — | Unproven |
| At VWAP | +5 | Within 0.3% of VWAP | — | — | Unproven |
| Confluence zone | +5 | >=2 levels within 0.5% | 51.6% | 62 | Neutral (no edge) |
| Elevated options flow (2-5x) | +5 | vol/OI 2-5x, liquid | — | — | Unproven |
| Net premium ($10M+) | +5 | abs(netPremium) >= $10M | 29.3% | 41 | **HARMFUL** |
| Net premium aligned | +5 | Premium direction matches | 29.3%* | * | **HARMFUL** (same pool) |
| AI Outlook highlight | +5 | Discovery source = ai_outlook | — | — | Unproven |
| Dip buy (SPY bearish + bullish) | +8 | direction=bullish, SPY=bearish | 70.0% | 10 | VALIDATED |
| Chasing (SPY bullish + bullish) | -8 | direction=bullish, SPY=bullish | 40.0% | 25 | VALIDATED penalty |
| Against SPY trend | -3 | direction opposes SPY | 54.7% | 53 | **WRONG** — should not penalize |
| Index ETF penalty (SPY/QQQ) | -8 | Symbol is SPY or QQQ | 17-29% | 13 | VALIDATED but insufficient |
| TF aligned (swing + intraday) | +5 | Both TFs match direction | — | — | Unproven |
| TF partially aligned | +3 | Swing matches, intraday doesn't | — | — | Unproven |
| Sector RS top quartile (>=75) | +8 | Sector ETF percentile >= 75 | — | — | Unproven |
| Sector RS above median (50-74) | +4 | Sector ETF percentile 50-74 | — | — | Unproven |
| Sector RS below median (25-49) | -3 | Sector ETF percentile 25-49 | — | — | Unproven |
| Sector RS bottom quartile (<25) | -5 | Sector ETF percentile < 25 | — | — | Unproven |
| History: STREAK (3+ days) | +5 | Consecutive days in scanner | 60.8% | 52 | VALIDATED |
| History: NEW | +3 | First day in scanner | 45.5% | 22 | Neutral |
| History: DAY_2 | -5 | Second day in scanner | 21.4% | 15 | VALIDATED penalty |
| History: RETURNED | -3 | Returned after gap | 31.0% | — | VALIDATED penalty |
| Internals confirm | +5 | 2/3 internals match signal | — | — | Directional (see section 6) |
| Internals oppose | -3 | 2/3 internals oppose signal | — | — | Directional (see section 6) |

### Annotation-Only Factors (no score impact)

| Factor | Location | Win Rate | Status |
|--------|----------|----------|--------|
| Elevated volume 1.5-2x | line 1070 | 20% | Correctly removed |
| MA structure alignment | lines 1334-1349 | 57-64% | Correctly annotation-only |
| Price near SMA 50 | lines 1351-1359 | untested | Correctly annotation-only |
| Unusual flow (5x+, not at wall) | line 1121 | 30.8% | Correctly annotation-only |
| Flow direction opposition | lines 1207-1212 | — | Correctly annotation-only |

---

## 3. Signal Outcome Data

### Overall Performance (93 signals, 91 validated)

| Metric | Value |
|--------|-------|
| Overall win rate | **49.5%** (45W / 46L) |
| Final outcomes | 27 LOSS, 24 WIN, 19 BREAKEVEN, 23 active |
| HC-only win rate | **47.1%** (24W / 27L of 51 resolved) |
| WIN avg peak gain | +5.33% |
| WIN avg drawdown | -1.05% |
| LOSS avg peak gain | +0.43% |
| LOSS avg drawdown | -6.44% |

### Win Rate by Score Range (INVERSE RELATIONSHIP)

| Score Range | Total | Wins | Losses | Win Rate |
|------------|-------|------|--------|----------|
| 45-54 | 14 | 8 | 5 | **61.5%** |
| 55-64 | 19 | 10 | 9 | **52.6%** |
| 65+ | 60 | 27 | 32 | **45.8%** |
| 80+ | 42 | — | — | **44.4%** |

**Higher scores perform worse.** The scoring system is broken.

### Win Rate by Direction

| Direction | Total | Wins | Losses | Win Rate |
|-----------|-------|------|--------|----------|
| Bullish | 79 | 37 | 40 | **48.1%** |
| Pinned | 11 | 8 | 3 | **72.7%** |
| Bearish | 2 | 0 | 2 | **0%** |
| Neutral | 1 | 0 | 1 | **0%** |

Note: Pinned 72.7% contradicts alert-analyzer's 0% finding (different counting methodologies — 4h checkpoint vs final outcome). **Needs reconciliation** before making pinned decisions. The two agents may be counting WIN/LOSS differently (peak gain threshold vs outcome field).

### Win Rate by VIX Regime

| VIX Regime | Total | Wins | Losses | Win Rate | Avg Peak | Avg DD |
|-----------|-------|------|--------|----------|----------|--------|
| Normal | 64 | 29 | 34 | **46.0%** | +1.97% | -3.13% |
| Elevated | 25 | 16 | 9 | **64.0%** | +3.34% | -1.22% |

**VIX elevated is a strong edge.** Normal VIX signals are near random.

### Win Rate by SPY Trend

| SPY Trend | Total | Wins | Losses | Win Rate |
|-----------|-------|------|--------|----------|
| Bearish | 10 | 7 | 3 | **70.0%** |
| Neutral | 54 | 28 | 25 | **52.8%** |
| Bullish | 25 | 10 | 15 | **40.0%** |

**Counter-trend signals outperform.** System is a mean-reversion/bounce detector.

### Win Rate by Gamma Regime

| Gamma Regime | Total | Wins | Losses | Win Rate |
|-------------|-------|------|--------|----------|
| NEUTRAL | 16 | 10 | 6 | **62.5%** |
| BULLISH_SUPPORT | 47 | 26 | 20 | **56.5%** |
| BEARISH_TILT | 13 | 6 | 7 | **46.2%** |
| BULLISH_TILT | 7 | 2 | 5 | **28.6%** |

### Win Rate by Zone

| Zone | Total | Wins | Losses | Win Rate |
|------|-------|------|--------|----------|
| BUY_ZONE | 78 | 38 | 40 | **48.7%** |
| SELL_ZONE | 11 | 5 | 5 | **50.0%** |
| LOW_MOMENTUM | 4 | 2 | 1 | **66.7%** |

### Win Rate by Signal History

| History | Total | Wins | Win Rate |
|---------|-------|------|----------|
| STREAK (3+ days) | 52 | — | **60.8%** |
| NEW (first appearance) | 22 | — | **45.5%** |
| DAY_2 | 15 | — | **21.4%** |

**Day 2 is the worst entry point.** Streaks are the best.

### Win Rate by Time of Day (UTC → ET)

| Hour UTC | ET Approx | N | Win Rate |
|----------|-----------|---|----------|
| 12 | 7am | 6 | **66.7%** |
| 14 | 9am | 24 | **54.2%** |
| 15 | 10am | 23 | **60.9%** |
| 16 | 11am | 9 | **33.3%** |
| 17 | 12pm | 11 | **36.4%** |
| 18 | 1pm | 9 | **25.0%** |
| 19 | 2pm | 6 | **60.0%** |

**Morning (9-10am ET): 55-61%. Midday (11am-1pm ET): 25-36%.** Clear time-of-day pattern.

### Score x VIX Cross-Tab

| Score | VIX | N | Win Rate |
|-------|-----|---|----------|
| 45-54 | Elevated | 8 | **75.0%** |
| 65+ | Elevated | 13 | **61.5%** |
| 55-64 | Normal | 15 | **53.3%** |
| 65+ | Normal | 44 | **44.2%** |

**Best combo: moderate score + elevated VIX = 75%.**

### Win Rate by Symbol (n >= 3)

**Winners:** TSLA 71.4%, PLTR 75.0%, MARA 66.7%, QCOM 66.7%
**Losers:** SPY 16.7%, QQQ 28.6%, GOOGL 20.0%, IBIT 33.3%

### Factor Confluence

| Category | N | Win Rate |
|----------|---|----------|
| No strong factors present | 17 | **35.3%** |
| 2+ strong factors (PRIME, RSI_OS, Vel+, VIX_elev, Lower BB) | 33 | **66.7%** |

**Confluence of the RIGHT factors doubles win rate.**

### Checkpoint Progression

| Checkpoint | Win Rate |
|-----------|----------|
| 4h | 49.5% (45/91) |
| 24h | 45.6% (36/79) |
| 7d | No data yet |

Signals degrade from 4h to 24h — ~9% chance of flipping.

---

## 4. Tier Classification and Alert Flow

### Zone Assignment (lines 1431-1471)

| Zone | Condition | Priority |
|------|-----------|----------|
| HIGH_MOMENTUM | RSI >= 70 | 1st |
| LOW_MOMENTUM | RSI <= 30 (not at put wall) | 2nd |
| BUY_ZONE | RSI <= 30 + at put wall, OR just at put wall | 2nd/6th |
| EXTENDED_HIGH | Price above call wall by >1% | 3rd |
| EXTENDED_LOW | Price below put wall by >1% | 4th |
| PINNED | At both put and call wall | 5th |
| SELL_ZONE | At call wall | 7th |
| MID_RANGE | Default | Default |

### Tier Assignment (lines 1474-1554)

| Tier | Condition |
|------|-----------|
| HIGH_CONVICTION | isPrimeSetup AND score >= 40 AND not badZone |
| HIGH_CONVICTION | score >= 60 AND atWall AND has action AND not badZone |
| TRADEABLE | score >= 35 AND atWall AND has action AND not badZone |
| WATCH | score >= 20 AND near wall (within 2%) |
| WATCH | EXTENDED_LOW + extendedRSI + score >= 20 |
| WATCH | MID_RANGE + score >= 35 |
| TRADEABLE | PINNED + score >= 35 |
| FILTERED | Everything else |

**Bad zones (excluded from tradeable tiers):** EXTENDED_HIGH, HIGH_MOMENTUM

### Tier Adjustments (lines 1528-1554)

| Adjustment | Effect |
|------------|--------|
| VIX >= 20 + TRADEABLE + not badZone | TRADEABLE -> HIGH_CONVICTION |
| RETURNED history + HC or TRADEABLE | Capped at WATCH |
| DAY_2 history + HC or TRADEABLE | Capped at WATCH |
| Pinned direction + HC | Capped at TRADEABLE |

### What Gets Telegram Alerts

**Only HIGH_CONVICTION tier.** Additional filtering:
- New symbol -> always alert
- Zone or direction changed -> alert
- Score jumped 15+ points -> alert
- Same setup within 4h -> suppress
- Same setup, 2+ alerts already today -> suppress

TRADEABLE: logged for validation, no Telegram.
WATCH: dashboard only.
FILTERED: no output.

---

## 5. Alert Volume and Patterns

### Volume
- **~5 HC signals per day** (range 1-14)
- Peak: 14 signals on Feb 13
- **50% of signals fire 9-10am ET** (first 2 hours after open)

### VIX Regime Alert Chattering
- 28 VIX regime alerts in 11 days
- Feb 12: **13 alerts in one day** — VIX oscillating 19.77-20.26, flip-flopping normal/elevated every 5 min
- **No hysteresis** on the 20.0 threshold (line 2088: simple `!==` comparison)

### Repeat Alerters with Poor Outcomes

| Symbol | HC Alerts | Win Rate | Avg Peak |
|--------|-----------|----------|----------|
| SPY | 6 | 0-17% | 0.74% |
| GOOGL | 5 | 0-20% | 0.99% |
| QQQ | 7 | 28.6% | 1.13% |
| MSFT | 5 | 33.3% | 1.53% |
| ORCL | 2 | 0% | 0.25% |

---

## 6. Options Flow Analysis

### Flow Impact on Bloodhound Scoring (Conservative by Design)

Flow max contribution to Bloodhound score: ~23 pts
- Wall ENGAGED: +8 highEdge
- Elevated flow (2-5x): +5 standard
- Net premium ($10M+): +5 standard + 5 alignment = +10

5x+ unanchored flow: annotation-only, no score (correct — 30.8% WR).

### Flow Correlation with Outcomes

| Condition | N | Win Rate | Avg Peak |
|-----------|---|----------|----------|
| With unusual flow signals | 39 | **30.8%** | +1.84% |
| Without unusual flow | 31 | **38.7%** | +2.74% |
| Wall ENGAGED | 21 | **52.4%** | +2.87% |
| Wall ACTIVE (5x+) | 12 | **0%** | — |
| Wall DORMANT | 2 | **0%** | — |
| Net premium annotation | 41 | **29.3%** | — |

**Unusual flow hurts signal quality by 7.9 percentage points.**
**Net premium scoring (+5/+10 pts) has 29.3% WR — actively harmful.**

### Option Contract Tracking (Early Stage)

- 19 signals with option contracts tracked (of 93 total)
- Only 4 closed outcomes — too few for conclusions
- Peak gains impressive (50-200%+) but close gains are -100% (expiring worthless)
- 18 of 19 tracked signals hit their target wall (94.7%)

---

## 7. Backtest Results (MA Factors)

### Alignment Mode (10 years daily data, 11 symbols)

Best full_bull 5d WRs:

| Symbol | Best MA/Combo | Bull 5d WR | Bear 5d WR | Spread |
|--------|---------------|-----------|-----------|--------|
| SPY | SMA 20/200 | 62.7% | 51.5% | 11.2pp |
| AAPL | HMA 50/100 | 63.8% | 51.6% | 12.2pp |
| QQQ | HMA 50/100 | 62.7% | 64.2% | -1.5pp |
| NVDA | HMA 50/100 | 62.5% | 64.0% | -1.5pp |
| TSLA | HMA 10/20 | 59.2% | 52.9% | 6.3pp |
| META | EMA 50/100 | 57.2% | 52.8% | 4.4pp |

**Verdict:** 57-64% WR range. Below 65% threshold. **Correctly annotation-only.** Per-ticker variation is enormous.

### Crossover Mode (Golden Cross / Death Cross)

Best golden cross 5d WRs (n >= 15):

| Symbol | Best Combo | GC 5d WR | Sample |
|--------|------------|---------|--------|
| QQQ | EMA 8/50 | 82.9% | 35 |
| MSFT | SMA 25/50 | 81.8% | 22 |
| SPY | EMA 21/55 | 80.0% | 15 |
| TSLA | EMA 20/50 | 77.3% | 22 |
| META | SMA 12/50 | 70.6% | 17 |
| AAPL | EMA 3/8 | 66.9% | 127 |

**Caveat:** High WR combos have low samples (15-35 signals in 10 years). More robust combos with 100+ signals cluster at 60-67%. **Crossovers are rare events, not scanner factors** — could be "bonus" annotations.

### Bounce Mode (MA Support/Resistance)

Best bullish bounce 5d WRs:

| Symbol | Best Combo | Bounce 5d WR | Sample |
|--------|------------|-------------|--------|
| QQQ | SMA 150/200 | 75.9% | 29 |
| SPY | SMA 100/200 | 69.0% | 58 |
| AAPL | HMA 55/144 | 69.4% | 121 |
| NVDA | EMA 150/200 | 66.7% | 21 |
| META | EMA 40/100 | 65.1% | 109 |
| MSFT | EMA 100/200 | 64.1% | 64 |

**RSI < 50 filter on bounces is powerful for some tickers:**
- AAPL HMA 13/34: 70.7% (n=41)
- SPY HMA 20/50: 73.3% (n=15)
- META EMA 40/100: 72.7% (n=33)

**Verdict:** MA bounce + RSI < 50 is a potential scored factor but needs real-time bounce detection and per-ticker MA combo configuration.

---

## 8. Identified Problems (Ranked by Impact)

### P1: Hard Gate Failures (Sending Known-Bad Alerts)

| Problem | Win Rate | Impact | Fix |
|---------|----------|--------|-----|
| Pinned direction gets HC tier | 0%* | ~11 bad alerts | Hard-block from HC tier |
| Bearish/neutral direction gets HC | 0% | ~3 bad alerts | Hard-block from HC tier |
| SPY signals get HC tier | 17% | ~6 bad alerts | Hard-block SPY from HC |
| QQQ signals get HC tier | 29% | ~7 bad alerts | Hard-block QQQ from HC |

*Pinned WR needs reconciliation between two measurement methods (see note in section 3).

### P2: Score-Inflating Factors (Adding Points for Losers)

| Problem | Win Rate | Current Points | Fix |
|---------|----------|----------------|-----|
| Net premium scoring | 29.3% | +5 to +10 | Remove from scoring |
| Confluence zone | 51.6% | +5 | No edge — remove or reduce |
| Upper Bollinger Band | 37.5% | +5 | Remove from scoring |
| Against SPY penalty | 54.7% (good!) | -3 | Remove penalty |

### P3: Threshold Issues

| Problem | Data | Fix |
|---------|------|-----|
| Prime setup HC at score 40+ | 33% WR below 60 | Raise threshold to 55-60 |
| VIX regime chattering | 13 alerts/day at boundary | Add hysteresis (dead-band ±0.5) |
| 80+ score bucket underperforms | 44.4% WR | Investigate which factor combos inflate |

### P4: Missing Opportunities

| Opportunity | Data | Action |
|-------------|------|--------|
| Midday signal filtering | 25-36% WR 11am-1pm | Time-of-day annotation or gate |
| Dip buy under-weighted | 70% WR | Increase from +8 to +12 |
| Market internals at entry | Wins: A/D +197, Losses: -276 | Gather more data, potential gate |
| MA bounce + RSI < 50 | 70-76% WR for some tickers | Build real-time bounce detection |

---

## 9. Action Plan

### Tier 1 — Immediate Wins (Highest Impact, Low Risk)

**1a. Hard-gate pinned/bearish/neutral direction out of HC tier**
- Current: warning annotation only
- Change: these directions can never be HC, max WATCH
- Expected impact: eliminates ~14 losing signals

**1b. Remove net premium scoring**
- Current: +5 for $10M+ premium, +5 for aligned premium
- Change: annotation-only (no score impact)
- Expected impact: stops inflating ~41 signals with 29.3% WR factor

**1c. Hard-block SPY and QQQ from HC tier**
- Current: -8 point penalty (insufficient, base score overcomes it)
- Change: SPY/QQQ can never be HC, max WATCH
- Expected impact: eliminates ~13 losing signals (17-29% WR)

**1d. VIX hysteresis**
- Current: simple threshold comparison, no dead-band
- Change: require VIX > 20.5 to enter elevated, < 19.5 to exit. OR require 3 consecutive readings.
- Expected impact: eliminates alert storms (13 in one day)

### Tier 2 — Scoring Rebalance

**2a. Raise prime setup HC threshold from 40 to 55**
- Signals 40-54 via prime path have 33% WR
- Prime setup is great (70%) but needs other factors to confirm

**2b. Remove "against SPY trend" penalty (-3)**
- Counter-trend signals actually outperform (54.7% vs 46.7%)
- This penalty is actively hurting good signals

**2c. Remove upper Bollinger Band scoring (+5)**
- 37.5% WR on 8 signals — harmful factor

**2d. Reduce or remove confluence zone scoring (+5)**
- 51.6% WR on 62 signals — no edge, just noise

**2e. Increase dip buy bonus from +8 to +12**
- 70% WR — one of the best validated factors, under-weighted

### Tier 3 — Future Development

**3a. Time-of-day awareness**
- Morning (9-10am ET): 55-61% WR
- Midday (11am-1pm ET): 25-36% WR
- Add annotation; consider midday signal suppression or higher threshold

**3b. MA bounce detection**
- QQQ SMA 150/200 bounce: 75.9% WR
- SPY SMA 100/200 bounce: 69.0% WR
- MA bounce + RSI < 50 reaches 70%+ for select tickers
- Requires building real-time bounce detection + per-ticker MA config

**3c. Market internals gating**
- Wins had A/D spread +197, losses had -276 (small sample)
- As more data accumulates, could become an HC gate

**3d. Score cap investigation**
- 80+ score bucket underperforms (44.4%)
- Need to identify which specific factor combos in 80+ are losers
- May indicate some factors compound badly at high confluence

---

## 10. Validated Factor Summary

### Give Points (60%+ WR, proven)

| Factor | Win Rate | Current | Recommendation |
|--------|----------|---------|----------------|
| Prime setup (wall + RSI extreme) | 70.0% | +20 base | Keep |
| RSI oversold | 68.2% | +15 base | Keep |
| Dip buy (SPY bearish + bullish signal) | 70.0% | +8 std | Increase to +12 |
| VIX elevated | 64.0% | +10 highEdge | Keep |
| VIX fear | 66.7% | +15 highEdge | Keep |
| Volume spike (2x+) | 71.4% | +20 highEdge | Keep (monitor for inflation) |
| Streak 3+ days | 60.8% | +5 std | Keep |

### Penalize (proven losers)

| Factor | Win Rate | Current | Recommendation |
|--------|----------|---------|----------------|
| DAY_2 history | 21.4% | -5, cap WATCH | Keep |
| RETURNED history | 31.0% | -3, cap WATCH | Keep |
| Chasing (SPY bullish + bullish) | 40.0% | -8 std | Keep |
| Wall ACTIVE (5x+) | 0% | -3 std | Keep |
| Wall DORMANT | 0% | -3 std | Keep |

### Remove from Scoring (no edge or harmful)

| Factor | Win Rate | Current | Recommendation |
|--------|----------|---------|----------------|
| Net premium ($10M+) | 29.3% | +5 to +10 | Annotation-only |
| Upper Bollinger Band | 37.5% | +5 | Annotation-only |
| Confluence zone | 51.6% | +5 | Annotation-only |
| Against SPY trend | 54.7% (good!) | -3 penalty | Remove penalty |

### Hard Gates (never HC tier)

| Condition | Win Rate | Action |
|-----------|----------|--------|
| Pinned direction | 0%* | Max tier = WATCH |
| Bearish direction | 0% | Max tier = WATCH |
| Neutral direction | 0% | Max tier = WATCH |
| Symbol = SPY | 17% | Max tier = WATCH |
| Symbol = QQQ | 29% | Max tier = WATCH |

*Needs reconciliation — see section 3 note.

---

## Appendix A: Opportunity Scanner Architecture

- 52,739 records over 29 days (~2,800/day)
- Persistence filter (5+ scans = 98% accuracy) cuts noise by ~90%
- Two scanners (Opportunity + Bloodhound) are architecturally separate
- Both fetch from same Options API independently
- HC opportunities auto-add to Bloodhound watchlist (3-day expiry)
- No direct "flow score" transfer between systems

## Appendix B: Data Caveats

- 93 signals over ~4 weeks is a small sample for per-factor analysis
- Some factor WRs are based on n < 10 (pinned, bearish, low_momentum)
- Signal-outcomes and alert-analyzer agents used different WIN/LOSS counting methods for pinned direction — this MUST be reconciled before implementing pinned gates
- Backtest data is 10 years of daily bars; intraday behavior may differ
- VIX regime distribution is skewed (64 normal, 25 elevated, 0 fear/capitulation)

## Appendix C: Key File Locations

| File | Purpose |
|------|---------|
| `monitor/bloodhound-scanner.js` | Core scoring engine (2,663 lines) |
| `monitor/config.json` | API endpoints, Telegram config |
| `monitor/signal-db.js` | Signal tracking and validation |
| `monitor/opportunity-scanner.js` | Options flow detection |
| `scripts/ma-backtest.js` | MA backtesting tool |
| `scripts/enrich-signals-ma.js` | MA enrichment for signals |
| `data/wingman.db` | SQLite — signals, scans, backtests |
