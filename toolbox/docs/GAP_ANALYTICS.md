# GAP ANALYTICS SYSTEM

**Last Updated:** January 30, 2026
**Status:** ACTIVE - v1.0

---

## OVERVIEW

The Gap Analytics System tracks pre-market gaps and analyzes their behavior throughout the trading day. It captures whether gaps "fill" (price returns to previous close) or "run" (price continues in gap direction), building historical data to identify patterns and improve gap trading decisions.

### Key Questions This System Answers

- What percentage of gaps fill same-day?
- Do HIGH_CONVICTION gaps behave differently than WATCH tier?
- Which tickers are "repeat offenders" that gap frequently?
- Do earnings gaps fill less often than regular gaps?
- Does gap size affect fill probability?

---

## SYSTEM ARCHITECTURE

```
                         GAP ANALYTICS DATA FLOW
═══════════════════════════════════════════════════════════════════════════

     6:00 AM ET                9:30 AM ET               4:15 PM ET
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   PREMARKET     │       │     MARKET      │       │   EOD TRACKER   │
│    SCANNER      │       │     OPENS       │       │                 │
│                 │       │                 │       │                 │
│  Discovers:     │       │  Gaps are now   │       │  Captures:      │
│  • gap_pct      │       │  "live" trades  │       │  • close price  │
│  • tier         │       │                 │       │  • high/low     │
│  • catalyst     │       │                 │       │  • gap_filled   │
│  • volume       │       │                 │       │  • outcome      │
└────────┬────────┘       └─────────────────┘       └────────┬────────┘
         │                                                   │
         │                                                   │
         │           ┌─────────────────────────┐             │
         └──────────►│     SQLite DATABASE     │◄────────────┘
                     │  opportunity_history.db │
                     │                         │
                     │  Tables:                │
                     │  • premarket_movers     │
                     │  • premarket_scans      │
                     │  • gap_ticker_stats     │
                     │  • watchlist            │
                     └────────────┬────────────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │     WEB DASHBOARD       │
                     │  localhost:8080/        │
                     │  premarket.html         │
                     │                         │
                     │  Displays:              │
                     │  • Fill rates by tier   │
                     │  • Repeat offenders     │
                     │  • Per-ticker history   │
                     └─────────────────────────┘
```

---

## DAILY WORKFLOW

```
═══════════════════════════════════════════════════════════════════════════
                           DAILY TIMELINE (ET)
═══════════════════════════════════════════════════════════════════════════

  6:00 AM   Premarket scanner activates
     │
     │      ┌─────────────────────────────────────────────────────────┐
     │      │  PREMARKET SCANNER (6:00 AM - 9:30 AM)                  │
     │      │                                                          │
     ├─────►│  • Scans S&P 500 + NASDAQ for gaps ≥2%                  │
     │      │  • Scores each gap (0-100)                              │
     │      │  • Tiers: HIGH_CONVICTION / TRADEABLE / WATCH           │
     │      │  • Checks for earnings catalyst                         │
     │      │  • AUTO-ADDS HIGH_CONVICTION to watchlist (7-day expiry)│
     │      │  • Saves to premarket_movers table                      │
     │      └─────────────────────────────────────────────────────────┘
     │
  9:30 AM   Market opens - gaps are "live"
     │
     │      ┌─────────────────────────────────────────────────────────┐
     │      │  TRADING DAY                                            │
     │      │                                                          │
     ├─────►│  • Bloodhound scanner tracks watchlist symbols          │
     │      │  • Session watchlist persists all day                   │
     │      │  • Dashboard shows today's gaps with history            │
     │      └─────────────────────────────────────────────────────────┘
     │
  4:00 PM   Market closes
     │
  4:15 PM   EOD Tracker runs (scheduled via PM2)
     │
     │      ┌─────────────────────────────────────────────────────────┐
     │      │  EOD GAP TRACKER                                        │
     │      │                                                          │
     ├─────►│  For each gap today:                                    │
     │      │  1. Fetch close, high, low from API                     │
     │      │  2. Calculate if gap FILLED:                            │
     │      │     • Gap UP filled if low ≤ prev_close                 │
     │      │     • Gap DOWN filled if high ≥ prev_close              │
     │      │  3. Determine OUTCOME:                                  │
     │      │     • WIN = gap continued (closed beyond gap)           │
     │      │     • LOSS = gap faded (closed beyond prev_close)       │
     │      │     • SCRATCH = minimal movement (<0.5%)                │
     │      │  4. Update gap_ticker_stats for analytics               │
     │      └─────────────────────────────────────────────────────────┘
     │
  4:30 PM   Backup run (if any gaps missed at 4:15)
     │
     ▼
  Analytics available on premarket dashboard

═══════════════════════════════════════════════════════════════════════════
```

