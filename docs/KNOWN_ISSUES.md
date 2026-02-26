# Known Issues & Status Log

> Last updated: 2026-02-26

---

## Critical Issues

### 1. Signal 7-Day Checkpoints Not Executing
**Severity:** HIGH
**Files:** `monitor/signal-logger.js`, `monitor/bloodhound-scanner.js`
**Status:** Broken (0/187 eligible signals completed 7-day checkpoint)

**Impact:** Swing-trade performance validation is completely non-functional. Cannot analyze whether HIGH_CONVICTION signals perform better over 7 days vs 24 hours. This is a core analytics gap.

**Likely Cause:** Checkpoint scheduling logic may not be triggering the 7-day check, or signals are being auto-closed (72h timeout) before reaching the 7-day window.

**Action:** Investigate signal lifecycle — the 72h auto-close may conflict with the 7-day checkpoint window.

---

### 2. Opportunity Scanner Aborts on Market Context Failure
**Severity:** HIGH
**Files:** `monitor/opportunity-scanner.js`
**Status:** Unfixed

**Impact:** When `/api/market/context` fails (observed: 30+ failures on Feb 23), the entire scan cycle aborts. This means zero opportunity data during API outages.

**Current Behavior:**
```
"Failed to fetch market context, aborting scan"
```

**Expected:** Should fall back to cached context or run scan without context, not abort entirely.

---

## Medium Priority Issues

### 3. SPY/QQQ change_pct Hardcoded to 0
**Severity:** MEDIUM
**File:** `monitor/bloodhound-scanner.js:2909, 2919`
**Status:** Unfixed

```javascript
spy: {
    price: marketContext?.spyPrice || 0,
    change_pct: 0, // TODO: get from API if needed
```

**Impact:** Scanner output always shows 0% daily change for SPY and QQQ. Dashboards can't display daily market movement.

---

### 4. Silent Error Catch (Pause File)
**Severity:** MEDIUM
**File:** `monitor/bloodhound-scanner.js:2140`
**Status:** Unfixed

```javascript
try {
    pausedAt = fs.readFileSync(PAUSE_FILE, 'utf8');
} catch (e) {}  // Swallows all errors silently
```

**Impact:** If PAUSE_FILE read fails for unexpected reasons (permissions, corruption), the error is completely masked.

---

### 5. External Divergence DB Path Fragile
**Severity:** MEDIUM
**File:** `monitor/bloodhound-scanner.js:832`
**Status:** Works but fragile

```javascript
const DB_PATH = path.join(__dirname, '..', '..', 'divergence-scanner', 'data', 'divergence_scanner.db');
```

**Impact:** Hardcoded relative path assumes exact directory layout. Breaks if repos are reorganized. Falls back to API (which may also fail — see divergence API timeout history).

---

### 6. Market Internals tick_high/tick_low Always 0
**Severity:** MEDIUM
**File:** `monitor/market-internals.js`
**Status:** Unverified (533/558 rows have tick_high=0, tick_low=0)

**Likely Cause:** Schwab API's `$TICK` quote doesn't include `highPrice`/`lowPrice` fields for index symbols.

**Impact:** Cannot track TICK range for the day. Limits breadth extreme analysis.

---

### 7. Divergence Scanner API Timeouts
**Severity:** MEDIUM (intermittent)
**File:** `logs/pm2/bloodhound-error.log`
**Status:** External dependency issue

**Observed:** 48+ consecutive API call failures to divergence scanner (Feb 23-25). Each timeout took ~5 seconds, slowing scan cycles.

**Mitigation:** Bloodhound reads RS data directly from divergence scanner SQLite DB as primary source, only falling back to API. Rotation regime still requires API call.

---

## Low Priority Issues

### 8. Legacy eod.js Still Exists
**Severity:** LOW
**File:** `eod.js` (root)
**Status:** Deprecated, marked with comment on line 3

**Action:** Delete file. All functionality absorbed into `monitor/eod-wrapup.js`.

---

### 9. _legacy/ Folder Should Be Cleaned Up
**Severity:** LOW
**File:** `monitor/_legacy/zone-scanner.js` (14.6 KB)
**Status:** Pre-migration code, no longer referenced

**Action:** Delete folder.

---

### 10. Migration Scripts No Longer Needed
**Severity:** LOW
**Files:** `monitor/migrate-to-db.js`, `monitor/migrate-watchlist.js`, `monitor/cleanup-duplicate-signals.js`
**Status:** One-time utilities, already executed

**Action:** Move to archive or delete.

---

### 11. JSON Files Still in data/ Directory
**Severity:** LOW (violates project mandate but no production impact)
**Status:** Partially addressed

| File | Size | Status | Notes |
|------|------|--------|-------|
| account_summary.json | 2.4 KB | Orphaned | Written by deprecated eod.js, stale since Dec 2025 |
| paper_trades.json | 18 bytes | Empty | Referenced in web-server.js but unused |
| spy_history.json | 358 KB | Research | Used by legacy backtest scripts only |
| vix_history.json | 328 KB | Research | Used by legacy backtest scripts only |
| add_history.json | 341 KB | Research | Used by legacy backtest scripts only |
| pcall_history.json | 42 bytes | Research | Used by legacy backtest scripts only |

**Per project mandate:** "ALL data must live in SQLite. NO JSON files in data/."

---

### 12. Hourly Log Commits Inflating Git History
**Severity:** LOW
**File:** `scripts/archive-logs.sh`
**Status:** Working as designed, but generates 24 commits/day

**Action:** Consider reducing frequency to every 6-12 hours.

---

### 13. Dashboard Auto-Refresh Race Condition
**Severity:** LOW
**File:** `analytics.html`
**Status:** Low probability

**Issue:** Manual refresh during auto-refresh could cause display inconsistency. No debouncing between manual and auto-refresh intervals.

---

## Previously Fixed

### 2026-02-26
- SPY trend computation moved to Bloodhound (was using misleading Options API label)
- EOD wrapup consolidated (absorbed eod.js functionality)
- CSS for new SPY trend labels in opportunity scanner

### 2026-02-25
- Breadth extreme alerts (Strategy 10) added to Bloodhound
- Strategies dashboard updated with all 10 strategies + automation badges
- Strategy candidates research completed (P1/P2/Rejected rankings)

### 2026-02-24
- Flow x sector RS audit completed (QCOM lesson)
- Annotation-only warning for flow + bottom-quartile sector

### 2026-02-20
- Cross-scanner flow injection (Opportunity -> Bloodhound scoring)
- Opportunity scanner maxSymbols raised 30 -> 50

### 2026-02-19
- API Gateway deployed (central proxy with circuit breakers)
- Cross-process API cache implemented (SQLite-backed)
- All scanners migrated to api-client.js routing through gateway

### 2026-01-13
- Market hours handling fixed (scanner stops during after-hours)
- Paper trade API endpoint fixed (was using wrong endpoint)
