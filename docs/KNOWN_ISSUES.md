# Known Issues & Future Improvements

## Medium Priority Issues

### 1. API Retry Logic Missing
**File**: `monitor/paper-trade-manager.js:216-219`
**Status**: Working but fragile
**Impact**: If OPTIONS API fails to return price, trade update is silently skipped

**Current Behavior**:
```javascript
const currentPrice = await getCurrentPrice(trade.symbol);
if (!currentPrice) {
  continue; // Skip if price fetch failed
}
```

**Improvement Needed**:
- Add exponential backoff retry (3 attempts)
- Log failures to monitoring
- Distinguish between 401 (auth), 404 (symbol not found), 500 (server error)

---

### 2. File I/O on Every Update Cycle
**File**: `monitor/paper-trade-manager.js:205, 269`
**Status**: Working but inefficient
**Impact**: Reads/writes entire `paper_trades.json` every 2 minutes

**Current Behavior**:
- 20 trades × 2-min updates = ~14KB written every 2 min
- 500 trades = ~300KB every 2 min
- ~216MB/day with 500 trades

**Improvement Options**:
1. In-memory cache with periodic flush (every 10 min)
2. Switch to SQLite database
3. Write deltas only (append-only log + periodic compaction)

---

### 3. Dashboard Auto-Refresh Race Condition
**File**: `analytics.html:690, 331`
**Status**: Low probability issue
**Impact**: Manual refresh during auto-refresh could cause display inconsistency

**Current Behavior**:
```javascript
setInterval(loadData, 30000);  // Auto-refresh every 30s
// But manual refresh button can also call loadData()
```

**Improvement Needed**:
- Add debouncing: ignore manual refresh if auto-refresh in progress
- Cancel pending fetch if new one starts
- Show loading spinner during fetch

---

### 4. Missing Context Capture: Gamma Regime
**File**: `monitor/bloodhound-scanner.js:1904-1910`
**Status**: Working but incomplete
**Impact**: Can't analyze performance by gamma regime (BULLISH_SUPPORT vs BEARISH_RESISTANCE)

**Current Context Captured**:
```javascript
{
  score: analysis.totalScore,
  zone: analysis.zone,
  signals: analysis.signals,
  vix: marketContext?.vix,
  vix_regime: marketContext?.vixRegime
}
```

**Missing**:
- `gamma_regime` - Would show if trades work better in BULLISH_SUPPORT vs BEARISH_RESISTANCE
- `market_sentiment` - Overall bullish/bearish sentiment score
- `spy_trend` - Alignment with SPY direction

---

### 5. All-Breakevens Edge Case
**File**: `analytics.html:482-490`
**Status**: Edge case not handled
**Impact**: If all closed trades are breakevens (no wins or losses), insight logic shows "FILTER OUT"

**Better Handling**:
- Show special insight: "⚠️ INCONCLUSIVE: All trades breakeven (±2%)"
- Suggest tightening thresholds or extending hold time

---

### 6. Dashboard Sections Not Fully Responsive
**File**: `analytics.html` (error handling)
**Status**: Fixed for errors, but loading states inconsistent
**Impact**: UX issue - some sections show "Loading..." forever if data fetch slow

**Improvement**:
- Global loading state
- Timeout after 10s → show error
- Skeleton loaders instead of "Loading..." text

---

## Low Priority Issues

### 7. After-Hours Price Data Not Flagged
**Status**: Data quality issue
**Impact**: Time window prices (1h, 4h, 24h, 72h) might capture after-hours prices

**Improvement**:
- Check if market is open when capturing time window prices
- Flag after-hours prices in outcome data
- Filter analytics by regular hours only

---

### 8. No Atomic File Writes
**File**: `monitor/paper-trade-manager.js:65`
**Status**: Low-probability data corruption risk
**Impact**: If process crashes mid-write, `paper_trades.json` could be truncated

**Current**:
```javascript
fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(data, null, 2));
```

**Fix**:
```javascript
const tempFile = CONFIG.DATA_FILE + '.tmp';
fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
fs.renameSync(tempFile, CONFIG.DATA_FILE);  // Atomic on most filesystems
```

---

### 9. Hardcoded Win/Loss Thresholds
**File**: `monitor/paper-trade-manager.js:11-12`
**Status**: Arbitrary thresholds
**Impact**: WIN (+2%) / LOSS (-2%) / BREAKEVEN band is 4% wide

**Current**:
```javascript
WIN_THRESHOLD_PCT: 2.0,
LOSS_THRESHOLD_PCT: -2.0,
```

**Improvement**:
- Make configurable via config.json
- Consider % of account risk instead of fixed %
- Different thresholds per strategy (scalp vs swing)

---

### 10. WATCH Tier Not Tracked
**File**: `monitor/bloodhound-scanner.js:1904`
**Status**: Intentional design choice
**Impact**: Only HIGH_CONVICTION signals create paper trades

**Improvement**:
- Track WATCH tier separately (signal_type='WATCH')
- Compare HIGH_CONVICTION vs WATCH performance
- Helps validate if 60-80 score range is actionable

---

## Recently Fixed

### 2026-01-13
✅ **Market Hours Handling** (CRITICAL):
- Scanner now detects market hours and stops during after-hours/weekends
- Shows next market open time when idle
- Prevents unnecessary API calls and alerts during closed hours

✅ **Paper Trade API Endpoint** (HIGH):
- Fixed wrong endpoint: `/api/quotes/{symbol}` → `/api/technicals/{symbol}`
- Eliminates 401 errors during price updates
- Properly extracts price from technicals response

**Commit**: Pending

---

### 2026-01-12
✅ **Critical Bugs Fixed**:
1. Time window price capture (missed snapshots on restart)
2. Bearish trade PnL calculated backwards
3. Exit conditions masked (couldn't see multiple reasons)
4. Analytics dashboard crashed on malformed JSON
5. Hardcoded '999' profit factor
6. Missing null checks on pnl_pct
7. Duplicate trade IDs possible
8. Risky price/direction fallback chains

**Commit**: `d93b9a4` - "Fix critical bugs in analytics system"

---

## Priority for Next Update

1. API Retry Logic (MEDIUM)
2. Gamma Regime Context (MEDIUM)
3. File I/O Optimization (LOW - only matters at scale)
4. Atomic File Writes (LOW - safety improvement)
