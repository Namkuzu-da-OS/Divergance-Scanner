# Earnings Season Scanner - Design Plan

## Overview

A **standalone, modular earnings scanner** that identifies high-probability trading opportunities around earnings announcements. Designed to work independently but with future Bloodhound integration in mind.

---

## Core Strategies (3)

### 1. Pre-Earnings Momentum (PREM)
**Entry:** 5-10 days before earnings announcement
**Exit:** Day before earnings (close) OR hold through if conviction is high
**Edge:** Stocks with positive momentum + analyst upgrades tend to run into earnings
**Position:** Stock only (avoids IV crush entirely)

**Scoring Factors:**
- Relative strength vs sector (5-10 day)
- Recent analyst estimate revisions (up = bullish)
- Historical pre-earnings drift pattern
- Options flow (smart money positioning)
- Sector rotation alignment

### 2. Post-Earnings Announcement Drift (PEAD)
**Entry:** 1-2 days after earnings (let dust settle)
**Exit:** Hold 20-60 days for drift
**Edge:** ~12% annualized. Stocks continue drifting in direction of surprise for weeks.
**Position:** Stock only

**Scoring Factors:**
- Earnings surprise magnitude (beat/miss %)
- Initial reaction direction + magnitude
- Historical PEAD tendency for this stock
- Volume confirmation (>2x average)
- Analyst revision activity post-earnings

### 3. Gap Trading (GAPS)
**Entry:** Morning of earnings release, within first 30 minutes
**Exit:** Same day or next day
**Edge:** 65% fill probability on gaps >10%
**Position:** Stock only (intraday)

**Scoring Factors:**
- Gap size (>3% minimum, >10% ideal)
- Pre-market volume (>500K shares)
- Historical gap fill rate for stock
- Direction vs market sentiment
- Support/resistance proximity

---

## IV Crush Strategy (Options - Phase 2)

**Why separate phase:** Requires more sophisticated IV analysis. Start with stocks for simplicity.

When implemented:
- **Pre-Earnings IV Run-Up:** Buy options 14 days out, sell day before earnings
- **IV Crush Sellers:** Sell iron condors/strangles into high IV, profit from collapse
- **Volatility Arbitrage:** Compare implied move vs historical avg move

---

