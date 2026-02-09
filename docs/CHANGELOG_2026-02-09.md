# Changelog: 2026-02-09

## Summary

Fixed Bloodhound discovery system: manual watchlist entries protected from corruption, static/dynamic slot separation, maxSymbols bumped 20 → 50.

---

## Bug Fix: Manual Watchlist Corruption

### Problem
`signal-logger.js` calls `addToWatchlist()` when a signal fires. The UPDATE path in `addToWatchlist()` overwrites `source` and `expires_at` on existing entries — so a permanent `source='manual'` entry like SPY could become `source='signal_tracking'` with a 72h expiry, then get auto-deleted by `cleanExpiredWatchlist()`.

### Fix
**File:** `monitor/signal-db.js`

Added guard before the UPDATE query: if existing row has `source === 'manual'`, skip the update entirely and return `{ action: 'skipped_manual', symbol }`.

No changes needed to callers (`signal-logger.js`, `premarket-scanner.js`) — they continue to work, they just can't corrupt manual entries anymore.

---

## Discovery Overhaul: Static/Dynamic Slot Separation

### Problem
28 watchlist entries (9 manual + 19 premarket_gap) all scored 100, competing for 20 slots. Market data (max score 55) and sector rotation (max score 30) got zero slots. Bloodhound silently became "scan whatever's on the watchlist" instead of a discovery engine.

### Fix
**File:** `monitor/bloodhound-scanner.js`

1. **`loadWatchlist()`** — Rewritten to use database only (removed `watchlist.json` fallback). Returns `{ static: [...], dynamic: [...] }` via new `getWatchlistPartitioned()` function in `signal-db.js`.

2. **`discoverSymbols()`** — Static (manual) symbols get reserved slots, always included. Dynamic pool (premarket_gap at score 60, market_data at 25-55, sector_rotation at 25-30) competes for remaining slots.

3. **`maxSymbols`** — Bumped from 20 to 50. No API rate limits documented, no 429 errors in history. Opportunity scanner already does 30 on the same API.

### New Discovery Flow

```
discoverSymbols()
  ├── loadWatchlist() → { static: 9, dynamic: 19 }
  ├── Reserve static slots (9 symbols, always in)
  ├── Build dynamic pool:
  │     ├── premarket_gap / signal_tracking → score 60
  │     ├── market_data (52wk extremes, volume) → score 25-55
  │     └── sector_rotation (leaders/laggards) → score 25-30
  ├── Sort dynamic pool by score, take top 41
  └── Result: [9 static] + [up to 41 dynamic] = up to 50 symbols
```

### New function added
**`getWatchlistPartitioned()`** in `signal-db.js` — returns `{ static: [symbols], dynamic: [{symbol, source}] }`. Partitions by `source='manual'` vs everything else.

---

## Files Changed

| File | Changes |
|------|---------|
| `monitor/signal-db.js` | Manual entry protection in `addToWatchlist()`, new `getWatchlistPartitioned()`, added to exports |
| `monitor/bloodhound-scanner.js` | `maxSymbols: 50`, rewrote `loadWatchlist()` (DB-only), rewrote `discoverSymbols()` (static/dynamic) |
| `CLAUDE.md` | Updated discovery docs and maxSymbols default |
| `data/MARKET_INTEL.md` | Added system change notes for Monday verification |

## Files NOT Changed

- `monitor/signal-logger.js` — fix protects at the source
- `monitor/premarket-scanner.js` — already has `isInWatchlist()` guard
- `data/watchlist.json` — stays in repo, still used by HTTP API endpoints
- SQLite schema — no changes needed

---

## Verification Checklist (Monday)

- [ ] Logs: `[Watchlist] DB: 9 static, 19 dynamic`
- [ ] Logs: `[Discovery] 9 reserved + N dynamic = N total` (N > 20)
- [ ] `/api/scan/latest` returns >20 symbols
- [ ] market_data or sector_rotation sources appear in scan results
- [ ] SPY still `source='manual'`, `expires_at=NULL` in SQLite
- [ ] No API errors or 429 backoff at 50 symbols
- [ ] `node monitor/scanner-validator.js` passes

## Rollback

If issues at 50 symbols: change `maxSymbols: 50` → `maxSymbols: 30` in `monitor/bloodhound-scanner.js` line 39 and `pm2 restart bloodhound`. The manual protection fix is independent and safe.
