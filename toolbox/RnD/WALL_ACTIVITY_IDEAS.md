# Wall Activity Enhancement Ideas

**Created:** January 9, 2026
**Status:** Backlog - revisit later

---

## Current State

Wall activity is classified by vol/OI ratio at the wall strike:

| Ratio | Status | Current Action |
|-------|--------|----------------|
| >= 5x | ACTIVE | Logged only |
| >= 2x | ENGAGED | Logged only |
| < 2x | DORMANT | -5 pts, blocks HIGH_CONVICTION |

---

## Enhancement Ideas

### 1. Add Wall Activity to Smart Money Dip Buy Trigger

**Current trigger:**
```javascript
RSI oversold + Unusual CALL + Put wall support
```

**Enhanced trigger:**
```javascript
RSI oversold + Unusual CALL + Put wall support + PUT wall ACTIVE/ENGAGED
```

**Why:** Support isn't just on paper - someone is actively defending that level TODAY.

**Implementation:**
```javascript
const hasActivePutWall = signals.some(s =>
    s.includes('PUT wall ACTIVE') || s.includes('PUT wall engaged'));

if (hasRsiOversold && hasUnusualCall && hasAtPutWall && hasActivePutWall) {
    signals.unshift('🎯 TRIGGER: Smart Money Dip Buy');
}
```

---

### 2. Reward Active Walls (Score Boost)

Currently we only penalize dormant (-5 pts). Could add:
- ACTIVE wall: +10 pts (high confidence level will hold)
- ENGAGED wall: +5 pts (moderate confidence)

**Trade-off:** More complexity, but more accurate wall confidence.

---

### 3. Breakout Signal (Dormant = Easier to Break)

A dormant resistance wall might be GOOD for breakout trades:
- Wall exists on paper but no one defending it
- Price more likely to slice through

**Could add:**
```javascript
if (isBreakout && wallActivity === 'DORMANT') {
    scores.levels += 5;
    signals.push('Dormant resistance (easier breakout)');
}
```

---

### 4. Wall Activity Velocity

Track if wall activity is INCREASING or DECREASING over scans:
- Wall becoming more active = conviction building
- Wall going dormant = fading interest

**Data structure:**
```javascript
{
  "TSLA": {
    "putWall": {
      "history": [
        { "timestamp": "...", "volOiRatio": 1.2, "status": "DORMANT" },
        { "timestamp": "...", "volOiRatio": 3.5, "status": "ENGAGED" },
        { "timestamp": "...", "volOiRatio": 6.1, "status": "ACTIVE" }
      ],
      "trend": "BUILDING"  // or "FADING"
    }
  }
}
```

---

### 5. Dashboard Visual Enhancement

Show wall activity status on zone scanner cards:
- Green badge = ACTIVE
- Yellow badge = ENGAGED
- Red badge = DORMANT

Currently shows "CALL wall dormant (stale OI)" in analysis text - could make it more visual.

---

## Priority Assessment

| Idea | Impact | Effort | Priority |
|------|--------|--------|----------|
| Add to trigger | High | Low | **1** |
| Reward active | Medium | Low | 2 |
| Breakout signal | Medium | Medium | 3 |
| Activity velocity | High | High | 4 |
| Dashboard visual | Low | Medium | 5 |

---

## Notes

- Wall activity is already being calculated - these ideas just USE the data more
- The TSLA trigger didn't have wall activity data in the original signal, so adding it as REQUIRED might be too restrictive
- Consider making it a BONUS rather than REQUIRED for the trigger

---

## Related Files

- `monitor/bloodhound-scanner.js` - `classifyWallActivity()` function (line 329)
- `toolbox/STRATEGY_01_SMART_MONEY_DIP.md` - Current trigger definition
