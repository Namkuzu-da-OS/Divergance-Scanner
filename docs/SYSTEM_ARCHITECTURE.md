# Wingman System Architecture

Complete mapping of all components, data flows, and dependencies.

---

## System Overview Diagram

```
                            ┌─────────────────────────────────────────┐
                            │         EXTERNAL APIs                   │
                            │  ┌─────────────┐  ┌─────────────────┐  │
                            │  │ Intel API   │  │ Options API     │  │
                            │  │ Port 3000   │  │ Port 8000       │  │
                            │  │             │  │                 │  │
                            │  │ • /latest   │  │ • /technicals   │  │
                            │  │ • /outlook  │  │ • /levels       │  │
                            │  │ • /trades   │  │ • /flow         │  │
                            │  │             │  │ • /calendar     │  │
                            │  └──────┬──────┘  └────────┬────────┘  │
                            └─────────┼──────────────────┼───────────┘
                                      │                  │
                    ┌─────────────────┴──────────────────┴─────────────────┐
                    │                                                       │
                    ▼                                                       ▼
    ┌───────────────────────────────┐       ┌───────────────────────────────────┐
    │      PRIMARY SCANNERS         │       │         AUXILIARY SERVICES         │
    │  (Background PM2 Processes)   │       │     (Background PM2 Processes)     │
    │                               │       │                                    │
    │  ┌─────────────────────────┐  │       │  ┌──────────────────────────────┐  │
    │  │ bloodhound-scanner.js  │  │       │  │ web-server.js                │  │
    │  │ Port 8081 (Control)    │  │       │  │ Port 8080 (HTTP)             │  │
    │  │ • 2min scan cycle      │  │       │  │ • Serves dashboards          │  │
    │  │ • Confluence scoring   │  │       │  │ • Default: morning.html      │  │
    │  │ • Zone classification  │  │       │  │ • REST API proxy to SQLite   │  │
    │  │ • VIX regime alerts    │  │       │  └──────────────────────────────┘  │
    │  └───────────┬────────────┘  │       │                                    │
    │              │               │       │  ┌──────────────────────────────┐  │
    │  ┌───────────▼────────────┐  │       │  │ eod-gap-tracker.js           │  │
    │  │ earnings-scanner.js   │  │       │  │ No HTTP (cron-scheduled)     │  │
    │  │ Port 8082 (Control)   │  │       │  │ • Runs at 4:15 PM ET        │  │
    │  │ • 30min scan cycle    │  │       │  │ • Captures EOD gap data      │  │
    │  │ • PREM strategy       │  │       │  └──────────────────────────────┘  │
    │  │ • Position tracking   │  │       │                                    │
    │  └───────────┬────────────┘  │       └────────────────────────────────────┘
    │              │               │
    │  ┌───────────▼────────────┐  │
    │  │ opportunity-scanner.js│  │
    │  │ Port 8083 (Control)   │  │
    │  │ • 5min scan cycle     │  │
    │  │ • Unusual options     │  │
    │  │ • Vol/OI detection    │  │
    │  └───────────┬────────────┘  │
    │              │               │
    │  ┌───────────▼────────────┐  │
    │  │ premarket-scanner.js  │  │
    │  │ Port 8084 (Control)   │  │
    │  │ • 5min scan cycle     │  │
    │  │ • 6:00-9:30 AM ET     │  │
    │  │ • Gap detection       │  │
    │  └────────────────────────┘  │
    └───────────────┬──────────────┘
                    │
                    │ WRITES
                    ▼
    ┌───────────────────────────────────────────────────────────────────────────┐
    │                              data/                                        │
    │                                                                           │
    │  ┌──────────────────────────────────────────────────────────────────┐    │
    │  │                    wingman.db (SQLite)                            │    │
    │  │                                                                   │    │
    │  │  bloodhound_scans    ── Scan metadata (market context, VIX)      │    │
    │  │  bloodhound_results  ── Per-ticker results (zones, scores)       │    │
    │  │  scanner_history     ── History badges (NEW/Day2/Streak)         │    │
    │  │  signals             ── Signal tracking + validation             │    │
    │  │  checkpoints         ── Multi-checkpoint validation (4h/24h/7d)  │    │
    │  │  watchlist           ── User watchlist + auto-added symbols      │    │
    │  │  premarket_scans     ── Pre-market scan metadata                 │    │
    │  │  premarket_movers    ── Pre-market gap movers                    │    │
    │  │  gap_ticker_stats    ── Gap fill analytics per ticker            │    │
    │  │  earnings_scans      ── Earnings scan metadata                   │    │
    │  │  earnings_results    ── PREM candidates                          │    │
    │  │  positions           ── Open positions                           │    │
    │  │  opportunities       ── Unusual options activity                 │    │
    │  │  alerts              ── Telegram alert history                   │    │
    │  └──────────────────────────────────────────────────────────────────┘    │
    │                                                                           │
    │  ┌──────────────────────────────────────────────────────────────────┐    │
    │  │                    Flat Files (remaining)                         │    │
    │  │                                                                   │    │
    │  │  watchlist.json         ── Legacy fallback (SQLite is primary)   │    │
    │  │  earnings-calendar.json ── Earnings dates                        │    │
    │  │  account_summary.json   ── P&L summary                          │    │
    │  │  MARKET_INTEL.md        ── Living market intelligence            │    │
    │  │  daily_log.md           ── Trading journal                       │    │
    │  │  .bloodhound_paused     ── Pause state flag                     │    │
    │  │  .earnings_paused       ── Earnings pause flag                  │    │
    │  └──────────────────────────────────────────────────────────────────┘    │
    └───────────────────────────────────────────────────────────────────────────┘
                    │
                    │ READS
                    ▼
    ┌───────────────────────────────────────────────────────────────────────────┐
    │                           DASHBOARDS (HTML)                               │
    │                         Served via Port 8080                              │
    │                                                                           │
    │  ┌─────────────────────────────────────────────────────────────────────┐ │
    │  │                     INTER-DASHBOARD NAVIGATION                      │ │
    │  │              (Shared nav bar across all 10 dashboards)               │ │
    │  │                                                                      │ │
    │  │   morning ◄──► zone-scanner ◄──► scanner ◄──► dashboard             │ │
    │  │     │               │                │                               │ │
    │  │     ▼               ▼                ▼                               │ │
    │  │   premarket    analytics       earnings-scanner                      │ │
    │  │                    │                  │                               │ │
    │  │              opportunity-scanner      │                               │ │
    │  │                    │                  │                               │ │
    │  │              INSIGHTS dropdown:       │                               │ │
    │  │              ├── analytics            │                               │ │
    │  │              ├── strategies           │                               │ │
    │  │              └── options-lab          │                               │ │
    │  └─────────────────────────────────────────────────────────────────────┘ │
    └───────────────────────────────────────────────────────────────────────────┘
                    │
                    │ CONTROL APIs
                    ▼
    ┌───────────────────────────────────────────────────────────────────────────┐
    │                          CONTROL API MAPPING                              │
    │                                                                           │
    │  Dashboard              Control Port    Scanner                           │
    │  ─────────              ────────────    ───────                           │
    │  zone-scanner.html  ──► Port 8081  ──► bloodhound-scanner.js             │
    │  earnings-scanner   ──► Port 8082  ──► earnings-scanner.js               │
    │  opportunity-scanner──► Port 8083  ──► opportunity-scanner.js            │
    │  premarket.html     ──► Port 8084  ──► premarket-scanner.js              │
    │                                                                           │
    │  All Control Endpoints:                                                  │
    │  • GET  /status          - Scanner state, next scan countdown            │
    │  • POST /pause           - Pause scanning                                │
    │  • POST /resume          - Resume scanning                               │
    │  • POST /scan            - Trigger immediate scan                        │
    │  • POST /clear-cooldowns - Reset alert cooldowns                         │
    │  • POST /test-alert      - Send test Telegram message                    │
    │                                                                           │
    │  Bloodhound-specific (8081):                                             │
    │  • GET  /watchlist       - Current watchlist                             │
    │  • POST /watchlist/add   - Add symbol                                    │
    │  • POST /watchlist/remove- Remove symbol                                 │
    │                                                                           │
    │  Earnings-specific (8082):                                               │
    │  • GET  /calendar        - Earnings dates                                │
    │  • GET  /results         - PREM scan results                             │
    │  • GET  /positions       - Open positions                                │
    │  • POST /positions/add   - Add position                                  │
    │  • POST /positions/close - Close position                                │
    │  • GET  /analytics       - Performance stats                             │
    │  • POST /refresh-calendar- Fetch new earnings dates                      │
    └───────────────────────────────────────────────────────────────────────────┘
```

