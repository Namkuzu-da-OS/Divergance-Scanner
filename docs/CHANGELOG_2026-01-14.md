# Changelog: Scanner Signal Accuracy Fixes (Jan 14, 2026)

Based on backtest of 460 signals (Jan 12-14, 2026).

---

## Summary of Changes

| Change | File | Lines | Purpose | Revert? |
|--------|------|-------|---------|---------|
| Fib Golden Zone | bloodhound-scanner.js | 261-306, 1365-1400 | 0.5 + 0.618 entries, 1.272 + 1.618 targets | See below |
| Counter-trend override | bloodhound-scanner.js | 1674-1679 | Bearish→pinned in bull market | See below |
| Bad zone exclusion | bloodhound-scanner.js | 1787-1800 | EXTENDED_HIGH out of HIGH_CONVICTION | See below |
| EXTENDED_HIGH direction | bloodhound-scanner.js | 1784-1790 | Bullish→pinned in EXTENDED_HIGH | See below |

---

## Change 1: Fib Signal Cleanup

**Problem:** Too many Fib levels cluttering alerts (0.236, 0.382, 0.5, 0.618, 0.786 + all extensions)

**Backtest:** Golden Pocket (0.618) = 83.3% win rate, other Fibs = noise

**What changed:**

### In `checkFibWallConfluence` function (~line 261):
```javascript
// BEFORE: Checked ALL retracements and extensions against walls
for (const [level, fibPrice] of Object.entries(fibLevels.retracements)) { ... }
for (const [level, fibPrice] of Object.entries(fibLevels.extensions)) { ... }

// AFTER: Only checks 0.618 (Golden Pocket) and 1.618 extension
if (putWall && fibLevels.retracements['0.618']) { ... }
if (callWall && fibLevels.extensions['1.618']) { ... }
```

### In scoring section (~line 1371):
```javascript
// BEFORE: Reported all retracements and extensions
} else if (fibSignal.type === 'retracement') {
    scores.technical += 5;
    signals.push(`📐 At ${fibSignal.level} Fib ...`);
} else if (fibSignal.type === 'extension') {
    scores.technical += 5;
    signals.push(`🎯 At ${fibSignal.level} extension ...`);
}

// AFTER: Only reports 1.618 extension (Golden Pocket already handled separately)
} else if (fibSignal.type === 'extension' && fibSignal.level === 1.618) {
    scores.technical += 5;
    signals.push(`🎯 At 1.618 extension ...`);
}
// Other Fibs removed - comment explains why
```

**To revert:** Restore the loops in `checkFibWallConfluence` and the full if/else in scoring.

---

## Change 2: Counter-Trend Direction Override

**Problem:** Bearish signals in bullish market = 16.4% win rate (51/51 failures had "Against SPY bullish")

**What changed (~line 1674):**
```javascript
// ADDED after the "Against SPY" warning:
// BACKTEST FIX: Don't call bearish in bullish market (16.4% win rate)
// Override to pinned instead of fighting the trend
if (direction === 'bearish' && spyTrend === 'bullish') {
    direction = 'pinned';
    signals.push(`📍 Downgraded to PINNED (counter-trend)`);
}
```

**To revert:** Remove lines 1674-1679 (the if block that overrides direction to 'pinned')

---

## Change 3: Bad Zones Excluded from HIGH_CONVICTION

**Problem:** HIGH_CONVICTION tier = 37.2% win rate (worse than WATCH at 74.9%)
- 22/96 HIGH_CONVICTION signals were EXTENDED_HIGH zone
- EXTENDED_HIGH = 4.5% win rate
- Bad zones dragging down the tier

**What changed (~line 1787):**
```javascript
// ADDED before HIGH_CONVICTION checks:
// BACKTEST FIX: Exclude bad zones from HIGH_CONVICTION
// EXTENDED_HIGH = 4.5% win rate, OVERBOUGHT has similar issues
const badZones = ['EXTENDED_HIGH', 'OVERBOUGHT'];
const notBadZone = !badZones.includes(zone);

// MODIFIED: Added "&& notBadZone" to both HIGH_CONVICTION conditions
if (totalScore >= 70 && (atPutWall || atCallWall) && notBadZone) { ... }
if (totalScore >= 80 && (nearPutWall || nearCallWall) && notBadZone) { ... }
```

**To revert:** Remove `badZones` and `notBadZone` variables, remove `&& notBadZone` from conditions

---

## Change 4: EXTENDED_HIGH Direction Override

**Problem:** 21/22 EXTENDED_HIGH signals were bullish direction, 4.5% win rate
- Breakouts above call walls often fail (profit-taking)
- Should be reversal watch, not bullish continuation

**What changed (~line 1784):**
```javascript
// ADDED after zone assignment, before tier logic:
// BACKTEST FIX: EXTENDED_HIGH = reversal watch zone, not bullish continuation
// 21/22 EXTENDED_HIGH signals were bullish, 4.5% win rate
// Override bullish to pinned - don't chase breakouts
if (zone === 'EXTENDED_HIGH' && direction === 'bullish') {
    direction = 'pinned';
    signals.push(`📍 Extended high - reversal watch`);
}
```

**To revert:** Remove lines 1784-1790 (the entire if block)

---

## Backtest Data (Pre-Fix)

| Category | Win Rate | Signals |
|----------|----------|---------|
| Golden Pocket | 83.3% | 14 |
| BUY_ZONE | 81.8% | 244 |
| Score 90-100 | 82.9% | 289 |
| PINNED direction | 100% | 217 |
| **bearish direction** | **16.4%** | 69 |
| **EXTENDED_HIGH** | **4.5%** | 22 |
| **SELL_ZONE** | **31%** | 50 |
| **HIGH_CONVICTION tier** | **37.2%** | 96 |

---

## Verification Commands

```bash
# Run backtest to compare before/after
node backtesting/signal-backtester.js

# Analyze specific failures
node backtesting/analyze-failures.js

# Check scanner logs
pm2 logs bloodhound --lines 50

# Restart scanner after changes
pm2 restart bloodhound
```

---

## Files Created

| File | Purpose |
|------|---------|
| `backtesting/signal-backtester.js` | Full backtest by direction, zone, score, VIX |
| `backtesting/analyze-failures.js` | Deep dive into failed signal patterns |
| `docs/CHANGELOG_2026-01-14.md` | This file |
