# Wingman Project Vision

## The Bloodhound Scanner

**Core Purpose:** Autonomous opportunity detection system that finds confluence and alerts the trader.

The trader makes all final decisions. Wingman finds where to look.

---

## Philosophy

### Not a Static Watchlist
Traditional scanners watch fixed symbols. Wingman dynamically discovers where the action is based on:
- What's moving (volume, price action)
- What's being talked about (social sentiment, news)
- What has unusual activity (options flow, institutional footprints)
- What's at key levels (gamma walls, support/resistance, VWAP)

### Confluence is Everything
A single signal means nothing. We're looking for multiple factors aligning:
- Technical setup (RSI, patterns, levels)
- Options flow (unusual activity, gamma positioning)
- Sentiment (social buzz, news catalysts)
- Market context (regime, SPY/QQQ direction)

**Example:** A stock at a buy zone means little if SPY is breaking down. Context matters.

### Market Regime Awareness
Individual stocks don't exist in isolation:
- Bullish catalyst on NVDA can be negated by bearish QQQ
- Sector rotation affects everything in that sector
- VIX regime determines position sizing and risk tolerance
- Everything flows from the broad market down

---

## What We Scan For

### Primary Filters
| Filter | Description | Why It Matters |
|--------|-------------|----------------|
| Unusual Options Activity | Large trades, sweeps, unusual OI | Smart money positioning |
| Volume Anomalies | Relative volume spikes | Something is happening |
| Technical Patterns | RSI extremes, doji, breakouts | Price action setups |
| Key Levels | Gamma walls, support/resistance, VWAP | Known decision points |
| Social Sentiment | Twitter/StockTwits buzz, news | Catalyst awareness |
| Gap Analysis | Pre-market gaps, gap fills | Gap-and-go setups |

### Context Filters
| Filter | Description | Why It Matters |
|--------|-------------|----------------|
| SPY/QQQ Direction | Broad market trend | Rising tide lifts/sinks all boats |
| Sector Strength | Relative sector performance | Rotation awareness |
| VIX Regime | Volatility environment | Risk adjustment |
| Gamma Regime | Dealer positioning | Support/resistance dynamics |

---

## How It Works

### The 3AM Scraper
Background process that runs continuously:
1. **Pre-market (3AM+):** Scan for gaps, pre-market movers, overnight news
2. **Market Hours:** Real-time monitoring of all filters
3. **After Hours:** Catch extended hours moves, earnings reactions
4. **Overnight:** Crypto, futures, global markets (future expansion)

### Dynamic Symbol Discovery
Instead of "watch these 10 symbols," we ask:
- What has unusual volume right now?
- What's trending on social media?
- What has options flow conviction?
- What's at a critical technical level?
- What has a catalyst today?

The answer changes constantly. That's the point.

### Confluence Scoring
Each opportunity gets scored on multiple factors:
```
NVDA Score: 78/100
  + At put wall support (gamma)
  + RSI oversold bounce
  + High conviction calls (options)
  - QQQ bearish (context)
  - VIX elevated (risk)
```

Higher scores = more factors aligned = higher probability setup.

### Alert Flow
```
Scanner detects confluence → Telegram alert → Trader reviews chart → Trade decision
```

The system finds. The trader decides.

---

## Alert Types

### High Priority
- **Confluence Alert:** Multiple factors aligned (score > threshold)
- **Regime Change:** VIX crosses key level, market shift
- **Unusual Activity:** Large options sweep, volume spike

### Standard
- **Zone Entry:** Symbol enters buy/sell zone
- **Level Test:** Price at gamma wall, VWAP, key support/resistance
- **Sentiment Spike:** Social buzz increasing

### Informational
- **Market Context:** Morning regime summary
- **Sector Update:** Rotation changes
- **Watchlist Update:** New symbols meeting criteria

---

## Data Sources

### Current (Port 3000 - Intel API)
- ETF data (price, change, 52-week range)
- VIX and regime classification
- Sentiment scores
- AI outlook and signals
- High conviction picks

### Current (Port 8000 - Options API)
- Gamma levels (call wall, put wall, max pain)
- Expected move calculations
- Put/call ratios
- IV/HV metrics

### Future Expansion
- Real-time options flow (sweeps, blocks, unusual)
- Social sentiment feeds (Twitter, StockTwits, Reddit)
- News aggregation with NLP
- Pre-market/after-hours data
- Dark pool prints
- Institutional 13F tracking

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BLOODHOUND SCANNER                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Symbol    │    │   Filter    │    │ Confluence  │     │
│  │  Discovery  │───►│   Engine    │───►│   Scoring   │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  Dynamic    │    │   Market    │    │   Alert     │     │
│  │  Watchlist  │    │   Context   │    │   Engine    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                               │              │
│                                               ▼              │
│                                        ┌─────────────┐      │
│                                        │  Telegram   │      │
│                                        │   Alerts    │      │
│                                        └─────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **Symbol Discovery**
   - Pulls from trending, high conviction, unusual activity sources
   - Builds dynamic watchlist based on current conditions
   - Not limited to static list

2. **Filter Engine**
   - Applies technical filters (RSI, patterns, levels)
   - Applies flow filters (volume, options activity)
   - Applies sentiment filters (social, news)

3. **Market Context**
   - Monitors SPY/QQQ for broad direction
   - Tracks sector rotation
   - Watches VIX regime
   - Understands gamma positioning

4. **Confluence Scoring**
   - Weights each factor
   - Calculates composite score
   - Considers context modifiers (bearish SPY = penalty)

5. **Alert Engine**
   - Prioritizes by score and type
   - Respects cooldowns (no spam)
   - Delivers via Telegram

---

## Current State

### Working
- **Bloodhound Scanner** - Core confluence detection with dynamic discovery
- Zone Scanner (static watchlist backup)
- Wingman Monitor (market alerts, VIX regime, wall proximity)
- Telegram integration
- Confluence scoring (technical + levels + sentiment + volume + context)
- Dynamic symbol discovery (trending, market data, core)
- Market context awareness (SPY/QQQ direction check)
- Pinned detection (trapped between gamma walls)

### Future Enhancements
- Real options flow data (sweeps, unusual activity)
- Pre-market gap scanner
- News catalyst detection
- Intraday momentum detection
- Pattern recognition (doji, engulfing, etc.)

---

## Success Criteria

The system is successful when:
1. **It finds things before I do** - Alerts on setups I would have missed
2. **Context is accurate** - Warns when broad market contradicts individual setup
3. **Signal quality is high** - Most alerts are worth reviewing
4. **It runs autonomously** - I wake up to pre-market alerts, not manual scanning

---

## The Edge

Every trader needs an edge. Ours is:
- **Speed:** Automated scanning beats manual
- **Coverage:** Can watch more than humanly possible
- **Discipline:** System doesn't get emotional, doesn't FOMO
- **Confluence:** Multiple data points, not gut feel
- **Context:** Never trades against the market blindly

The trader brings experience, pattern recognition, and final judgment.
The system brings tireless scanning, data aggregation, and objective alerts.

Together: edge.

---

## Guiding Principles

1. **Find, don't trade** - System alerts, human decides
2. **Context over signals** - A signal without context is noise
3. **Confluence over conviction** - Multiple factors > single strong factor
4. **Dynamic over static** - Follow the action, don't force it
5. **Quality over quantity** - Better to miss setups than spam noise

---

*This document defines what Wingman is building toward. All features should serve this vision.*
