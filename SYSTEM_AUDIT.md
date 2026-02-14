# Wingman System Audit Report
**Generated:** February 14, 2026

Comprehensive audit by 5 specialized agents covering: Bloodhound scanner logic, secondary scanners, infrastructure reliability, signal database analytics, and dashboards.

---

## Executive Summary

**223 signals** tracked over 25 days (Jan 20 - Feb 13, 2026). **55 issues** identified across all subsystems.

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 6 | Weekend history bug, dead backoff, DST bug, Promise.all violations, DB shutdown, body size limits |
| HIGH | 15 | Scan overlap, bearish signal blindness, score compression, missing error handlers |
| MEDIUM | 20 | Stale data flags, CORS, memory growth, cross-scanner gaps |
| LOW | 14 | Dead code, config hygiene, cosmetic issues |

### Top 5 Highest-Impact Fixes
1. **Weekend history bug** — Every Monday, legitimate Day 2/Streak symbols are falsely labeled RETURNED and capped to WATCH tier
2. **Bearish/neutral signal cap** — System is permanently blind to short-side setups based on a sample of 3 signals
3. **Scan overlap protection** — No mutex on any scanner; slow API days can cause concurrent scans
4. **Dead backoff system** — Logs "backoff activated" but takes no action; API hammering continues
5. **7-day checkpoints never fire** — 0 of 223 signals have 7d checkpoints, losing long-term validation data

---

## Signal Performance Analysis (223 signals)

### Overall Stats
- **Win rate:** 33.5% (67 WIN / 200 closed)
- **Breakeven rate:** 41.0% (82 BREAKEVEN)
- **Loss rate:** 21.5% (43 LOSS)
- **Active:** 23 signals still being tracked
- **Avg peak gain:** +1.99% | **Avg max drawdown:** -1.67%
- **Best single signal:** +10.9% | **Worst drawdown:** -20.16%

### By Tier
| Tier | Count | Note |
|------|-------|------|
| HIGH_CONVICTION | 223 | **ALL signals are HIGH_CONVICTION** — no TRADEABLE or WATCH signals are logged |

**FINDING:** Only HIGH_CONVICTION signals are stored. The system has no data on TRADEABLE or WATCH tier performance, making it impossible to validate whether the tier thresholds are calibrated correctly. Consider logging a sample of lower-tier signals for comparison.

### By Zone
| Zone | Signals | Win Rate | Avg Peak |
|------|---------|----------|----------|
| BUY_ZONE | 206 (92%) | 35.8% (64W/37L) | ~2.0% |
| SELL_ZONE | 13 (6%) | 18.2% (2W/5L) | lower |
| LOW_MOMENTUM | 4 (2%) | 50% (1W/1L) | — |

**FINDING:** BUY_ZONE dominates. SELL_ZONE has a much lower win rate (18% vs 36%) — this is partly explained by the bearish signal cap that prevents most short setups from reaching HIGH_CONVICTION. The system needs more bearish signal data before conclusions can be drawn.

### By Direction
| Direction | Count | Avg Peak | Avg DD |
|-----------|-------|----------|--------|
| Bullish | 182 (82%) | +2.43% | -1.40% |
| Pinned | 30 (13%) | +0.00% | -2.77% |
| Bearish | 4 (2%) | +0.30% | -5.58% |
| Neutral | 7 (3%) | +0.00% | -1.70% |

**FINDING:** Pinned signals (30) have 0% avg peak gain and -2.77% avg drawdown — these are pure losers. The pinned direction detection may need refinement, or pinned signals should not generate HIGH_CONVICTION alerts.

### By VIX Regime
| Regime | Count | Wins | Losses | Win Rate | Avg Peak |
|--------|-------|------|--------|----------|----------|
| Normal | 183 | 53 | 39 | 57.6% (of decided) | +1.83% |
| Elevated | 33 | 13 | 1 | **92.9%** | +3.10% |
| (null) | 7 | 1 | 3 | — | +0.88% |

**FINDING:** Elevated VIX signals massively outperform (92.9% vs 57.6% win rate). This validates the VIX entry-focused framework. Consider **increasing position size confidence** during elevated VIX, or adding a VIX bonus to the confluence score.

