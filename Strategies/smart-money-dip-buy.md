# Smart Money Dip Buy Strategy

## Overview

This strategy identifies institutional accumulation at oversold levels **ahead of earnings** by combining:
1. **RSI Reset** (RSI < 35) - Momentum exhaustion
2. **Put Wall Support** - Gamma-based floor
3. **Unusual Call Activity** - Smart money positioning
4. **Earnings Timing** (5-14 days out) - The catalyst driving the activity

When these factors align, it signals "smart money buying the dip" ahead of earnings with a high probability bounce to the call wall.

**Critical Insight:** Historical analysis shows 4 of 5 top winning signals (Jan 20-23, 2026) were in the PREM window. The unusual call activity we detect is primarily driven by pre-earnings positioning.

---

## The Formula

```
ENTRY = RSI < 35 + Put Wall Support + Unusual Call Activity + Earnings (5-14 days)
TARGET = Gamma Flip → Call Wall (exit BEFORE earnings)
STOP = Below Put Wall (1-2%)
```

---

## Trigger Detection

The Bloodhound scanner automatically detects this pattern. When triggered, you'll see:

```
🎯 TRIGGER: Smart Money Dip Buy
```

**In the codebase** (`monitor/bloodhound-scanner.js` lines 1768-1776):
```javascript
const hasRsiLowMomentum = signals.some(s => s.includes('RSI low momentum'));
const hasUnusualCall = signals.some(s => s.includes('Unusual CALL'));
const hasAtPutWall = signals.some(s => s.includes('put wall support'));

if (hasRsiLowMomentum && hasUnusualCall && hasAtPutWall) {
    signals.unshift('🎯 TRIGGER: Smart Money Dip Buy');
}
```

---

## Entry Criteria Checklist

**Core Requirements (need all 3):**

| Factor | Signal | Why |
|--------|--------|-----|
| RSI < 35 | `RSI low momentum` or `RSI oversold` | Momentum exhausted |
| At Put Wall | `put wall support` or within 1% | Gamma floor in place |
| Unusual Calls | `Unusual CALL activity` (Vol > 2x OI) | Smart money positioning |

**Confluence Factors (need 2+ of 4):**

| Factor | Signal | Why |
|--------|--------|-----|
| **Earnings 5-14 days** | Check earnings calendar | **Primary catalyst** - explains the call activity |
| Lower Bollinger Band | Price at or below lower BB | Technical oversold confirmation |
| C/P Ratio > 2x | Call volume dominates | Bullish bias confirmation |
| Net Call Premium > $1M | Real money flow | Size confirms conviction |

**Optional Boosters:**

| Factor | Description | Impact |
|--------|-------------|--------|
| Golden Pocket | 50-61.8% Fib retracement | Higher conviction |
| VELOCITY | Fast move into zone | Watch for continuation |
| Confluence Zone | Multiple levels at same price | Stronger support |

---

## Historical Performance (Jan 20-23, 2026)

Analysis of top winning signals from last week:

| Symbol | Peak Gain | Days to Earnings | Earnings Date | Signals Present |
|--------|-----------|------------------|---------------|-----------------|
| META | +10.5% | 5-8 days | Jan 28 | RSI 28, Put wall, Unusual calls, Lower BB |
| TSLA | +6.8% | 5-8 days | Jan 28 | RSI 29, Put wall, Call flow, Golden pocket |
| NVDA | +4.9% | No earnings | - | RSI 31, Put wall support, C/P ratio 2.3x |
| MSFT | +4.4% | 5-8 days | Jan 28 | RSI 27, Put wall, Unusual call activity |
| AAPL | +3.2% | 6-9 days | Jan 29 | RSI 12, Put wall, 6.8x C/P ratio |

**Critical Finding:**
- **4 of 5 top wins were in PREM window** (5-10 days before earnings)
- NVDA was the exception - no earnings, still worked but smaller gain
- The unusual call activity we detected was pre-earnings positioning

**Common characteristics of winners:**
- All had RSI < 35 (most < 30)
- All were at put wall support
- All showed unusual call activity
- **Most were 5-10 days from earnings**
- Average peak gain: 3-10%

---

## Why It Works

### The Mechanics

1. **RSI Exhaustion** - When RSI < 30, selling pressure is exhausted
   - Mean reversion probability increases significantly
   - Short covering adds fuel to bounces

2. **Put Wall as Floor** - Gamma mechanics create support
   - Dealers who sold puts must buy stock to hedge as price drops
   - This buying accelerates near the put wall
   - Creates a "gamma floor" effect