---

## Dashboard Matrix

| Dashboard | Primary Data Source | Control Port | Purpose |
|-----------|---------------------|--------------|---------|
| **morning.html** | `/api/morning-briefing` | - | Morning briefing, session overview |
| **zone-scanner.html** | `/api/scan/latest` (SQLite) | 8081 | Bloodhound confluence zones, tradeable setups |
| **scanner.html** | `/api/scan/summary`, `/api/alerts` (SQLite) | - | Legacy market structure, VIX regime |
| **dashboard.html** | `/api/positions`, account_summary.json | - | Account P&L, positions |
| **analytics.html** | `/api/signals`, `/api/signals/stats` (SQLite) | - | Signal validation, performance analysis |
| **earnings-scanner.html** | (API only - port 8082) | 8082 | PREM candidates, earnings calendar |
| **opportunity-scanner.html** | `/api/opportunities/latest` (SQLite) | 8083 | Unusual options activity |
| **premarket.html** | `/api/premarket`, `/api/premarket/today` (SQLite) | 8084 | Pre-market gaps and movers |
| **strategies.html** | (static) | - | Strategy browser |
| **options-lab.html** | Options API (8000) | - | Options analysis tools |

---

## Data File Ownership

### Written by bloodhound-scanner.js (every 2 min)
```
data/wingman.db (SQLite tables)
├── bloodhound_scans      # Scan metadata (market context, VIX, counts)
├── bloodhound_results    # Per-ticker results (zone, score, signals, levels)
├── scanner_history       # History badges (NEW/Day2/Streak)
├── signals               # Signal tracking + multi-checkpoint validation
├── checkpoints           # 4h/24h/7d validation checkpoints
├── watchlist             # Via /watchlist/add|remove API
└── alerts                # Telegram alert history

data/
└── watchlist.json         # Legacy fallback (SQLite watchlist table is primary)
```

