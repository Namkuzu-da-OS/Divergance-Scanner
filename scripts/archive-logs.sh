#!/bin/bash
# archive-logs.sh — Copy Wingman PM2 logs to repo and push to GitHub
# Runs hourly via cron

REPO_DIR="/home/bigpic/github/wingman"
LOG_DIR="$REPO_DIR/logs/pm2"
PM2_LOGS="/home/bigpic/.pm2/logs"

mkdir -p "$LOG_DIR"

# Copy only Wingman scanner logs (not other PM2 processes)
for service in bloodhound opportunity earnings premarket eod-tracker webserver; do
    cp "$PM2_LOGS/${service}-out.log" "$LOG_DIR/" 2>/dev/null
    cp "$PM2_LOGS/${service}-error.log" "$LOG_DIR/" 2>/dev/null
done

cd "$REPO_DIR"

# Only commit if there are actual changes
if git diff --quiet logs/pm2/ 2>/dev/null && git diff --cached --quiet logs/pm2/ 2>/dev/null; then
    # Check for new untracked files too
    if [ -z "$(git ls-files --others --exclude-standard logs/pm2/)" ]; then
        exit 0  # Nothing changed
    fi
fi

git add logs/pm2/
git commit -m "Archive PM2 logs — $(date '+%Y-%m-%d %H:%M')"
git push
