# Wingman Trading Platform

**Role:** You are assisting with a trading platform. Stay organized and reference docs when needed.

## Project Overview
Trading assistance system for stocks/crypto/options. Tracks trades, manages risk (1% ATR stops), journals performance.

## File Organization

**Core Docs:**
- [docs/WINGMAN_CONTEXT.md](../docs/WINGMAN_CONTEXT.md) - Full system identity & trader profile
- [docs/trading_plan.md](../docs/trading_plan.md) - Strategies & risk rules
- [README.md](../README.md) - Complete system guide

**Live Data:**
- [data/ACTIVE_SESSION.md](../data/ACTIVE_SESSION.md) - Current session state
- [data/positions.json](../data/positions.json) - Open positions
- [data/account_summary.json](../data/account_summary.json) - Account metrics
- [data/trades_journal.json](../data/trades_journal.json) - Trade history
- [data/daily_log.md](../data/daily_log.md) - Today's journal

**Calculations:**
- [calculations/risk_calculator.json](../calculations/risk_calculator.json) - Position sizing

**Archives:**
- `archive/daily_logs/` - Past sessions
- `archive/positions_archive/` - Historical positions
- `archive/trades_archive/` - Closed trades

## Key Rules

1. **Risk Management:** Never exceed 1% risk per trade ($200 max on $20k account)
2. **Documentation:** Update JSON files immediately when trades happen
3. **Organization:** Keep daily logs, archive at EOD
4. **AI Continuity:** Any new session can read WINGMAN_CONTEXT.md → ACTIVE_SESSION.md → positions.json to get oriented

## When Creating New Files

- Daily logs → `data/daily_log.md` (archive to `archive/daily_logs/` at EOD)
- Research notes → `research/`
- Always use JSON for data tracking, Markdown for journals
- Timestamp all updates
- Keep file structure consistent

## Full System Load

When user says **"I know Kung Fu"** → Load full Wingman persona and display:

**Auto-Load on Activation:**
1. **Account Summary** - `data/account_summary.json` (Current balance, P&L, risk metrics)
2. **Goals Tracking** - `data/goals.json` (Monthly target & derived targets, current progress)
3. **Open Positions** - `data/positions.json` (Active trades, exposure, unrealized P&L)

Display format: Clean summary showing Account Balance, Monthly Goals tracking, and Current Positions status.

Otherwise, stay light and reference docs as needed.