## Scanner Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 EARNINGS SEASON SCANNER                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │  Discovery   │────►│   Analysis   │────►│  Signals    │  │
│  │  (Calendar)  │     │  (Scoring)   │     │  (Alerts)   │  │
│  └──────────────┘     └──────────────┘     └─────────────┘  │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐  │
│  │ earnings-    │     │ earnings-    │     │ paper-      │  │
│  │ calendar.json│     │ scan.json    │     │ trades.json │  │
│  └──────────────┘     └──────────────┘     └─────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Control API: http://localhost:8082
Dashboard:   http://localhost:8080/earnings-scanner.html
```

---

## Data Sources

### From Existing APIs

| Data | Endpoint | Purpose |
|------|----------|---------|
| Earnings dates | `GET /api/calendar/{symbol}` | Next earnings, days to earnings |
| Technicals | `GET /api/technicals/{symbol}` | RSI, trend, momentum |
| Levels | `GET /api/levels/{symbol}` | Support/resistance for gap targets |
| Options IV | `GET /api/options/{symbol}/iv` | IV rank, IV percentile |
| Flow | `GET /api/flow/{symbol}` | Smart money positioning |
| Market context | `GET /api/market/context` | VIX regime, SPY trend |

### New Data Needed

| Data | Source | Purpose |
|------|--------|---------|
| Earnings calendar feed | External API (earnings whispers, yahoo, etc.) | Upcoming earnings for all stocks |
| Historical surprises | External or build | Beat/miss rate, avg surprise % |
| Analyst estimates | External API | EPS estimates, revisions |
| Expected move | Calculate from options | Compare to historical avg move |

---

## Symbol Discovery

### Primary Sources (earnings-focused)

1. **Earnings This Week**
   - All stocks reporting in next 7 days
   - Priority: market cap > $10B (moves markets)

2. **Watchlist + Earnings**
   - Stocks from Bloodhound watchlist that have earnings upcoming
   - Always scanned if within 14 days of earnings

3. **Sector Leaders**
   - First major company in sector to report = bellwether
   - Other sector stocks react to bellwether results

4. **High IV Rank**
   - Stocks with IV rank >70% (elevated expectations)
   - Good candidates for volatility strategies

5. **Narrative Stocks**
   - AI outlook mentions + earnings upcoming
   - Social trending + earnings upcoming

---

## Confluence Scoring (0-100)

### Pre-Earnings Score (PREM)

| Factor | Max Pts | Criteria |
|--------|---------|----------|
| Momentum | 25 | 5-day relative strength vs sector |
| Analyst Revisions | 20 | Estimate revisions (up/down/flat) |
| Options Flow | 20 | Net premium direction, unusual activity |
| Historical Pattern | 15 | This stock's avg pre-earnings drift |
| Market Alignment | 10 | SPY trend matches position direction |
| Narrative | 10 | AI outlook mention, social buzz |

### Post-Earnings Score (PEAD)

| Factor | Max Pts | Criteria |
|--------|---------|----------|
| Surprise Size | 30 | EPS surprise % (>5% = max points) |
| Reaction Size | 25 | Gap + day 1 move size |
| Volume Confirm | 15 | Volume vs average (>2x = max) |
| Historical PEAD | 15 | This stock's drift tendency |
| Analyst Activity | 15 | Post-earnings upgrades/downgrades |

### Gap Score (GAPS)

| Factor | Max Pts | Criteria |
|--------|---------|----------|
| Gap Size | 30 | 3-5% = 15pts, 5-10% = 25pts, >10% = 30pts |
| Pre-market Volume | 25 | >500K = max points |
| Historical Fill | 20 | Stock's gap fill rate |
| Level Proximity | 15 | Near support/resistance = higher fill prob |
| Market Context | 10 | Aligned with SPY direction |

---

## Signal Types & Alerts

| Signal | Trigger | Action | Telegram |
|--------|---------|--------|----------|
| PREM_ENTRY | Score >=70, 5-10 days before | Paper trade created | Yes |
| PREM_EXIT | Day before earnings | Alert to close | Yes |
| PEAD_WATCH | Score >=60, 1-2 days after | Monitor for entry | No |
| PEAD_ENTRY | Score >=70, trend confirmed | Paper trade created | Yes |
| GAPS_ALERT | Gap >5%, volume >500K | Morning alert | Yes |
| BLACKOUT_START | 14 days before earnings | Avoid new positions | No |

---

## Buyback Blackout Integration

**Timing:** ~2 weeks before quarter end through 2 days after earnings release

**Scanner Behavior:**
- Flag stocks entering blackout period
- Track when blackout ends (potential buying resumption)
- Consider blackout as minor bearish factor in scoring (-5 pts)
- Post-blackout = minor bullish factor (+5 pts for first week after)

---

## Stock-Specific Tuning (Learning System)

Each stock builds a profile over multiple earnings cycles:

```json
{
  "symbol": "NVDA",
  "earnings_profile": {
    "avg_pre_drift_5d": 2.3,
    "avg_pre_drift_10d": 3.8,
    "beat_rate": 0.85,
    "avg_surprise_pct": 8.2,
    "avg_reaction_gap": 5.4,
    "avg_pead_20d": 3.1,
    "avg_pead_60d": 7.2,
    "gap_fill_rate": 0.42,
    "iv_crush_avg": 35,
    "expected_move_accuracy": 0.7
  },
  "last_5_earnings": [...],
  "strategy_performance": {
    "PREM_win_rate": 0.65,
    "PEAD_win_rate": 0.58,
    "GAPS_win_rate": 0.45
  }
}
```

---

## Output Files

| File | Purpose | Consumers |
|------|---------|-----------|
| `data/earnings-calendar.json` | All upcoming earnings with metadata | Scanner, dashboard |
| `data/earnings-scan.json` | Current scan results with scores | Dashboard |
| `data/earnings-signals.json` | Active signals (PREM/PEAD/GAPS) | Alerts, paper trades |
| `data/earnings-profiles.json` | Per-stock historical patterns | Scoring algorithm |
| `data/earnings-paper-trades.json` | Strategy validation tracking | Analytics |

---

## Dashboard: earnings-scanner.html

### Sections:

1. **Earnings Calendar View**
   - Week view of upcoming earnings
   - Color-coded by signal type (PREM candidate, just reported, etc.)
   - Click to expand details

2. **Active Signals**
   - Current PREM entries (with days to earnings)
   - Current PEAD watches (with days since earnings)
   - Today's gap alerts

3. **Leaderboard**
   - Stocks by PREM score (5-10 days out)
   - Stocks by PEAD score (just reported)
   - Historical win rates by stock

4. **Performance Analytics**
   - Strategy comparison (PREM vs PEAD vs GAPS)
   - Win rate by market condition
   - Best/worst performers

---

## Implementation Files

| File | Purpose |
|------|---------|
| `monitor/earnings-scanner.js` | Main scanner logic |
| `monitor/earnings-calendar-fetcher.js` | Fetch/update earnings calendar |
| `monitor/earnings-paper-trades.js` | Paper trade manager for earnings |
| `earnings-scanner.html` | Dashboard |
| `docs/EARNINGS_STRATEGIES.md` | Strategy documentation |

---

## Bloodhound Integration Layer (USE FROM DAY ONE)

**Philosophy:** Don't rebuild what Bloodhound already does. Import and call it.

### Shared Modules (require() from Bloodhound)

```javascript
// In earnings-scanner.js - use Bloodhound's existing code:

const { sendTelegramAlert } = require('./bloodhound-scanner.js');  // Same alert format
const PaperTradeManager = require('./paper-trade-manager.js');     // Same tracking system
const config = require('./config.json');                            // Same Telegram creds

// Or extract these into shared utilities:
// monitor/shared/telegram.js
// monitor/shared/api-client.js
// monitor/shared/paper-trades.js
```

### Functions to Reuse (Don't Rebuild)

| Function | Source | What It Does |
|----------|--------|--------------|
| `sendTelegramAlert()` | bloodhound-scanner.js:150 | Format & send Telegram |
| `fetchMarketContext()` | bloodhound-scanner.js:380 | VIX, SPY trend, regime |
| `fetchTechnicals()` | bloodhound-scanner.js:450 | RSI, trend, momentum |
| `fetchLevels()` | bloodhound-scanner.js:520 | Gamma walls, support/resistance |
| `fetchFlow()` | bloodhound-scanner.js:580 | Options flow analysis |
| `fetchSentiment()` | bloodhound-scanner.js:640 | X/Twitter sentiment |
| `PaperTradeManager.*` | paper-trade-manager.js | All paper trade functions |

### Data Bloodhound Already Fetches

When Bloodhound runs every 2 min, it already has:
- Full technicals for 20 symbols
- Gamma levels
- Options flow
- Sentiment data
- Market context

**Option A:** Earnings Scanner reads `data/dynamic_scan.json` (Bloodhound's output)
**Option B:** Earnings Scanner calls same APIs (independent but redundant)
**Option C (Best):** Share a common data fetching layer both scanners use

### Recommended Architecture

```
monitor/
├── shared/
│   ├── telegram.js          # Extract from bloodhound
│   ├── api-client.js        # All API calls
│   ├── market-context.js    # VIX, SPY, regime
│   └── paper-trades.js      # Paper trade manager
├── bloodhound-scanner.js    # Uses shared/
├── earnings-scanner.js      # Uses shared/
└── config.json              # Shared config
```

### Cross-Scanner Signals (Future Integration)

```javascript
// When both scanners run, combine signals:

// Bloodhound finds: NVDA HIGH_CONVICTION (score 85, at put wall)
// Earnings finds:   NVDA PREM candidate (7 days to earnings, score 72)
// Combined signal:  NVDA SUPER_SIGNAL (earnings + technical confluence)

