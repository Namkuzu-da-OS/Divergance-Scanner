# Wingman Monitor Setup

## Step 1: Get Your Telegram Bot Token

1. **Open Telegram** and search for `@BotFather`

2. **Start a chat** with BotFather and send:
   ```
   /newbot
   ```

3. **Follow the prompts:**
   - Enter a name for your bot (e.g., "Wingman Alerts")
   - Enter a username (must end in `bot`, e.g., `wingman_trading_bot`)

4. **Copy the token** BotFather gives you. It looks like:
   ```
   7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

---

## Step 2: Get Your Chat ID

1. **Start a chat with your new bot** - search for the username you created and click "Start"

2. **Send any message** to your bot (just say "hello")

3. **Get your chat ID** by opening this URL in your browser (replace TOKEN with your bot token):
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```

4. **Find the chat ID** in the response:
   ```json
   {
     "result": [{
       "message": {
         "chat": {
           "id": 123456789,  <-- THIS IS YOUR CHAT ID
           "first_name": "Your Name",
           "type": "private"
         }
       }
     }]
   }
   ```

---

## Step 3: Configure the Monitor

### Option A: Edit config.json directly

Open `monitor/config.json` and update the credentials:

```json
{
  "apis": {
    "intel": "http://192.168.10.60:3000",
    "options": "http://192.168.10.60:8000"
  },
  "telegram": {
    "botToken": "7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "chatId": "123456789"
  }
}
```

### Option B: Use environment variables (recommended for security)

```bash
export TELEGRAM_BOT_TOKEN="7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TELEGRAM_CHAT_ID="123456789"
```

---

## Step 4: Run the Monitor

### Test it first:
```bash
# Start all scanners with PM2
pm2 start ecosystem.config.js

# Check they're running
pm2 list
```

You should see all 5 processes (bloodhound, opportunity, earnings, premarket, webserver) with status "online".

Check Bloodhound logs:
```bash
pm2 logs bloodhound --lines 20
```

You should see scan cycles running and receive a Telegram startup message.

---

## Step 5: Run as Background Service

### Recommended: PM2 (all platforms)

```bash
# Install PM2 globally
npm install -g pm2

# Start all scanners
pm2 start ecosystem.config.js

# Save config and enable auto-restart on reboot
pm2 save
pm2 startup    # Follow the instructions it prints
```

### Alternative: systemd (Linux)

Create `/etc/systemd/system/wingman.service`:
```ini
[Unit]
Description=Wingman Trading System
After=network.target

[Service]
Type=forking
User=your-username
WorkingDirectory=/path/to/wingman
ExecStart=/usr/bin/pm2 start ecosystem.config.js
ExecReload=/usr/bin/pm2 restart all
ExecStop=/usr/bin/pm2 stop all
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable wingman
sudo systemctl start wingman
```

---

## Alert Types

| Alert | Trigger | Priority |
|-------|---------|----------|
| VIX Regime Change | VIX crosses 15/20/25/35 | HIGH |
| Call Wall | Price within 0.15% of call wall | HIGH |
| Put Wall | Price within 0.15% of put wall | HIGH |
| Gamma Flip | Price crosses gamma flip level | MEDIUM |
| High Conviction | Sequencer signal >85% conviction | HIGH |

---

## Customizing Alerts

Edit SETTINGS in `bloodhound-scanner.js`:

```javascript
thresholds: {
  wallProximityPct: 0.15,      // How close to wall to alert (%)
  vixLevels: [15, 20, 25, 35], // VIX threshold levels
  convictionMin: 85,            // Min conviction for signals
  sectorRotationPct: 2.0        // Sector move threshold
}
```

---

## Troubleshooting

**"Failed to send Telegram message"**
- Check your bot token is correct
- Make sure you've started a chat with your bot
- Verify chat ID is correct

**"Failed to get market data"**
- Check APIs are running: `curl http://192.168.10.60:3000/health`
- Verify network connectivity

**No alerts received**
- Monitor initializes without alerting on first run
- Wait for actual market conditions to trigger alerts
- Or manually test by adjusting thresholds temporarily
