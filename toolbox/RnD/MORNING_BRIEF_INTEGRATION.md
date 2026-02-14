# R&D: Expand Bloodhound Scanner with Morning Brief Integration

**Created:** 2026-02-09
**Status:** Research complete, implementation pending
**Priority:** High — this is the missing intelligence layer

---

## Problem

Bloodhound scans only 20 symbols per cycle, discovered reactively from SPX movers, sector ETFs, and a manual watchlist. This misses opportunities in thesis-driven sectors (AI, defense, nuclear, quantum, cybersecurity, space, robotics, minerals).

The 20-symbol limit was never justified:
- No documented API rate limits or 429 errors in project history
- Adaptive backoff has never triggered in production
- Current scan uses ~5% of available time window (10s out of 300s)
- Opportunity scanner already does 30 symbols on the same API with no issues

## The Morning Brief System

An automated morning brief generates daily markdown files at:
```
https://github.com/DaryllGomas/bigpic-markets/tree/main/morning-brief/2026-02/
```

### Daily Brief (`2026-02-09_Mon.md`)
Generated every morning. Contains structured markdown tables:
- **Pre-market snapshot**: Futures, yields, commodities, crypto
- **Pre-market movers**: ticker, sector, price, recent move, catalyst
- **Key technical levels**: ticker, sector, support, resistance, 52W high, signal
- **This week's earnings**: ticker, date, consensus, tier/sector
- **Approaching catalysts**: date, ticker, catalyst, priority
- **Scenario analysis**: NFP/CPI outcome branches with market impact
- **Playbook**: Bias, risks, watch items

### Research Watchlist (`research-watchlist.md`)
Static thesis universe. Updated as thesis evolves (quarterly-ish):

| Sector | Tier 1 | Tier 2 | Tier 3 | Total |
|--------|--------|--------|--------|-------|
| AI Infrastructure | 5 | 6 | 7 | 18 |
| Cybersecurity | 6 | 8 | 7 | 21 |
| Defense & Aerospace | 4 | 5 | 5 | 14 |
| Nuclear Energy | 4 | 4 | 7 | 15 |
| Critical Minerals | 4 | 5 | 6 | 15 |
| Energy Storage | 4 | 4 | 6 | 14 |
| Quantum Computing | 5 | 3 | 4 | 12 |
| Robotics & Automation | 5 | 7 | 6 | 18 |
| Space | 3 | 4 | 3 | 10 |

**~95-100 unique tickers** after cross-sector deduplication.
**~30-35 Tier 1** unique tickers (highest conviction, always scan).
**~55-65 Tier 1+2** unique tickers.

### Why This Matters

The brief provides the **intelligence layer** Wingman is missing:

| What Wingman Has | What the Brief Adds |
|------------------|---------------------|
| Gamma levels, flow, RSI | WHY something is moving (thesis, catalyst) |
| Confluence scoring | Macro context (yields, DXY, global markets) |
| Signal validation | Economic calendar + scenario analysis |
| Position sizing | Sector rotation theme + sector classification |
| Reactive discovery | **Proactive thesis-driven universe** |

Together = thesis + timing + execution = complete trades.

---

## Implementation Plan

### 1. Create `monitor/thesis-loader.js` — Brief Parser & Watchlist Sync

New script that:

**Fetches the daily brief markdown from GitHub:**
- Computes today's date → `morning-brief/YYYY-MM/YYYY-MM-DD_Day.md`
- Uses `gh api` or raw GitHub URL
- Falls back to most recent file if today's isn't published yet
- Caches locally in `data/morning-brief-cache.md`

**Parses markdown tables to extract:**
- Movers: ticker, sector, last close, recent move, catalyst
- Technical levels: ticker, sector, support, resistance, signal
- Earnings: ticker, date, consensus, tier/sector
- Catalysts: date, ticker, catalyst, priority

**Optionally parses research-watchlist.md for static thesis universe:**
- ticker, sector, tier (1/2/3), key thesis

**Syncs to watchlist table in SQLite:**
- `source = 'thesis'` for research-watchlist tickers (expires: 30 days)
- `source = 'brief'` for daily brief tickers (expires: end of trading day)
- Does NOT touch `manual` or `premarket_gap` entries
- Stores sector in `notes` field, tier in `tier_at_add`

