# Scoring Overhaul — Data-Driven Improvements

**Status:** IN PROGRESS
**Files:** `monitor/bloodhound-scanner.js`, `monitor/premarket-scanner.js`
**Created:** 2026-02-15

---

## Why

After deduplicating signals (223→93), statistical analysis showed:

| Factor | Win Rate | Verdict |
|--------|----------|---------|
| STREAK history | 57.1% | Keep +5 |
| NEW history | 80.0% | Keep +3 |
| DAY_2 history | 23.1% | PENALIZE |
| RETURNED history | 31.3% | PENALIZE |
| SPY bearish setups | 70.0% | Under-rewarded |
| SPY bullish setups | 40.0% | Over-rewarded |
| WITH options flow | 20.0% | Generic flow HURTS |
| WITHOUT options flow | 49.3% | Better without! |
| Gap WIN rate | 3.3% | Broken scoring |

---

## Issues (work through one by one)

### ISSUE 1: DAY_2 penalty — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** DAY_2 history gets 0 points. Data shows 23.1% WR — worse than coin flip.
**Fix:** Add `scores.standard -= 5` and annotation when `historyStatus?.label === 'DAY_2'`
**Where:** After line 1563 (end of existing STREAK/NEW if-else chain)
**Code:**
```javascript
else if (historyStatus?.label === 'DAY_2') {
    scores.standard -= 5;
    signals.push(`⚠️ Day 2 setup — historically weak (23% WR)`);
}
```

---

### ISSUE 2: RETURNED penalty — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** RETURNED history gets 0 points but IS tier-capped at WATCH. Data shows 31.3% WR.
**Fix:** Add `scores.standard -= 3` and annotation when `historyStatus?.label === 'RETURNED'`
**Where:** After ISSUE 1's code (continues the else-if chain)
**Code:**
```javascript
else if (historyStatus?.label === 'RETURNED') {
    scores.standard -= 3;
    signals.push(`⚠️ Returned setup — historically weak (31% WR)`);
}
```

---

### ISSUE 3: DAY_2 tier cap — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** RETURNED is capped at WATCH (lines 1723-1726) but DAY_2 has NO cap. A DAY_2 with high base score can still be TRADEABLE or HC despite 23% WR.
**Fix:** Add identical cap for DAY_2 after the RETURNED cap block.
**Where:** After line 1726 (after existing RETURNED cap)
**Code:**
```javascript
if (historyStatus?.label === 'DAY_2' && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
    tier = 'WATCH';
    tradeable = false;
}
```

---

### ISSUE 4: SPY dip buy bonus too weak — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** Bullish signal + bearish SPY (dip buy) gets +5. Data shows 70% WR — strongest edge in dataset.
**Fix:** Change `+5` to `+8` at line 1494.
**Where:** Line 1494
**Change:** `scores.standard += 5` → `scores.standard += 8`

---

### ISSUE 5: SPY chasing penalty too weak — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** Bullish signal + bullish SPY (chasing) gets -5. Data shows 40% WR.
**Fix:** Change `-5` to `-8` at line 1498.
**Where:** Line 1498
**Change:** `scores.standard -= 5` → `scores.standard -= 8`

---

### ISSUE 6: Against-SPY has no score penalty — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** Line 1501-1503 catches direction opposing SPY trend but only logs — no score impact.
**Fix:** Add `scores.standard -= 3` before the existing signals.push.
**Where:** Line 1501-1503
**Current:**
```javascript
else if (direction !== 'neutral' && spyTrend && direction !== spyTrend) {
    signals.push(`⚠️ Against SPY ${spyTrend}`);
}
```
**New:**
```javascript
else if (direction !== 'neutral' && spyTrend && direction !== spyTrend) {
    scores.standard -= 3;
    signals.push(`⚠️ Against SPY ${spyTrend} (-3)`);
}
```

---

### ISSUE 7: High confluence annotation — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** No visual flag when a setup scores ≥70. Trader has to read the number.
**Fix:** Add annotation after totalScore is computed.
**Where:** After line 1609 (`const totalScore = Math.min(100, rawScore);`)
**Code:**
```javascript
if (totalScore >= 70) {
    signals.push(`🎯 HIGH CONFLUENCE (${totalScore}/100)`);
}
```

---

### ISSUE 8: PINNED tier cap too strict — STATUS: DONE
**File:** `monitor/bloodhound-scanner.js`
**What:** PINNED always capped at WATCH. But PINNED + high score + flow at wall is a valid breakout setup.
**Fix:** Allow PINNED to reach TRADEABLE (not HC). **TWO locations must change together.**
**Location 1 — Line 1705 (tier assignment):**
```javascript
// Change tier = 'WATCH' to:
tier = 'TRADEABLE';
```
**Location 2 — Lines 1728-1731 (tier cap):**
```javascript
// Current:
if (direction === 'pinned' && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
    tier = 'WATCH';
    tradeable = false;
}
// Change to:
if (direction === 'pinned' && tier === 'HIGH_CONVICTION') {
    tier = 'TRADEABLE';
}
```
**WARNING:** Changing only one location silently undoes the other.

