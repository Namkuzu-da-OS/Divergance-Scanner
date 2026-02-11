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
- [data/MARKET_INTEL.md](../data/MARKET_INTEL.md) - Living market intelligence (regime, watchlist, session state)
- [data/SESSION_STATE.md](../data/SESSION_STATE.md) - Intra-session checkpoint (written by `/checkpoint`, read by `/kungfu`)
- `/api/positions` - Open positions (SQLite-backed, via web server on port 8080)
- `/api/rotation/rankings` - RS rankings from divergence scanner (proxied via port 8080)
- `/api/rotation/regime` - Rotation regime phase from divergence scanner
- [data/account_summary.json](../data/account_summary.json) - Account metrics
- [data/trades_journal.json](../data/trades_journal.json) - Trade history
- [data/daily_log.md](../data/daily_log.md) - Today's journal

**Calculations:**
- [calculations/risk_calculator.json](../calculations/risk_calculator.json) - Position sizing

**Archives:**
- `archive/daily_logs/` - Past sessions
- `archive/trades_archive/` - Closed trades

## Key Rules

1. **Risk Management:** Never exceed 1% risk per trade ($200 max on $20k account)
2. **Documentation:** Update data via APIs when trades happen
3. **Organization:** Keep daily logs, archive at EOD
4. **AI Continuity:** Any new session can read CLAUDE.md → MARKET_INTEL.md → /api/positions to get oriented

## When Creating New Files

- Daily logs → `data/daily_log.md` (archive to `archive/daily_logs/` at EOD)
- Research notes → `research/`
- Always use JSON for data tracking, Markdown for journals
- Timestamp all updates
- Keep file structure consistent

## Full System Load

When user says **"I know Kung Fu"** → Load full Wingman persona via `/kungfu` command.

Otherwise, stay light and reference docs as needed.