**API access (via web-server.js on port 8080):**
- `GET /api/scan/latest` -- full scan data (replaces dynamic_scan.json)
- `GET /api/scan/summary` -- summary format (replaces scanner.json)
- `GET /api/signals` -- signal tracking data
- `GET /api/alerts` -- alert history (replaces alerts_log.json)

### Written by earnings-scanner.js (every 30 min)
```
data/wingman.db (SQLite tables)
├── earnings_scans            # Earnings scan metadata
└── earnings_results          # PREM candidates

data/
├── earnings-calendar.json    # Earnings dates (prerequisite)
└── earnings-paper-trades.json # Earnings paper trades
```

**API access (via earnings scanner control API on port 8082):**
- `GET /results` -- PREM scan results
- `GET /calendar` -- earnings dates
- `GET /positions` -- open earnings positions
- `GET /analytics` -- performance stats

### Written by opportunity-scanner.js (every 5 min)
```
data/wingman.db (SQLite tables)
├── scans                     # Opportunity scan metadata
└── opportunities             # Unusual options opportunities (per scan)
```

**API access (via web-server.js on port 8080):**
- `GET /api/opportunities/latest` -- latest opportunity scan results

**SQLite Schema (wingman.db):**
```sql
-- Scan metadata
CREATE TABLE scans (
    id INTEGER PRIMARY KEY,
    timestamp TEXT,
    symbols_scanned INTEGER,
    high_conviction_count INTEGER,
    tradeable_count INTEGER,
    watch_count INTEGER,
    market_vix REAL,
    market_spy_price REAL,
    market_spy_trend TEXT
);

-- Individual opportunities
CREATE TABLE opportunities (
    id INTEGER PRIMARY KEY,
    scan_id INTEGER,
    symbol TEXT,
    timestamp TEXT,
    discovery_score INTEGER,
    discovery_sources TEXT,      -- JSON array
    opportunity_score INTEGER,
    tier TEXT,
    price REAL,
    vol_oi_ratio REAL,
    unusual_activity TEXT,
    gap_percent REAL,
    iv_percentile REAL,
    rsi REAL,
    signals TEXT                 -- JSON array
);
```