**CLI interface:**
```bash
node monitor/thesis-loader.js                    # Fetch today's brief + sync
node monitor/thesis-loader.js --research         # Also load research-watchlist.md
node monitor/thesis-loader.js --date 2026-02-09  # Load specific date
node monitor/thesis-loader.js --list             # Show current thesis watchlist
```

### 2. Modify Bloodhound Scanner — Increase Capacity

**File: `monitor/bloodhound-scanner.js`**

**SETTINGS changes:**
```javascript
maxSymbols: 50,                  // Up from 20
scanIntervalMs: 7 * 60 * 1000,  // 7 min (up from 5) — gentle pace for more symbols
```

**Add 100ms inter-symbol delay** in scan loop (matches opportunity scanner pattern).

**Discovery priority reorder:**
1. Manual watchlist (score: 100)
2. Thesis Tier 1 (score: 90)
3. Daily brief movers/catalysts (score: 85)
4. Premarket gaps (score: 80)
5. Thesis Tier 2 (score: 70)
6. Thesis Tier 3 (score: 40)
7. Reactive discovery — market data + sector rotation (score: 25-35)

### 3. Integration — Bloodhound Calls Thesis Loader

On startup + every 4 hours during market hours:
```javascript
const { syncThesisWatchlist } = require('./thesis-loader');
await syncThesisWatchlist();
setInterval(() => syncThesisWatchlist(), 4 * 60 * 60 * 1000);
```

### 4. Schema — Add `sector` Column to Watchlist Table

**File: `monitor/signal-db.js`**
```sql
ALTER TABLE watchlist ADD COLUMN sector TEXT;
```

---

## API Load Analysis

### Current (20 symbols, 5-min interval)
| Scanner | Calls/Cycle | Interval | Calls/Min |
|---------|-------------|----------|-----------|
| Bloodhound | 65 | 5 min | 13 |
| Opportunity | 155 | 5 min | 31 |
| **Total** | **220** | — | **44** |

### Proposed (50 symbols, 7-min interval)
| Scanner | Calls/Cycle | Interval | Calls/Min |
|---------|-------------|----------|-----------|
| Bloodhound | 155 | 7 min | 22 |
| Opportunity | 155 | 5 min | 31 |
| **Total** | **310** | — | **53** |

**Only 20% increase in API load.** The Options API is on local network (192.168.10.60:8000).

### Scan Timing
- 50 symbols × 600ms (500ms API + 100ms delay) = **30 seconds**
- 7-minute interval = 420 seconds
- **Utilization: 7%** — massive headroom

### If We Go Bigger (100 symbols, 10-min interval)
- 100 × 600ms = 60 seconds
- 10-minute interval = 600 seconds
- Utilization: 10% — still fine
- Calls: 305/cycle, 30.5/min — less than current Opportunity scanner alone

---

## Files to Modify

| File | Change |
|------|--------|
| `monitor/thesis-loader.js` | **NEW** — Fetch/parse brief markdown, sync to watchlist |
| `monitor/bloodhound-scanner.js` | maxSymbols→50, 100ms delay, thesis priority in discovery, call thesis-loader |
| `monitor/signal-db.js` | Add `sector` column to watchlist table |

---

## Open Questions

1. **maxSymbols**: Start at 50 or go straight to 100? (Math says 100 is fine)
2. **Scan interval**: 7 min is conservative. Could stay at 5 min even with 50 symbols.
3. **Foreign tickers**: research-watchlist.md includes PLS.AX, NEO.TO, UCU.V — skip gracefully or map to US equivalents?
4. **Zone scanner dashboard**: Should it show sector labels? Could group/filter by sector.
5. **Brief URL pattern**: Need to confirm the day suffix (Mon, Tue, etc.) matches JavaScript's day naming.

---

## Related Research

- Morning brief example: https://markets.bigpicsolutions.com/morning-brief/2026-02/2026-02-09_Mon.html
- GitHub repo: https://github.com/DaryllGomas/bigpic-markets/tree/main/morning-brief/2026-02/
- Bloodhound backoff system: `monitor/bloodhound-scanner.js` lines 79-121
- Opportunity scanner delay pattern: `monitor/opportunity-scanner.js` (100ms between symbols)
- Watchlist schema: `monitor/signal-db.js` lines 197-211
