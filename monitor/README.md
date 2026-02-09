# Wingman Monitor

Background service for market alerts and scanner data.

## Quick Start

```bash
# Start all scanners (ONE COMMAND)
pm2 start ecosystem.config.js

# View logs
pm2 logs bloodhound          # Bloodhound scanner
pm2 logs opportunity          # Opportunity scanner
pm2 logs earnings             # Earnings scanner
pm2 logs premarket            # Pre-market scanner
pm2 logs webserver            # Dashboard server
```

## Dynamic Scanner

**No hardcoded watchlist.** Bloodhound dynamically discovers symbols from:
1. **Watchlist** (SQLite `watchlist` table via `signal-db.js`)
2. **Market Data** (`/api/latest`) - 52-week extremes, volume spikes
3. **Sector Rotation** - Strongest/weakest sector ETFs

Then applies zone filter logic and confluence scoring to find tradeable setups.

### Scoring (0-80)
- Technical: up to 25 points (RSI, Bollinger, trend)
- Levels: up to 25 points (gamma walls, VWAP, confluence zones)
- Volume: up to 15 points (volume spikes)
- Context: up to 15 points (SPY alignment, market regime)

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

Manage the watchlist via CLI or API — all backed by SQLite:
```bash
node monitor/watchlist.js list              # Show all symbols
node monitor/watchlist.js add SYMBOL        # Add symbol
node monitor/watchlist.js remove SYMBOL     # Remove symbol

# Or via Bloodhound HTTP API (port 8081):
curl http://localhost:8081/watchlist
curl -X POST http://localhost:8081/watchlist/add -H 'Content-Type: application/json' -d '{"symbol":"AAPL"}'
```

---

## What It Does

### Bloodhound Scanner (Primary)

1. **Discovers symbols** from 3 sources (watchlist, market data, sector rotation)
2. **Scores confluence** across technicals, levels, volume, context (0-80)
3. **Sends Telegram alerts** for tradeable zones (BUY_ZONE, SELL_ZONE, etc.)
4. **Writes to SQLite database** (`data/wingman.db`) and serves via API (`/api/scan/latest`, `/api/scan/summary`)
5. **VIX regime alerts** - Detects regime changes (complacent/normal/elevated/fear/capitulation)
6. **Signal validation** - Logs HIGH_CONVICTION signals with multi-checkpoint tracking (4h, 24h, 7d)

> **Note:** VIX monitoring is consolidated into Bloodhound. The separate `wingman-monitor.js` is deprecated.

## Configuration

Edit `monitor/config.json` for API endpoints and Telegram credentials:

```json
{
  "apis": {
    "intel": "http://192.168.10.60:3000",
    "options": "http://192.168.10.60:8000"
  },
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID"
  }
}
```

Edit `bloodhound-scanner.js` SETTINGS for scan behavior:
- `scanIntervalMs` - Scan frequency (default: 2 min)
- `minConfluenceScore` - Alert threshold (default: 60)
- `maxSymbols` - Max symbols per scan (default: 20)
- `alertCooldownMs` - Per-symbol cooldown (default: 30 min)

## Trade Client

```bash
# Check open trades
node trade-client.js open

# View stats
node trade-client.js stats

# Pre-trade market context
node trade-client.js context SPY
```

## Data Storage

All scanner data is stored in SQLite (`data/wingman.db`):

| Table | Purpose | API |
|-------|---------|-----|
| `bloodhound_scans` | Scan metadata (market context, VIX, counts) | `GET /api/scan/summary` |
| `bloodhound_results` | Individual ticker results with all data | `GET /api/scan/latest` |
| `signals` | HIGH_CONVICTION signal tracking with checkpoints | `GET /api/signals` |

> **Deprecated:** `bloodhound.json`, `dynamic_scan.json`, `scanner.json`, `alerts_log.json` are no longer written. These have been archived in `data/archive/`.

## Telegram Setup

1. Message @BotFather to create bot
2. Get bot token
3. Message your bot, then get chat ID from:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Update credentials in `monitor/config.json`
