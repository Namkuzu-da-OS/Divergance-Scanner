# Project Audit TODO — 2026-02-13

Generated from 4-agent parallel audit. Full report at `research.html` > Project Audit tab.

---

## Priority 1 — Fix Now

- [ ] **Fix 7-Day Checkpoint Execution** — 0/187 eligible signals have completed 7d checkpoint. Swing-trade validation is completely non-functional. Check checkpoint scheduling in `signal-logger.js` and `bloodhound-scanner.js`.

- [ ] **Fix tick_high / tick_low Population** — 533/558 market_internals rows have these as 0. Check Schwab API response for $TICK — verify `highPrice`/`lowPrice` extraction in `market-internals.js`.

- [ ] **Fix ERR_HTTP_HEADERS_SENT in Web Server** — Add `if (res.headersSent) return;` guards in proxy error handlers at `web-server.js:486` and `:681`. Directly causing webserver's 26 restarts.

- [ ] **Add Global Error Handlers to All PM2 Processes** — Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` to every scanner. Add `SIGTERM`/`SIGINT` for graceful DB close. Currently only `eod-gap-tracker.js` has signal handlers.

## Priority 2 — Address Soon

- [ ] **Extract Shared Utilities Module** — Create `monitor/utils.js` for `isDST`, `sleep`, `formatTimePST`, `getETTime*`, `fetchJSON`, `loadWatchlist`, `addSymbol`, `isMarketOpen`. Removes 200+ duplicate lines across 6 files. Fixes fragile `isDST` timezone logic.

- [ ] **Fix Divergence Scanner Logging + Update Flush Script** — Configure Python httpx logger to WARNING (not INFO) — currently dumping 42 MB to stderr. Add divergence-scanner, internals, invoicing to `scripts/archive-logs.sh` and `scripts/flush-logs.sh`.

- [ ] **Add Body Size Limits to POST Endpoints** — Cap `req.on('data')` accumulation at ~1 MB in `web-server.js`. Add `req.on('error')` handlers. Also fix the `https` import bug in `opportunity-scanner.js:317` (references `https` but never imports it).

- [ ] **Blacklist LBTYB/BNAI from Discovery** — These symbols fail every scan cycle (~455 error entries). Add a symbol blacklist to Bloodhound discovery. Also reduce log archive commits from hourly to every 6h or daily (currently 24 commits/day inflating `.git/`).

- [ ] **Fix Opportunity Scanner Market Context Abort** — Scanner aborts entire scan cycle when market context fetch times out (18 occurrences in error log). Should fall back gracefully instead of skipping the whole scan.

- [ ] **Fix SOLQ vs SOLZ Inconsistency** — `bloodhound-scanner.js:123` maps SOL to `SOLQ`, but CLAUDE.md and opportunity-scanner use `SOLZ`. One is wrong.

- [ ] **Add price_snapshots Cleanup** — No purge logic exists. Currently at 32,717 rows growing ~5,760/day. Add periodic cleanup (e.g., keep last 14 days).

## Priority 3 — Cleanup

- [ ] **Delete Dead Code** — Remove `monitor/_legacy/` directory (14,604 lines), `cleanup-duplicate-signals.js` (63), `migrate-watchlist.js` (42), `migrate-to-db.js` (284). All completed their purpose.

- [ ] **Archive Stale Files** — Move `data/opportunities.json` (39KB) to `data/archive/`. Delete `data/opportunity_history.db.backup` (22 MB). Clean up `goals.json`, `scanner_config.json`, `earnings-paper-trades.json`, handoff markdown files.

- [ ] **Rewrite KNOWN_ISSUES.md** — 6 of 10 issues reference deleted `paper-trade-manager.js`. Severely outdated and misleading.

- [ ] **Fix CLAUDE.md References** — Remove `data/watchlist.json` from Bloodhound output section (file no longer exists).

- [ ] **Config.json Gaps** — Add `"premarket_control": 8084` and `"internals_control": 8085` to ports section. Either configure or remove the `earnings_telegram` placeholder.

- [ ] **Clean Up Test Data** — Delete 5 test positions (TEST, VERIFY, VERIFY2) from positions table. Drop legacy `scans` table (1,810 rows).

- [ ] **Move eod.js to scripts/** — Currently at project root, should be with other utility scripts.

- [ ] **Consider Splitting signal-db.js** — At 3,519 lines with 60+ exports, it's the single biggest maintenance risk. Extract into domain modules sharing the same DB connection.

---

## What's Working Well

- All 9 PM2 processes online, 753 MB total memory
- All 16 internal API endpoints returning HTTP 200
- All 3 external APIs healthy (Options 8000, Intel 3000, Divergence 32212)
- All 11 dashboards serving correctly
- Telegram alert pipeline operational
- Signal validation: 41.5% win rate, 1.72:1 W:L ratio
- SQL injection prevention solid (parameterized queries throughout)
- Only 3 dependencies — minimal, clean
- CLAUDE.md verified accurate (all ports, endpoints, HTML files match)
- Only 1 TODO comment in 14K lines of code
