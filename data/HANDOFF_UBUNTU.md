# Ubuntu Migration Handoff - January 29, 2026

## Quick Start on Ubuntu

```bash
# 1. Clone/copy project to server
cd /home/user
git clone <repo> wingman
cd wingman

# 2. Install Node.js (v18+ required for better-sqlite3)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install PM2 globally
npm install -g pm2

# 4. Install dependencies
npm install

# 5. Configure API endpoints
nano monitor/config.json
# Update IPs if APIs are on different servers

# 6. Start all scanners (ONE COMMAND)
pm2 start ecosystem.config.js

# 7. Save PM2 config for auto-restart on reboot
pm2 save
pm2 startup
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WINGMAN SYSTEM                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   EXTERNAL APIS (Configure IPs in monitor/config.json)              │
│   ─────────────────────────────────────────────────────             │
│   Port 8000 │ Options API  │ Technicals, Levels, Flow               │
│   Port 3000 │ Intel API    │ Market Data, VIX, Trade Logging        │
│                                                                      │
│   LOCAL SCANNERS (PM2 Managed via ecosystem.config.js)              │
│   ────────────────────────────────────────────────────              │
│   Port 8081 │ Bloodhound   │ Confluence scanner (2 min cycle)       │
│   Port 8083 │ Opportunity  │ Unusual options (5 min cycle)          │
│   Port 8082 │ Earnings     │ PREM scanner (30 min cycle)            │
│   Port 8084 │ Pre-Market   │ Gap scanner (5 min, 6-9:30 AM ET)      │
│   Port 8080 │ Web Server   │ Dashboard server                       │
│                                                                      │
│   DATA STORAGE                                                      │
│   ────────────                                                      │
│   data/wingman.db  │ SQLite - All scanner/signal data    │
│     → bloodhound_scans/results │ API: GET /api/scan/latest          │
│     → opportunities            │ API: GET /api/opportunities/latest │
│     → premarket_scans/movers   │ API: GET /api/premarket            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Status: COMPLETE

### SQLite Database: `data/wingman.db`

**Tables (8 total):**
1. `signals` - Core signal data with market context
2. `checkpoints` - Multi-checkpoint validation snapshots (4h, 24h, 7d)
3. `price_snapshots` - Granular price history
4. `scanner_history` - Day 2/Streak badge tracking
5. `premarket_scans` - Pre-market scan context
6. `premarket_movers` - Pre-market gap movers
7. `scans` - Opportunity scanner scan metadata
8. `opportunities` - Individual opportunity records

**What's Working:**
- Signal logging: Bloodhound → signal-logger → signal-db → SQLite
- Multi-checkpoint validation: 4h, 24h, 7d checkpoints
- Price tracking: Every scan updates peak/trough/gain/drawdown
- 72-hour auto-close: Stale signals closed automatically
- Opportunity history: Full data capture with vol/OI, RSI, gap%, IV

---

## Files to Copy

### Critical Files
```
wingman/
├── ecosystem.config.js          # PM2 startup config (ONE COMMAND START)
├── package.json                 # Dependencies (axios, better-sqlite3)
├── CLAUDE.md                    # AI instructions
│
├── monitor/
│   ├── config.json              # API endpoints, Telegram credentials
│   ├── bloodhound-scanner.js    # Main confluence scanner
│   ├── opportunity-scanner.js   # Unusual options scanner (DYNAMIC DISCOVERY)
│   ├── opportunity-db.js        # SQLite database module
│   ├── earnings-scanner.js      # PREM earnings scanner
│   ├── premarket-scanner.js     # Pre-market gap scanner
│   ├── web-server.js            # Dashboard server
│   ├── signal-db.js             # Signal database module
│   ├── signal-logger.js         # Signal logging wrapper
│   └── paper-trade-manager.js   # Paper trade tracking
│
├── data/
│   ├── wingman.db   # SQLite database (COPY THIS!)
│   ├── watchlist.json           # User watchlist (legacy, backed by SQLite)
│   └── *.json                   # Other data files (most migrated to SQLite)
│
├── docs/
│   ├── VISUAL_WORKFLOWS.md      # 10 ASCII system diagrams
│   ├── SYSTEM_ARCHITECTURE.md   # Technical docs
│   ├── CHANGELOG_2026-01-16.md  # Recent changes
│   └── *.md                     # Other documentation
│
└── *.html                       # Dashboard files
```

---

## Configuration Files

### monitor/config.json
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

**Update IPs if APIs move to different servers.**

### ecosystem.config.js (Already configured)
```javascript
module.exports = {
  apps: [
    { name: 'bloodhound', script: 'monitor/bloodhound-scanner.js' },
    { name: 'opportunity', script: 'monitor/opportunity-scanner.js' },
    { name: 'earnings', script: 'monitor/earnings-scanner.js' },
    { name: 'premarket', script: 'monitor/premarket-scanner.js' },
    { name: 'webserver', script: 'monitor/web-server.js' }
  ]
};
```

---

## PM2 Commands

```bash
# Start all scanners (ONE COMMAND)
pm2 start ecosystem.config.js

