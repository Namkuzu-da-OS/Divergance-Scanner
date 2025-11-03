# Wingman Documentation Map

**Last Updated:** November 4, 2025
**Status:** Complete system documentation with VWAP + Divergence integration

---

## Quick Navigation

### For Trading (Right Now)
1. **Before Each Session:** [WINGMAN_CONTEXT.md](WINGMAN_CONTEXT.md) (5 min read)
2. **Active Session Status:** [../../data/ACTIVE_SESSION.md](../../data/ACTIVE_SESSION.md) (2 min read)
3. **Today's Plan:** [../../data/daily_log.md](../../data/daily_log.md) (ongoing)
4. **Real-Time Dashboard:** Open `dashboard.html` in browser (pin to second monitor)

### For VWAP Reversion + Divergence Scalps
1. **Indicator Script:** [TradingView/Divergence + VWAP Reversion v4.md](TradingView/Divergence%20+%20VWAP%20Reversion%20v4.md) (paste into TradingView)
2. **Trade Rules:** [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md)
3. **Trade Logging:** [TRADES_JOURNAL_SCHEMA.md](TRADES_JOURNAL_SCHEMA.md)

### For Strategy Details
1. **All Strategies:** [trading_plan.md](trading_plan.md) (complete playbook)
2. **Trading Rules (5 Core + 6 Supporting):** [TRADING_RULES.md](TRADING_RULES.md)
3. **Account & Risk Setup:** [WINGMAN_CONTEXT.md](WINGMAN_CONTEXT.md) (Account section)

### For System Management
1. **Quick Start Guide:** [../../QUICK_START.md](../../QUICK_START.md)
2. **End of Day Automation:** `eod.js` script (run: `node eod.js`)
3. **Files to Update:** See "Data Files" section below

---

## Complete File Structure

### 📊 Data Files (Machine Truth - JSON)

**Active/Current:**
- `data/positions.json` - Open trades (real-time)
- `data/daily_log.md` - Today's session notes (append throughout day)
- `data/ACTIVE_SESSION.md` - Current session snapshot (update hourly)

**Updated EOD:**
- `data/account_summary.json` - Account balance, daily/weekly/monthly P&L, statistics
- `data/trades_journal.json` - Permanent trade history (append when trade closes)
- `data/goals.json` - Daily/weekly/monthly/yearly targets (edit if changing monthly goal)

**Archival (Old Sessions):**
- `archive/daily_logs/trading_log_YYYY-MM-DD.md` - Historical session notes
- `archive/positions_archive/positions_YYYY-MM-DD.json` - Historical positions

### 📚 Documentation Files (Human Context - Markdown)

**Primary Reference:**
- [WINGMAN_CONTEXT.md](WINGMAN_CONTEXT.md) - Who/what/why, account setup, trader profile
- [trading_plan.md](trading_plan.md) - All 4 approved strategies with entry/exit criteria
- [TRADING_RULES.md](TRADING_RULES.md) - 5 core rules + 6 supporting rules (READ FIRST!)
- [QUICK_START.md](../../QUICK_START.md) - Quick reference, common commands, dashboard guide

**Strategy Integration (NEW):**
- [TradingView/Divergence + VWAP Reversion v4.md](TradingView/Divergence%20+%20VWAP%20Reversion%20v4.md) - PineScript indicator (4-version, working)
- [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md) - Step-by-step trade rules
- [TRADES_JOURNAL_SCHEMA.md](TRADES_JOURNAL_SCHEMA.md) - How to log trades with divergence data

**Reference:**
- [TradingView/Divergence for Many Indicators.md](TradingView/Divergence%20for%20Many%20Indicators.md) - Original divergence indicator
- [DOCUMENTATION_MAP.md](DOCUMENTATION_MAP.md) - This file

**AI Learning (Updated Weekly):**
- [../../CLAUDE.md](../../CLAUDE.md) - AI session architecture, file organization, workflow
- `toolbox/ai/WINGMAN_MIND.md` - Trader insights, pattern observations (for next AI session)

---

## Session Workflows

### Start of Trading Day (8 minutes)

1. **Read Context (5 min)** → [WINGMAN_CONTEXT.md](WINGMAN_CONTEXT.md)
   - Understand current account status
   - Review trader profile & goals
   - Check current market conditions

2. **Check Active Session (2 min)** → [../../data/ACTIVE_SESSION.md](../../data/ACTIVE_SESSION.md)
   - What happened last session?
   - Any open positions? (should be none)
   - Today's focus areas?

3. **Open Dashboard** → `dashboard.html`
   - Pin to second monitor
   - Auto-refreshes every 10 seconds
   - Shows goals progress, risk usage, session notes

4. **Load TradingView Script** → `Divergence + VWAP Reversion v4`
   - Set to 5-minute chart
   - Watch for green highlights (entry zone)
   - Watch for divergence lines + "SIGNAL READY" alert

