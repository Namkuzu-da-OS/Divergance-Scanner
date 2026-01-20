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
    │  │ bloodhound-scanner.js  │  │       │  │ wingman-monitor.js           │  │
    │  │ Port 8081 (Control)    │  │       │  │ No HTTP (VIX alerts only)    │  │
    │  │ • 2min scan cycle      │──┼───────┼─▶│ • Checks 8081 pause state    │  │
    │  │ • Confluence scoring   │  │       │  │ • 2min check cycle           │  │
    │  │ • Zone classification  │  │       │  └──────────────────────────────┘  │
    │  └───────────┬────────────┘  │       │                                    │
    │              │               │       │  ┌──────────────────────────────┐  │
    │  ┌───────────▼────────────┐  │       │  │ web-server.js                │  │
    │  │ earnings-scanner.js   │  │       │  │ Port 8080 (HTTP)             │  │
    │  │ Port 8082 (Control)   │  │       │  │ • Serves dashboards          │  │
    │  │ • 30min scan cycle    │  │       │  │ • Default: zone-scanner.html │  │
    │  │ • PREM strategy       │  │       │  │ • POST /api/save-paper-trades│  │
    │  │ • Position tracking   │  │       │  └──────────────────────────────┘  │
    │  └───────────┬────────────┘  │       │                                    │
    │              │               │       └────────────────────────────────────┘
    │  ┌───────────▼────────────┐  │
    │  │ opportunity-scanner.js│  │
    │  │ Port 8083 (Control)   │  │
    │  │ • 5min scan cycle     │  │
    │  │ • Unusual options     │  │
    │  │ • Vol/OI detection    │  │
    │  └────────────────────────┘  │
    └───────────────┬──────────────┘
                    │
                    │ WRITES
                    ▼
    ┌───────────────────────────────────────────────────────────────────────────┐
    │                              data/                                        │
    │                                                                           │
    │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐    │
    │  │ dynamic_scan.json│  │ scanner.json     │  │ scanner_history.json │    │
    │  │ (1200+ lines)    │  │ (legacy summary) │  │ (history badges)     │    │
    │  │ MAIN DASHBOARD   │  │                  │  │                      │    │
    │  └────────┬─────────┘  └────────┬─────────┘  └──────────────────────┘    │
    │           │                     │                                         │
    │  ┌────────┼─────────────────────┼─────────────────────────────────┐      │
    │  │        │                     │                                  │      │
    │  │  ┌─────▼────────┐  ┌────────▼───────┐  ┌──────────────────┐   │      │
    │  │  │ paper_trades │  │ alerts_log.json│  │ watchlist.json   │   │      │
    │  │  │ .json        │  │ (Telegram log) │  │ (user symbols)   │   │      │
    │  │  └──────────────┘  └────────────────┘  └──────────────────┘   │      │
    │  │                                                                │      │
    │  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐   │      │
    │  │  │ earnings-    │  │ earnings-scan  │  │ opportunities    │   │      │
    │  │  │ calendar.json│  │ .json          │  │ .json            │   │      │
    │  │  └──────────────┘  └────────────────┘  └──────────────────┘   │      │
    │  │                                                                │      │
    │  │  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐   │      │
    │  │  │ positions    │  │ account_summary│  │ goals.json       │   │      │
    │  │  │ .json        │  │ .json          │  │                  │   │      │
    │  │  └──────────────┘  └────────────────┘  └──────────────────┘   │      │
    │  └────────────────────────────────────────────────────────────────┘      │
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
    │  │                                                                      │ │
    │  │   zone-scanner ◄──────► scanner ◄──────► dashboard                  │ │
    │  │        │                   │                                         │ │
    │  │        ▼                   │                                         │ │
    │  │   analytics ◄─────────────┼───────────► earnings-scanner            │ │
    │  │        │                   │                   │                     │ │
    │  │        └───────────────────┼───────────────────┘                     │ │
    │  │                            │                                         │ │
    │  │                   opportunity-scanner                                │ │
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
| **zone-scanner.html** | dynamic_scan.json | 8081 | Bloodhound confluence zones, tradeable setups |
| **scanner.html** | scanner.json, alerts_log.json | - | Legacy market structure, VIX regime |
| **dashboard.html** | positions.json, account_summary.json, goals.json | - | Account P&L, positions, goals |
| **analytics.html** | paper_trades.json | - | Signal validation, performance analysis |
| **earnings-scanner.html** | (API only - port 8082) | 8082 | PREM candidates, earnings calendar |
| **opportunity-scanner.html** | opportunities.json | 8083 | Unusual options activity |