# View status
pm2 list

# View logs
pm2 logs                    # All logs
pm2 logs bloodhound         # Specific scanner

# Restart
pm2 restart all
pm2 restart opportunity

# Stop
pm2 stop all

# Auto-start on reboot
pm2 save
pm2 startup                 # Follow instructions it prints
```

---

## Dashboard URLs

```
http://<server-ip>:8080/zone-scanner.html        # Bloodhound (Primary)
http://<server-ip>:8080/opportunity-scanner.html # Unusual options
http://<server-ip>:8080/earnings-scanner.html    # Earnings PREM
http://<server-ip>:8080/premarket.html           # Pre-market gaps
http://<server-ip>:8080/analytics.html           # Signal validation
```

**Firewall:** Open port 8080 if accessing dashboards remotely.

---

## Recent Work (January 2026)

### Opportunity Scanner: Dynamic Discovery
- **Removed** hardcoded 71-symbol list
- **Added** 7 dynamic discovery sources:
  - Core (SPY, QQQ, IWM) - Score 100
  - Watchlist - Score 50
  - Volume Leaders ($SPX) - Score 40
  - Gainers/Losers (2%+ movers) - Score 35
  - NASDAQ Movers ($COMPX) - Score 35
  - 52-Week Extremes - Score 30
- **Result:** Symbols discovered based on market activity, not static list

### SQLite Historical Data
- Every opportunity scan saves to SQLite
- Captures: vol/OI ratio, RSI, gap%, IV rank, unusual activity
- Enables future analysis of what works

### Analysis Results (First Session)
- **Best discovery sources:** gainer/loser (100% HIGH_CONVICTION)
- **Weakest source:** 52wk_extreme (4% HIGH_CONVICTION)
- **Vol/OI correlation:** >50x strongly correlates with HIGH_CONVICTION
- **Top performers:** IBRX, PLTR, SMCI, MU

---

## Verification Commands

```bash
# Check database tables
sqlite3 data/wingman.db ".tables"
# Expected: checkpoints opportunities premarket_movers premarket_scans
#           price_snapshots scanner_history scans signals

# Count opportunity records
sqlite3 data/wingman.db "SELECT COUNT(*) FROM opportunities"

# Check signal database
node -e "const db = require('./monitor/signal-db'); console.log(db.getDatabaseStats())"

# Check opportunity database
node -e "const db = require('./monitor/opportunity-db'); console.log(db.getTierStats(7))"

# Test API connectivity
curl http://192.168.10.60:8000/api/technicals/SPY
curl http://192.168.10.60:3000/api/status
```

---

## Troubleshooting

### Scanner won't start
```bash
pm2 logs opportunity --err --lines 50
lsof -i :8083                    # Check if port in use
pm2 restart opportunity
```

### SQLite errors
```bash
npm list better-sqlite3
npm rebuild better-sqlite3       # Rebuild native module
```

### API connection issues
```bash
curl http://192.168.10.60:8000/api/technicals/SPY
cat monitor/config.json          # Check IPs
```

### Outside market hours
- Opportunity scanner: 8 AM - 4 PM EST only
- Pre-market scanner: 6 AM - 9:30 AM EST only
- Bloodhound: 24/7 but reduced data after hours

---

## Cleanup Tasks (Optional)

### Deprecated JSON files
These files have been migrated to SQLite (`data/wingman.db`) and archived in `data/archive/`:
- `signal_log.json` → SQLite `signals` table
- `scanner_history.json` → SQLite `scanner_history` table
- `signal_tracking.json` → SQLite `signals` table
- `alerts_log.json` → SQLite `signals` table

If archive copies exist and database is verified, these can be safely removed.

### Delete temp files
```bash
rm monitor/tmpclaude-*
rm nul   # Windows artifact
```

---

## Documentation Reference

| File | Purpose |
|------|---------|
| `CLAUDE.md` | AI instructions, full system docs |
| `docs/VISUAL_WORKFLOWS.md` | 10 ASCII diagrams of entire system |
| `docs/SYSTEM_ARCHITECTURE.md` | Technical architecture details |
| `docs/RULES.md` | Trading rules |
| `docs/STRATEGIES.md` | Trading strategies |
| `docs/CHANGELOG_2026-01-16.md` | Recent changes log |

---

## Summary

1. **One command start:** `pm2 start ecosystem.config.js`
2. **5 scanners:** bloodhound, opportunity, earnings, premarket, webserver
3. **SQLite database:** All historical data in `wingman.db`
4. **Dynamic discovery:** No more hardcoded symbol lists
5. **Dashboards:** Access via port 8080