---

### ISSUE 9: Options flow scores on ANY strike — STATUS: PENDING
**File:** `monitor/bloodhound-scanner.js`
**What:** Vol/OI ≥5 gives +10 highEdge regardless of WHERE in the chain. Data: 20% WR with flow vs 49.3% without. `classifyWallActivity()` (line 616) already checks flow AT the wall but isn't used for scoring.
**Fix:** Gate the +10 on wall activity status.
**Where:** Line 1358 — replace `scores.highEdge += 10` with:
```javascript
if (wallActivity?.status === 'ACTIVE') {
    scores.highEdge += 12;
} else if (wallActivity?.status === 'ENGAGED') {
    scores.highEdge += 6;
} else {
    signals.push(`ℹ️ Options flow detected (not at wall — informational)`);
}
```
**Context:** `wallActivity` is computed at lines 1296-1298, BEFORE this section. When not at wall, it's null → falls to else.

---

### ISSUE 10: No premium filter on flow — STATUS: PENDING
**File:** `monitor/bloodhound-scanner.js`
**What:** A $500 contract gets same weight as $50K. Small-dollar flow is retail noise.
**Fix:** Add premium filter after liquidity filter at line 1338.
**Where:** After line 1338
**Code:**
```javascript
const MIN_PREMIUM = 50000;
const significantCalls = liquidCalls.filter(c => (c.premium || 0) >= MIN_PREMIUM);
const significantPuts = liquidPuts.filter(p => (p.premium || 0) >= MIN_PREMIUM);
```
Then change `topCall`/`topPut` reduce calls (lines 1340-1346) to use `significantCalls`/`significantPuts`.

---

### ISSUE 11: Flow direction not checked against signal — STATUS: PENDING
**File:** `monitor/bloodhound-scanner.js`
**What:** Heavy call buying on a bearish signal still gets full score. No alignment check.
**Fix:** After the wall-activity scoring (ISSUE 9), add direction check.
**Where:** Inside the `if (maxCallVolOI >= 5 || maxPutVolOI >= 5)` block, after ISSUE 9's code.
**Code:**
```javascript
const flowDirection = (maxCallVolOI > maxPutVolOI) ? 'bullish' : 'bearish';
if (direction !== 'neutral' && direction !== 'pinned' && flowDirection !== direction) {
    if (wallActivity?.status === 'ACTIVE') scores.highEdge -= 6;
    else if (wallActivity?.status === 'ENGAGED') scores.highEdge -= 3;
    signals.push(`⚠️ Flow direction (${flowDirection}) opposes signal (${direction})`);
}
```

---

### ISSUE 12: Gap size over-weighted — STATUS: PENDING
**File:** `monitor/premarket-scanner.js`
**What:** Gap size worth 0-40 pts (40% of score). Data: 3.3% WIN rate. Size alone is misleading.
**Fix:** Rewrite `scoreMover()` at lines 609-635. Reduce gap size to 0-25, increase catalyst to 0-35, add -15 no-catalyst penalty.
**Where:** Lines 609-635 (full function replacement)
**New function:**
```javascript
function scoreMover(mover) {
    let score = 0;
    const absGap = Math.abs(mover.gap_pct);
    if (absGap >= 5) score += 25;
    else if (absGap >= 3) score += 20;
    else if (absGap >= 2) score += 15;
    else if (absGap >= 1) score += 5;

    if (mover.premarket_volume > 1000000) score += 20;
    else if (mover.premarket_volume > 500000) score += 15;
    else if (mover.premarket_volume > 100000) score += 10;

    if (mover.catalyst) {
        if (mover.catalyst.includes('earnings')) score += 35;
        else if (mover.catalyst.includes('news')) score += 25;
        else score += 15;
    }
    if (!mover.catalyst) score -= 15;

    if (mover.futures_aligned) score += 20;
    return Math.max(0, score);
}
```

---

### ISSUE 13: Gap tier thresholds too loose — STATUS: PENDING
**File:** `monitor/premarket-scanner.js`
**What:** HC≥70, TRADEABLE≥50, WATCH≥30. With reweighted scoring, raise by 5 each.
**Fix:** Change `determineTier()` at lines 640-645.
**Where:** Lines 640-645
**New:**
```javascript
function determineTier(score) {
    if (score >= 75) return 'HIGH_CONVICTION';
    if (score >= 55) return 'TRADEABLE';
    if (score >= 35) return 'WATCH';
    return 'FILTERED';
}
```

---

## Implementation Order

1. Issues 1-3 (history penalties) — simple, low risk
2. Issues 4-6 (SPY weights) — change 3 numbers + add 1 line
3. Issues 7-8 (annotations + PINNED cap) — watch the dual-location trap
4. Issues 12-13 (gap scoring) — premarket-scanner changes
5. Issues 9-11 (options flow) — most complex, do last
