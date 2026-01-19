# CLAUDE.md

Wingman Trading System - AI Instructions

---

## Project Vision

**READ FIRST:** [docs/VISION.md](docs/VISION.md) - The Bloodhound Scanner

> Wingman is an autonomous opportunity detection system. It finds confluence across
> multiple data sources (levels, flow, technicals) and alerts the trader.
> The trader makes all final decisions. Wingman finds where to look.
>
> **Key Principles:**
> - Dynamic symbol discovery, not static watchlists
> - Confluence is everything - multiple factors must align
> - Market context matters - SPY/QQQ direction affects everything
> - Find, don't trade - system alerts, human decides

---

## Quick Start

**Full Wingman Mode:** User says "I know Kung Fu" or `/kungfu`

**Orientation Path:**
```
docs/RULES.md → data/ACTIVE_SESSION.md → data/positions.json
```

---

## MANDATORY: Scanner Review Process (NEVER SKIP)

When reviewing Bloodhound scanner data OR the Zone Scanner dashboard, follow this process EXACTLY:

### Step 1: USE SUBAGENT FOR SCANNER DATA (Context Efficiency)

**DO NOT read dynamic_scan.json directly** - it's 1200+ lines and burns context.

Instead, spawn an Explore agent:
```
Task tool with subagent_type=Explore:
"Read data/dynamic_scan.json and return a compact summary:
1. Total ticker count
2. ALL symbols listed (e.g., SPY, QQQ, NVDA...)
3. Tradeable setups with zone and action
4. Market context (VIX, SPY trend)
Format as a table. Miss no tickers."
```

The agent reads the big file in its own context and returns only the summary.

### Step 2: VERIFY THE COUNT
- Agent should report exact ticker count (usually 20)
- List every symbol by name
- Ask user: "I see X tickers. Did I miss any?"

### Step 3: PRESENT ALL TICKERS IN A TABLE
Show EVERY ticker from the agent's summary:

| Symbol | Zone | Score | Price | RSI | Trend | Action |
|--------|------|-------|-------|-----|-------|--------|
| SPY | PINNED | 100 | 689.51 | 61 | bullish | - |
| QQQ | BUY_ZONE | 100 | 620.64 | 61 | bullish | BUY |
... (ALL tickers, no exceptions)

### Step 4: ONLY THEN ANALYZE/FILTER
- After showing all, highlight specific setups
- After showing all, group by zone or priority
- NEVER skip the "show all" step

### FAILURES TO AVOID
- DO NOT read dynamic_scan.json directly (use subagent)
- DO NOT skip low-score tickers
- DO NOT assume "they probably don't care about that one"
- If user shows a screenshot, enumerate FROM THE SCREENSHOT first
- DO NOT make excuses if you miss tickers - acknowledge and fix immediately

**This is CRITICAL. Missing tickers defeats the entire purpose of the scanner.**

### Validation Tool

After ANY scanner review, the user can verify my work:

```bash
# Show what's actually in the scan
node monitor/scanner-validator.js

# Validate my claimed tickers against reality
node monitor/scanner-validator.js SPY QQQ NVDA TSLA GOOGL ...
```

If the validator shows ❌ FAIL, I missed tickers and must correct immediately.

---

## Context Efficiency Guidelines

**Principle:** Keep main conversation context lean. Offload heavy reads to subagents.

### When to Use Subagents

| Task | Use Subagent? | Why |
|------|---------------|-----|
| Scanner review | YES | dynamic_scan.json is 1200+ lines |
| Signal tracking check | YES | Read file + call APIs + compare |
| Deep ticker analysis | YES | Multiple API calls, lots of data |
| Quick price check | NO | Single API call, small response |
| File edits | NO | Need direct access |

### Subagent Patterns

**Scanner Summary:**
```
subagent_type=Explore
"Read data/dynamic_scan.json. Return: ticker count, all symbols,
tradeable setups table, market context. Be complete, be compact."
```

**Signal Tracking Check:**
```
subagent_type=general-purpose
"Read data/signal_tracking.json for entry prices.
Call /api/technicals/{symbol} for current prices.
Compare and return: Symbol | Entry | Current | Change% | Grade | Outcome"
```

### Key Research Findings (Jan 2026)