---

## GAP FILL LOGIC

### Definition of "Gap Filled"

A gap is considered **FILLED** when price crosses back through the previous day's close.

```
GAP UP EXAMPLE:
═══════════════════════════════════════════════════

  Previous Close: $100
  Gap Open:       $105 (+5% gap)

  FILLED if:      Intraday Low ≤ $100
  NOT FILLED if:  Intraday Low > $100

  Example A: Low = $99  → FILLED ✓
  Example B: Low = $103 → NOT FILLED ✗


GAP DOWN EXAMPLE:
═══════════════════════════════════════════════════

  Previous Close: $100
  Gap Open:       $95 (-5% gap)

  FILLED if:      Intraday High ≥ $100
  NOT FILLED if:  Intraday High < $100

  Example A: High = $101 → FILLED ✓
  Example B: High = $97  → NOT FILLED ✗
```

### Outcome Determination

| Outcome | Gap Up Condition | Gap Down Condition |
|---------|------------------|-------------------|
| **WIN** | Closed > gap open | Closed < gap open |
| **LOSS** | Closed < prev_close | Closed > prev_close |
| **SCRATCH** | Closed within 0.5% of open | Closed within 0.5% of open |

---

## DATABASE SCHEMA

### premarket_movers (Core Gap Data)

```sql
-- Original columns (from premarket scanner)
id              INTEGER PRIMARY KEY
scan_id         INTEGER             -- Links to premarket_scans
timestamp       TEXT
symbol          TEXT
prev_close      REAL
premarket_price REAL
gap_pct         REAL
premarket_volume INTEGER
gap_type        TEXT                -- HUGE_UP, LARGE_DOWN, etc.
catalyst        TEXT                -- earnings_bmo, earnings_amc, null
tier            TEXT                -- HIGH_CONVICTION, TRADEABLE, WATCH
score           INTEGER

-- EOD tracking columns (added by eod-gap-tracker)
eod_close       REAL                -- Closing price
intraday_high   REAL                -- Day's high
intraday_low    REAL                -- Day's low
gap_filled      INTEGER             -- 0 or 1
fill_time       TEXT                -- When it filled (if tracked)
eod_change_pct  REAL                -- Change from gap open to close
outcome         TEXT                -- WIN, LOSS, SCRATCH
eod_updated_at  TEXT                -- When EOD data was captured
```

### gap_ticker_stats (Aggregated Analytics)

```sql
symbol          TEXT PRIMARY KEY
total_gaps      INTEGER             -- All-time gap count
total_gaps_up   INTEGER
total_gaps_down INTEGER
avg_gap_pct     REAL
fill_count      INTEGER
fill_rate       REAL                -- 0.0 to 1.0
avg_follow_through REAL             -- Avg EOD change from gap
wins            INTEGER
losses          INTEGER
win_rate        REAL                -- 0.0 to 1.0
last_gap_date   TEXT
last_gap_pct    REAL
updated_at      TEXT
```

### watchlist (Unified Symbol Tracking)

```sql
symbol          TEXT PRIMARY KEY
enabled         INTEGER             -- 0 or 1
notes           TEXT
source          TEXT                -- 'manual', 'premarket_gap', etc.
added_at        TEXT
added_by        TEXT                -- Which scanner added it
gap_pct         REAL                -- Gap % when added (if applicable)
score_at_add    INTEGER
tier_at_add     TEXT
expires_at      TEXT                -- Auto-cleanup date (7 days for gaps)
last_scanned    TEXT
```

---

## API ENDPOINTS

### Gap Analytics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gaps/analytics` | GET | Fill rates by tier, size, catalyst, direction |
| `/api/gaps/analytics?days=30` | GET | Filter to last 30 days |
| `/api/gaps/ticker/:symbol` | GET | Ticker-specific gap history |
| `/api/gaps/repeat-offenders` | GET | Frequent gappers with fill rates |
| `/api/gaps/today-with-history` | GET | Today's gaps enriched with historical context |

### Example Response: `/api/gaps/analytics`

```json
{
  "days": 30,
  "overall": {
    "total": 245,
    "filled": 142,
    "fill_rate": 58.0
  },
  "by_tier": [
    { "tier": "WATCH", "total": 89, "filled": 63, "fill_rate": 70.8 },
    { "tier": "TRADEABLE", "total": 98, "filled": 57, "fill_rate": 58.2 },
    { "tier": "HIGH_CONVICTION", "total": 58, "filled": 22, "fill_rate": 37.9 }
  ],
  "by_size": [
    { "size_bucket": "2-3%", "total": 112, "fill_rate": 68.0 },
    { "size_bucket": "3-5%", "total": 87, "fill_rate": 52.0 },
    { "size_bucket": "5%+", "total": 46, "fill_rate": 41.0 }
  ],
  "by_catalyst": [
    { "has_catalyst": "No Catalyst", "fill_rate": 62.0 },
    { "has_catalyst": "With Catalyst", "fill_rate": 38.0 }
  ]
}
```