3. **Unusual Call Activity** - Smart money positioning
   - When Vol >> Open Interest, NEW positions are being opened
   - Institutions accumulate calls before the crowd
   - C/P ratio > 2x confirms bullish bias

4. **Confluence = Conviction** - Multiple factors at same level
   - Each factor alone = moderate probability
   - All three together = high probability bounce

### The Gamma Acceleration

Once price bounces and breaks above gamma flip:
1. Dealers who sold calls must buy stock to hedge
2. This buying accelerates the move
3. Price gets "pulled" toward call wall
4. Creates a self-reinforcing upward move

---

## Trade Management

### Entry
- Wait for RSI < 30 + put wall test
- Confirm unusual call activity (C/P > 2x preferred)
- Enter on bounce confirmation (higher low on lower timeframe)
- Don't chase - let price come to support

### Stop Loss
- Below put wall (1-2% below entry)
- If put wall breaks, thesis is invalid
- Hard stop, no hoping

### Targets
| Target | Level | Action |
|--------|-------|--------|
| T1 | Gamma Flip | Take 50% profit |
| T2 | Call Wall | Take remaining |
| Runner | Beyond call wall | Trail if momentum strong |

### Position Sizing
- Standard risk rules (1% account risk)
- Size based on stop distance
- No YOLO sizing even on high conviction

---

## When to Skip

Do NOT take this setup if:
- **Earnings < 2 days away** - Binary outcome, IV crush risk
- **No earnings in next 14 days** - Reduced conviction (can still work, but lower probability)
- Market-wide selloff (SPY breaking support)
- VIX > 35 (fear regime - wait for stabilization)
- RSI divergence negative (lower lows on RSI)
- Put wall already broken on previous test

---

## Earnings: The Primary Catalyst

**Why earnings timing matters:**

The unusual call activity we detect is not random - it's institutions positioning for earnings:

| Timing | What's Happening | Signal Strength |
|--------|------------------|-----------------|
| 10-14 days out | Early accumulation begins | Moderate |
| 5-10 days out | **Sweet spot** - heavy positioning | **Strongest** |
| 2-4 days out | Late/risky - IV crush coming | Weak |
| < 2 days out | Avoid - binary outcome | Skip |

**The PREM (Pre-Earnings Momentum) Window:**
- Institutions buy calls 5-14 days before earnings
- IV expands into earnings (helps call holders)
- Price tends to drift toward call wall
- Exit BEFORE earnings to avoid IV crush

**Without earnings:** The pattern can still work (see NVDA example), but:
- Gains tend to be smaller
- Less predictable timing
- Fewer institutional buyers

---

## System Integration

### Where It Appears

1. **Zone Scanner Dashboard** - Ticker cards with 🎯 TRIGGER signal
2. **Telegram Alerts** - HIGH_CONVICTION alerts include trigger
3. **Signal Database** - Logged for performance tracking
4. **Morning Briefing** - Highlighted in high conviction section

### Querying Historical Performance

```sql
-- Find all Smart Money Dip Buy triggers
SELECT symbol, entry_price, peak_gain_pct, final_outcome
FROM signals
WHERE signals_json LIKE '%Smart Money Dip Buy%'
ORDER BY timestamp DESC;
```

---

## Case Studies

### META (January 21, 2026)

**Setup:**
- RSI: 28 (oversold)
- Position: At put wall $605
- Call activity: 2.8x C/P ratio, +$15M net premium
- Additional: Lower Bollinger Band touch

**Outcome:**
- Entry: ~$607
- Peak: $671 (+10.5%)
- Target hit: Call wall at $665

### AAPL (January 26, 2026)

**Setup:**
- RSI: 12 (extremely oversold)
- Position: At put wall / high OI support $249.74
- Call activity: 6.83x C/P ratio, +$40.5M net premium
- Additional: 10 days to earnings (PREM window)

**Outcome:**
- Support held at $249.74 exactly
- Bounced through gamma flip $252.66
- Approached call wall at $255.00

---

## Summary

The Smart Money Dip Buy is our highest-conviction reversal pattern. It works because it combines:
- **Technical exhaustion** (RSI < 35)
- **Structural support** (put wall gamma floor)
- **Institutional positioning** (unusual call activity)
- **Earnings catalyst** (5-14 days out) ← **Primary driver**

Historical analysis shows 4 of 5 top wins were in the PREM window. The unusual call activity we're detecting is primarily institutions positioning for earnings. Without earnings, the pattern can still work but with reduced conviction.

**The trigger in one sentence:**
> When smart money accumulates calls at gamma-supported oversold levels ahead of earnings, follow them.

---

*Strategy documented from live market observation. Past performance does not guarantee future results.*
