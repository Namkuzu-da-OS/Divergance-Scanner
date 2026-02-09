# Changelog: 2026-01-16

## Summary

Major improvements to both Bloodhound and Opportunity scanners:
- Fixed Bloodhound logic issues (SPY comparison, Fib matching, PINNED tiers, PUT interpretation)
- **Converted Opportunity Scanner to dynamic discovery** (no more hardcoded symbols)
- **Added SQLite historical data collection** for future analysis
- Created comprehensive visual workflow documentation

---

## Opportunity Scanner: Dynamic Discovery + SQLite

### Problem
The Opportunity Scanner had a hardcoded list of 71 symbols in `SCAN_UNIVERSE`, missing hot movers like SMCI (+7.7% that day).

### Solution: Dynamic Symbol Discovery

**New file:** `monitor/opportunity-db.js`

Replaced hardcoded symbols with 7 dynamic discovery sources:

| Source | Score | Description |
|--------|-------|-------------|
| Core | 100 | SPY, QQQ, IWM (always scan) |
| Watchlist | 50 | User priorities from watchlist.json |
| Volume Leaders | 40 | Top volume from $SPX movers |
| Gainers | 35 | Stocks up 2%+ today |
| Losers | 35 | Stocks down 2%+ (reversal candidates) |
| NASDAQ Movers | 35 | Top volume from $COMPX |
| 52-Week Extremes | 30 | Breakout/breakdown candidates |

**Result:** Scanner now discovers ~20-30 symbols dynamically each cycle.

### SQLite Historical Data Collection

**New file:** `data/wingman.db`

Every scan now stores results to SQLite for future analysis:

```sql
-- Scan metadata
CREATE TABLE scans (
    id, timestamp, symbols_scanned,
    high_conviction_count, tradeable_count, watch_count,
    market_vix, market_spy_price, market_spy_trend
);

-- Individual opportunities
CREATE TABLE opportunities (
    id, scan_id, symbol, timestamp,
    discovery_score, discovery_sources,
    opportunity_score, tier, price,
    vol_oi_ratio, unusual_activity,
    gap_percent, iv_percentile, rsi, signals
);
```

**Stats after first day:**
- 9 scans recorded
- 189 opportunities tracked
- 103 HIGH_CONVICTION, 36 TRADEABLE, 41 WATCH

### Files Changed

| File | Change |
|------|--------|
| `monitor/opportunity-scanner.js` | Added dynamic discovery, SQLite integration |
| `monitor/opportunity-db.js` | **NEW** - SQLite database module |
| `package.json` | Added `better-sqlite3` dependency |
| `data/wingman.db` | **NEW** - Historical data storage |

### Query Examples for Future Analysis

```sql
-- Which discovery sources produce best opportunities?
SELECT json_each.value as source, COUNT(*) as total,
       SUM(CASE WHEN tier = 'HIGH_CONVICTION' THEN 1 ELSE 0 END) as high_conviction
FROM opportunities, json_each(discovery_sources)
GROUP BY json_each.value ORDER BY high_conviction DESC;

-- Symbols appearing most in HIGH_CONVICTION
SELECT symbol, COUNT(*) as appearances
FROM opportunities WHERE tier = 'HIGH_CONVICTION'
GROUP BY symbol ORDER BY appearances DESC LIMIT 20;
```

---

## Documentation Updates

### New Files Created

| File | Purpose |
|------|---------|
| `docs/VISUAL_WORKFLOWS.md` | 10 ASCII diagrams explaining entire system |

### Files Updated

| File | Changes |
|------|---------|
| `docs/SYSTEM_ARCHITECTURE.md` | Added SQLite schema, opportunity-db.js dependency |

---

## Bloodhound Scanner Logic Fixes

### Current Configuration (Before Changes)

```javascript
const SETTINGS = {
    scanIntervalMs: 5 * 60 * 1000,  // 5 minutes (changed from 2 min earlier today)
    minConfluenceScore: 48,          // Minimum score to alert (0-80)
    maxSymbols: 20,                  // Max symbols per scan
    alertCooldownMs: 30 * 60 * 1000, // 30 min cooldown per symbol
    ignoreMarketHours: false,
    velocityThreshold: 20,
    autoTrackMinScore: 80,
    signalExpirationDays: 5,
};
```

