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

## NEVER FABRICATE DATA (NON-NEGOTIABLE)

This is a live trading system. Every factual claim must trace to a specific data source: an API response from this session, a file you read, or something the user told you. **If you cannot point to the source, DO NOT STATE IT.**

- **Economic calendar dates** (FOMC, CPI, PPI, NFP) — only from MARKET_INTEL.md, user input, or a verified web search. NEVER from "general knowledge" or pattern-matching. Dates get rescheduled. Wrong dates cause wrong trades.
- **Prices, levels, scores** — only from API responses fetched this session.
- **No data = say "no data."** Never fill gaps with plausible-sounding guesses stated as facts.
- **If uncertain, flag it.** Say "unconfirmed" or "needs verification."

Fabricated data presented as fact is the single worst failure mode of this system. It is better to leave a field blank than to guess.

---

## Quick Start

**Full Wingman Mode:** User says "I know Kung Fu" or `/kungfu`

**Orientation Path:**
```
docs/RULES.md → data/MARKET_INTEL.md → /api/positions
```

---

## MANDATORY: Scanner Review Process (NEVER SKIP)

When reviewing Bloodhound scanner data OR the Zone Scanner dashboard:

### Step 1: Use API via subagent
```
Task tool with subagent_type=Explore:
"Fetch http://localhost:8080/api/scan/latest and return a compact summary:
1. Total ticker count
2. ALL symbols listed
3. Tradeable setups with zone and action
4. Market context (VIX, SPY trend)
Format as a table. Miss no tickers."
```

### Step 2: Verify the count
- Report exact ticker count. List every symbol. Ask user: "I see X tickers. Did I miss any?"

### Step 3: Present ALL tickers in a table
| Symbol | Zone | Score | Price | RSI | Trend | Action |
Show EVERY ticker, no exceptions. Low-score tickers included.

### Step 4: Only THEN analyze/filter
After showing all, highlight specific setups or group by zone/priority.

### Failures to avoid
- DO NOT read raw database (use API or subagent)
- DO NOT skip low-score tickers or assume "they probably don't care"
- If user shows screenshot, enumerate FROM THE SCREENSHOT first
- If you miss tickers, acknowledge and fix immediately

### Validation: `node monitor/scanner-validator.js [symbols...]`

---

## Context Efficiency

Keep main context lean. Offload heavy reads to subagents.

| Task | Subagent? | Why |
|------|-----------|-----|
| Scanner review | YES | 20+ tickers |
| Signal tracking | YES | DB + APIs + compare |
| Deep ticker analysis | YES | Multiple API calls |
| Quick price check | NO | Single API call |
| File edits | NO | Need direct access |

**Scanner pattern:** `subagent_type=Explore` → fetch `/api/scan/latest` → return compact summary
**Signal pattern:** `subagent_type=general-purpose` → query DB + `/api/technicals/{symbol}` → return comparison table

---

## MANDATORY: Data Sources First

**ALWAYS pull from our APIs before web search. Web search is SUPPLEMENTAL.**

### External API (for AI integrations)
```
GET http://localhost:8080/api/v1/context  — Full context bundle (market intel, session state, scan, positions, alerts, flow, internals)
GET http://localhost:8080/api/v1/health   — Service health check
```
Docs: `docs/API_V1.md`

### Discovery (if unsure about available endpoints)
- Options API: `GET http://192.168.10.60:8000/api/capabilities`
- Intel API: `GET http://192.168.10.60:3000/api/status` or `/api-docs`

### Primary Analysis Endpoints
```
1. Technicals:     GET http://192.168.10.60:8000/api/technicals/{SYMBOL}
2. Signals:        GET http://192.168.10.60:8000/api/technicals/{SYMBOL}/signals
3. Gamma Levels:   GET http://192.168.10.60:8000/api/levels/{SYMBOL}
4. Options Flow:   GET http://192.168.10.60:8000/api/flow/{SYMBOL}
5. Market Context: GET http://192.168.10.60:8000/api/market/context
6. AI Outlook:     GET http://192.168.10.60:3000/api/market/outlook
```

---

## System Architecture

### API Pacing (CRITICAL)
All scanners share Options API at `192.168.10.60:8000`. **Never use Promise.all** for multiple endpoints.
- 100ms delay between API calls within a symbol
- 200ms delay between symbols in scan loop
- 15s timeout for Options API requests
- Violations cause timeouts, null data, slow responses across all consumers

### API Cache (`monitor/api-cache.js`)
Cross-process shared cache via SQLite (`api_cache` table in `wingman.db`). All PM2 scanners read/write the same cache — when Bloodhound fetches technicals for NVDA, Opportunity gets it free.

