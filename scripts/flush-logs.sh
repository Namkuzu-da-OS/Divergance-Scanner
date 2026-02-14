#!/bin/bash
# flush-logs.sh — Flush PM2 logs after they've been archived to GitHub
# Runs weekly via cron (Sunday midnight)

# Archive first, just in case
/home/bigpic/github/wingman/scripts/archive-logs.sh

# Then flush
for service in bloodhound opportunity earnings premarket eod-tracker webserver internals; do
    pm2 flush "$service" 2>/dev/null
done

echo "[$(date '+%Y-%m-%d %H:%M')] PM2 logs flushed for Wingman services"