---

## Data File Ownership

### Written by bloodhound-scanner.js (every 2 min)
```
data/
├── dynamic_scan.json      # PRIMARY - Zone Scanner dashboard data
├── bloodhound.json        # Legacy format (compatibility)
├── scanner.json           # Legacy format (compatibility)
├── scanner_history.json   # History badges (NEW/Day2/Streak)
├── signal_tracking.json   # Signal outcome tracking
└── watchlist.json         # Via /watchlist/add|remove API
```

### Written by earnings-scanner.js (every 30 min)
```
data/
├── earnings-scan.json         # PREM candidates
├── earnings-positions.json    # Open earnings positions
└── earnings-paper-trades.json # Earnings paper trades
```

### Written by opportunity-scanner.js (every 5 min)
```
data/
├── opportunities.json         # Unusual options opportunities (JSON, overwrites each scan)
└── opportunity_history.db     # SQLite database for historical analysis
```

**SQLite Schema (opportunity_history.db):**
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

### Written by wingman-monitor.js (on VIX regime change)
```
data/
└── alerts_log.json        # Alert history (30-day retention)
```

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

### Written by eod.js (daily)
```
data/
├── account_summary.json   # Updates timestamp
├── daily_log.md           # Creates fresh template
└── ACTIVE_SESSION.md      # Appends EOD marker
```

