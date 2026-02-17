# Wingman System Audit — Implementation Plan

Generated: 2026-02-14
Status: **P0 COMPLETE — RESTART NEEDED**

---

## P0 — CRITICAL (DONE — needs `pm2 restart all`)

- [x] **Fix `isDST` in premarket-scanner.js** — replaced with `getETTime()` (line 227)
- [x] **Fix AT_WALL/BELOW_WALL overlap in bloodhound-scanner.js** — changed breakout threshold from 0.3% to `wallThresholdPct` (1.0%) (line 1198-1199)
- [x] **Fix Bollinger Band direction + bb_position falsy-zero** — `||` → explicit `=== 'neutral'` check (line 1120, 1124) + `||` → `??` (line 1093)
- [x] **Block sensitive files in web-server.js** — added blocklist for .env, .git, data/, config.json, node_modules (line 1071-1078)
- [x] **Add DB-level signal dedup** — UNIQUE index on signals(symbol) WHERE status='active' + UNIQUE on checkpoints(signal_id, checkpoint_type)
- [x] **Fix pinned signal gain tracking** — pinned signals now track max absolute move as peak gain instead of hardcoded 0 (signal-db.js line 804-810)

### Restart command:
```bash
pm2 restart all
```

---

## P1 — HIGH SEVERITY (next batch)

- [ ] **signal-db.js SIGTERM prevents graceful HTTP shutdown** — remove `process.exit(0)` from SIGTERM/SIGINT handlers in signal-db.js (line 42-43). It already has `process.on('exit', closeDb)`. Let the importing process control exit.
- [ ] **EOD gap tracker missing error handlers** — add `uncaughtException`/`unhandledRejection` handlers + `_scanInProgress` re-entrancy guard to eod-gap-tracker.js
- [ ] **Add `internals` to log rotation scripts** — `scripts/archive-logs.sh` and `scripts/flush-logs.sh` both iterate 6 services but omit `internals`
- [ ] **Log TRADEABLE signals separately** — currently only HC signals are logged because dedup blocks TRADEABLE for same symbol. Need to either: (a) log TRADEABLE with different signal_id scheme, or (b) track tier changes on existing signals

---

## P2 — MEDIUM SEVERITY (after P1)

- [ ] **Standardize UTC→ET timezone** — create `getETDate()` helper in signal-db.js, replace all `new Date().toISOString().split('T')[0]` instances (lines 1496, 1658, 1842+)
- [ ] **Analytics proxy headersSent check** — add `if (!res.headersSent)` guard in web-server.js analytics proxy error/timeout handlers (line 937-945)
- [ ] **earnings-scanner `result.earningsDate` → `result.earnings_date`** — fix undefined watchlist notes (line 533)
- [ ] **premarket-scanner missing `.catch()` on manual scan** — add `.catch()` at line 986
- [ ] **Bloodhound `buildReasoning()` hardcoded 0.5%** — should use `SETTINGS.WALL_THRESHOLD_PCT`

---

## P3 — LOW SEVERITY (when convenient)

- [ ] No market holiday handling (all scanners)
- [ ] `discovery_score` always null in opportunity DB (field name mismatch)
- [ ] Empty internals snapshots stored when all APIs fail
- [ ] File-based pause in earnings scanner persists across PM2 restarts
- [ ] No PM2 health alerting (process stays stopped after max_restarts)
- [ ] Telegram message length truncation (4096 char limit)
- [ ] Missing input validation on POST /api/positions and /api/analyses
- [ ] Premarket inter-symbol delay 50ms (should be 100-200ms)
- [ ] Mixed HTTP libraries (axios + native fetch)
- [ ] Add `engines: { "node": ">=18.0.0" }` to package.json
- [ ] Add `config.json.example` template
- [ ] Add stale-data indicators to dashboards lacking them
- [ ] Circuit breaker for API-down scenarios
- [ ] Bloodhound `fetchJSON()` should log non-200 HTTP responses

---

## Statistical Findings (for reference)

| Metric | Before Fix | Notes |
|--------|-----------|-------|
| True win rate (deduplicated) | 25.8% (24/93) | Reported as 43% due to signal duplication |
| Best score range | 60-79 (40% win rate) | Score=70 anomaly: 0% from 9 signals |
| VIX elevated signals | 39.4% win rate | vs 29% in normal VIX |
| 3-day streak signals | 46.2% win rate | Best predictor of success |
| RETURNED signals | 8.3% win rate | Worst performers |
| Counter-trend (bearish SPY) | 31.9% win rate | Better than bullish SPY (22.6%) |
| 24h checkpoint | 49% accuracy | vs 36% at 4h |
| Gap WIN rate | 3.3% | Scoring doesn't predict outcomes |
| Alerts per day | ~23 | Likely too high |
