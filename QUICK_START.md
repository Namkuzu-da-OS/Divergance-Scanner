# Wingman Quick Start Guide

## The System at a Glance

**You have a fully integrated self-reflecting trading system with:**

1. **Real-Time Dashboard** → Open `dashboard.html` in browser
2. **Goal Tracker** → Monitor daily/weekly/monthly/yearly progress
3. **Session Notes** → Quick journaling visible on dashboard
4. **Position Tracking** → All open trades with P&L
5. **Risk Management** → Visual daily/weekly loss limits

---

## Before Trading

1. **Open Dashboard**
   - File: `dashboard.html`
   - Pin on second monitor
   - Auto-refreshes every 10 seconds

2. **Read Current Context**
   - `docs/WINGMAN_CONTEXT.md` (who/what/why)
   - `data/MARKET_INTEL.md` (what's happening now)
   - Takes ~8 minutes total

3. **Check Risk Limits** (Hard Stops - Non-Negotiable)
   - Daily Max Loss: $500 → STOP trading for rest of day if hit
   - Weekly Max Loss: $1,000 → STOP trading for rest of week if hit
   - Per Trade Max Risk: $200 (1% of $20k account)

---

## During Trading

### Wingman Commands

- `-note [text]` → Add a journal entry (timestamps automatically)
  - Example: `-note SPY rejected at resistance 3x`
  - Automatically timestamps and saves to dashboard
  - Visible in "Session Notes" within 10 seconds

### Execute a Trade (VWAP Reversion + Divergence - PRIMARY METHOD)

**This is your main 5-min scalp system. Load the indicator and follow the checklist.**

**Setup (One-Time):**
1. Load script: `toolbox/docs/TradingView/Divergence + VWAP Reversion v4.md`
2. Paste into TradingView → 5-min chart
3. Read: `toolbox/docs/VWAP_Reversion_with_Divergence_Checklist.md`

**Trading (Each Setup):**
1. **Watch for Signal** (TradingView chart)
   - Green highlight = Price in entry zone (1.5-2.5 ATR from VWAP)
   - Divergence lines = Momentum exhaustion (11 indicators)
   - Orange circle = "SIGNAL READY ✓"

2. **Pre-Entry Checklist** (from checklist doc)
   - [ ] Market hours? (9:30 AM - 4:00 PM ET)
   - [ ] Price in entry zone? (green highlight)
   - [ ] Divergence detected? (chart shows lines)
   - [ ] Reversal candle present? (wick rejection or close reversal)
   - [ ] **Higher TF context?** (Daily Open? Weekly Midpoint?) ← MUST STATE THIS

3. **Calculate Entry**
   - Entry: Where reversal candle rejects (wick or close)
   - Stop: Entry - (10-period ATR × 1.5-2.0)
   - Position: $200 / (Entry - Stop) = shares
   - Target 1: Return to VWAP (take 50% profit)
   - Target 2: Overbalance past VWAP (runner with trail)

4. **Validate with Wingman**
   ```
   "Taking VWAP reversion scalp at [DAILY OPEN/WEEKLY MIDPOINT/etc].
    Entry $X.XX, Stop $X.XX, Target $X.XX (half) / $X.XX (runner)
    [shares] shares, $200 risk"
   ```

5. **Execute & Log**
   - Place entry + stop + target orders
   - Log via `POST /api/positions` (if still open)
   - Log to `data/trades_journal.json` when closed
   - Include: `divergence_confirmed_by: ["MACD", "RSI"]` (which indicators?)

### Execute a Trade (Manual - If No Divergence Signal)

**Step 1: Identify Trade Type**
- **SCALP** (5min-6hrs): Quick entry on 1/5/15-min chart - use 10-period ATR
- **SWING** (days-3mo): Multi-day entry on 4hr/Daily/Weekly - use 20-25 period Daily ATR

**Step 2: For SCALPS - Verify Higher Timeframe Context (MANDATORY)**
- What daily/weekly level am I near? (Daily Open, Weekly High/Low, Weekly Midpoint, etc.)
- CRITICAL: Scalps without higher TF context have ZERO EDGE
- Always state the context before entry

**Step 3: Identify Strategy**
- Weekly Range Plays
- VWAP Reversions (with divergence confirmation - preferred)
- MA Reversions
- Mid-Point Range Trades

**Step 4: Calculate Position Size**
- Risk: $200 max (1% rule)
- For SCALPS: 10-period ATR on execution timeframe (e.g., 5-min chart)
  - Stop: Entry - (10-period ATR × 1.5-2.0)
  - Tighter stops, more shares
- For SWINGS: 20-25 period ATR on Daily chart
  - Stop: Entry - (20-25 Daily ATR × 1.5-2.0)
  - Wider stops, fewer shares
- Formula: Position = $200 / (Entry - Stop)

**Step 5: Validate with Wingman** (me)
- Trade type (Scalp/Swing)? ✓
- Higher TF context (if scalp)? ✓
- Strategy match? ✓
- Position size within 1% risk? ✓
- R/R acceptable (min 1.5:1)? ✓

**Step 6: Take the Trade**
- Log position via `/api/positions`
- Monitor on dashboard

### Add a Note (Quick Journaling)

Simply type `-note` followed by anything you want to log:
- `-note SPY rejected resistance 3x`
- `-note AAPL showing VWAP setup`
- `-note Feeling disciplined today`
- `-note Good scalp at daily open`

**I'll timestamp and save it** → Appears on dashboard in "Session Notes" within 10 seconds

---

## Scalp vs Swing Quick Reference

### SCALP Trade Checklist
```
Trade Type: SCALP (5min - 6hrs, rarely overnight)
Timeframe: 1-min, 5-min, or 15-min chart
ATR: 10-period on your execution timeframe
Stop: Entry - (10-period ATR × 1.5-2.0)
Target: 127% Fibonacci extension (primary), partial profits at 50%/61.8%
CRITICAL: What higher TF level am I near?
  ✓ Daily Open (DO)?
  ✓ Daily High/Low (PDH/PDL)?
  ✓ Weekly High/Low (WH/WL)?
  ✓ Weekly Midpoint (WM)?
Risk: $200 max = typically 200-500 shares
Position Size: $200 / (Entry - Stop)
```

### SWING Trade Checklist
```
Trade Type: SWING (2 days - 3 months)
Timeframe: 4-hour, Daily, or Weekly chart
ATR: 20-25 period on DAILY chart (always)
Stop: Entry - (20-25 Daily ATR × 1.5-2.0)
Target: Multiple Fibonacci targets (50%, 61.8%, 127%)
Risk: $200 max = typically 20-100 shares
Position Size: $200 / (Entry - Stop)
```

---

## After Each Trade

1. Update `data/trades_journal.json` (when trade closes)
2. Close position via `PATCH /api/positions/close`
3. Dashboard automatically reflects changes

---

## End of Day (Before Leaving)

**Quick Way (Recommended):**
```
node eod.js
```
This single command handles everything:
- Archives daily_log.md to `archive/daily_logs/trading_log_YYYY-MM-DD.md`
- Updates account_summary.json timestamp
- Creates fresh daily_log.md for tomorrow

**Alternative (Manual):**
1. Update account_summary.json (daily_pnl, weekly_pnl, stats)
2. Copy files with YYYY-MM-DD naming to archive folders
3. Create fresh daily_log.md for next session
4. Update MARKET_INTEL.md with session recap

---

## Dashboard Sections Explained

### Account Cards (Top)
- **Account Balance:** Starting $20,000 + all P&L
- **Today's P&L / Weekly P&L:** Cumulative returns
- **Open Positions:** How many trades running
- **Unrealized P&L:** Current position gains/losses

### Risk Cards
- **Daily Risk Used:** $0 / $500 (visual bar)
- **Weekly Risk Used:** $0 / $1,000 (visual bar)
- **Position Slots:** 5 max open trades
- **Unrealized P&L:** Total unrealized gains/losses

### Goals Section (Key Feature!)
Shows real-time progress:
- **Daily Goal:** $0 / $83.33
- **Weekly Goal:** $0 / $577.25
- **Monthly Goal:** $0 / $2,500
- **Yearly Goal:** $0 / $30,000

Color bars: Green (on track) → Yellow (caution) → Red (behind)

### Open Positions
Each position shows:
- Symbol, entry price, stop, target, current P&L

### Session Notes (Collapsible)
- Expands to show all timestamped notes
- Newest first
- Categorized by type

---

## File Reference

### Your Primary Trading System (VWAP + Divergence)
These files enable your main 5-min scalp strategy:
- `toolbox/docs/TradingView/Divergence + VWAP Reversion v4.md` - TradingView script (copy to TradingView)
- `toolbox/docs/VWAP_Reversion_with_Divergence_Checklist.md` - Pre-entry & exit rules
- `toolbox/docs/TRADES_JOURNAL_SCHEMA.md` - How to log trades with divergence data

### Read These Files FIRST (Session Start)
- `toolbox/docs/WINGMAN_CONTEXT.md` - Core strategy understanding, trading styles, account limits
- `toolbox/docs/TRADING_RULES.md` - The five immutable rules (CRITICAL)
- `toolbox/docs/trading_plan.md` - Entry/exit criteria for each strategy, ATR settings
- `data/MARKET_INTEL.md` - Market intelligence, session state, open positions

### Reference During Trading
- `GET /api/positions` - Real-time open trades (SQLite)
- `data/daily_log.md` - Session notes and observations
- `dashboard.html` - Real-time dashboard (open in browser, pin to 2nd monitor)
- TradingView 5-min chart with `Divergence + VWAP Reversion v4` loaded

### Update These Files
- `/api/positions` - When you open/close trades (via API)
- `data/trades_journal.json` - When trades close (permanent record, include divergence details)
- `data/account_summary.json` - EOD (daily P&L, stats)
- `data/daily_log.md` - Session notes (via `-note` command)

### Optional (Weekly)
- `toolbox/ai/WINGMAN_MIND.md` - After trading sessions (pattern insights for next AI session)

### Don't Edit
- `CLAUDE.md` - AI reference only
- `dashboard.html` - System file, don't modify
- `toolbox/docs/DOCUMENTATION_MAP.md` - Reference only

---

## The 4-Hour Check

Every 4 hours, take 10 minutes to:

1. **Check Dashboard** - Are goals on track?
2. **Review Discipline** - Followed all rules?
3. **Note Anything** - Any patterns or lessons?
4. **Adjust if Needed** - Reset mindset for next session

---

## Common Commands / Actions

### "I want to log a quick note"
→ Type: `-note observation: [your note]`
→ I'll save it automatically

### "End of day - wrap everything up"
→ Run: `node eod.js`
→ Automatically archives: daily_log.md
→ Updates: account_summary.json
→ Creates: fresh daily_log.md for tomorrow
→ Completes in <1 second

### "What's my goal progress?"
→ Check dashboard "Goals Progress" section
→ All four timeframes displayed with % bars

### "How much risk have I used today?"
→ Dashboard shows "Daily Risk Used" card
→ Red line at $500 (hard stop)

### "Is this trade valid?"
→ Tell me entry, stop, target, position size
→ I'll validate against rules

### "I'm hitting daily loss limit"
→ STOP immediately
→ Don't trade rest of day
→ I'll alert if approaching limit

---

## Remember

**This system has three superpowers:**

1. **Real-Time Goals** → You see progress toward $2,500/month constantly
2. **Instant Journaling** → Notes appear on dashboard as you trade (emotions, observations, lessons)
3. **Risk Transparency** → Every metric visible (positions, P&L, risk usage)

All three feed into ONE thing: **Self-reflection**

At the end of each day, you can see:
- How much you made/lost (goals section)
- What you were thinking (session notes)
- How well you managed risk (risk cards)

Use all three to improve day by day.

---

**Trading Date:** November 3, 2025
**System Status:** LIVE & TRADING
**Account Balance:** $23,526.10 (+$3,576.57 YTD)
**Daily Risk Budget:** $500 remaining
**Win Rate:** 100% (1 win, 0 losses)

**Let's trade with discipline.**