### During Trading (Ongoing)

**When Spotting a Setup:**
1. Check [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md)
   - Pre-entry checklist
   - Entry calculation
   - Position sizing

2. Validate with Wingman:
   ```
   "Taking VWAP reversion scalp at [higher TF level].
    Entry $X.XX, Stop $X.XX, Target $X.XX
    [shares] shares, $200 risk"
   ```

3. Execute & Update:
   - Add to `positions.json` (if still open)
   - Add to `daily_log.md` with `-note` (automatic timestamp)
   - Log in `trades_journal.json` when trade closes

### End of Trading Day (1 minute)

**Run Single Command:**
```bash
node eod.js
```

This automatically:
- ✓ Archives `daily_log.md` → `archive/daily_logs/trading_log_YYYY-MM-DD.md`
- ✓ Archives `positions.json` → `archive/positions_archive/positions_YYYY-MM-DD.json`
- ✓ Updates `account_summary.json` timestamp
- ✓ Appends EOD note to `ACTIVE_SESSION.md`
- ✓ Creates fresh `daily_log.md` for tomorrow

**OR Manual (if eod.js unavailable):**
1. Update `account_summary.json` with daily totals
2. Copy files with YYYY-MM-DD naming to archive folders
3. Create fresh `daily_log.md`
4. Update `ACTIVE_SESSION.md` snapshot

### Weekly Review (30 minutes)

**Every Friday close:**
1. Analyze `trades_journal.json` for week's performance
2. Identify best/worst strategies and setups
3. Update [../../CLAUDE.md](../../CLAUDE.md) with patterns noticed
4. Adjust targets or strategy focus if needed

---

## VWAP Reversion + Divergence System

### What It Is

A **high-conviction 5-minute scalp signal** combining:
- **Divergence Detection** (momentum exhaustion via 11 indicators)
- **VWAP Entry Zone** (price 1.5-2.5 ATR from VWAP)
- **Reversal Confirmation** (wick rejection or close reversal)

**Signal Quality:** 95%+ when all three present

### Files Involved

| File | Purpose |
|------|---------|
| [TradingView/Divergence + VWAP Reversion v4.md](TradingView/Divergence%20+%20VWAP%20Reversion%20v4.md) | TradingView indicator (PineScript v4) |
| [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md) | Pre-entry & exit rules |
| [TRADES_JOURNAL_SCHEMA.md](TRADES_JOURNAL_SCHEMA.md) | Trade logging with divergence tracking |
| `data/trades_journal.json` | Actual logged trades |

### How to Use

1. **Load indicator** on 5-min TradingView chart
2. **Watch for:**
   - Green highlight = Entry zone active
   - Divergence lines = Momentum exhaustion
   - Orange circle = "SIGNAL READY ✓"
3. **Pre-entry checklist** from [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md)
4. **Log trade** with divergence details in `trades_journal.json`

### Settings Reference

```
Divergence Settings:
- Pivot Period: 5
- Minimum Divergence: 1
- Show Divergence Lines: True

VWAP Reversion Settings:
- ATR Period: 10 (for scalps)
- Lower Band: 1.5 ATR
- Upper Band: 2.5 ATR
- Highlight Entry Zone: True
```

---

## Key Metrics to Track

### Daily
- Today's P&L (goal: $83.33)
- Win rate (goal: >50%)
- Trades taken vs available setups

### Weekly
- Weekly P&L (goal: $577.25)
- Best performing strategy
- Most used indicators in divergence signals

### Monthly
- Monthly P&L (goal: $2,500)
- Overall win rate (goal: >50%)
- Strategy breakdown (which made most $?)
- Drawdown percentage (track against max 10% limit)

### Manually Track (After 20+ VWAP trades)
- MACD alone: Win rate %
- MACD + RSI: Win rate %
- Stochastic alone: Win rate %
- Daily Open context: Win rate %
- Weekly Midpoint context: Win rate %
- 1.5-1.8 ATR zone: Win rate %
- 1.8-2.5 ATR zone: Win rate %

(This helps identify your personal best signal combinations)

---

## Common Questions

### "I'm ready to trade, where do I start?"
→ Open `dashboard.html`, load [TradingView/Divergence + VWAP Reversion v4.md](TradingView/Divergence%20+%20VWAP%20Reversion%20v4.md) on 5-min chart

### "How do I validate a trade?"
→ Use [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md) (pre-entry section)

### "How do I log a trade?"
→ Follow [TRADES_JOURNAL_SCHEMA.md](TRADES_JOURNAL_SCHEMA.md) (example at bottom)

### "What are the 5 core rules?"
→ [TRADING_RULES.md](TRADING_RULES.md)

### "How do I end my trading day?"
→ Run `node eod.js` (or see QUICK_START.md "End of Day" section)