// This is the real edge - multiple independent systems agreeing
```

### Quick Integration Path

**Phase 1 (MVP):**
- Earnings Scanner imports shared functions from Bloodhound files
- Uses same config.json, same Telegram, same paper trades
- Writes to separate data files (earnings-*.json)

**Phase 2:**
- Extract shared code to `monitor/shared/`
- Both scanners import from shared
- Cleaner separation

**Phase 3:**
- Cross-scanner signal combination
- Unified dashboard showing both
- Single paper trade system with source tags

---

## Integration Points (Additional)

### With Trade Logging:
- Tag trades as earnings-related
- Track performance by strategy type
- Compare earnings trades vs regular trades

---

## Phase 1 Deliverables (MVP)

1. **Earnings Calendar Fetcher**
   - Fetch earnings for watchlist + top 100 market cap
   - Store in `earnings-calendar.json`
   - Run daily to update

2. **Pre-Earnings Scanner (PREM)**
   - Discover stocks 5-10 days from earnings
   - Score using available data (technicals, flow, momentum)
   - Generate signals, paper trades
   - Telegram alerts for score >=70

3. **Basic Dashboard**
   - Calendar view
   - Active signals table
   - Simple analytics

4. **Documentation**
   - EARNINGS_STRATEGIES.md explaining each strategy
   - How to interpret signals
   - Risk management for earnings trades

---

## Phase 2 (After Validation)

- PEAD implementation
- Gap trading alerts
- Stock-specific tuning/learning
- IV crush strategies (options)
- Bloodhound integration

---

## Verification Plan

1. **Manual Testing:**
   - Run earnings fetcher, verify calendar data
   - Check scoring against known earnings movers
   - Verify Telegram alerts fire correctly

2. **Paper Trade Validation:**
   - Track PREM signals for 2 earnings cycles
   - Measure actual win rate vs expected
   - Compare different score thresholds

3. **Dashboard Testing:**
   - All data displays correctly
   - Filters work
   - Auto-refresh functions

---

## Resolved Questions

### 1. Earnings Data Source (FREE ONLY)

**Upcoming Earnings Calendar:**
| Source | Method | Notes |
|--------|--------|-------|
| [Yahoo Finance](https://finance.yahoo.com/calendar/earnings) | Scrape | Best free option, paginated by date |
| [yahoo-earnings-calendar](https://github.com/wenboyu2/yahoo-earnings-calendar) | Python lib | Can port logic to Node.js |
| [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs) | Free API tier | 250 calls/day free |

**Recommendation:** Build Yahoo Finance scraper (Node.js). Most reliable, no rate limits.

### 2. Historical Earnings Data (FREE ONLY)

| Source | Data Available | Notes |
|--------|---------------|-------|
| [Finnhub](https://finnhub.io/docs/api/company-earnings) | EPS actual/estimate, dates | Free tier available |
| [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs/earnings-historical-earnings) | Historical EPS, surprise % | 250 calls/day free |
| [Market Data App](https://www.marketdata.app/docs/api/stocks/earnings) | EPS + surprise % | Has surpriseEPSpct field |

**Recommendation:** Start with FMP free tier for historical. Build local cache to avoid rate limits.

### 3. Position Sizing
**Decision:** 1% risk per trade (same as regular trades, $200 on $20K account)

### 4. Scan Frequency
**Decision:** Hybrid approach

| Mode | When | Behavior |
|------|------|----------|
| **Manual** | Default, off-season | On-demand via `/scan` endpoint or dashboard |
| **Auto** | Earnings season | Enable via `/resume`, runs every 30 min |
| **Pause** | Off-season | Via `/pause`, same as Bloodhound |

**Earnings Season Windows:**
- Q4: Mid-Jan to mid-Feb (current)
- Q1: Mid-Apr to mid-May
- Q2: Mid-Jul to mid-Aug
- Q3: Mid-Oct to mid-Nov

---

## Sources Referenced

- [Post-Earnings Announcement Drift - Quantpedia](https://quantpedia.com/strategies/post-earnings-announcement-effect)
- [Trading Around Earnings: 5 Proven Strategies - TradeFundrr](https://tradefundrr.com/trading-around-earnings-announcements/)
- [IV Crush Guide - MenthorQ](https://menthorq.com/guide/iv-crush-understanding-the-earnings-driven-volatility-spike-and-how-to-capitalize-on-it/)
- [Buyback Blackout Impact - TradeAlgo](https://www.tradealgo.com/news/a-stock-market-buyback-blackout-could-spark-a-decline-as-earnings-season-begin)
- [State Street: Blackout Periods Performance](https://www.ssga.com/library-content/pdfs/etf/us/b27-buyback-blackout-periods-do-not-negatively-impact-performance.pdf)
- [Yahoo Earnings Calendar Scraper](https://github.com/wenboyu2/yahoo-earnings-calendar)
- [Finnhub Company Earnings API](https://finnhub.io/docs/api/company-earnings)
- [Financial Modeling Prep Earnings](https://site.financialmodelingprep.com/developer/docs/earnings-historical-earnings)

---

## Engineering Handoff

### Summary for Engineering AI

Build a **standalone Earnings Season Scanner** that runs independently from Bloodhound but follows similar patterns.

### Key Architecture Decisions

1. **Separate scanner** - Port 8082, own data files, can integrate with Bloodhound later
2. **Free data only** - Scrape Yahoo Finance for calendar, FMP free tier for historical
3. **Stock positions only (Phase 1)** - Avoid IV crush complexity, options in Phase 2
4. **Hybrid scan mode** - Manual default, auto-enable during earnings season
5. **Separate Telegram bot** - Different bot token than Bloodhound (keep alert streams separate)

### Implementation Order (Phase 1 MVP)

```
1. monitor/earnings-calendar-scraper.js
   - Scrape Yahoo Finance earnings calendar
   - Parse dates, times (before/after market)
   - Output: data/earnings-calendar.json
   - Run: Daily cron or on-demand