---

## PM2 PROCESSES

| Process | Script | Schedule | Purpose |
|---------|--------|----------|---------|
| `premarket` | `premarket-scanner.js` | 6am-9:30am ET | Discover gaps |
| `bloodhound` | `bloodhound-scanner.js` | Market hours | Track watchlist |
| `eod-tracker` | `eod-gap-tracker.js` | 4:15 PM ET | Capture EOD data |
| `webserver` | `web-server.js` | Always | Serve dashboard |

### Common Commands

```bash
# View all processes
pm2 list

# View EOD tracker logs
pm2 logs eod-tracker

# Restart all
pm2 restart all

# Manual EOD run (for testing)
node monitor/eod-gap-tracker.js --now

# Check watchlist state
node monitor/migrate-watchlist.js
```

---

## DASHBOARD UI

### Premarket Page Analytics Section

Located at: `http://localhost:8080/premarket.html`

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 GAP ANALYTICS                           Lookback: [30d ▼]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FILL RATES                    REPEAT OFFENDERS                 │
│  ┌─────────────────────┐       ┌─────────────────────────────┐  │
│  │ Overall: 58%        │       │ TSLA  12 gaps  65% fill     │  │
│  │                     │       │ NVDA   8 gaps  50% fill     │  │
│  │ By Tier:            │       │ SOFI   6 gaps  83% fill     │  │
│  │ • HIGH_CONV: 38%    │       │ AMD    5 gaps  60% fill     │  │
│  │ • TRADEABLE: 58%    │       │ META   4 gaps  25% fill     │  │
│  │ • WATCH: 71%        │       └─────────────────────────────┘  │
│  │                     │                                        │
│  │ By Size:            │       TODAY'S GAPS WITH HISTORY        │
│  │ • 2-3%: 68%         │       ┌─────────────────────────────┐  │
│  │ • 3-5%: 52%         │       │ SNDK +24.7% │ 6 gaps │ NEW  │  │
│  │ • 5%+: 41%          │       │ Recent: ✓✓✓✓✗ (80%)         │  │
│  └─────────────────────┘       └─────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Legend: ✓ = filled, ✗ = ran (didn't fill)
```

---

## TRADING INSIGHTS

### What the Data Tells Us

1. **HIGH_CONVICTION gaps fill LESS often** (~38% vs 71% for WATCH)
   - Implication: HIGH_CONVICTION gaps are more likely to "run" - don't fade them

2. **Larger gaps fill less often** (5%+ gaps: 41% fill rate)
   - Implication: Big gaps often continue - momentum is real

3. **Earnings gaps fill less often** (~38% vs 62% for no catalyst)
   - Implication: News-driven gaps have follow-through

4. **Repeat offenders have patterns**
   - Some tickers consistently gap and fill (good fade candidates)
   - Some tickers gap and run (momentum plays)

### Strategy Implications

| If... | Then Consider... |
|-------|------------------|
| HIGH_CONVICTION gap | Play continuation, not fade |
| WATCH tier gap | Fade setup more likely to work |
| 5%+ gap with catalyst | Let it run, don't counter-trade |
| Repeat offender with 80% fill rate | Fade trade setup |
| Ticker's first gap in 30 days | No historical edge, use other factors |

---

## FILES REFERENCE

| File | Purpose |
|------|---------|
| `monitor/premarket-scanner.js` | Discovers gaps, saves to DB |
| `monitor/eod-gap-tracker.js` | Captures EOD data, calculates fills |
| `monitor/signal-db.js` | All database queries and schema |
| `monitor/web-server.js` | API endpoints for analytics |
| `premarket.html` | Dashboard with analytics UI |
| `data/opportunity_history.db` | SQLite database |
| `data/premarket.json` | Latest scan (JSON cache) |

---

## MAINTENANCE

### Daily
- EOD tracker runs automatically at 4:15 PM ET
- Watchlist entries expire after 7 days (auto-cleaned)

### Weekly
- Review repeat offenders for pattern changes
- Check `pm2 logs eod-tracker` for any failures

### If EOD Tracker Misses a Day
```bash
# No way to backfill - EOD data is only available same-day
# The gap will remain with eod_close = NULL
# It will be excluded from fill rate calculations
```

### Database Size Monitoring
```bash
# Check database size
ls -lh data/opportunity_history.db

# Expected growth: ~1-2 MB per month
# No automatic cleanup - all data preserved for analysis
```

---

## VERSION HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-30 | Initial release - full gap analytics system |