### By SPY Trend
| SPY Trend | Count | Wins | Losses | Avg Peak |
|-----------|-------|------|--------|----------|
| Neutral | 116 | 39 | 19 | +2.14% |
| Bullish | 53 | 12 | 16 | +1.48% |
| Bearish | 47 | 15 | 5 | +2.39% |

**FINDING:** Counter-trend signals (bearish SPY + bullish signal) show the best risk-adjusted returns (+2.39% peak, 75% win rate). This confirms the existing CLAUDE.md note that "counter-trend signals outperform." The bearish signal cap is actively hurting performance.

### Score Distribution
| Score Range | Count | Avg Peak |
|-------------|-------|----------|
| 40-59 | 23 | +1.97% |
| 60-79 | 69 | **+2.54%** |
| 80-100 | 131 | +1.71% |

**FINDING:** Scores 60-79 outperform scores 80-100 (+2.54% vs +1.71%). This suggests **score compression** at the top — high scores are capped at 100 but the raw components can exceed 115+. The highest scores may represent over-crowded/obvious setups where edge is reduced.

### Checkpoint Performance
| Checkpoint | Completed | Direction Correct | Accuracy |
|------------|-----------|-------------------|----------|
| 4h | 221/223 (99%) | 95/266 (35.7%) | Low |
| 24h | 204/223 (91%) | 100/204 (49.0%) | Coin flip |
| 7d | **0/223 (0%)** | N/A | **BROKEN** |

**FINDING:** 7-day checkpoints NEVER fire. This is a critical gap — the system cannot validate whether signals that look good at 24h continue to work over a week. The 72-hour time stop closes signals before the 7d checkpoint can run.

### Top Symbols
| Symbol | Signals | Wins | Avg Peak | Notes |
|--------|---------|------|----------|-------|
| QQQ | 38 | 10 (26%) | +1.35% | Below average |
| AAPL | 34 | 14 (41%) | +1.22% | Solid |
| TSLA | 22 | 10 (45%) | +2.61% | Strong |
| META | 19 | 15 (79%) | +5.48% | **Best performer** |
| SPY | 19 | 0 (0%) | +0.84% | **0 wins — investigate** |

