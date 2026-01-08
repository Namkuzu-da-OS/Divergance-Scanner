# CLAUDE.md

Wingman Trading System - AI Instructions

---

## Project Vision

**READ FIRST:** [docs/VISION.md](docs/VISION.md) - The Bloodhound Scanner

> Wingman is an autonomous opportunity detection system. It finds confluence across
> multiple data sources (levels, flow, sentiment, technicals) and alerts the trader.
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
7. Sentiment:           GET http://192.168.10.239:3000/api/x/sentiment/ticker/{SYMBOL}
```

**Web search is SUPPLEMENTAL, not primary.**

---

## System Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  Wingman CLI    │     │  Market Intelligence Server (3000)   │
│  (Claude Code)  │◄───►│  - Sentiment, VIX, ETF data          │
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
| `data/scanner.json` | Live market data | Every 2 min (monitor) |
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

### Commands
| Command | Purpose |
|---------|---------|
| `/kungfu` | Load full Wingman context |
| `/data` | Pull market intelligence |
| `-note` | Quick journal entry |

---

## Bloodhound Scanner

**The core autonomous opportunity detection system.** This is the primary scanner that implements the project vision - finding high-confluence trading opportunities across multiple data sources.

### Running Bloodhound

Bloodhound runs persistently via PM2:
```bash
pm2 start monitor/bloodhound-scanner.js --name bloodhound
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

### 6 Discovery Sources

Bloodhound dynamically discovers symbols from:

1. **Watchlist** (`data/watchlist.json`) - Always scanned, highest priority
2. **X/Twitter Trending** (`/api/x/tickers/trending`) - Most mentioned tickers
3. **AI Market Outlook** (`/api/market/outlook`) - AI-identified key tickers
4. **Author Consensus** (`/api/garden/consensus`) - 3+ authors agree on direction
5. **Market Data** (`/api/latest`) - 52-week extremes, volume spikes
6. **Sector Rotation** - Strongest/weakest sector ETFs

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

When BTC is trending, IBIT gets the score boost. When authors are bullish on ETH, ETHA gets scanned.

### Confluence Scoring (0-100)

Each symbol is scored across multiple factors:

| Category | Max Points | Signals |
|----------|------------|---------|
| Technical | 25 | RSI oversold/overbought, Bollinger Band position, trend |
| Levels | 25 | At gamma walls, VWAP, confluence zones, breakout/breakdown |
| Sentiment | 15 | Social mentions, author consensus, AI outlook mention |
| Volume | 15 | Volume spike (2x+), elevated volume (1.5x+) |
| Context | 20 | Aligned with SPY trend, market regime |

**Alert threshold: 60/100** (configurable in SETTINGS)

### Alert Types

- 🟢 **Bullish** - At support, oversold, aligned with market
- 🔴 **Bearish** - At resistance, overbought, or breakdown
- 📍 **Pinned** - Trapped between gamma walls
- 🚀 **Breakout** - Above call wall resistance
- 💥 **Breakdown** - Below put wall support
- 👥 **Consensus** - Multiple authors agree (e.g., "6 authors BULLISH")

### Output Files

| File | Content |
|------|---------|
| `data/bloodhound.json` | Latest scan results with all opportunities |
| `data/dynamic_scan.json` | Full technical data for dashboard |
| `data/watchlist.json` | Symbols to always scan |

### Configuration

Edit `monitor/config.json` for API endpoints and Telegram credentials.
Edit `monitor/bloodhound-scanner.js` SETTINGS for:
- `scanIntervalMs` - Scan frequency (default: 2 min)
- `minConfluenceScore` - Alert threshold (default: 60)
- `maxSymbols` - Max symbols per scan (default: 20)
- `alertCooldownMs` - Per-symbol cooldown (default: 30 min)

---

## Monitor System

### Starting the Monitor
```bash
cd monitor
node wingman-monitor.js
```

The monitor runs in background and:
- Polls both APIs every 2 minutes
- Sends alerts to Telegram
- Writes `data/scanner.json` for dashboard
- Logs alerts to `data/alerts_log.json`

### Alert Types
| Alert | Trigger | Cooldown |
|-------|---------|----------|
| VIX Regime | VIX crosses 15/20/25/35 | On change |
| Wall Proximity | Price within 0.15% of wall | 30 min |
| Pinned | Spread < 0.3% between walls | 30 min |
| High Conviction | Signal conviction ≥ 85% | Once per signal |

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
- Sentiment score (-100 to +100)
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

Open `scanner.html` in browser. Shows:
- VIX regime banner with sizing advice
- SPY/QQQ price vs gamma walls
- Sentiment distribution
- High conviction signals
- Recent alerts

Auto-refreshes every 30 seconds from `data/scanner.json`.

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

**Sentiment & Social**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/x/tweets?limit=50` | Tweets with sentiment scores |
| `GET /api/x/sentiment/distribution?hours=24` | Bullish/bearish breakdown |
| `GET /api/x/sentiment/overview` | 24h sentiment distribution |
| `GET /api/x/sentiment/ticker/{symbol}` | Ticker-specific sentiment |
| `GET /api/x/tickers/trending?hours=24` | Most mentioned tickers |
| `GET /api/garden/leaderboard?limit=20` | Top authors by accuracy |
| `GET /api/garden/consensus?hours=24&min_authors=3` | **Tickers where 3+ authors agree** (used by Bloodhound) |

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

4. SENTIMENT (for major tickers)
   curl http://192.168.10.239:3000/api/x/sentiment/ticker/{SYMBOL}
   → Bullish/bearish/neutral split

5. MARKET CONTEXT
   curl http://192.168.10.239:8000/api/market/context
   → VIX regime, position size modifier

6. ONLY THEN: Web search for news/catalysts if needed
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
