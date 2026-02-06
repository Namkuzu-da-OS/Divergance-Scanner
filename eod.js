#!/usr/bin/env node

/**
 * END OF DAY (EOD) AUTOMATION SCRIPT
 *
 * Automates end-of-day tasks:
 * - Archives daily_log.md to archive/daily_logs/trading_log_YYYY-MM-DD.md
 * - Updates account_summary.json timestamp
 * - Creates fresh daily_log.md for next day
 *
 * Usage: node eod.js
 */

const fs = require('fs');
const path = require('path');

// Get today's date in YYYY-MM-DD format
const today = new Date().toISOString().split('T')[0];
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().split('T')[0];
const tomorrowFormatted = tomorrow.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

console.log(`\n🌙 END OF DAY AUTOMATION - ${today}\n`);

try {
  // 1. Archive daily_log.md
  const dailyLogPath = path.join(__dirname, 'data', 'daily_log.md');
  const archivedLogPath = path.join(__dirname, 'archive', 'daily_logs', `trading_log_${today}.md`);

  if (fs.existsSync(dailyLogPath)) {
    const dailyLogContent = fs.readFileSync(dailyLogPath, 'utf8');
    fs.writeFileSync(archivedLogPath, dailyLogContent);
    console.log('✓ Archived daily_log.md to archive/daily_logs/');
  } else {
    console.log('⚠ daily_log.md not found - skipping');
  }

  // 2. Positions are now in SQLite database - no file archiving needed

  // 3. Update account_summary.json timestamp
  const accountSummaryPath = path.join(__dirname, 'data', 'account_summary.json');

  if (fs.existsSync(accountSummaryPath)) {
    const accountSummary = JSON.parse(fs.readFileSync(accountSummaryPath, 'utf8'));
    accountSummary.last_updated = new Date().toISOString();
    fs.writeFileSync(accountSummaryPath, JSON.stringify(accountSummary, null, 2) + '\n');
    console.log('✓ Updated account_summary.json timestamp');
  }

  // 4. ACTIVE_SESSION.md removed - session state lives in MARKET_INTEL.md

  // 5. Create fresh daily_log.md for tomorrow
  const freshLogTemplate = `# Trading Log - ${tomorrowFormatted}

**Session Status:** Fresh
**Account Balance:** [Update from dashboard]
**Risk Available:** $500.00 (daily max loss)

---

## SESSION NOTES (Dashboard Feed)

Add timestamped notes here for real-time dashboard visibility.
Format: \`[HH:MM] [CATEGORY] - Your note text\`
Categories: observation, trade_idea, emotion, lesson

Example:
\`\`\`
[09:45] [OBSERVATION] - SPY breaking above weekly resistance
[10:15] [TRADE_IDEA] - AAPL showing VWAP reversion setup
[14:30] [EMOTION] - Feeling disciplined, passed two FOMO setups
[16:45] [LESSON] - Learned to wait for confirmation candle
\`\`\`

**Live Notes:**

---

## PRE-MARKET PREPARATION (8:30-9:30 AM)

### Market Overview
- **SPY:** [Add after market check]
- **QQQ:** [Add after market check]
- **VIX:** [Add after market check]
- **Market Sentiment:** [Bullish/Bearish/Neutral]

### Key Levels to Watch
- **SPY Support:** [Price level]
- **SPY Resistance:** [Price level]
- **Daily VWAP:** [Calculate at open]
- **Weekly Range:** High [X] - Low [X]

### Watchlist & Potential Setups
1. **[Symbol]** - [Strategy] - [Entry/Stop/Target levels]
2. **[Symbol]** - [Strategy] - [Entry/Stop/Target levels]
3. **[Symbol]** - [Strategy] - [Entry/Stop/Target levels]

---

## MARKET OPEN (9:30 AM - 10:00 AM)

### Opening Action
- **Market Direction:** [Up/Down/Flat]
- **Volume:** [Above/Below average]
- **Volatility:** [High/Medium/Low]

---

## MID-DAY TRADING (10:00 AM - 3:00 PM)

### Trades Executed
- [Document trades here]

---

## END OF DAY SUMMARY

- Total Trades: [Count]
- Daily P&L: $[X.XX]
- Win Rate: [X]%

---

*This log will be archived at end of day.*
`;

  fs.writeFileSync(dailyLogPath, freshLogTemplate);
  console.log('✓ Created fresh daily_log.md for next trading day');

  console.log('\n✅ All EOD tasks completed successfully!\n');
  console.log(`📅 Next trading day: ${tomorrowFormatted}`);
  console.log('🚀 Ready to trade!\n');

} catch (error) {
  console.error('\n❌ Error during EOD automation:');
  console.error(error.message);
  process.exit(1);
}