**FINDING:** SPY has 19 signals and 0 wins. This is a red flag — SPY may not be suitable for the current scoring model (it's the market itself, so "confluence" has different meaning). META is exceptional (79% win rate, +5.48% avg peak). Consider symbol-specific scoring adjustments.

### Daily Signal Volume
- **Spiky:** Ranges from 1 signal (Jan 27) to 44 signals (Jan 22)
- **Recent trend:** Feb 9-13 averaging 6.4 signals/day (down from 24.2 in Jan 20-23)
- **Win rate declining:** Feb 9-13 has 0 wins in 32 signals (all still processing or losses)

### Additional Signal Findings (from deep DB analysis)

**Pinned direction outcome logic is broken:**
- 29 pinned signals: 0 wins, 16 losses, 13 breakeven
- The outcome logic uses `peak_gain >= 2%` for WIN, but pinned signals predict *range-bound* movement
- A pinned signal staying within ±2% for 72h should be WIN, not BREAKEVEN
- Currently these are all-loss signals that should be all-wins by their own thesis
- **Fix:** Add pinned-specific outcome: if direction=pinned and price stayed within ±2% for 72h, outcome = WIN

**Intraday bias field is useless:**
- 204/223 signals (91%) have `intraday_bias = 'NEUTRAL'`, rest are NULL
- Zero discriminating value — field exists in schema but isn't meaningfully populated
- **Fix:** Wire market internals into bias calculation, or remove the field

**Gamma regime insights:**
- NEUTRAL gamma: best risk-adjusted (2.52% peak, -1.37% DD)
- BULLISH_TILT: worst bullish regime (0.91% peak) — over-crowded setups?
- BEARISH_RESISTANCE: poor (0.84% peak) — avoid signals in this regime

**Option signal tracking incomplete:**
- 19 signals have option contracts, but 15/19 have no outcome
- `option_hit_wall = 1` for 18/19 (fires too easily — likely set immediately)
- Option peak gains can be massive (MAT put +205%, GOOGL call +125%) but most expire worthless
- **Fix:** Option outcome closing logic needs to fire consistently, not just on expiration

**Orphaned checkpoint records:**
- 45 checkpoint records reference signal_ids not in the signals table (from Jan 20-21 development)
- **Fix:** `DELETE FROM checkpoints WHERE signal_id NOT IN (SELECT signal_id FROM signals)`
- Add UNIQUE constraint: `CREATE UNIQUE INDEX idx_checkpoints_unique ON checkpoints(signal_id, checkpoint_type)`

**Price snapshot growth:**
- 34,345 rows for 223 signals (avg 154 per signal, one every 5-min scan)
- ~50K rows/month at current rate
- **Fix:** Consider sampling — only record snapshots every 15-30 min, or when price changes > 0.1%

---

## Bloodhound Scanner Findings (19 issues)

### CRITICAL (2)

**B-1. Weekend history bug — false RETURNED labels every Monday**
- `signal-db.js:1482-1489`
- `computeHistoryStatus()` counts raw calendar days, not trading days. On Monday, it expects Sunday/Saturday entries. Symbols present Friday get `consecutiveDays = 0` and label `RETURNED` instead of `DAY_2/STREAK`.
- RETURNED signals are capped to WATCH tier — every Monday, legitimate streak symbols are wrongly downgraded.
- **Fix:** Skip weekends (and holidays) in expected date calculation.

**B-2. Backoff system is dead code**
- `bloodhound-scanner.js:76-116`
- `backoffState` tracks slow/fast responses and sets `backoffState.active`, but the scan loop at lines 2346-2391 never checks it. Symbols always process at flat 200ms delay.
- Logs "Switching to batched mode" but no batching occurs.
- **Fix:** Implement batch logic in scan loop, or remove the dead code.

### HIGH (5)

**B-3. `validateOldSignals()` called twice per scan**
- Lines 2294 and 2742 — first call has no priceCache (triggers extra API calls), second has priceCache.
- **Fix:** Remove line 2294 call.

**B-4. Bearish/neutral direction cap based on n=3 sample**
- Lines 1714-1717 — All bearish and neutral signals permanently capped to WATCH.
- Based on 3 bearish and 1 neutral signal backtest. System can never learn from short setups since they're never promoted.
- **Fix:** Remove cap or reduce to only blocking HIGH_CONVICTION.

**B-5. Score compression — cap at 100 but components sum to 115+**
- Line 1598-1600 — `Math.min(100, ...)` loses differentiation at the top.
- **Fix:** Either normalize components to truly sum to 100, or raise cap to 150.

**B-6. "Smart Money Dip Buy" strategy trigger is dead code**
- Line 1735 — `signals.some(s => s.includes('RSI low momentum'))` never matches; actual text is "RSI oversold".
- **Fix:** Change to `s.includes('RSI oversold')`.

**B-7. `fetchRsFromApi()` uses Promise.all**
- Line 995-998 — Two concurrent requests to divergence scanner.
- **Fix:** Sequence with 100ms delay.

### MEDIUM (7)

**B-8.** Direction conflict when price at both put AND call walls simultaneously
**B-9.** `updateScannerHistory()` passes `first_seen: now` even on updates
**B-10.** `buildReasoning()` uses hardcoded 0.5% instead of `WALL_THRESHOLD_PCT` (1.0%)
**B-11.** `topOpportunities` capped at 15 — can miss symbols from API output
**B-12.** Bollinger Band direction assignment is dead code (`direction || 'bullish'`)
**B-13.** Variable shadowing: `volRatio` used for both stock volume and internals
**B-14.** Missing holiday check in `isMarketOpen()`

### LOW (5)

**B-15.** `CL` symbol maps to both XLP (stock) and USO (futures)
**B-16.** Dead variable `yesterday` in `computeHistoryStatus()`
**B-17.** Fibonacci levels return null for downtrends instead of inverting
**B-18.** `_context` property deleted from array object (bad practice)
**B-19.** `signalExpirationDays: 5` in SETTINGS conflicts with 72h time stop

---

## Infrastructure Findings (18 issues)

### CRITICAL (2)

**I-1. No SQLite close on shutdown — ALL scanners**
- `signal-db.js:23-33`, `opportunity-db.js:13-23`
- No `process.on('exit')` or SIGTERM handler calls `db.close()`.
- **Fix:** Add shutdown handlers in DB modules.

**I-2. No request body size limit on POST endpoints**
- `web-server.js` — all POST handlers accumulate chunks without limit. Server is bound to `0.0.0.0`.
- **Fix:** Add `if (body.length > 1048576) { req.destroy(); return; }`.

### HIGH (6)

**I-3.** Promise.all in discovery functions (opportunity, premarket, bloodhound) — API pacing violation
**I-4.** Missing `https` require in opportunity-scanner.js `httpGet()`
**I-5.** No `max_memory_restart` in ecosystem.config.js
**I-6.** No `uncaughtException`/`unhandledRejection` handlers in any scanner
**I-7.** setInterval scan overlap — no mutex guard on async `runScan()`
**I-8.** Web server has no graceful shutdown

### MEDIUM (6)

**I-9.** `busy_timeout` 5000ms may be too low for 7 concurrent writers
**I-10.** CORS `Access-Control-Allow-Origin: *` on write endpoints
**I-11.** Path traversal protection bypassable with URL encoding
**I-12.** In-memory Maps (setupTracker, velocityCache) grow unbounded
**I-13.** Stale divergence scanner data not flagged in API output
**I-14.** EOD gap tracker has no API timeout

### LOW (4)

**I-15.** Repeated `require('./signal-db')` inside request handlers
**I-16.** Telegram chatId hardcoded in config.json
**I-17.** Inconsistent `EADDRINUSE` handling across control servers
**I-18.** PM2 log rotation not configured

---

## Secondary Scanner Findings (18 issues)

### CRITICAL (2)

**S-1. `isDST()` bug in premarket-scanner.js and market-internals.js**
- Both use server timezone offset to determine DST. Only correct if server is in US timezone.
- Opportunity-scanner.js and earnings-scanner.js already use `toLocaleString('en-US', { timeZone: 'America/New_York' })` correctly.
- **Fix:** Share the correct ET time utility across all scanners.

**S-2. Promise.all for market mover discovery**
- `opportunity-scanner.js:147`, `premarket-scanner.js:357` — 3 simultaneous requests each.
- **Fix:** Sequential with 100ms delays.

### HIGH (4)

**S-3.** Missing `https` require in opportunity-scanner.js (same as I-4)
**S-4.** Premarket `nextScanTime` never set on initial scan
**S-5.** Premarket scanner: no inter-symbol API delay in `fetchMarketData()` (50 rapid-fire requests)
**S-6.** EOD gap tracker uses server-local date instead of ET date

### MEDIUM (7)

**S-7.** Opportunity scanner discovery sources mismatch in output
**S-8.** Premarket `data.news` field never populated (dead catalyst path)
**S-9.** Earnings scanner: `result.earningsDate` typo (should be `result.earnings_date`)
**S-10.** Earnings scanner uses file-based pause state, unlike all others
**S-11.** Market internals comment says "9 symbols" but fetches 10
**S-12.** Opportunity scanner uses separate `opportunity-db.js` instead of `signal-db.js`
**S-13.** No weekend/holiday detection in any scanner

### LOW (5)

**S-14.** Premarket `alertedToday` not restored on restart (duplicate alerts possible)
**S-15.** Opportunity `persistenceTracker` deletion during iteration
**S-16.** Earnings calendar refresh blocks the scan loop (60-90 seconds)
**S-17.** EOD gap tracker has no control API server
**S-18.** Config.json missing port entries for premarket (8084) and internals (8085)

---

## Cross-Scanner Integration Assessment

### Working Well
- Premarket HIGH_CONVICTION gaps auto-add to Bloodhound watchlist (2-day expiry)
- Opportunity HIGH_CONVICTION auto-adds to watchlist (3-day expiry)
- Earnings PREM signals auto-add to watchlist (7-day expiry)
- EOD gap tracker links back to premarket_movers via scan_id
- Market internals consumed by zone-scanner and `/pulse` command

### Critical Gaps
1. **Opportunity flow data doesn't inform Bloodhound scoring** — Vol/OI spikes aren't a confluence factor
2. **Market internals aren't in any scanner's scoring** — Only displayed, never used for signal quality
3. **No cross-scanner deduplication** — A symbol can be added to watchlist by 3 scanners simultaneously
4. **Earnings proximity checked independently** by both earnings-scanner and opportunity-scanner (redundant API calls)

---

## Prioritized Improvement Roadmap

### Phase 1: Critical Bugs (Fix Immediately)
| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | B-1: Weekend history bug (false RETURNED) | S | **Every Monday signals are wrongly capped** |
| 2 | I-1: Add DB close on shutdown | S | Prevents data corruption on PM2 restart |
| 3 | S-1: Fix isDST() — share ET time utility | S | Prevents wrong scan schedules |
| 4 | I-7: Add scan overlap mutex | S | Prevents concurrent scan chaos |
| 5 | I-6: Add uncaughtException handlers | S | Prevents silent crash loops |
| 6 | I-2: Add request body size limit | S | Prevents DoS on web server |

### Phase 2: Signal Quality (High Impact on Trading)
| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 7 | B-4: Remove bearish/neutral signal cap | S | **Enables short-side detection** |
| 8 | B-3: Remove duplicate validateOldSignals call | S | Reduces unnecessary API load |
| 9 | B-5: Fix score compression (normalize to 100) | M | Better signal differentiation |
| 10 | B-6: Fix "Smart Money Dip Buy" trigger text | S | Enables dead strategy trigger |
| 11 | Fix 7d checkpoint (runs before 72h close) | M | Enables long-term signal validation |
| 12 | Log TRADEABLE signals too (not just HC) | S | **Enables tier threshold calibration** |
| 13 | Investigate SPY 0% win rate | M | 19 false signals from core symbol |
| 14 | Add VIX regime bonus to scoring | S | Leverages 93% elevated-VIX win rate |

### Phase 3: Reliability (Prevent Downtime/Data Loss)
| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 15 | Convert all Promise.all to sequential | S | Prevents API overload |
| 16 | Add max_memory_restart to PM2 config | S | Prevents OOM crashes |
| 17 | Add graceful shutdown to web server | S | Prevents mid-request crashes |
| 18 | Add https require to opportunity-scanner | S | Prevents latent crash |
| 19 | Increase busy_timeout to 15s | S | Reduces SQLITE_BUSY errors |
| 20 | Add API timeout to EOD gap tracker | S | Prevents infinite hangs |

### Phase 4: Cross-Scanner Integration (Feature Gaps)
| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 21 | Feed opportunity flow data into Bloodhound scoring | M | **New confluence factor** |
| 22 | Feed market internals into scanner scoring | M | **New confluence factor** |
| 23 | Add holiday calendar to all scanners | M | Prevents stale-data signals |
| 24 | Flag missing RS data in API output | S | Transparency on data completeness |
| 25 | Fix premarket inter-symbol API delay | S | API pacing compliance |

### Phase 5: Code Quality & Hardening
| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 26 | B-2: Remove dead backoff code or implement it | M | Code clarity |
| 27 | Restrict CORS on write endpoints | S | Security |
| 28 | Fix path traversal protection | S | Security |
| 29 | Consolidate opportunity-db into signal-db | M | Consistency |
| 30 | Add pm2-logrotate or PM2 log config | S | Ops hygiene |

**Effort Key:** S = Small (< 30 min), M = Medium (1-3 hours), L = Large (half day+)

---

## Data Integrity Summary

| Check | Result |
|-------|--------|
| NULL scores | 0 (clean) |
| NULL VIX | 7 (3%) — from early signals before VIX tracking |
| NULL zones | 0 (clean) |
| NULL peak_gain_pct | 0 (clean) |
| 4h checkpoints | 99% complete |
| 24h checkpoints | 91% complete |
| 7d checkpoints | **0% complete (BROKEN)** |
| Duplicate cleanup | 8 signals auto-cleaned |

---

*Audit performed by 5 specialized agents: Bloodhound Logic, Signal Analytics, Infrastructure Reliability, Secondary Scanners, Dashboard UX*