### Written by premarket-scanner.js (every 5 min, 6:00-9:30 AM ET)
```
data/wingman.db (SQLite tables)
├── premarket_scans          # Pre-market scan metadata
├── premarket_movers         # Gap movers per scan
└── watchlist                # Auto-adds HIGH_CONVICTION gaps (7-day expiry)
```

**API access (via web-server.js on port 8080):**
- `GET /api/premarket` -- latest premarket scan
- `GET /api/premarket/today` -- today's stats and top gappers

### Written by eod-gap-tracker.js (daily at 4:15 PM ET)
```
data/wingman.db (SQLite tables)
└── gap_ticker_stats         # Gap fill rates, EOD outcomes per ticker
```

**API access (via web-server.js on port 8080):**
- `GET /api/gaps/analytics?days=30` -- fill rates by tier, size, catalyst
- `GET /api/gaps/ticker/:symbol` -- ticker-specific gap history
- `GET /api/gaps/repeat-offenders` -- frequent gappers with fill rates
- `GET /api/gaps/today-with-history` -- today's gaps with historical context

### Written by paper-trade-manager.js (called by scanners)
```
data/
└── paper_trades.json      # Paper trade tracking for validation
```

### Written by earnings-calendar-scraper.js (manual/scheduled)
```
data/
└── earnings-calendar.json # Earnings dates (prerequisite for earnings-scanner)
```

### VIX Regime Alerts (consolidated into bloodhound-scanner.js)

VIX regime change detection was previously handled by `wingman-monitor.js` (deprecated).
It is now built directly into `bloodhound-scanner.js`. When VIX crosses regime thresholds
(12/20/30/40), Bloodhound sends a Telegram alert. Alerts are stored in the `alerts` table
in `wingman.db`. No separate process is needed.

### Written by eod.js (daily)
```
data/
├── account_summary.json   # Updates timestamp
├── daily_log.md           # Creates fresh template
└── MARKET_INTEL.md        # Appends EOD session recap
```

### Manual / UI-written
```
data/
├── watchlist.json         # Also via zone-scanner.html UI (SQLite is primary)
├── MARKET_INTEL.md        # Living market intelligence (swing watchlist, session recaps)
└── daily_log.md           # User journaling via -note command

data/wingman.db (SQLite tables)
└── positions              # Via /api/positions endpoint or dashboard UI
```

---