### Manual / UI-written
```
data/
├── watchlist.json         # Also via zone-scanner.html UI
├── goals.json             # Via dashboard.html or manual
├── positions.json         # Via trading activity
└── daily_log.md           # User journaling via -note command
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
│     │ from JSON        │                                                    │
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
│     │ Write JSON files │                                                    │
│     │                  │                                                    │
│     │ • dynamic_scan.json (full data for dashboard)                        │
│     │ • scanner.json (legacy summary)                                      │
│     │ • bloodhound.json (legacy format)                                    │
│     │ • scanner_history.json (badge tracking)                              │
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
│  │  • Control API still responds to /status                              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                              │                                              │
│                              │ wingman-monitor.js checks                    │
│                              │ before each alert cycle                      │
│                              ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ GET http://localhost:8081/status                                      │ │
│  │                              │                                         │ │
│  │                              ▼                                         │ │
│  │  if (response.paused === true) {                                      │ │
│  │      // Skip all checks, return early                                 │ │
│  │      // No VIX regime alerts sent                                     │ │
│  │  }                                                                    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  RESULT: Pausing Bloodhound silences entire system                         │
│  • Bloodhound stops scanning                                               │
│  • Monitor stops alerting                                                  │
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
| **8080** | Web Server | HTTP Static | web-server.js |
| **8081** | Bloodhound Control | HTTP API | bloodhound-scanner.js |
| **8082** | Earnings Control | HTTP API | earnings-scanner.js |
| **8083** | Opportunity Control | HTTP API | opportunity-scanner.js |

---

## File Location Summary

### Root Directory
```
wingman/
├── CLAUDE.md              # AI instructions
├── README.md              # Project readme
├── package.json           # Node dependencies
├── eod.js                 # End-of-day script
│
├── zone-scanner.html      # PRIMARY DASHBOARD
├── scanner.html           # Market structure dashboard
├── dashboard.html         # Account/positions dashboard
├── analytics.html         # Signal validation dashboard
├── earnings-scanner.html  # Earnings dashboard
├── opportunity-scanner.html # Unusual options dashboard
│
├── DOCUMENTATION_SUMMARY.md   # Orphan doc
├── QUICK_REFERENCE_CARD.md    # Orphan doc
├── QUICK_START.md             # Orphan doc
├── SYSTEM_AUDIT.md            # Orphan doc
├── SYSTEM_STATUS.md           # Orphan doc
└── nul                        # Windows artifact (delete)
```

### monitor/
```
monitor/
├── config.json                    # API endpoints, Telegram credentials
│
├── bloodhound-scanner.js          # PRIMARY SCANNER (103 KB)
├── earnings-scanner.js            # Earnings PREM scanner (45 KB)
├── opportunity-scanner.js         # Unusual options scanner (25 KB)
├── dynamic-scanner.js             # Zone classification module (19 KB)
│
├── wingman-monitor.js             # VIX regime alerts (11 KB)
├── web-server.js                  # Dashboard server (3 KB)
├── paper-trade-manager.js         # Paper trade tracking (11 KB)
├── earnings-calendar-scraper.js   # Earnings date fetcher (9 KB)
├── trade-client.js                # Trade logging client (7 KB)
├── watchlist.js                   # Watchlist CLI (7 KB)
├── scanner-validator.js           # Validation tool (6 KB)
│
├── README.md
├── SETUP.md
├── _legacy/                       # Old/deprecated code
│
├── tmpclaude-0205-cwd             # TEMP FILE (delete)
├── tmpclaude-1f2e-cwd             # TEMP FILE (delete)
├── tmpclaude-573c-cwd             # TEMP FILE (delete)
├── tmpclaude-598f-cwd             # TEMP FILE (delete)
└── tmpclaude-998a-cwd             # TEMP FILE (delete)
```

### data/
```
data/
├── dynamic_scan.json          # PRIMARY - Zone scanner data (1200+ lines)
├── scanner.json               # Legacy scanner summary
├── bloodhound.json            # Legacy bloodhound format
├── scanner_history.json       # History badges
├── signal_tracking.json       # Signal outcomes
├── paper_trades.json          # Paper trade tracking
├── alerts_log.json            # Alert history
├── watchlist.json             # User watchlist
│
├── earnings-calendar.json     # Earnings dates
├── earnings-scan.json         # PREM candidates
├── earnings-paper-trades.json # Earnings paper trades
├── opportunities.json         # Unusual options
│
├── positions.json             # Open positions
├── account_summary.json       # P&L summary
├── goals.json                 # Trading goals
├── trades_journal.json        # Trade history (API-only?)
│
├── daily_log.md               # Trading journal
├── ACTIVE_SESSION.md          # Session state
├── scanner_config.json        # (unused?)
│
├── .bloodhound_paused         # Pause state flag
├── .earnings_paused           # Earnings pause flag
└── HANDOFF_2026-01-15.md      # (should be in docs)
```

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
    └── requires: paper-trade-manager.js (calls createPaperTrade, updatePaperTrades)

earnings-scanner.js
    └── requires: paper-trade-manager.js (calls functions)
    └── can call: earnings-calendar-scraper.js (via /refresh-calendar)

opportunity-scanner.js
    └── requires: opportunity-db.js (SQLite historical data)
    └── discovery: Dynamic from 7 sources (core, watchlist, movers, extremes)

opportunity-db.js
    └── exports: getDb(), saveScanResults(), getRecentScans(), getTierStats(), getTopSymbols()
    └── uses: better-sqlite3 (npm package)

dynamic-scanner.js
    └── exports: runDynamicScan(), buildDynamicWatchlist(), analyzeSymbol(), ZONES
    └── imported by: bloodhound-scanner.js (optional module usage)

wingman-monitor.js
    └── checks: bloodhound-scanner.js (via GET /status on port 8081)

web-server.js
    └── serves: All HTML files from root
    └── writes: paper_trades.json (via POST /api/save-paper-trades)
```

---

## Summary Stats

| Category | Count |
|----------|-------|
| HTML Dashboards | 6 |
| Monitor Scripts | 11 |
| Data Files | 18+ |
| Control Ports | 3 (8081, 8082, 8083) |
| External API Ports | 2 (3000, 8000) |
| Static Server Port | 1 (8080) |
| Orphan Docs (root) | 5 |
| Temp Files (monitor) | 5 |