**TTL Rules:**
| Endpoint Pattern | TTL | Constant |
|------------------|-----|----------|
| `/api/technicals/*` | 15 min | `TTL.TECHNICALS` |
| `/api/flow/*` | 15 min | `TTL.FLOW` |
| `/api/options/*/analysis` | 10 min | `TTL.ANALYSIS` |
| `/api/options/*/iv` | 10 min | `TTL.IV` |
| `/api/market/context` | 5 min | `TTL.CONTEXT` |
| `/api/calendar/*` | 24 hours | `TTL.CALENDAR` |
| `/api/levels/*` | **NEVER** | Real-time gamma walls |
| `/api/quotes/*` | **NEVER** | Real-time prices |

**Usage:** `apiCache.wrap(url, apiCache.TTL.TECHNICALS, () => fetchJSON(url), 'bloodhound')`
**Monitoring:** `curl localhost:8080/api/cache/stats` → `{ total, fresh, stale }`

### API Gateway (`monitor/api-gateway.js`)
Central HTTP proxy on port 8086. All scanner API calls route through here via `api-client.js`.

| Route Prefix | Upstream Target | Max Concurrent | Circuit Breaker |
|-------------|----------------|----------------|-----------------|
| `/schwab/*` | `192.168.10.60:8000` | 250 | 5 failures/60s, 30s cooldown |
| `/divergence/*` | `192.168.10.61:32212` | 5 | 3 failures/60s, 60s cooldown |
| `/intel/*` | `192.168.10.60:3000` | 20 | 5 failures/60s, 30s cooldown |

**Circuit states:** CLOSED (normal) → OPEN (reject with 503) → HALF_OPEN (probe 1 request)
**Queue:** When at max concurrency, requests queue (FIFO). Max 100 queued, 30s timeout.
**Monitoring:** `curl localhost:8086/status` → per-upstream in-flight, queue depth, circuit state, total stats
**Fallback:** If gateway is down (ECONNREFUSED), `api-client.js` falls back to direct API calls.

### Scan Staggering
Scanners start at staggered intervals via `SCAN_OFFSET_MS` env var in `ecosystem.config.js` to keep concurrent Schwab API calls under 300 (the rate limit threshold).

| Scanner | Offset | Rationale |
|---------|--------|-----------|
| Bloodhound | 0s | Fires first, populates cache for others |
| Premarket | 60s | Only 6-9:30 AM, light overlap |
| Opportunity | 90s | Reads warm cache from Bloodhound |
| Earnings | 180s | Everything cached, near-zero Schwab load |

**Important:** After changing `ecosystem.config.js` env vars, you must `pm2 delete <name> && pm2 start ecosystem.config.js` — `pm2 restart --update-env` does NOT re-read ecosystem env vars.

### Port Map (HARDCODED)

| Port | Service | File/Location |
|------|---------|---------------|
| 3000 | Intel API | External — market intelligence, trade logging |
| 8000 | Options API | External — options analytics, technicals, gamma |
| 8080 | Web Server | `monitor/web-server.js` — dashboards + internal APIs |
| 8081 | Bloodhound | `monitor/bloodhound-scanner.js` |
| 8082 | Earnings | `monitor/earnings-scanner.js` |
| 8083 | Opportunity | `monitor/opportunity-scanner.js` |
| 8084 | Pre-Market | `monitor/premarket-scanner.js` |
| 8085 | Internals | `monitor/market-internals.js` |
| 8086 | API Gateway | `monitor/api-gateway.js` — central proxy for all upstream APIs |
| 32212 | Divergence Scanner | External (192.168.10.61) — RS rankings, rotation |

### Dashboard URLs (all at localhost:8080)
morning.html (default), zone-scanner.html, premarket.html, earnings-scanner.html, opportunity-scanner.html, analytics.html, strategies.html, dashboard.html, options-lab.html, research.html, scanner.html, backtests.html, levels.html

