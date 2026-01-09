# Wingman Monitor

Background service for market alerts and scanner data.

## Quick Start

```bash
# Bloodhound scanner (primary) - run via PM2
pm2 start bloodhound-scanner.js --name bloodhound
pm2 logs bloodhound

# VIX monitor (regime changes only)
pm2 start wingman-monitor.js --name monitor
pm2 logs monitor
```

## Dynamic Scanner (NEW)

**No hardcoded watchlist.** Sources candidates from:
1. **Author Consensus** - Tickers where 3+ authors agree on direction
2. **High Conviction Signals** - From the sequencer endpoint
3. **Trending Tickers** - What's hot on X/Twitter
4. **AI Outlook Themes** - Symbols mentioned in market narrative

Then applies zone filter logic to find tradeable setups.

### How It Works
```
[Author Consensus] ──┬──► [Deduplicate] ──► [Score & Rank] ──► [Zone Filter] ──► [Alert]
[High Conviction]  ──┤                      (by source count)   (BUY/SELL only)
[Trending on X]    ──┤
[AI Outlook]       ──┘
```

### Scoring
- Core symbols (SPY, QQQ): 100 points (always included)
- Author consensus: +40 points
- High conviction signals: +30 points
- Trending on X: +20 points
- AI outlook themes: +10 points

Higher score = scanned first, shown first in results.

## Zone Classifications

Bloodhound applies these zones to determine tradeability:

| Zone | Meaning | Tradeable? |
|------|---------|------------|
| BUY_ZONE | At put wall, RSI not overbought | YES |
| SELL_ZONE | At call wall, RSI not oversold | YES |
| MID_RANGE | Between walls | NO |
| OVERBOUGHT | RSI > 75 | NO |
| OVERSOLD | RSI < 30 | WATCH |
| EXTENDED_HIGH | Above call wall | WATCH |
| EXTENDED_LOW | Below put wall | WATCH |

### Watchlist

Edit `../data/watchlist.json` - symbols here are always included in Bloodhound scans:
```json
{
  "symbols": [
    {"symbol": "SPY", "enabled": true},
    {"symbol": "IBIT", "enabled": true}
  ]
}
```

---

## What It Does

### Bloodhound Scanner (Primary)

1. **Discovers symbols** from 6 sources (trending, consensus, watchlist, etc.)
2. **Scores confluence** across technicals, levels, sentiment, volume, context
3. **Sends Telegram alerts** for tradeable zones (BUY_ZONE, SELL_ZONE, etc.)
4. **Writes scanner.json** and **dynamic_scan.json** for dashboard

### VIX Monitor (Secondary)

1. **Polls VIX** every 2 minutes
2. **Checks Bloodhound pause state** before alerting (unified control)
3. **Sends Telegram alerts** for VIX regime changes ONLY:
   - low (<15) → normal → elevated → high → extreme
4. Does NOT send wall/signal alerts (Bloodhound handles those)

## Configuration

Edit `wingman-monitor.js`:

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
  checkIntervalMs: 2 * 60 * 1000  // 2 minutes
};
```

**Note:** Wall proximity and conviction thresholds removed - Bloodhound handles those alerts now.

## Trade Client

```bash
# Check open trades
node trade-client.js open

# View stats
node trade-client.js stats

# Pre-trade market context
node trade-client.js context SPY
```

## Files Written

| File | Purpose |
|------|---------|
| `../data/bloodhound.json` | Bloodhound scan results |
| `../data/dynamic_scan.json` | Full technical data for Zone Scanner dashboard |
| `../data/scanner.json` | Market state for dashboard |
| `../data/alerts_log.json` | Alert history (last 500) |

## Telegram Setup

1. Message @BotFather to create bot
2. Get bot token
3. Message your bot, then get chat ID from:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Update CONFIG in wingman-monitor.js