## Scan Cycle Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BLOODHOUND SCAN CYCLE (Every 2 min)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. DISCOVERY                                                               │
│     ┌──────────────────┐                                                    │
│     │ Load watchlist   │──► Always-scanned symbols (user curated)          │
│     │ from SQLite      │    (fallback: watchlist.json)                      │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│     ┌────────▼─────────┐                                                    │
│     │ Call Intel API   │──► /api/latest for 52wk extremes, volume spikes   │
│     │ /api/latest      │                                                    │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│     ┌────────▼─────────┐                                                    │
│     │ Sector Rotation  │──► Find strongest/weakest sector ETFs             │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│  2. ANALYSIS (for each symbol)                                              │
│     ┌────────▼─────────┐                                                    │
│     │ /api/technicals  │──► RSI, trend, Bollinger Bands, momentum          │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│     ┌────────▼─────────┐                                                    │
│     │ /api/levels      │──► Call wall, put wall, max pain, VWAP            │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│     ┌────────▼─────────┐                                                    │
│     │ /api/flow        │──► Options flow, unusual activity                 │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│  3. SCORING                                                                 │
│     ┌────────▼─────────┐                                                    │
│     │ Confluence Score │                                                    │
│     │ (0-80 points)    │                                                    │
│     │                  │                                                    │
│     │ Technical: 25pts │──► RSI extremes, BB position, trend               │
│     │ Levels:    25pts │──► Wall proximity, VWAP, breakout/breakdown       │
│     │ Volume:    15pts │──► Volume spike (2x+), elevated (1.5x+)           │
│     │ Context:   15pts │──► SPY alignment, VIX regime                      │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│  4. CLASSIFICATION                                                          │
│     ┌────────▼─────────┐                                                    │
│     │ Zone Assignment  │                                                    │
│     │                  │                                                    │
│     │ BUY_ZONE    ──► <0.5% to put wall, RSI <40                           │
│     │ SELL_ZONE   ──► <0.5% to call wall, RSI >60                          │
│     │ PINNED      ──► Between walls <3% spread                             │
│     │ MID_RANGE   ──► No clear edge                                        │
│     │ EXTENDED_*  ──► Beyond walls                                         │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│     ┌────────▼─────────┐                                                    │
│     │ Tier Assignment  │                                                    │
│     │                  │                                                    │
│     │ HIGH_CONVICTION ──► Score ≥56 + at wall (0.5%)                       │
│     │                      OR Score ≥64 + near wall (1.5%)                 │
│     │ TRADEABLE       ──► Score ≥48 + at wall + trend aligned              │
│     │ WATCH           ──► Score ≥40 + near wall                            │
│     │                      OR EXTENDED + RSI <35                           │
│     │ FILTERED        ──► Everything else                                  │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│  5. OUTPUT                                                                  │
│     ┌────────▼─────────┐                                                    │
│     │ Write to SQLite  │                                                    │
│     │ (wingman.db)     │                                                    │
│     │                  │                                                    │
│     │ • bloodhound_scans   (scan metadata)                                 │
│     │ • bloodhound_results (per-ticker data → /api/scan/latest)            │
│     │ • scanner_history    (badge tracking)                                │
│     │ • signals            (HIGH_CONVICTION → validation)                  │
│     └────────┬─────────┘                                                    │
│              │                                                               │
│  6. ALERTS                                                                  │
│     ┌────────▼─────────┐                                                    │
│     │ Telegram Alerts  │                                                    │
│     │                  │                                                    │
│     │ HIGH_CONVICTION ──► Alert immediately                                │
│     │ TRADEABLE       ──► Alert with 30min cooldown                        │
│     │ WATCH/FILTERED  ──► No alert (dashboard only)                        │
│     └──────────────────┘                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Paper Trade Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAPER TRADE LIFECYCLE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ENTRY (on HIGH_CONVICTION or TRADEABLE signal)                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Captured at entry:                                                    │  │
│  │ • entry_price, entry_timestamp                                        │  │
│  │ • score, zone, tier                                                   │  │
│  │ • signals (array of contributing factors)                             │  │
│  │ • vix, vix_regime                                                     │  │
│  │ • spy_trend, intraday_bias, swing_bias                                │  │
│  │ • history_status (NEW/DAY_2/STREAK)                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│  TRACKING (every 2 min scan cycle)                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Price windows captured:                                               │  │
│  │ • price_1h  (first check after 1 hour)                                │  │
│  │ • price_4h  (first check after 4 hours)                               │  │
│  │ • price_24h (first check after 24 hours)                              │  │
│  │ • price_72h (first check after 72 hours)                              │  │
│  │                                                                        │  │
│  │ Running metrics:                                                       │  │
│  │ • peak_gain_pct (highest % gain seen)                                 │  │
│  │ • max_drawdown_pct (largest % loss seen)                              │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│  EXIT CONDITIONS                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ • Stop Loss:   -5% from entry      ──► outcome: LOSS                  │  │
│  │ • Take Profit: +5% from entry      ──► outcome: WIN                   │  │
│  │ • Time Stop:   72 hours elapsed    ──► outcome: based on final P&L   │  │
│  │                                                                        │  │
│  │ Outcome classification:                                               │  │
│  │ • WIN:       final P&L ≥ +2%                                          │  │
│  │ • LOSS:      final P&L ≤ -2%                                          │  │
│  │ • BREAKEVEN: -2% < final P&L < +2%                                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│  ANALYTICS (analytics.html dashboard)                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Performance analysis by:                                              │  │
│  │ • Tier (HIGH_CONVICTION vs TRADEABLE vs WATCH)                        │  │
│  │ • VIX regime (complacent/normal/elevated/fear/capitulation)           │  │
│  │ • Score range (does higher score = better results?)                   │  │
│  │ • SPY trend (bullish vs bearish market)                               │  │
│  │ • Bias alignment (with vs against market direction)                   │  │
│  │ • Exit reason (stop loss vs target vs time stop)                      │  │
│  │ • Optimal timing (1h, 4h, 24h, 72h windows)                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Monitor Pause Coordination

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PAUSE STATE COORDINATION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User clicks PAUSE on zone-scanner.html                                    │
│                              │                                              │
│                              ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ POST http://localhost:8081/pause                                      │ │
│  │                              │                                         │ │
│  │                              ▼                                         │ │
│  │  bloodhound-scanner.js                                                │ │
│  │  • Sets paused = true                                                 │ │
│  │  • Creates data/.bloodhound_paused file                               │ │
│  │  • Stops scan cycles                                                  │ │
│  │  • Stops VIX regime alerts (consolidated into Bloodhound)             │ │
│  │  • Control API still responds to /status                              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  RESULT: Pausing Bloodhound silences scanning + VIX alerts                 │
│  • Bloodhound stops scanning and alerting                                  │
│  • Dashboards still display last data (no refresh)                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Port Allocation