### Issues Identified

1. **SPY vs SPY comparison** - SPY trend compared to itself, producing nonsensical "Against SPY bullish" signals on SPY
2. **Fib matching too loose** - 1% tolerance allows $7+ price differences to show as "Fib = Wall" matches
3. **PINNED no tier** - Max score (80/80) + PINNED zone = FILTERED tier (should be WATCH)
4. **Unusual PUT always bearish** - All unusual PUT activity flagged as bearish, ignoring:
   - ITM vs OTM distinction
   - 0DTE expiration mechanics
   - Dealer hedging dynamics (OTM creates "charm bid")

### Changes Made

#### Fix 1: Skip SPY Trend Comparison for SPY/QQQ
**Location:** ~Line 1470

Before:
```javascript
const spyTrend = marketContext.spyTrend;
// Applied to ALL symbols including SPY itself
```

After:
```javascript
// Skip SPY trend comparison for index ETFs
if (symbol !== 'SPY' && symbol !== 'QQQ') {
    const spyTrend = marketContext.spyTrend;
    // ... comparison logic
}
```

#### Fix 2: Tighten Fib-Wall Matching Tolerance
**Location:** `checkFibWallConfluence()` ~Line 272

Before:
```javascript
const distance = Math.abs((callWall - fibPrice) / callWall * 100);
if (distance <= threshold) {  // 1.0% default - too loose for high-priced stocks
```

After:
```javascript
const dollarDiff = Math.abs(callWall - fibPrice);
// Must be within $2 OR 0.3%, whichever is larger
const tolerance = Math.max(2.0, callWall * 0.003);
if (dollarDiff <= tolerance) {
```

#### Fix 3: PINNED Symbols Get WATCH Tier
**Location:** ~Line 1643

Added:
```javascript
// WATCH: High-score PINNED setups (waiting for direction)
if (zone === 'PINNED' && totalScore >= 56) {
    tier = 'WATCH';
}
```

#### Fix 4: Context-Aware Unusual PUT Interpretation
**Location:** ~Line 1415

Research basis:
- OTM puts (strike < spot) = tail-risk hedges, create "charm bid" (supportive)
- ITM puts (strike > spot) = directional conviction OR deep hedge
- 0DTE activity = often expiration mechanics, not directional signal

Before:
```javascript
if (direction === 'neutral') direction = 'bearish';  // All puts = bearish
```

After:
```javascript
if (topPut && currentPrice) {
    const isITM = topPut.strike > currentPrice;
    const dte = topPut.dte || 0;

    if (isITM && dte === 0) {
        // 0DTE ITM = expiration mechanics, not directional
        signals.push(`Unusual PUT $${strike} 0DTE (expiration activity)`);
    } else if (isITM && dte > 0) {
        // ITM with DTE = bearish conviction
        signals.push(`Unusual PUT $${strike} ITM (bearish)`);
        if (direction === 'neutral') direction = 'bearish';
    } else {
        // OTM puts = protective hedge (charm bid supportive)
        signals.push(`Unusual PUT $${strike} OTM (hedge)`);
    }
}
```

| Condition | Signal Label | Direction Impact |
|-----------|--------------|------------------|
| ITM + 0DTE | Expiration activity | None |
| ITM + DTE>0 | Bearish conviction | Bearish |
| OTM (any) | Protective hedge | None |

### Research Sources

- [MenthorQ: Charm and Vanna OTM vs ITM Puts](https://menthorq.com/guide/charm-and-vanna-otm-vs-itm-puts/)
- [Nasdaq: Understanding Unusual Options Activity](https://www.nasdaq.com/articles/understanding-unusual-options-activity)
- [MenthorQ: How Dealers Hedge Options](https://menthorq.com/guide/how-dealers-hedge-options-and-why-atm-vs-itm-positions-matter/)

### Verification

1. `pm2 restart bloodhound`
2. `curl -X POST http://localhost:8081/scan`
3. Check SPY alert no longer shows "Against SPY bullish"
4. Check Fib matches only appear when within $2 or 0.3%
5. Check PINNED high-score symbols show WATCH tier
6. Check unusual PUT labels reflect ITM/OTM/0DTE context
