# Bloodhound Scoring Engine — Complete Audit

**Date:** 2026-02-12
**Source:** `monitor/bloodhound-scanner.js`
**Visualized:** `research.html` → Insights tab → "How Your Alerts Are Built"

---

## Pipeline Overview

```
Symbol Discovery → Data Collection → Scoring (3 categories) → Zone → Tier → Alert Decision
```

Every 5 minutes. Up to 50 symbols per scan.

---

## Step 1: Symbol Discovery

**Static Slots (always scanned, score 100):**
SPY, QQQ, NVDA, TSLA, AMD, AAPL, META, MSFT, IBIT (9 symbols, source='manual' in SQLite watchlist)

**Dynamic Slots (~41 remaining, competitive by score):**

| Source | Score | Description |
|--------|-------|-------------|
| Watchlist (premarket_gap, signal_tracking) | 60 | Auto-added by other scanners |
| 52wk extreme + volume spike | 55 | Both conditions met |
| Sector rotation leader | 30 | Strongest XL* ETF |
| 52wk extreme | 25 | Near 52wk high or low |
| Sector rotation laggard | 25 | Weakest XL* ETF with volume |
| Volume spike only | 20-30 | High relative volume |

---

## Step 2: Data Collection (Per Symbol)

Sequential API calls with 100ms delays between each:

1. `GET /api/levels/{symbol}` — gamma walls, max pain, VWAP, gamma flip
2. `GET /api/technicals/{symbol}` — RSI, MAs, trend, Bollinger, volume ratio
3. `GET /api/options/{symbol}/analysis` — unusual activity, premium flow, vol/OI

**Pre-scan (cached, once per cycle):**
- Market context: VIX, SPY/QQQ levels, AI outlook, IV rank
- Sector RS: Direct SQLite read from divergence scanner DB (28 assets, ~76ms)
- Rotation regime: API call to divergence scanner

**Separate process:** Market internals (TICK, TRIN, A/D, vol ratio) updated every 2 min by `market-internals.js`

---

## Step 3: Confluence Scoring (0-100)

**Three categories add independently, clamped to 0-100.**

### BASE FACTORS (0-50 pts) — The Foundation

| Factor | Points | Condition |
|--------|--------|-----------|
| At put wall | +15 | Price within 1% of put wall |
| At call wall | +15 | Price within 1% of call wall |
| Pinned (both walls) | +15 | Within 1% of BOTH walls |
| RSI oversold | +15 | RSI ≤ 30 |
| RSI overbought | +15 | RSI ≥ 70 |
| **PRIME COMBO BONUS** | **+20** | **Wall + RSI together (89.5% historical win rate)** |

Max base: 50 pts (e.g., wall +15, RSI +15, combo +20)

### HIGH-EDGE FACTORS (0-35 pts) — Volume & Volatility

| Factor | Points | Condition |
|--------|--------|-----------|
| Volume spike | +20 | volRatio ≥ 2.0 |
| Elevated volume | +15 | volRatio ≥ 1.3 |
| VIX fear | +15 | VIX ≥ 30 |
| Unusual options | +10 | vol/OI ≥ 5x (min 50 OI) |
| VIX elevated | +10 | VIX 20-30 |

### STANDARD FACTORS (0-30 pts) — Confirming Details

| Factor | Points | Condition |
|--------|--------|-----------|
| Breakout above call wall | +8 | Price > call wall by 0.3%+ |
| Breakdown below put wall | +8 | Price < put wall by 0.3%+ |
| Above/below gamma flip | +4 | Added to breakout/breakdown |
| Sector RS top quartile | +8 | RS percentile ≥ 75 |
| Sector RS above median | +4 | RS percentile 50-74 |
| Bollinger Band extreme | +5 | bbPosition ≤ 0.1 or ≥ 0.9 |
| At VWAP | +5 | Within 0.3% of VWAP |
| RSI pullback in uptrend | +5 | RSI ≤ 40 + uptrend |
| RSI bounce in downtrend | +5 | RSI ≥ 60 + downtrend |
| Fibonacci (golden pocket) | +5 | Price at 0.618 fib within 1.5% |
| Fibonacci (50%) | +4 | Price at 0.5 fib within 1.5% |
| Fib + MA confluence | +3 | Fib level near key MA |
| Fib + wall confluence | +3 | Fib level aligns with wall |
| Confluence zone | +5 | 2+ levels within 0.5% |
| Net premium ≥$10M | +5 | Large directional flow |
| Premium + flow alignment | +5 | Flow matches setup direction |
| SPY trend alignment | +5 | Setup matches SPY trend |
| Multi-TF aligned | +5 | Swing + intraday both match |
| Swing only aligned | +3 | Swing matches, intraday doesn't |
| AI outlook mention | +5 | Symbol in AI outlook |
| Elevated options 2-5x | +5 | 2 ≤ vol/OI < 5 |
| History: STREAK | +5 | Consecutive scan days |
| History: NEW | +3 | First appearance |
| Internals confirm | +5 | ≥2 of TICK/A-D/Vol match direction |
| Sector RS below median | -3 | RS percentile 25-49 |
| **Sector RS bottom quartile** | **-5** | **RS percentile < 25** |
| Dormant wall | -3 | At wall but low vol/OI |
| Opposing internals | -3 | ≥2 internals against direction |