| Port | Service | Type | Owner File |
|------|---------|------|------------|
| **3000** | Intel API | External | (remote server) |
| **8000** | Options API | External | (remote server) |
| **8080** | Web Server | HTTP Static + API | web-server.js |
| **8081** | Bloodhound Control | HTTP API | bloodhound-scanner.js |
| **8082** | Earnings Control | HTTP API | earnings-scanner.js |
| **8083** | Opportunity Control | HTTP API | opportunity-scanner.js |
| **8084** | Pre-Market Control | HTTP API | premarket-scanner.js |

---

## File Location Summary

### Root Directory
```
wingman/
├── CLAUDE.md              # AI instructions
├── README.md              # Project readme
├── package.json           # Node dependencies
├── ecosystem.config.js    # PM2 process config (starts all scanners)
├── eod.js                 # End-of-day script
│
├── morning.html           # DEFAULT - Morning briefing dashboard
├── zone-scanner.html      # Bloodhound confluence zones
├── scanner.html           # Legacy market structure dashboard
├── dashboard.html         # Account/positions dashboard
├── analytics.html         # Signal validation dashboard
├── earnings-scanner.html  # Earnings dashboard
├── opportunity-scanner.html # Unusual options dashboard
├── premarket.html         # Pre-market gaps dashboard
├── strategies.html        # Strategy browser
├── options-lab.html       # Options analysis tools
├── options-explainer.html # Options education
│
├── css/
│   └── nav.css            # Shared navigation styles
```