### Key Web Server API Endpoints (Port 8080)
| Endpoint | Purpose |
|----------|---------|
| `/api/scan/latest` | Full Bloodhound scan data |
| `/api/scan/summary` | Summary format |
| `/api/internals/latest` | Latest market internals (TICK, TRIN, VIX, etc.) |
| `/api/internals/history?hours=N` | Intraday internals for charts |
| `/api/internals/today` | All internals readings today |
| `/api/rotation/rankings` | RS rankings |
| `/api/rotation/divergences` | Active sector divergences |
| `/api/rotation/regime` | Cycle phase + leading/lagging sectors |
| `/api/signals` | All signals with checkpoint data |
| `/api/signals/stats` | Aggregated signal stats |
| `/api/signals/options?days=30` | Option signal tracking stats |
| `/api/alerts?days=7&limit=50` | Alert history |
| `/api/analyses` | Research journal (GET list, POST new) |
| `/api/backtest/results` | MA backtest sweep results (?type=crossover&symbol=NVDA) |
| `/api/premarket` | Latest premarket scan |
| `/api/gaps/analytics?days=30` | Gap fill rates |
| `/api/gaps/today-with-history` | Today's gaps + historical context |
| `/api/opportunities/latest` | Latest opportunity scan |
| `/api/morning-briefing` | Aggregated morning data |
| `/api/positions` | Open positions (GET/POST/PATCH close) |
| `/api/cache/stats` | API cache stats (total, fresh, stale entries) |
| `/proxy/analytics/*` | Forwards to Options API |
| `/proxy/divergence/*` | Forwards to divergence scanner |

---

## File Structure

### Key Data Files
| File | Purpose |
|------|---------|
| `data/wingman.db` | SQLite — scans, signals, checkpoints, premarket, watchlist, positions, api_cache |
| `data/MARKET_INTEL.md` | Living market intelligence — regime, rotation, watchlist, session recaps |
| `data/SESSION_STATE.md` | Intra-session checkpoint (written by `/checkpoint`, read by `/kungfu`) |
| `data/daily_log.md` | Today's journal |
| `data/STRATEGY_CANDIDATES.md` | Researched strategies ranked for backtesting (P1/P2/P3/Rejected) |
| `data/trades_journal.json` | Trade history |
| `data/account_summary.json` | P&L metrics |

### Commands
| Command | Purpose |
|---------|---------|
| `/kungfu` | Load full Wingman context |
| `/pulse` | Intraday market internals check |
| `/checkpoint` | Save session state to SESSION_STATE.md |
| `-note` | Quick journal entry |

---

## Starting All Scanners

```bash
pm2 start ecosystem.config.js    # Start all 8 services (gateway + 7 scanners with stagger offsets)
pm2 list                          # Show processes
pm2 logs [name]                   # View logs (gateway, bloodhound, opportunity, earnings, premarket, webserver, eod-tracker, internals)
pm2 restart all                   # Restart everything (keeps existing env vars)
# If ecosystem.config.js env vars changed:
pm2 delete gateway bloodhound opportunity earnings premarket webserver eod-tracker internals
pm2 start ecosystem.config.js    # Re-reads env vars from config
```

---

## Bloodhound Scanner

Core autonomous opportunity detection system. Discovers symbols dynamically (static watchlist + market data + sector rotation), scores confluence 0-100, classifies into tiers, sends Telegram alerts.

**Control API (port 8081):** `/status`, `/pause`, `/resume`, `/scan`, `/clear-cooldowns`, `/test-alert`, `/watchlist` (GET/add/remove)

**Static watchlist:** 9 symbols (SPY, QQQ, NVDA, TSLA, AMD, AAPL, META, MSFT, IBIT) in SQLite `watchlist` table. Protected from automation.
**Dynamic slots:** `maxSymbols` (50) minus static count = 41 competitive slots.

**Alert threshold:** 35/100 confluence score (`minConfluenceScore` in SETTINGS)
**Scan interval:** 5 min | **Alert cooldown:** 30 min per symbol

### Tradeable Tiers

| Tier | Criteria |
|------|----------|
| HIGH_CONVICTION | AT_WALL + EXTENDED_RSI + score ≥40, OR score ≥60 at wall |
| TRADEABLE | Score ≥35 at wall + action |
| WATCH | Score ≥20 near wall, OR EXTENDED_LOW + oversold RSI, OR MID_RANGE/PINNED + score ≥35 |
| FILTERED | Everything else |

EXTENDED_HIGH and HIGH_MOMENTUM zones never get tradeable tiers.
Counter-trend warnings are annotations, never suppressions (counter-trend signals outperform: 55.6% vs 34.9% win rate).

### Cross-Scanner Flow Confirmation (from Opportunity Scanner)
Opportunity Scanner independently analyzes options flow (vol/OI, premium, positioning). When it flags a symbol that Bloodhound is also scanning, the cross-confirmation adds confluence score:

| Opportunity Tier | Score Impact | Rationale |
|-----------------|-------------|-----------|
| HIGH_CONVICTION (score ≥70, vol/OI ≥5x) | +8 pts | Two independent systems agree — strong confluence |
| TRADEABLE (score 50-69) | +5 pts | Moderate flow confirmation |