Per [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):
- Subagents use **isolated context windows**
- Only send **relevant summaries** back to parent
- "Do the simplest thing that works"

Per [JetBrains research](https://blog.jetbrains.com/research/2025/12/efficient-context-management/):
- Observation masking beats summarization (52% cost reduction)
- Don't over-engineer - simple delegation works

---

## MANDATORY: Data Sources First

**BEFORE using web search for any ticker analysis, ALWAYS pull from our APIs first.**

### Discovery Endpoints (CHECK THESE IF UNSURE)

| Server | Endpoint | Purpose |
|--------|----------|---------|
| Options (8000) | `GET /api/capabilities` | Full AI-friendly docs, all endpoints, workflows, concepts |
| Options (8000) | `GET /api/capabilities/summary` | Quick reference |
| Options (8000) | `GET /openapi.json` | OpenAPI spec |
| Intel (3000) | `GET /api/status` | Health check, DB stats |
| Intel (3000) | `GET /api-docs` | Swagger UI (browser) |

### Primary Analysis Endpoints

```
1. Quote + Technicals:  GET http://192.168.10.239:8000/api/technicals/{SYMBOL}
2. Trading Signals:     GET http://192.168.10.239:8000/api/technicals/{SYMBOL}/signals
3. Gamma Levels:        GET http://192.168.10.239:8000/api/levels/{SYMBOL}
4. Options Flow:        GET http://192.168.10.239:8000/api/flow/{SYMBOL}
5. Market Context:      GET http://192.168.10.239:8000/api/market/context
6. AI Outlook:          GET http://192.168.10.239:3000/api/market/outlook
```

**Web search is SUPPLEMENTAL, not primary.**

---

## System Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  Wingman CLI    │     │  Market Intelligence Server (3000)   │
│  (Claude Code)  │◄───►│  - VIX, ETF data                     │
└────────┬────────┘     │  - Trade Logging API (/api/trades)   │
         │              │  - AI outlook, signals               │
         │              └──────────────────────────────────────┘
         │              ┌──────────────────────────────────────┐
         │              │  Options Analytics Server (8000)     │
         └─────────────►│  - GEX, gamma walls, max pain        │
                        │  - Position sizing, expected move    │
                        └──────────────────────────────────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────────────────────────┐
│  Monitor        │────►│  Telegram Alerts                     │
│  (Background)   │     │  - VIX regime changes                │
└────────┬────────┘     │  - Wall proximity / pinned           │
         │              │  - High conviction signals           │
         ▼              └──────────────────────────────────────┘
┌─────────────────┐
│  scanner.json   │────► Scanner Dashboard (scanner.html)
└─────────────────┘
```

### Port Map (HARDCODED - DO NOT CHANGE)

| Port | Service | File | Purpose |
|------|---------|------|---------|
| 3000 | Intel API | External | Market intelligence, trade logging |
| 8000 | Options API | External | Options analytics, technicals, gamma levels |
| 8080 | Web Server | `monitor/web-server.js` | Serves HTML dashboards |
| 8081 | Bloodhound | `monitor/bloodhound-scanner.js` | Bloodhound control API |
| 8082 | Earnings | `monitor/earnings-scanner.js` | Earnings scanner control API |

**Dashboard URLs:**
- Zone Scanner: `http://localhost:8080/zone-scanner.html`
- Earnings Scanner: `http://localhost:8080/earnings-scanner.html`
- Analytics: `http://localhost:8080/analytics.html`

---

## File Structure

### Data Files
| File | Purpose | Update Trigger |
|------|---------|----------------|
| `data/bloodhound.json` | **Bloodhound scan results** | Every 2 min scan |
| `data/watchlist.json` | Symbols to always scan | Manual edit or web UI |
| `data/dynamic_scan.json` | Full technical data for dashboard | Every scan |
| `data/positions.json` | Open trades | Position change |
| `data/trades_journal.json` | Trade history | Trade closes |
| `data/account_summary.json` | P&L metrics | EOD |
| `data/scanner.json` | Live market data | Every 2 min (bloodhound) |
| `data/alerts_log.json` | Alert history | On alert |
| `data/ACTIVE_SESSION.md` | Session state | Hourly |
| `data/daily_log.md` | Today's journal | Throughout day |

### Monitor System
| File | Purpose |
|------|---------|
| `monitor/bloodhound-scanner.js` | **Confluence scanner** - Dynamic symbol discovery + scoring |
| `monitor/wingman-monitor.js` | Background alert service |
| `monitor/trade-client.js` | Trade logging API client |
| `scanner.html` | Visual market dashboard |

### Documentation
| File | Purpose |
|------|---------|
| `docs/RULES.md` | All trading rules |
| `docs/STRATEGIES.md` | All strategies |
| `docs/SCANNER_HISTORY.md` | Scanner history & Day 2 detection system |

### Commands
| Command | Purpose |
|---------|---------|
| `/kungfu` | Load full Wingman context |
| `/data` | Pull market intelligence |
| `-note` | Quick journal entry |

---

## Starting All Scanners

**One command to start everything:**

```bash
pm2 start ecosystem.config.js
```

This starts all 4 services: bloodhound, opportunity, earnings, webserver.

**Common PM2 commands:**
```bash
pm2 list                     # Show all processes
pm2 logs                     # View all logs
pm2 logs bloodhound          # View specific logs
pm2 restart all              # Restart everything
pm2 stop all                 # Stop everything
```

---

## Bloodhound Scanner

**The core autonomous opportunity detection system.** This is the primary scanner that implements the project vision - finding high-confluence trading opportunities across multiple data sources.

### Running Bloodhound

Bloodhound runs persistently via PM2 (started automatically via ecosystem.config.js):
```bash
pm2 logs bloodhound          # View logs
pm2 restart bloodhound       # Restart after changes
```

### Web Control Interface

Dashboard: `http://localhost:8080` (zone-scanner.html)
Control API: `http://localhost:8081`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Scanner status, uptime, next scan countdown |
| `/pause` | POST | Pause scanner |
| `/resume` | POST | Resume scanner |
| `/scan` | POST | Trigger immediate scan |
| `/clear-cooldowns` | POST | Clear 30-min alert cooldowns |
| `/test-alert` | POST | Send test message to Telegram |
| `/watchlist` | GET | Get current watchlist |
| `/watchlist/add` | POST | Add symbol `{"symbol":"AAPL"}` |
| `/watchlist/remove` | POST | Remove symbol `{"symbol":"AAPL"}` |

### 3 Discovery Sources

Bloodhound dynamically discovers symbols from:

1. **Watchlist** (`data/watchlist.json`) - Always scanned, highest priority
2. **Market Data** (`/api/latest`) - 52-week extremes, volume spikes
3. **Sector Rotation** - Strongest/weakest sector ETFs

Note: Social sentiment sources (X/Twitter trending, author consensus) were removed as unreliable.

### Symbol Mapping

Non-tradeable symbols are mapped to liquid ETF equivalents:

| Source | Maps To | Description |
|--------|---------|-------------|
| BTC | IBIT | BlackRock Bitcoin ETF |
| ETH | ETHA | BlackRock Ethereum ETF |
| SOL | SOLQ | Solana ETF |
| TAO | GTAO | Grayscale TAO |
| SPX | SPY | S&P 500 Index → ETF |
| NDX | QQQ | Nasdaq 100 → ETF |
| DJI | DIA | Dow Jones → ETF |
| CL | USO | Crude Oil futures → ETF |
| GC | GLD | Gold futures → ETF |

### Confluence Scoring (0-80)

Each symbol is scored across multiple factors:

| Category | Max Points | Signals |
|----------|------------|---------|
| Technical | 25 | RSI oversold/overbought, Bollinger Band position, trend |
| Levels | 25 | At gamma walls, VWAP, confluence zones, breakout/breakdown |
| Volume | 15 | Volume spike (2x+), elevated volume (1.5x+) |
| Context | 15 | Aligned with SPY trend, market regime |

**Alert threshold: 48/80** (configurable in SETTINGS)

Note: Sentiment scoring was removed (unreliable). Max score reduced from 100 to 80.

### Alert Types

- 🟢 **Bullish** - At support, oversold, aligned with market
- 🔴 **Bearish** - At resistance, overbought, or breakdown
- 📍 **Pinned** - Trapped between gamma walls
- 🚀 **Breakout** - Above call wall resistance
- 💥 **Breakdown** - Below put wall support

### Tradeable Tiers (Score-Aware)

The tradeable decision uses both wall proximity AND confluence score:

| Tier | Criteria | Paper Trade? |
|------|----------|--------------|
| **HIGH_CONVICTION** | Score >= 56 + at wall (0.5%), OR Score >= 64 + near wall (1.5%) | Yes |
| **TRADEABLE** | Score >= 48 + at wall (0.5%) + trend-aligned | Yes |
| **WATCH** | Score >= 40 + near wall (2%), OR EXTENDED_LOW + RSI < 35, OR Score >= 56 mid-range | No (alert only) |
| **FILTERED** | Everything else | No |

**Key Rules:**
1. **Score gates tradeability** - Low-score symbols at walls are NOT tradeable
2. **High scores loosen threshold** - Score 64+ can be 1.5% from wall instead of 0.5%
3. **Trend alignment matters** - Counter-trend trades downgraded to WATCH
4. **EXTENDED_LOW reversals** - Below put wall with RSI < 35 = potential bounce watch

**Wall Threshold by Score:**
| Score | Wall Threshold |
|-------|---------------|
| 64+ | 1.5% (looser - high conviction) |
| 56-63 | 1.0% (moderate) |
| 48-55 | 0.5% (strict - lower conviction) |
| < 48 | Not tradeable at any distance |

**Trend Alignment:**
- BUY action + bullish/neutral trend = aligned
- BUY action + bearish trend = counter-trend → WATCH tier
- SELL action + bearish/neutral trend = aligned
- SELL action + bullish trend = counter-trend → WATCH tier

### Output Files

| File | Content |
|------|---------|
| `data/bloodhound.json` | Latest scan results with all opportunities |
| `data/dynamic_scan.json` | Full technical data for dashboard |
| `data/watchlist.json` | Symbols to always scan |
| `data/paper_trades.json` | Paper trade tracking for signal validation |

### Paper Trade System

Bloodhound automatically creates paper trades for signals to validate their effectiveness.

**Which signals get paper trades:**
- HIGH_CONVICTION tier - Yes
- TRADEABLE tier - Yes
- WATCH tier - Yes (for validation comparison)
- FILTERED tier - No

**Data captured at entry:**
| Field | Description |
|-------|-------------|
| `score` | Confluence score (0-100) |
| `zone` | BUY_ZONE, SELL_ZONE, PINNED, etc. |
| `signals` | Array of contributing signals |
| `vix` | VIX level at entry |
| `vix_regime` | low/normal/elevated/high |
| `spy_trend` | bullish/bearish/neutral |
| `intraday_bias` | Market intraday direction |
| `swing_bias` | Market swing direction |

**Price tracking:**
- Updates every scan cycle (2 min)
- Captures prices at 1h, 4h, 24h, 72h after entry
- Tracks peak gain and max drawdown

**Exit conditions:**
- Stop loss: -5%
- Take profit: +5%
- Time stop: 72 hours
- Outcome classified as WIN (≥2%), LOSS (≤-2%), or BREAKEVEN

**File:** `monitor/paper-trade-manager.js`

### Configuration

Edit `monitor/config.json` for API endpoints and Telegram credentials.
Edit `monitor/bloodhound-scanner.js` SETTINGS for:
- `scanIntervalMs` - Scan frequency (default: 2 min)
- `minConfluenceScore` - Alert threshold (default: 60)
- `maxSymbols` - Max symbols per scan (default: 20)
- `alertCooldownMs` - Per-symbol cooldown (default: 30 min)

---

## Opportunity Scanner

**Detects unusual options activity and smart money positioning.** Focuses on vol/OI ratios, premium flow, and call/put imbalances.

### Running Opportunity Scanner

Started automatically via `pm2 start ecosystem.config.js`. View logs:
```bash
pm2 logs opportunity
```

### Dynamic Symbol Discovery

The scanner dynamically discovers symbols each cycle (no hardcoded list):

| Source | Score | Description |
|--------|-------|-------------|
| Core | 100 | SPY, QQQ, IWM (always) |
| Watchlist | 50 | User priorities |
| Volume Leaders | 40 | $SPX top volume |
| Gainers/Losers | 35 | 2%+ movers |
| NASDAQ Movers | 35 | $COMPX top volume |
| 52-Week Extremes | 30 | Breakouts/breakdowns |

### SQLite Historical Data

Every scan saves to `data/opportunity_history.db` for future analysis:

```javascript
// Query recent stats
const db = require('./monitor/opportunity-db');
console.log(db.getTierStats(7));      // Last 7 days by tier
console.log(db.getTopSymbols(7, 10)); // Top 10 symbols
```

### Control API (Port 8083)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Scanner status, discovery sources |
| `/pause` | POST | Pause scanner |
| `/resume` | POST | Resume scanner |
| `/scan` | POST | Trigger immediate scan |

### Output Files

| File | Content |
|------|---------|
| `data/opportunities.json` | Latest scan results (overwrites each cycle) |
| `data/opportunity_history.db` | SQLite historical data for analysis |

---

## Monitor System (VIX Regime Watchdog)

The Monitor is a **VIX regime change detector** that sends Telegram alerts when volatility conditions change. It runs alongside Bloodhound but with a focused purpose.

### Unified Control System

**When Bloodhound pauses, Monitor also pauses.** The monitor checks Bloodhound's `/status` endpoint before each alert cycle.

### Architecture
```
Bloodhound Scanner          Wingman Monitor
──────────────────          ───────────────
Confluence scanning     →   VIX regime detection ONLY
Wall alerts, signals    →   No wall/signal alerts (removed)
Writes scanner.json     →   Checks Bloodhound pause state
```

### Starting the Monitor
```bash
pm2 start monitor/wingman-monitor.js --name monitor
pm2 logs monitor
```

The monitor runs in background and:
- Polls VIX every 2 minutes
- **Checks Bloodhound pause state** before alerting
- Only sends **VIX regime change** alerts
- Logs alerts to `data/alerts_log.json`

### Alert Types
| Alert | Trigger | Notes |
|-------|---------|-------|
| VIX Regime | VIX crosses 15/20/25/35 | Only alert type - Bloodhound handles wall/signal alerts |

### Why Separate Processes?

- **Bloodhound** = Confluence scanner (walls, signals, zones, scoring)
- **Monitor** = VIX regime watchdog (simpler, focused on volatility)

Both respect the same pause state - pause Bloodhound from the dashboard and both go silent.

### Configuration
Edit `monitor/wingman-monitor.js`:
```javascript
const CONFIG = {
  telegram: {
    botToken: 'YOUR_BOT_TOKEN',
    chatId: 'YOUR_CHAT_ID'
  },
  apis: {
    intel: 'http://192.168.10.239:3000',
    options: 'http://192.168.10.239:8000'
  },
  checkIntervalMs: 2 * 60 * 1000
};
```

---

## Trade Logging API

### Endpoints (Port 3000)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/trades` | Log entry (auto-captures snapshot) |
| PATCH | `/api/trades/:id/close` | Close trade (calculates P&L) |
| GET | `/api/trades` | Query history with filters |
| GET | `/api/trades/stats` | Performance analytics |
| GET | `/api/trades/open` | Current open positions |

### Using the Trade Client
```bash
# Check open trades
node monitor/trade-client.js open

# View performance stats
node monitor/trade-client.js stats

# Get market context before trade
node monitor/trade-client.js context SPY
```

### Logging a Trade (via curl)
```bash
# Entry
curl -X POST http://192.168.10.239:3000/api/trades \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SPY","direction":"long","strategy":"vwap_reversion",
       "entry_price":692.00,"stop_price":690.00,"target_price":695.00}'

# Close
curl -X PATCH http://192.168.10.239:3000/api/trades/{id}/close \
  -H "Content-Type: application/json" \
  -d '{"exit_price":694.50,"exit_reason":"target_hit"}'
```

### Market Snapshot (Auto-Captured)
On each trade entry/exit, the server captures:
- VIX + regime (low/normal/elevated/high)
- Gamma regime (BULLISH_SUPPORT/BEARISH_RESISTANCE/NEUTRAL)
- Call wall, put wall, max pain
- IV, HV, put/call OI ratio

### Analytics Queries
```bash
# Performance by VIX regime
curl "http://192.168.10.239:3000/api/trades/stats?vix_regime=low"

# Performance by gamma regime
curl "http://192.168.10.239:3000/api/trades/stats?gamma_regime=BULLISH_SUPPORT"

# Performance by strategy
curl "http://192.168.10.239:3000/api/trades/stats?strategy=vwap_reversion"
```

---

## Trade Validation

When user proposes a trade, auto-pull from APIs and check:

1. Scalp has higher TF context?
2. Position size ≤ 1% risk ($200)?
3. R:R acceptable?
4. Daily/weekly limits clear?
5. Market context favorable? (VIX regime, gamma regime)

**Verdict:** APPROVE / CHALLENGE / RED FLAG

---

## Update Flow

```
Trade executed  → POST /api/trades (server captures snapshot)
                → positions.json + trades_journal.json (local)

Position change → positions.json + ACTIVE_SESSION.md

Trade closed    → PATCH /api/trades/:id/close (server calculates P&L)
                → trades_journal.json + account_summary.json

End of day      → account_summary.json + archive
```

---

## Scanner Dashboard

### Zone Scanner (Primary)

**URL:** [http://localhost:8080](http://localhost:8080) (`zone-scanner.html`)

**Features:**
- Real-time ticker cards with zones (BUY_ZONE, SELL_ZONE, PINNED, etc.)
- **History badges:** 🆕 NEW, 📈 Day 2, 🔥 Streak (see [docs/SCANNER_HISTORY.md](docs/SCANNER_HISTORY.md))
- Gamma walls visualization with position bars
- RSI, trend, Bollinger Band position
- Bloodhound confluence scores and signals
- Filtering by zone type (tradeable, buy zones, sell zones, etc.)
- Click any ticker for detailed modal view

Auto-refreshes every 30 seconds from `data/dynamic_scan.json`.

### Legacy Dashboard

**URL:** `scanner.html` (older dashboard)

**Market Context Cards:**
| Field | Source | Description |
|-------|--------|-------------|
| Gamma Regime | `/api/options-walls/SPY/pressure` | BULLISH_SUPPORT, BEARISH_RESISTANCE, etc. |
| Market Bias | AI Outlook intraday_bias | BULLISH, BEARISH, NEUTRAL |
| IV Rank | `/api/options/SPY/iv` | IV percentile (0-100%) |
| Expected Move | SPY levels | Daily expected range |

Shows:
- VIX regime banner with sizing advice
- SPY/QQQ price vs gamma walls
- High conviction signals
- Recent alerts

Auto-refreshes every 30 seconds from `data/scanner.json`.

### Analytics Dashboard

**URL:** [http://localhost:8080/analytics.html](http://localhost:8080/analytics.html)

Analyzes paper trade performance to validate signal quality.

**Metrics tracked:**
| Section | Analysis |
|---------|----------|
| Performance by Tier | HIGH_CONVICTION vs TRADEABLE vs WATCH win rates |
| Performance by VIX Regime | Which VIX levels produce best signals |
| Performance by Score Range | Does higher score = better results? |
| Performance by SPY Trend | Bullish vs bearish market context |
| Bias Alignment | Trading with vs against market direction |
| Exit Reason Breakdown | Stop loss vs target vs time stop distribution |
| Optimal Exit Timing | Best time window (1h, 4h, 24h, 72h) |
| Risk Metrics | Peak gain, max drawdown, left on table |

**Key insights:**
- Compares tier performance to validate filtering logic
- Shows if score threshold should be adjusted
- Identifies which market conditions favor signals
- Auto-generated recommendations based on data

Auto-refreshes every 30 seconds from `data/paper_trades.json`.

---

## Wingman Persona

- **Maximum truth-seeking** - Facts over narratives
- **Challenge bad trades** - Before execution
- **Enforce discipline** - Especially when emotions run high

---

## Emergency Stops

| Threshold | Action |
|-----------|--------|
| -$500 daily | STOP for day |
| -$1,000 weekly | STOP for week |
| -10% account | 0.5% risk |
| -20% account | Stop 1 week |

---

## Full API Reference

### Options Analytics Server (Port 8000)

**Quotes & History**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/quotes/{symbol}` | Current quote, bid/ask, 52wk range |
| `GET /api/quotes?symbols=X,Y,Z` | Multiple quotes |
| `GET /api/history/{symbol}` | Price history for charting |
| `GET /api/movers/{index}` | Market movers |

**Technicals (USE THESE FIRST)**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/technicals/{symbol}` | Full technicals: RSI, MAs, ATR, BB, momentum, HV |
| `GET /api/technicals/{symbol}/signals` | Simplified: trend, RSI signal, volume signal |

**Options & Levels**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/options/{symbol}` | Full option chain |
| `GET /api/options/{symbol}/analysis` | Unusual activity, flow signals |
| `GET /api/options/{symbol}/iv` | IV percentile analysis |
| `GET /api/levels/{symbol}` | Gamma walls, max pain, VWAP, expected move |
| `GET /api/levels/{symbol}/gex` | Detailed GEX by strike |
| `GET /api/levels/{symbol}/maxpain` | Max pain calculation |

**Flow Analysis**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/flow/{symbol}` | Current flow stats |
| `GET /api/flow/{symbol}/trades` | Recent trades |
| `GET /api/flow/{symbol}/delta` | Delta time series |
| `GET /api/flow/{symbol}/history` | Historical flow (up to 168h) |
| `GET /api/flow/{symbol}/daily` | Daily flow summaries |

**Trade Ideas**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/ideas` | Cached trade ideas |
| `GET /api/ideas/{symbol}` | Get/generate idea for symbol |
| `POST /api/ideas/{symbol}/commentary` | AI commentary on idea |

**Position Sizing**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/position/calculate?account=X&risk=Y&premium=Z` | Calculate position size |
| `GET /api/market/context` | VIX regime, risk appetite, size modifier |

**Calendar**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/calendar/{symbol}` | Earnings date, days to earnings |
| `GET /api/calendar/{symbol}/check?dte=30` | Check if trade spans earnings |

### Market Intelligence Server (Port 3000)

**Market Data**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/latest` | All symbols (SPY, QQQ, NVDA, TSLA, sectors) |
| `GET /api/latest/{symbol}` | Single symbol data |
| `GET /api/latest/VIX` | VIX index |
| `GET /api/maxpain/{symbol}` | Max pain by expiration |
| `GET /api/options-walls/{symbol}/pressure` | Call/put walls, gamma regime |
| `GET /api/market/outlook` | AI narrative, themes, levels, bias |
| `GET /api/intelligence/daily-briefing` | Daily summary |

**Trade Logging**
| Endpoint | Purpose |
|----------|---------|
| `POST /api/trades` | Log entry (auto-captures market snapshot) |
| `PATCH /api/trades/:id/close` | Close trade (calculates P&L) |
| `GET /api/trades/open` | Current open positions |
| `GET /api/trades/stats` | Performance analytics |

**System**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/status` | Health check, DB stats |
| `GET /api/autonomous/status` | Scraper status |

---

## Analysis Workflow

When analyzing ANY symbol:

```
1. TECHNICALS FIRST
   curl http://192.168.10.239:8000/api/technicals/{SYMBOL}
   → Trend, RSI, MAs, momentum, volume

2. GAMMA LEVELS
   curl http://192.168.10.239:8000/api/levels/{SYMBOL}
   → Call/put walls, max pain, gamma flip, expected move

3. FLOW (if available)
   curl http://192.168.10.239:8000/api/flow/{SYMBOL}
   → Recent flow, delta, unusual activity

4. MARKET CONTEXT
   curl http://192.168.10.239:8000/api/market/context
   → VIX regime, position size modifier

5. ONLY THEN: Web search for news/catalysts if needed
```

---

## Trading Rules

### Range Trading Rule
- NO entries at mid-range prices
- BUY established support (bottom of range)
- SELL established resistance (top of range)
- Breakouts only after level is cleared

---

## Notes

- `-note [text]` → appends to daily_log.md with timestamp
- Dashboard auto-refreshes every 10s
- Goals in goals.json ($2,500/month target)
- Full rules in `docs/RULES.md`
- Full strategies in `docs/STRATEGIES.md`
- Monitor logs to `data/alerts_log.json` (last 500 alerts)