### monitor/
```
monitor/
├── config.json                    # API endpoints, Telegram credentials
│
├── bloodhound-scanner.js          # PRIMARY SCANNER - confluence scoring, VIX alerts
├── earnings-scanner.js            # Earnings PREM scanner
├── opportunity-scanner.js         # Unusual options scanner
├── premarket-scanner.js           # Pre-market gap detection (6:00-9:30 AM ET)
├── eod-gap-tracker.js             # EOD gap fill tracking (4:15 PM ET)
├── dynamic-scanner.js             # Zone classification module
│
├── signal-db.js                   # SQLite database layer (all tables)
├── signal-logger.js               # Signal tracking wrapper
├── opportunity-db.js              # Opportunity SQLite storage
├── web-server.js                  # Dashboard server + REST API proxy
├── paper-trade-manager.js         # Paper trade tracking
├── earnings-calendar-scraper.js   # Earnings date fetcher
├── trade-client.js                # Trade logging client
├── watchlist.js                   # Watchlist CLI
├── migrate-to-db.js               # Migration: JSON files → SQLite
├── migrate-watchlist.js           # Migration: watchlist.json → SQLite
├── scanner-validator.js           # Validation tool
│
├── wingman-monitor.js             # DEPRECATED - VIX alerts now in bloodhound
├── _legacy/                       # Old/deprecated code
```

### data/
```
data/
├── wingman.db                 # PRIMARY - SQLite database (all scanner data)
│   ├── bloodhound_scans      #   Scan metadata (replaces scanner.json)
│   ├── bloodhound_results    #   Per-ticker data (replaces dynamic_scan.json)
│   ├── scanner_history       #   History badges (replaces scanner_history.json)
│   ├── signals               #   Signal tracking (replaces signal_tracking.json)
│   ├── checkpoints           #   Multi-checkpoint validation (4h/24h/7d)
│   ├── watchlist             #   User watchlist (replaces watchlist.json)
│   ├── premarket_scans       #   Pre-market scan metadata
│   ├── premarket_movers      #   Pre-market gap movers
│   ├── gap_ticker_stats      #   Gap fill analytics per ticker
│   ├── earnings_scans        #   Earnings scan metadata (replaces earnings-scan.json)
│   ├── earnings_results      #   PREM candidates
│   ├── positions             #   Open positions (replaces positions.json)
│   ├── opportunities         #   Unusual options (replaces opportunities.json)
│   ├── alerts                #   Alert history (replaces alerts_log.json)
│   └── scans                 #   Opportunity scan metadata
│
├── watchlist.json             # Legacy fallback for watchlist (SQLite is primary)
├── earnings-calendar.json     # Earnings dates
├── earnings-paper-trades.json # Earnings paper trades
├── account_summary.json       # P&L summary
│
├── MARKET_INTEL.md            # Living market intelligence (replaced ACTIVE_SESSION.md)
├── daily_log.md               # Trading journal
│
├── .bloodhound_paused         # Pause state flag
├── .earnings_paused           # Earnings pause flag
└── archive/                   # Archived deprecated JSON files
```

**Deprecated files (moved to data/archive/ or deleted):**
- `dynamic_scan.json` → SQLite `bloodhound_results` + `GET /api/scan/latest`
- `scanner.json` → SQLite `bloodhound_scans` + `GET /api/scan/summary`
- `bloodhound.json` → SQLite `bloodhound_scans`
- `signal_tracking.json` → SQLite `signals` table
- `alerts_log.json` → SQLite `alerts` table + `GET /api/alerts`
- `scanner_history.json` → SQLite `scanner_history` table
- `positions.json` → SQLite `positions` table + `GET /api/positions`
- `earnings-scan.json` → SQLite `earnings_scans`/`earnings_results` tables
- `opportunities.json` → SQLite `opportunities` table + `GET /api/opportunities/latest`
- `premarket.json` → SQLite `premarket_scans`/`premarket_movers` tables
- `ACTIVE_SESSION.md` → Removed; session state now in `MARKET_INTEL.md`
- `goals.json` → Removed (feature not active)

