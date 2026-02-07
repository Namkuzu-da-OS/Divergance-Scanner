# Wingman Visual Workflows

Quick visual reference for understanding the entire system.

---

## 1. System Overview

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                           WINGMAN TRADING SYSTEM                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║    ┌─────────────────────────────────────────────────────────────────────┐   ║
║    │                      EXTERNAL DATA SOURCES                          │   ║
║    │                                                                      │   ║
║    │   ┌──────────────────┐          ┌──────────────────┐                │   ║
║    │   │  OPTIONS API     │          │  INTEL API       │                │   ║
║    │   │  Port 8000       │          │  Port 3000       │                │   ║
║    │   │                  │          │                  │                │   ║
║    │   │  • Technicals    │          │  • Market Data   │                │   ║
║    │   │  • Gamma Levels  │          │  • VIX/ETF       │                │   ║
║    │   │  • Options Flow  │          │  • AI Outlook    │                │   ║
║    │   │  • IV/Greeks     │          │  • Trade Logging │                │   ║
║    │   └────────┬─────────┘          └────────┬─────────┘                │   ║
║    └────────────┼────────────────────────────┼──────────────────────────┘   ║
║                 │                            │                               ║
║                 └─────────────┬──────────────┘                               ║
║                               │                                              ║
║                               ▼                                              ║
║    ┌─────────────────────────────────────────────────────────────────────┐   ║
║    │                         SCANNERS (PM2)                              │   ║
║    │                                                                      │   ║
║    │   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │   ║
║    │   │  BLOODHOUND    │  │  OPPORTUNITY   │  │  EARNINGS      │        │   ║
║    │   │  Port 8081     │  │  Port 8083     │  │  Port 8082     │        │   ║
║    │   │                │  │                │  │                │        │   ║
║    │   │  Every 2 min   │  │  Every 5 min   │  │  Every 30 min  │        │   ║
║    │   │  Confluence    │  │  Unusual Opts  │  │  PREM Strategy │        │   ║
║    │   │  Zone Scoring  │  │  Vol/OI Ratio  │  │  Earnings Play │        │   ║
║    │   └───────┬────────┘  └───────┬────────┘  └───────┬────────┘        │   ║
║    │           │                   │                   │                 │   ║
║    │           │    ┌──────────────┴──────────────┐    │                 │   ║
║    │           │    │     WINGMAN MONITOR         │    │                 │   ║
║    │           │    │     (VIX Regime Alerts)     │    │                 │   ║
║    │           └───▶│     Checks Pause State      │◀───┘                 │   ║
║    │                └──────────────┬──────────────┘                      │   ║
║    └───────────────────────────────┼────────────────────────────────────┘   ║
║                                    │                                         ║
║                                    ▼                                         ║
║    ┌─────────────────────────────────────────────────────────────────────┐   ║
║    │                          OUTPUTS                                    │   ║
║    │                                                                      │   ║
║    │   ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │   ║
║    │   │  JSON Files  │  │   SQLite     │  │     Telegram           │    │   ║
║    │   │  data/*.json │  │   data/*.db  │  │     Alerts             │    │   ║
║    │   └──────┬───────┘  └──────┬───────┘  └────────────────────────┘    │   ║
║    └──────────┼─────────────────┼───────────────────────────────────────┘   ║
║               │                 │                                            ║
║               └────────┬────────┘                                            ║
║                        ▼                                                     ║
║    ┌─────────────────────────────────────────────────────────────────────┐   ║
║    │                      DASHBOARDS (Port 8080)                         │   ║
║    │                                                                      │   ║
║    │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   ║
║    │   │ Zone Scanner │  │ Opportunity  │  │  Earnings    │              │   ║
║    │   │ (Primary)    │  │  Scanner     │  │  Scanner     │              │   ║
║    │   └──────────────┘  └──────────────┘  └──────────────┘              │   ║
║    │                                                                      │   ║
║    │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   ║
║    │   │  Analytics   │  │   Scanner    │  │  Dashboard   │              │   ║
║    │   │ (Validation) │  │  (Legacy)    │  │ (Account)    │              │   ║
║    │   └──────────────┘  └──────────────┘  └──────────────┘              │   ║
║    └─────────────────────────────────────────────────────────────────────┘   ║
║                                                                               ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 2. Bloodhound Scanner Workflow

The core scanner that finds high-confluence trading opportunities.

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        BLOODHOUND SCAN CYCLE (2 min)                          ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 1: SYMBOL DISCOVERY                                                │ ║
║  │                                                                          │ ║
║  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │ ║
║  │   │ Watchlist   │    │ Intel API   │    │ Sector ETFs │                 │ ║
║  │   │ (Always)    │    │ (/latest)   │    │ (Rotation)  │                 │ ║
║  │   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                 │ ║
║  │          │                  │                  │                        │ ║
║  │          └─────────────────┬┴─────────────────┘                         │ ║
║  │                            │                                             │ ║
║  │                            ▼                                             │ ║
║  │                   ┌────────────────┐                                    │ ║
║  │                   │  20 Symbols    │                                    │ ║
║  │                   │  Per Scan      │                                    │ ║
║  │                   └────────┬───────┘                                    │ ║
║  └────────────────────────────┼────────────────────────────────────────────┘ ║
║                               │                                              ║
║                               ▼                                              ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 2: DATA COLLECTION (Per Symbol)                                    │ ║
║  │                                                                          │ ║
║  │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐       │ ║
║  │   │ /api/technicals │   │ /api/levels     │   │ /api/flow       │       │ ║
║  │   │                 │   │                 │   │                 │       │ ║
║  │   │ • RSI          │   │ • Call Wall     │   │ • Flow Delta    │       │ ║
║  │   │ • Trend        │   │ • Put Wall      │   │ • Volume        │       │ ║
║  │   │ • Bollinger    │   │ • Max Pain      │   │ • Unusual       │       │ ║
║  │   │ • Momentum     │   │ • VWAP          │   │                 │       │ ║
║  │   └────────┬────────┘   └────────┬────────┘   └────────┬────────┘       │ ║
║  │            │                     │                     │                │ ║
║  │            └─────────────────────┼─────────────────────┘                │ ║
║  │                                  │                                       │ ║
║  └──────────────────────────────────┼──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 3: CONFLUENCE SCORING (0-80 points)                                │ ║
║  │                                                                          │ ║
║  │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║  │   │                                                                  │   │ ║
║  │   │   TECHNICAL (25 pts)    │    LEVELS (25 pts)                    │   │ ║
║  │   │   ─────────────────     │    ──────────────                     │   │ ║
║  │   │   RSI < 30      +10     │    At Put Wall    +15                 │   │ ║
║  │   │   RSI > 70      +10     │    At Call Wall   +15                 │   │ ║
║  │   │   BB Low        +8      │    Near VWAP      +5                  │   │ ║
║  │   │   BB High       +8      │    Breakout Setup +10                 │   │ ║
║  │   │   Strong Trend  +7      │                                       │   │ ║
║  │   │                         │                                       │   │ ║
║  │   │   VOLUME (15 pts)       │    CONTEXT (15 pts)                   │   │ ║
║  │   │   ──────────────        │    ───────────────                    │   │ ║
║  │   │   2x Spike      +15     │    SPY Aligned    +10                 │   │ ║
║  │   │   1.5x Elevated +8      │    Low VIX        +5                  │   │ ║
║  │   │                         │                                       │   │ ║
║  │   └─────────────────────────────────────────────────────────────────┘   │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 4: ZONE CLASSIFICATION                                             │ ║
║  │                                                                          │ ║
║  │   Price Position                Zone                  Action            │ ║
║  │   ──────────────                ────                  ──────            │ ║
║  │   < 0.5% to Put Wall     ───►   BUY_ZONE        ───►  Look to Buy      │ ║
║  │   < 0.5% to Call Wall    ───►   SELL_ZONE       ───►  Look to Sell     │ ║
║  │   Between walls < 3%     ───►   PINNED          ───►  Range Trade      │ ║
║  │   > 2% from both walls   ───►   MID_RANGE       ───►  Wait             │ ║
║  │   Below Put Wall         ───►   EXTENDED_LOW    ───►  Bounce Watch     │ ║
║  │   Above Call Wall        ───►   EXTENDED_HIGH   ───►  Short Watch      │ ║
║  │                                                                          │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 5: TIER ASSIGNMENT                                                 │ ║
║  │                                                                          │ ║
║  │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║  │   │                                                                    │ │ ║
║  │   │  Score ≥ 64 + Near Wall (1.5%)  ──────►  HIGH_CONVICTION  🟢      │ │ ║
║  │   │  Score ≥ 56 + At Wall (0.5%)    ──────►  HIGH_CONVICTION  🟢      │ │ ║
║  │   │  Score ≥ 48 + At Wall + Aligned ──────►  TRADEABLE        🟠      │ │ ║
║  │   │  Score ≥ 40 + Near Wall         ──────►  WATCH            ⚪      │ │ ║
║  │   │  Everything else                ──────►  FILTERED         ❌      │ │ ║
║  │   │                                                                    │ │ ║
║  │   └───────────────────────────────────────────────────────────────────┘ │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 6: OUTPUT                                                          │ ║
║  │                                                                          │ ║
║  │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │ ║
║  │   │ SQLite DB        │  │ Signal Tracking  │  │ Telegram Alert   │      │ ║
║  │   │ /api/scan/latest │  │ (Validation)     │  │ (HIGH_CONVICTION)│      │ ║
║  │   └──────────────────┘  └──────────────────┘  └──────────────────┘      │ ║
║  └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 3. Opportunity Scanner Workflow

Finds unusual options activity and smart money positioning.

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                      OPPORTUNITY SCANNER CYCLE (5 min)                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 1: DYNAMIC DISCOVERY (7 Sources)                                   │ ║
║  │                                                                          │ ║
║  │                        ┌───────────────────┐                            │ ║
║  │   ┌────────────────┐   │   DISCOVERED      │   ┌────────────────┐       │ ║
║  │   │ Core (3)       │──▶│   SYMBOLS         │◀──│ Watchlist (8)  │       │ ║
║  │   │ SPY,QQQ,IWM    │   │                   │   │ User Picks     │       │ ║
║  │   └────────────────┘   │   ┌───────────┐   │   └────────────────┘       │ ║
║  │                        │   │  ~20-30   │   │                            │ ║
║  │   ┌────────────────┐   │   │  Symbols  │   │   ┌────────────────┐       │ ║
║  │   │ Volume Leaders │──▶│   │  Scored   │◀──│   │ Gainers        │       │ ║
║  │   │ $SPX Movers    │   │   │  & Ranked │   │   │ +2% Today      │       │ ║
║  │   └────────────────┘   │   └───────────┘   │   └────────────────┘       │ ║
║  │                        │                   │                            │ ║
║  │   ┌────────────────┐   │                   │   ┌────────────────┐       │ ║
║  │   │ NASDAQ Movers  │──▶│                   │◀──│ Losers         │       │ ║
║  │   │ $COMPX Volume  │   │                   │   │ -2% Today      │       │ ║
║  │   └────────────────┘   │                   │   └────────────────┘       │ ║
║  │                        │                   │                            │ ║
║  │   ┌────────────────┐   │                   │                            │ ║
║  │   │ 52-Wk Extremes │──▶│                   │                            │ ║
║  │   │ Breakouts      │   └───────────────────┘                            │ ║
║  │   └────────────────┘                                                    │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 2: OPTIONS ANALYSIS                                                │ ║
║  │                                                                          │ ║
║  │   For Each Symbol:                                                      │ ║
║  │                                                                          │ ║
║  │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║  │   │                                                                  │   │ ║
║  │   │   VOL/OI RATIO              FLOW ANALYSIS                       │   │ ║
║  │   │   ────────────              ─────────────                       │   │ ║
║  │   │                                                                  │   │ ║
║  │   │   Vol/OI > 3.0  ──►  🔥 Extreme Activity                        │   │ ║
║  │   │   Vol/OI > 2.0  ──►  📈 High Activity                           │   │ ║
║  │   │   Vol/OI > 1.5  ──►  📊 Elevated Activity                       │   │ ║
║  │   │                                                                  │   │ ║
║  │   │   Call Heavy    ──►  Bullish Smart Money                        │   │ ║
║  │   │   Put Heavy     ──►  Bearish Smart Money                        │   │ ║
║  │   │   Balanced      ──►  Hedging/Neutral                            │   │ ║
║  │   │                                                                  │   │ ║
║  │   └─────────────────────────────────────────────────────────────────┘   │ ║
║  │                                                                          │ ║
║  │   ┌─────────────────────────────────────────────────────────────────┐   │ ║
║  │   │                                                                  │   │ ║
║  │   │   GAPS & VOLUME             IV ANALYSIS                         │   │ ║
║  │   │   ────────────              ───────────                         │   │ ║
║  │   │                                                                  │   │ ║
║  │   │   Gap > 3%      ──►  Momentum Move                              │   │ ║
║  │   │   Volume 2x+    ──►  Institutional Interest                     │   │ ║
║  │   │   IV Rank > 80  ──►  High Premium (Sell Opportunity)            │   │ ║
║  │   │   IV Rank < 20  ──►  Low Premium (Buy Opportunity)              │   │ ║
║  │   │                                                                  │   │ ║
║  │   └─────────────────────────────────────────────────────────────────┘   │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 3: SCORING & TIER ASSIGNMENT                                       │ ║
║  │                                                                          │ ║
║  │   Score 70+  ──────►  HIGH_CONVICTION  🟢  (Auto Paper Trade)           │ ║
║  │   Score 50-69 ─────►  TRADEABLE        🟠  (Auto Paper Trade)           │ ║
║  │   Score 30-49 ─────►  WATCH            ⚪  (Monitor Only)               │ ║
║  │   Score < 30  ─────►  FILTERED         ❌  (Excluded)                   │ ║
║  │                                                                          │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 4: OUTPUT                                                          │ ║
║  │                                                                          │ ║
║  │   ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │ ║
║  │   │ SQLite DB          │  │ SQLite DB          │  │ Telegram Alert   │  │ ║
║  │   │ /api/opportunities │  │ (Historical)       │  │ (HIGH_CONVICTION)│  │ ║
║  │   │ /latest            │  │                    │  │                  │  │ ║
║  │   │ Overwrites each    │  │ Historical data    │  │ With 30min       │  │ ║
║  │   │ scan cycle         │  │ for analysis       │  │ cooldown         │  │ ║
║  │   └────────────────────┘  └────────────────────┘  └──────────────────┘  │ ║
║  └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 4. Earnings Scanner Workflow

Finds pre-earnings momentum (PREM) candidates.

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                       EARNINGS SCANNER CYCLE (30 min)                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 1: LOAD EARNINGS CALENDAR                                          │ ║
║  │                                                                          │ ║
║  │   earnings-calendar.json                                                │ ║
║  │   ┌──────────────────────────────────────────────────────────────────┐  │ ║
║  │   │  Symbol: AAPL                                                     │  │ ║
║  │   │  Report Date: 2026-01-23                                          │  │ ║
║  │   │  Days Until: 7                                                    │  │ ║
║  │   │  Time: After Market Close (AMC)                                   │  │ ║
║  │   └──────────────────────────────────────────────────────────────────┘  │ ║
║  │                                                                          │ ║
║  │   Filter: 5-10 days until earnings (PREM window)                        │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 2: PREM ANALYSIS                                                   │ ║
║  │                                                                          │ ║
║  │   Pre-Earnings Run-Up Momentum (PREM) Strategy:                         │ ║
║  │                                                                          │ ║
║  │   ┌───────────────────────────────────────────────────────────────────┐ │ ║
║  │   │                                                                    │ │ ║
║  │   │   CHECK                          PASS CRITERIA                    │ │ ║
║  │   │   ─────                          ─────────────                    │ │ ║
║  │   │   Price Trend            ───►    Above 20-day SMA                 │ │ ║
║  │   │   Volume                 ───►    Above average                    │ │ ║
║  │   │   RSI                    ───►    40-70 range (not overbought)     │ │ ║
║  │   │   Historical Pattern    ───►    Tends to run up pre-earnings     │ │ ║
║  │   │                                                                    │ │ ║
║  │   └───────────────────────────────────────────────────────────────────┘ │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 3: POSITION TRACKING                                               │ ║
║  │                                                                          │ ║
║  │   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐ │ ║
║  │   │   ENTER         │      │   MONITOR       │      │   EXIT          │ │ ║
║  │   │   5-10 days out │ ───► │   Daily P&L     │ ───► │   Day before    │ │ ║
║  │   │                 │      │   Track Runup   │      │   earnings      │ │ ║
║  │   └─────────────────┘      └─────────────────┘      └─────────────────┘ │ ║
║  │                                                                          │ ║
║  │   Rule: Exit BEFORE earnings announcement (avoid binary event)          │ ║
║  └──────────────────────────────────┬──────────────────────────────────────┘ ║
║                                     │                                        ║
║                                     ▼                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
║  │ STEP 4: OUTPUT                                                          │ ║
║  │                                                                          │ ║
║  │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │ ║
║  │   │ SQLite DB        │  │ earnings-paper-  │  │ Telegram Alert   │      │ ║
║  │   │ earnings_scans/  │  │ trades.json      │  │                  │      │ ║
║  │   │ earnings_results │  │ (Tracking)       │  │ (Score ≥ 70)     │      │ ║
║  │   └──────────────────┘  └──────────────────┘  └──────────────────┘      │ ║
║  └─────────────────────────────────────────────────────────────────────────┘ ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 5. Data Flow Diagram

How data moves through the system.

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              DATA FLOW                                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   EXTERNAL APIS                     SCANNERS                    STORAGE       ║
║   ────────────                      ────────                    ───────       ║
║                                                                               ║
║   ┌─────────────┐                 ┌────────────┐              ┌────────────┐ ║
║   │ Options API │ ──────────────► │ Bloodhound │ ───────────► │SQLite DB   │ ║
║   │ Port 8000   │    Technicals   │            │              │            │ ║
║   │             │    Levels       │            │              │wingman.db  │ ║
║   │             │    Flow         │            │              │(scans,     │ ║
║   └─────────────┘                 └─────┬──────┘              │ signals)   │ ║
║                                         │                      │            │ ║
║                                         │                      └─────┬──────┘ ║
║   ┌─────────────┐                       │                            │       ║
║   │ Intel API   │ ──────────────────────┘                            │       ║
║   │ Port 3000   │    Latest Data                                     │       ║
║   │             │    Market Outlook                                  │       ║
║   └──────┬──────┘                                                    │       ║
║          │                                                           │       ║
║          │                        ┌────────────┐              ┌──────▼──────┐║
║          └──────────────────────► │Opportunity │ ───────────► │SQLite DB    │║
║                                   │            │              │             │║
║                                   │            │              │wingman.db   │║
║                                   │            │              │(opportun.)  │║
║                                   └────────────┘              └──────┬──────┘║
║                                                                      │       ║
║                                   ┌────────────┐                     │       ║
║                                   │ Earnings   │ ───────────► ┌──────▼──────┐║
║                                   │            │              │ Dashboards  │║
║                                   └────────────┘              │ Port 8080   │║
║                                                               │             │║
║                                                               │ zone-scanner│║
║                                   (VIX alerts now in           │ opportunity │║
║                                    Bloodhound - no separate    │ earnings    │║
║                                    monitor needed)             │ analytics   │║
║                                                                └─────────────┘║
║                                                                               ║
║                                                               ┌─────────────┐║
║                                   ALL SCANNERS ─────────────► │  Telegram   │║
║                                                  HIGH_CONVIC  │  Alerts     │║
║                                                               └─────────────┘║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 6. Dashboard Relationships

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         DASHBOARD ARCHITECTURE                                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║                           http://localhost:8080                               ║
║                                    │                                          ║
║          ┌─────────────────────────┼─────────────────────────┐               ║
║          │                         │                         │               ║
║          ▼                         ▼                         ▼               ║
║   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         ║
║   │ ZONE SCANNER    │    │ OPPORTUNITY     │    │ EARNINGS        │         ║
║   │ (Primary)       │    │ SCANNER         │    │ SCANNER         │         ║
║   │                 │    │                 │    │                 │         ║
║   │ /zone-scanner   │    │ /opportunity-   │    │ /earnings-      │         ║
║   │     .html       │    │     scanner.html│    │     scanner.html│         ║
║   │                 │    │                 │    │                 │         ║
║   │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │         ║
║   │ │Data Source: │ │    │ │Data Source: │ │    │ │Data Source: │ │         ║
║   │ │/api/scan/   │ │    │ │/api/opportu-│ │    │ │API :8082    │ │         ║
║   │ │latest       │ │    │ │nities/latest│ │    │ │/results     │ │         ║
║   │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │         ║
║   │                 │    │                 │    │                 │         ║
║   │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │         ║
║   │ │Control:     │ │    │ │Control:     │ │    │ │Control:     │ │         ║
║   │ │Port 8081    │ │    │ │Port 8083    │ │    │ │Port 8082    │ │         ║
║   │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │         ║
║   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         ║
║            │                      │                      │                   ║
║            │                      │                      │                   ║
║            ▼                      ▼                      ▼                   ║
║   ┌─────────────────────────────────────────────────────────────────┐       ║
║   │                     CONTROL ACTIONS                              │       ║
║   │                                                                  │       ║
║   │   All Dashboards Can:                                           │       ║
║   │   • Pause/Resume scanner                                        │       ║
║   │   • Trigger immediate scan                                      │       ║
║   │   • Clear alert cooldowns                                       │       ║
║   │   • Send test alerts                                            │       ║
║   │                                                                  │       ║
║   │   Zone Scanner Also:                                            │       ║
║   │   • Add/Remove watchlist symbols                                │       ║
║   │                                                                  │       ║
║   │   Earnings Scanner Also:                                        │       ║
║   │   • Refresh earnings calendar                                   │       ║
║   │   • Add/Close positions                                         │       ║
║   └─────────────────────────────────────────────────────────────────┘       ║
║                                                                               ║
║          ┌─────────────────┐    ┌─────────────────┐                          ║
║          │ ANALYTICS       │    │ SCANNER         │                          ║
║          │ (Validation)    │    │ (Legacy)        │                          ║
║          │                 │    │                 │                          ║
║          │ /analytics.html │    │ /scanner.html   │                          ║
║          │                 │    │                 │                          ║
║          │ ┌─────────────┐ │    │ ┌─────────────┐ │                          ║
║          │ │Data Source: │ │    │ │Data Source: │ │                          ║
║          │ │SQLite DB    │ │    │ │/api/scan/   │ │                          ║
║          │ │signals table│ │    │ │summary      │ │                          ║
║          │ └─────────────┘ │    │ └─────────────┘ │                          ║
║          └─────────────────┘    └─────────────────┘                          ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 7. Port Map Quick Reference

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              PORT MAP                                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   EXTERNAL SERVICES                                                          ║
║   ─────────────────                                                          ║
║   ┌──────────────────────────────────────────────────────────────────────┐   ║
║   │  Port 3000  │  Intel API       │  Market data, VIX, trade logging    │   ║
║   │  Port 8000  │  Options API     │  Technicals, levels, flow, calendar │   ║
║   └──────────────────────────────────────────────────────────────────────┘   ║
║                                                                               ║
║   LOCAL SERVICES                                                             ║
║   ──────────────                                                             ║
║   ┌──────────────────────────────────────────────────────────────────────┐   ║
║   │  Port 8080  │  Web Server      │  Serves all HTML dashboards         │   ║
║   │  Port 8081  │  Bloodhound      │  Confluence scanner control         │   ║
║   │  Port 8082  │  Earnings        │  Earnings scanner control           │   ║
║   │  Port 8083  │  Opportunity     │  Unusual options scanner control    │   ║
║   └──────────────────────────────────────────────────────────────────────┘   ║
║                                                                               ║
║   Quick Access:                                                              ║
║   ─────────────                                                              ║
║   Zone Scanner      →  http://localhost:8080/zone-scanner.html              ║
║   Opportunity       →  http://localhost:8080/opportunity-scanner.html       ║
║   Earnings          →  http://localhost:8080/earnings-scanner.html          ║
║   Analytics         →  http://localhost:8080/analytics.html                 ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 8. File Map Quick Reference

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              FILE MAP                                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   SCANNERS (monitor/)                                                        ║
║   ───────────────────                                                        ║
║   bloodhound-scanner.js     │  Main confluence scanner (2 min cycle)        ║
║   opportunity-scanner.js    │  Unusual options scanner (5 min cycle)        ║
║   earnings-scanner.js       │  PREM earnings scanner (30 min cycle)         ║
║   wingman-monitor.js        │  DEPRECATED - VIX alerts now in bloodhound    ║
║   web-server.js             │  Dashboard server (port 8080)                 ║
║   opportunity-db.js         │  SQLite database module                       ║
║   paper-trade-manager.js    │  Paper trade tracking                         ║
║                                                                               ║
║   DATA FILES (data/)                                                         ║
║   ──────────────────                                                         ║
║   wingman.db                │  SQLite DB: scans, signals, opportunities     ║
║   (dynamic_scan.json)       │  DEPRECATED - use /api/scan/latest            ║
║   (opportunities.json)      │  DEPRECATED - use /api/opportunities/latest   ║
║   paper_trades.json         │  Paper trade validation (460+ trades)         ║
║   watchlist.json            │  User watchlist symbols                       ║
║   (alerts_log.json)         │  DEPRECATED - use SQLite signals table        ║
║                                                                               ║
║   DASHBOARDS (root)                                                          ║
║   ─────────────────                                                          ║
║   zone-scanner.html         │  PRIMARY - Bloodhound results                 ║
║   opportunity-scanner.html  │  Unusual options activity                     ║
║   earnings-scanner.html     │  PREM candidates                              ║
║   analytics.html            │  Signal validation analysis                   ║
║                                                                               ║
║   DOCS (docs/)                                                               ║
║   ────────────                                                               ║
║   VISION.md                 │  Project philosophy                           ║
║   RULES.md                  │  Trading rules                                ║
║   STRATEGIES.md             │  Trading strategies                           ║
║   SYSTEM_ARCHITECTURE.md    │  Technical architecture                       ║
║   VISUAL_WORKFLOWS.md       │  This file - visual diagrams                  ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 9. PM2 Process Quick Reference

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           PM2 PROCESSES                                       ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   START ALL (ONE COMMAND):                                                   ║
║   ────────────────────────                                                   ║
║   pm2 start ecosystem.config.js                                             ║
║                                                                               ║
║   This starts: bloodhound, opportunity, earnings, webserver                 ║
║                                                                               ║
║   COMMON COMMANDS:                                                           ║
║   ────────────────                                                           ║
║   pm2 list                    │  Show all processes                         ║
║   pm2 logs                    │  View all logs                              ║
║   pm2 logs [name]             │  View specific logs                         ║
║   pm2 restart all             │  Restart everything                         ║
║   pm2 restart [name]          │  Restart specific process                   ║
║   pm2 stop all                │  Stop everything                            ║
║   pm2 delete all              │  Remove all from PM2                        ║
║                                                                               ║
║   EXPECTED OUTPUT:                                                           ║
║   ────────────────                                                           ║
║   ┌────┬────────────┬────────┬──────────┐                                   ║
║   │ id │ name       │ status │ uptime   │                                   ║
║   ├────┼────────────┼────────┼──────────┤                                   ║
║   │ 0  │ bloodhound │ online │ 7h       │                                   ║
║   │ 1  │ webserver  │ online │ 7h       │                                   ║
║   │ 2  │ opportunity│ online │ 2h       │                                   ║
║   │ 3  │ earnings   │ online │ 5h       │                                   ║
║   └────┴────────────┴────────┴──────────┘                                   ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## 10. Tier Color Legend

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                          TIER COLOR LEGEND                                    ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   🟢 GREEN  │  HIGH_CONVICTION  │  Score ≥ 70  │  Strong setup, act now      ║
║   🟠 ORANGE │  TRADEABLE        │  Score 50-69 │  Good setup, watch entry    ║
║   ⚪ GREY   │  WATCH            │  Score 30-49 │  Potential, needs more      ║
║   ❌ HIDDEN │  FILTERED         │  Score < 30  │  Not shown on dashboard     ║
║                                                                               ║
║   Bloodhound-specific zones:                                                 ║
║   ──────────────────────────                                                 ║
║   BUY_ZONE       │  Near put wall support                                   ║
║   SELL_ZONE      │  Near call wall resistance                               ║
║   PINNED         │  Trapped between walls                                   ║
║   EXTENDED_LOW   │  Below put wall (bounce watch)                           ║
║   EXTENDED_HIGH  │  Above call wall (short watch)                           ║
║   MID_RANGE      │  No clear edge                                           ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```