- Goes to `scores.standard` (not highEdge) — confirmation, not standalone edge
- No double-counting: Bloodhound reads live chain data, Opportunity uses different scoring methodology
- Flow data (vol/OI ratio, net premium) shown in signal annotation: `📡 Flow confirmed by Opportunity Scanner (HC 612x $16.1M) [+8]`
- Data path: `opportunity-db.getRecentHighScoreSymbols()` → `oppFlowMap` in discovery → `symbolData.oppFlow` → scored in `analyzeSymbol()`

### Sector RS Scoring (from divergence scanner)
| Sector RS Percentile | Score Impact |
|----------------------|-------------|
| Top quartile (≥75th) | +8 pts |
| Above median (50-74th) | +4 pts |
| Below median (25-49th) | -3 pts |
| Bottom quartile (<25th) | -5 pts |

### Signal Validation
HIGH_CONVICTION signals logged to SQLite with checkpoints at 4h, 24h, 7d. Tracks peak gain and max drawdown. Auto-closes at ±2% or 72h timeout. Option contracts tracked when unusual flow (vol/OI ≥5x). Analytics dashboard at `/analytics.html`.

**Output:** `bloodhound_scans` + `bloodhound_results` tables → `/api/scan/latest` and `/api/scan/summary`
**Config:** `monitor/config.json` (APIs, Telegram) + `monitor/bloodhound-scanner.js` SETTINGS

---

## Opportunity Scanner

Detects unusual options activity and smart money positioning (vol/OI ratios, premium flow, call/put imbalances). Port 8083: `/status`, `/pause`, `/resume`, `/scan`.

**Symbol cap:** 50 (`maxSymbols` in SETTINGS). Scan time ~30s, well within 5-min interval.
**Discovery:** Core (SPY/QQQ/IWM) + Bloodhound watchlist + 28 ETFs (crypto, volatility, sectors, commodities) + volume leaders + movers + 52wk extremes.
**Swing filter:** `strike_count=100`, `MAX_DTE=60` (excludes LEAPs).
**Cross-scanner feed:** High-scoring results (HC/TRADEABLE) feed back into Bloodhound via `opportunity-db.getRecentHighScoreSymbols()` for both symbol discovery (+35/+25 discovery points) and flow confirmation scoring (+8/+5 confluence points).
**Output:** `data/wingman.db` (opportunities table) → `/api/opportunities/latest`

---

## Pre-Market Scanner

Detects pre-market gaps ≥2%. Runs 6:00-9:30 AM ET. Port 8084: `/status`, `/pause`, `/resume`, `/scan`, `/latest`, `/today`.

Gap tiers: HUGE (5%+), LARGE (3-5%), MODERATE (2-3%). Scored 0-100 on gap size, volume, catalyst, futures alignment.
HIGH_CONVICTION gaps auto-added to watchlist (source: `premarket_gap`, 7-day expiry) → Bloodhound picks them up.
Output: `premarket_scans` + `premarket_movers` tables → `/api/premarket`

---

## Market Internals Scanner

Collects TICK, TRIN, ADVN/DECN, UVOL/DVOL, VIX, SPX, COMPX, DJI during RTH (9:30 AM - 4:00 PM ET). Scans every 2 min. Port 8085.

**Schwab note:** Declining issues = `$DECN` (NOT `$DECL`). $ADD, $VOLD, $PCSP, $SPXA200R are thinkorswim-only.

| Metric | Bullish | Neutral | Bearish | Extreme |
|--------|---------|---------|---------|---------|
| TICK | > +400 | ±400 | < -400 | ±800 |
| A/D Spread | > +400 | ±400 | < -400 | ±1000 |
| TRIN | < 0.8 | 0.8-1.2 | > 1.2 | > 2.0 |
| Vol Ratio | > 2:1 | 1:1-2:1 | < 1:1 | > 3:1 |
| VIX | < 12 | 12-20 | 20-30 | > 30 |

Output: `market_internals` table → `/api/internals/latest`, `/history`, `/today`

---

## EOD Gap Tracker

Runs at 4:15 PM ET. Captures closing data for premarket gaps: EOD close/high/low, gap filled (yes/no), outcome (WIN/LOSS/SCRATCH).
Gap UP filled if intraday low ≤ prev_close. Gap DOWN filled if intraday high ≥ prev_close.
PM2: `pm2 logs eod-tracker` | Manual: `node monitor/eod-gap-tracker.js --now`
Analytics: `/api/gaps/analytics`, `/api/gaps/ticker/:symbol`, `/api/gaps/repeat-offenders`

---

## VIX Regime Alerts

Built into Bloodhound (no separate process). Telegram alert when VIX crosses thresholds:

| Regime | VIX | Alert |
|--------|-----|-------|
| Complacent | < 12 | Spike probable |
| Normal | 12-20 | Standard |
| Elevated | 20-30 | Watch for setups |
| Fear | 30-40 | Quality entries |
| Capitulation | > 40 | Scale in |

---

## Breadth Extreme Alerts

Built into Bloodhound (no separate process). Telegram alert when TICK + A/D breadth hit extremes:

| State | TICK | A/D | Alert |
|-------|------|-----|-------|
| Extreme Bearish | < -1000 | AND < -1500 | Dual extreme — capitulation zone |
| Extreme Bullish | > +1000 | AND > +1500 | Dual extreme — exhaustion zone |
| Strong Bearish | < -800 | OR < -1500 | Strong selling — confirm with price |
| Strong Bullish | > +800 | OR > +1500 | Strong buying — confirm with price |

Fires immediately on first reading (no hysteresis). No cooldown between alerts. Type: `BREADTH_EXTREME` in alerts DB.

---

## Trade Logging API (Port 3000)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/trades` | Log entry (auto-captures market snapshot) |
| PATCH | `/api/trades/:id/close` | Close trade (calculates P&L) |
| GET | `/api/trades` | Query history with filters |
| GET | `/api/trades/stats` | Performance analytics (filter by vix_regime, gamma_regime, strategy) |
| GET | `/api/trades/open` | Current open positions |

CLI: `node monitor/trade-client.js [open|stats|context SYMBOL]`

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
Trade executed  → POST /api/trades + POST /api/positions + trades_journal.json
Position change → PATCH /api/positions/close
Trade closed    → PATCH /api/trades/:id/close → trades_journal.json + account_summary.json
End of day      → account_summary.json + archive
```

---

## Scanner Dashboard

**Zone Scanner (primary):** `zone-scanner.html` — Ticker cards with zones, history badges (NEW/Day 2/Streak), gamma walls, RSI, scores. Auto-refresh 30s from `/api/scan/latest`.
**Market Dashboard:** `scanner.html` — Internals gauges + Chart.js intraday charts (TICK, TRIN, Vol Ratio, VIX) with threshold lines.
**Analytics:** `analytics.html` — Signal validation performance by tier, VIX regime, score range, direction, checkpoint.
**Legacy:** `dashboard.html` — VIX regime banner, SPY/QQQ vs walls, signals.

---

## VIX Reference Guide (Entry-Focused)

This system uses an **entry-focused** VIX framework. High VIX = opportunity, not danger.

| VIX | Regime | Entry Signal |
|-----|--------|--------------|
| < 12 | **COMPLACENT** | Spike probable - tighten trailing stops |
| 12-20 | **NORMAL** | Standard conditions |
| 20-30 | **ELEVATED** | Watch for setups forming |
| 30-40 | **FEAR** | Quality entries emerging |
| > 40 | **CAPITULATION** | Scale in - historically near bottoms |

**Key principle:** "When the VIX is high, it's time to buy. When the VIX is low, look out below."

---

## Wingman Persona

- **Maximum truth-seeking** - Facts over narratives
- **Challenge bad trades** - Before execution
- **Enforce discipline** - Especially when emotions run high
- **Intraday awareness** - Use `/pulse` to check market internals before confirming entries. Internals (TICK, TRIN, A/D, Vol Ratio) tell you whether the broad market supports the setup direction.

---

## Emergency Stops

| Threshold | Action |
|-----------|--------|
| -$500 daily | STOP for day |
| -$1,000 weekly | STOP for week |
| -10% account | 0.5% risk |
| -20% account | Stop 1 week |

---

## Analysis Workflow

When analyzing ANY symbol:

```
1. TECHNICALS FIRST
   curl http://192.168.10.60:8000/api/technicals/{SYMBOL}
   → Trend, RSI, MAs, momentum, volume

2. GAMMA LEVELS
   curl http://192.168.10.60:8000/api/levels/{SYMBOL}
   → Call/put walls, max pain, gamma flip, expected move

3. FLOW (if available)
   curl http://192.168.10.60:8000/api/flow/{SYMBOL}
   → Recent flow, delta, unusual activity

4. MARKET CONTEXT
   curl http://192.168.10.60:8000/api/market/context
   → VIX regime, position size modifier

5. SECTOR WIND (via divergence scanner)
   curl http://localhost:8080/api/rotation/regime
   curl http://localhost:8080/api/rotation/rankings
   → Rotation phase, RS percentile for symbol's sector

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
- Monthly goal: $2,500/month target
- Full rules in `docs/RULES.md`
- Full strategies in `docs/STRATEGIES.md`
- Signals stored in SQLite (`data/wingman.db`) with multi-checkpoint validation