### docs/
```
docs/
├── VISION.md                  # Project vision
├── RULES.md                   # Trading rules
├── STRATEGIES.md              # Trading strategies
├── EARNINGS_STRATEGIES.md     # Earnings strategies
├── TRADING_SYSTEM.md          # System documentation
├── SCANNER_HISTORY.md         # Scanner history feature
├── SCANNER_HISTORY_STATUS.md  # (duplicate?)
├── EARNINGS_SCANNER_PLAN.md   # Earnings scanner plan
├── KNOWN_ISSUES.md            # Known issues
└── CHANGELOG_2026-01-14.md    # Changelog
```

### backtesting/
```
backtesting/
├── README.md
├── signal-backtester.js       # JS backtesting
├── analyze-failures.js        # Failure analysis
├── wingman_backtest.py        # Python backtesting
└── wingman-strategy.pine      # TradingView strategy
```

### indicators/
```
indicators/
├── README.md
└── wingman-master.pine        # TradingView indicator
```

### toolbox/
```
toolbox/
└── archive/
    ├── RiskMGMT.md
    ├── trading_plan.md
    └── VWAP_Reversion_with_Divergence_Checklist.md
```

---

## Module Dependencies

```
bloodhound-scanner.js
    ├── requires: signal-db.js (SQLite storage for scans, signals, watchlist)
    ├── requires: signal-logger.js (signal tracking wrapper)
    ├── requires: paper-trade-manager.js (calls createPaperTrade, updatePaperTrades)
    └── includes: VIX regime alerts (consolidated from wingman-monitor.js)

earnings-scanner.js
    ├── requires: signal-db.js (SQLite storage for earnings scans/results)
    ├── requires: paper-trade-manager.js (calls functions)
    └── can call: earnings-calendar-scraper.js (via /refresh-calendar)

opportunity-scanner.js
    ├── requires: opportunity-db.js (SQLite historical data)
    └── discovery: Dynamic from 7 sources (core, watchlist, ETFs, movers, extremes)

premarket-scanner.js
    ├── requires: signal-db.js (SQLite storage for premarket scans/movers)
    └── auto-adds: HIGH_CONVICTION gaps to SQLite watchlist (7-day expiry)

eod-gap-tracker.js
    └── requires: signal-db.js (SQLite storage for gap_ticker_stats)

opportunity-db.js
    ├── exports: getDb(), saveScanResults(), getRecentScans(), getTierStats(), getTopSymbols()
    └── uses: better-sqlite3 (npm package)

signal-db.js
    ├── exports: All SQLite table operations (signals, scans, watchlist, premarket, etc.)
    └── uses: better-sqlite3 (npm package)

dynamic-scanner.js
    ├── exports: runDynamicScan(), buildDynamicWatchlist(), analyzeSymbol(), ZONES
    └── imported by: bloodhound-scanner.js (optional module usage)

web-server.js
    ├── requires: signal-db.js (reads SQLite for API responses)
    ├── requires: opportunity-db.js (reads opportunity data)
    ├── serves: All HTML files from root
    ├── proxies: /proxy/analytics/* to Intel API (port 3000)
    └── API: /api/scan/*, /api/signals/*, /api/alerts, /api/premarket/*,
             /api/gaps/*, /api/opportunities/*, /api/positions, /api/morning-briefing
```

---

## Summary Stats

| Category | Count |
|----------|-------|
| HTML Dashboards | 10 |
| Monitor Scripts (active) | 12 |
| SQLite Database | 1 (wingman.db with 15+ tables) |
| Flat Data Files | ~6 (legacy/supplemental) |
| Control Ports | 4 (8081, 8082, 8083, 8084) |
| External API Ports | 2 (3000, 8000) |
| Web Server Port | 1 (8080 - static + API) |