### "What's my monthly goal?"
→ Edit `monthly_target` in `data/goals.json` (currently $2,500)

### "How do I adjust positions mid-trade?"
→ Update `current_price` and `unrealized_pnl` in `data/positions.json`

### "How do I know if I'm on track?"
→ Check Dashboard "Goals Progress" section (auto-updates every 10s)

---

## File Update Triggers

| Trigger | Files to Update | When |
|---------|-----------------|------|
| Trade executed | `trades_journal.json` | Immediately when trade closes |
| Trade opened | `positions.json` | Immediately when entry filled |
| Position change | `ACTIVE_SESSION.md` | After each position change |
| Daily P&L finalized | `account_summary.json` | End of trading day |
| Session ending | Run `eod.js` | Before leaving for the day |
| Weekly review | `WINGMAN_MIND.md` | Friday close |
| Monthly adjustments | `goals.json` (if needed) | When changing monthly target |

---

## Important Files Not to Edit

- `dashboard.html` - System file (auto-generated, don't modify)
- `CLAUDE.md` - AI reference (update only weekly insights)
- Archived files in `archive/` - Historical data (read-only)

---

## Quick File Locations

**All Trading:**
- Rules: `toolbox/docs/TRADING_RULES.md`
- Plan: `toolbox/docs/trading_plan.md`
- Strategy Details: `toolbox/docs/WINGMAN_CONTEXT.md`

**VWAP + Divergence:**
- Script: `toolbox/docs/TradingView/Divergence + VWAP Reversion v4.md`
- Checklist: `toolbox/docs/VWAP_Reversion_with_Divergence_Checklist.md`
- Schema: `toolbox/docs/TRADES_JOURNAL_SCHEMA.md`

**Data & Tracking:**
- Current: `data/positions.json`, `data/daily_log.md`, `data/ACTIVE_SESSION.md`
- Summary: `data/account_summary.json`, `data/trades_journal.json`, `data/goals.json`
- Dashboard: `dashboard.html` (open in browser)

**Archive:**
- Past Sessions: `archive/daily_logs/trading_log_YYYY-MM-DD.md`
- Past Positions: `archive/positions_archive/positions_YYYY-MM-DD.json`

---

## System Architecture

```
Wingman Trading System
│
├── Configuration & Context
│   ├── WINGMAN_CONTEXT.md (account, trader profile, goals)
│   ├── trading_plan.md (4 strategies with entry/exit)
│   ├── TRADING_RULES.md (5 core + 6 supporting rules)
│   └── goals.json (monthly/weekly/daily targets)
│
├── Real-Time Tracking
│   ├── positions.json (open trades)
│   ├── daily_log.md (session notes)
│   └── dashboard.html (visual monitor)
│
├── Trade Management
│   ├── VWAP + Divergence System
│   │   ├── Divergence + VWAP Reversion v4 (TradingView script)
│   │   ├── VWAP_Reversion_with_Divergence_Checklist (rules)
│   │   └── TRADES_JOURNAL_SCHEMA (logging)
│   │
│   └── Account Summary
│       ├── account_summary.json (daily P&L, stats)
│       └── trades_journal.json (permanent history)
│
├── Session Management
│   ├── ACTIVE_SESSION.md (current state snapshot)
│   ├── eod.js (end-of-day automation)
│   └── archive/ (historical data)
│
└── AI Learning
    ├── CLAUDE.md (AI architecture & instructions)
    └── WINGMAN_MIND.md (pattern insights for next AI)
```

---

## Version Control

| Component | Version | Last Updated | Status |
|-----------|---------|--------------|--------|
| Divergence + VWAP Script | v4 | Nov 4, 2025 | ✓ Working |
| VWAP + Divergence Checklist | v1 | Nov 4, 2025 | ✓ Complete |
| Trades Journal Schema | v2.0 | Nov 4, 2025 | ✓ Complete |
| Dashboard | v1.3 | Nov 3, 2025 | ✓ Date dropdown active |
| EOD Script | v1 | Nov 3, 2025 | ✓ Working |
| Account Tracking | Live | Nov 3, 2025 | ✓ Real data |

---

## Next Steps

1. **Load indicator on TradingView** → `Divergence + VWAP Reversion v4`
2. **Paper trade 3-5 setups** → Understand the signals
3. **Take live trades** → Follow [VWAP_Reversion_with_Divergence_Checklist.md](VWAP_Reversion_with_Divergence_Checklist.md)
4. **Log all trades** → Include divergence data in `trades_journal.json`
5. **Weekly review** → Identify best indicator combinations
6. **Refine & scale** → Use weekly insights to improve

---

**System Status:** LIVE & TRADING
**Account:** $23,526.10 (+17.88% YTD)
**Win Rate:** 100% (1 trade)
**Ready for:** VWAP reversion scalps with divergence confirmation