**Formula:** `clamp(Base + HighEdge + Standard, 0, 100)`

---

## Step 4: Zone Classification

Based on price position relative to gamma walls:

| Zone | Condition |
|------|-----------|
| BUY_ZONE | At put wall (within 1%) |
| SELL_ZONE | At call wall (within 1%) |
| PINNED | At both walls simultaneously |
| EXTENDED_HIGH | Above call wall by 0.3%+ |
| EXTENDED_LOW | Below put wall by 0.3%+ |
| HIGH_MOMENTUM | RSI ≥ 70 (no wall) |
| LOW_MOMENTUM | RSI ≤ 30 (no wall) |
| MID_RANGE | None of the above |

---

## Step 5: Tier Assignment

| Tier | Criteria | Alerts? |
|------|----------|---------|
| HIGH_CONVICTION | Prime setup (wall+RSI) + score ≥40, OR score ≥50 at wall + action | Telegram |
| TRADEABLE | Score ≥35 at wall + action | Database only |
| WATCH | Score ≥20 near wall, OR score ≥35 mid-range/pinned | Dashboard only |
| FILTERED | Everything else | Not shown |

**Exclusion zones:** EXTENDED_HIGH and HIGH_MOMENTUM are never tradeable.

**Safety Caps (force downgrade to WATCH):**
- Bearish direction → WATCH (0% historical win rate, n=11)
- Neutral direction → WATCH (0% win rate)
- Pinned direction → WATCH (0% win rate)
- RETURNED setups → WATCH (11% win rate)

---

## Step 6: Alert Decision

**Only HIGH_CONVICTION fires Telegram alerts.**

**Deduplication rules:**
- New symbol → always alert
- Zone or direction changed → alert (new signal)
- Score jumped ≥15 pts → alert (new confluence appeared)
- Same setup within 4 hours → suppress
- Max 2 alerts per symbol per day
- Setup tracker entries expire after 24 hours

**Warning annotations (added to message, don't suppress alert):**
- Counter-trend (setup vs swing bias)
- Dormant wall (low options activity)
- Returned/pinned/bearish/neutral direction

---

## Key Findings from Signal Data (209 signals, 203 validated)

### What Works
- **VIX elevated** → 58.8% win rate vs normal 41.7% (17pp advantage)
- **PINNED zone** → 63.3% win rate (highest of any zone)
- **24h checkpoint** → 49.7% accuracy vs 4h at 34.7% (signals need time)
- **Prime combo** → 89.5% win rate (wall + RSI together)

### What Doesn't
- **SPY bearish/neutral** → 0% win rate (biggest blind spot)
- **Sector RS penalty** → Only -5 to +8 on 100-point scale (too weak)
- **Bearish signals** → 0% win rate (system has long bias)
- **VIX threshold oscillation** → 18 alerts in 30 days, many are noise around 20.0

### Recommended Improvements (Priority Order)
1. **HIGH:** Gate alerts on SPY trend (suppress when bearish/neutral)
2. **HIGH:** Weight scoring by VIX regime (1.2x elevated, 0.8x normal)
3. **MEDIUM:** Increase sector RS weight (-15 for bottom decile, +12 for top quartile)
4. **MEDIUM:** Add VIX hysteresis (trigger at 20.5, clear at 19.5)
5. **LOW:** Use 24h as primary evaluation window instead of 4h

---

## Settings Reference

| Setting | Value | Location |
|---------|-------|----------|
| scanIntervalMs | 300000 (5 min) | SETTINGS |
| minConfluenceScore | 35 | SETTINGS |
| WALL_THRESHOLD_PCT | 1.0 | SETTINGS |
| RSI_OVERSOLD / OVERBOUGHT | 30 / 70 | SETTINGS |
| VIX_ELEVATED / FEAR | 20 / 30 | SETTINGS |
| VOLUME_ELEVATED | 1.3 | SETTINGS |
| sameSetupCooldownMs | 14400000 (4h) | DEDUP |
| scoreJumpThreshold | 15 | DEDUP |
| maxAlertsPerSetup | 2 | DEDUP |
| setupExpiryMs | 86400000 (24h) | DEDUP |
