#!/bin/bash
# REVERT SCRIPT — Undo API Gateway deployment
#
# What this does:
#   1. Stops and removes the gateway PM2 process
#   2. Reverts all 6 scanner files + ecosystem.config.js to pre-gateway versions
#   3. Restarts scanners so they use their original fetch functions
#
# Usage:  bash scripts/revert-gateway.sh
#
# The new files (api-gateway.js, api-client.js) are left on disk but unused.

set -e

echo "=== Reverting API Gateway deployment ==="

# Step 1: Stop gateway if running
echo "[1/4] Stopping gateway..."
pm2 stop gateway 2>/dev/null && pm2 delete gateway 2>/dev/null || echo "  (gateway not running, skipping)"

# Step 2: Revert scanner files to their pre-gateway state
echo "[2/4] Reverting scanner files..."
cd "$(dirname "$0")/.."

git checkout HEAD -- \
    monitor/bloodhound-scanner.js \
    monitor/opportunity-scanner.js \
    monitor/earnings-scanner.js \
    monitor/market-internals.js \
    monitor/premarket-scanner.js \
    monitor/earnings-calendar-scraper.js \
    ecosystem.config.js

echo "  Reverted 7 files to last commit"

# Step 3: Restart scanners to pick up reverted code
echo "[3/4] Restarting scanners..."
pm2 restart bloodhound opportunity earnings premarket internals

# Step 4: Verify
echo "[4/4] Verifying..."
sleep 2
pm2 list

echo ""
echo "=== Revert complete ==="
echo "Scanners are back to direct API calls (no gateway)."
echo "api-gateway.js and api-client.js still exist on disk but are unused."
echo "To fully clean up: rm monitor/api-gateway.js monitor/api-client.js"