2. monitor/earnings-scanner.js (main scanner)
   - Load calendar, filter 5-10 days out (PREM candidates)
   - Score using existing APIs (technicals, flow, levels)
   - Generate PREM signals
   - Telegram alerts for score >= 70
   - HTTP control API on port 8082
   - Paper trade creation

3. earnings-scanner.html (dashboard)
   - Calendar view (week ahead)
   - Active signals table
   - Basic analytics

4. docs/EARNINGS_STRATEGIES.md
   - Strategy explanations
   - How to interpret signals
```

### Existing Patterns to Follow

Reference `monitor/bloodhound-scanner.js` for:
- HTTP control API pattern (pause/resume/scan)
- Telegram alert formatting
- Paper trade integration
- Scoring algorithm structure
- JSON output file patterns

### APIs Already Available

```javascript
// Use these - they exist and work
GET http://192.168.10.239:8000/api/technicals/{symbol}  // RSI, trend, momentum
GET http://192.168.10.239:8000/api/levels/{symbol}      // Support/resistance
GET http://192.168.10.239:8000/api/flow/{symbol}        // Options flow
GET http://192.168.10.239:8000/api/options/{symbol}/iv  // IV rank
GET http://192.168.10.239:8000/api/calendar/{symbol}    // Earnings date (single stock)
GET http://192.168.10.239:8000/api/market/context       // VIX, SPY trend
GET http://192.168.10.239:3000/api/x/sentiment/ticker/{symbol}  // Sentiment
```

### What Needs Building (NEW CODE)

1. **Yahoo Finance scraper** - Port Python logic to Node.js, or use cheerio/puppeteer
2. **Historical cache** - Store FMP earnings history locally to avoid rate limits
3. **PREM scoring algorithm** - Confluence scoring specific to pre-earnings setup
4. **Dashboard** - New HTML file, can reuse zone-scanner.html patterns

### What to REUSE (Don't Rebuild!)

```javascript
// IMPORT these from Bloodhound - don't write new versions:
const { sendTelegramAlert } = require('./bloodhound-scanner.js');
const PaperTradeManager = require('./paper-trade-manager.js');
const config = require('./config.json');

// Use same API call patterns from bloodhound-scanner.js lines 380-700
// - fetchMarketContext(), fetchTechnicals(), fetchLevels(), fetchFlow()
```

**KEY PRINCIPLE:** Earnings Scanner is a new brain using Bloodhound's body.
- New: Discovery logic (calendar), scoring algorithm (PREM)
- Reuse: Everything else (alerts, paper trades, API calls, config)

### Critical Files to Reference

| File | Why |
|------|-----|
| `monitor/bloodhound-scanner.js` | Scanner architecture, scoring, alerts |
| `monitor/paper-trade-manager.js` | Paper trade system |
| `zone-scanner.html` | Dashboard patterns |
| `monitor/config.json` | Telegram credentials, API endpoints |
| `data/watchlist.json` | Symbol list to always include |

### Success Criteria

1. Scanner fetches earnings calendar successfully
2. Identifies PREM candidates 5-10 days before earnings
3. Scores using existing APIs
4. Sends Telegram alerts for high-conviction signals
5. Creates paper trades for validation
6. Dashboard displays calendar and signals
7. Pause/resume works as expected

### Timeline Guidance

- Phase 1 MVP: Calendar scraper + PREM scanner + basic dashboard
- Phase 2: PEAD + Gap trading + stock profiles
- Phase 3: Options strategies + Bloodhound integration
