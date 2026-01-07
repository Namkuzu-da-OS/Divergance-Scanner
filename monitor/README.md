# Wingman Monitor

Background service for market alerts and scanner data.

## Quick Start

```bash
# Main monitor (VIX, walls, signals)
node wingman-monitor.js

# Zone scanner (buy/sell zones per trading rules)
node zone-scanner.js

# Dynamic scanner (sources from social/narrative, then applies zones)
node dynamic-scanner.js
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

## Zone Scanner (NEW)

Scans watchlist for buy/sell zone opportunities. Enforces the rule: **"No mid-range trades"**

### Zone Classifications

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

Edit `../data/watchlist.json`:
```json
{
  "symbols": [
    {"symbol": "SPY", "enabled": true},
    {"symbol": "IBIT", "enabled": true}
  ],
  "settings": {
    "buyZoneThresholdPct": 0.5,
    "rsiOverbought": 75,
    "alertCooldownMinutes": 60
  }
}
```

### Output

Results written to `../data/scan_results.json` every 2 minutes.

---

## What It Does

1. **Polls APIs** every 2 minutes:
   - Port 3000: VIX, sentiment, signals
   - Port 8000: Gamma walls, levels

2. **Sends Telegram Alerts** for:
   - VIX regime changes (15/20/25/35 thresholds)
   - Price near call/put walls (0.15% proximity)
   - Pinned between walls (<0.3% spread)
   - High conviction signals (85%+)

3. **Writes scanner.json** for dashboard

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
  checkIntervalMs: 2 * 60 * 1000,  // 2 minutes
  thresholds: {
    wallProximityPct: 0.15,
    convictionMin: 85
  }
};
```

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
| `../data/scanner.json` | Market state for dashboard |
| `../data/alerts_log.json` | Alert history (last 500) |

## Telegram Setup

1. Message @BotFather to create bot
2. Get bot token
3. Message your bot, then get chat ID from:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Update CONFIG in wingman-monitor.js
