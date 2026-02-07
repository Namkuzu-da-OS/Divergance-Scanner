# WINGMAN Quick Reference Card

**Print this out or keep it on your screen while trading**

---

## Morning Routine (8 minutes)

```
□ Open dashboard.html (pin to 2nd monitor)
□ Read WINGMAN_CONTEXT.md (5 min)
□ Check MARKET_INTEL.md (2 min)
□ Load TradingView, set to 5-min chart
□ Load "Divergence + VWAP Reversion v4" indicator
□ Set TradingView alerts
```

---

## VWAP Reversion Scalp Checklist (When You See a Setup)

### Green Light = TRADE READY

```
□ Green highlight visible? (Entry zone active)
□ Divergence lines on chart? (Momentum exhaustion)
□ Table shows "SIGNAL: READY ✓"? (Orange circle)
```

### Pre-Entry (MANDATORY)

```
□ Market hours? (9:30 AM - 4:00 PM ET)
□ Price in entry zone? (1.5-2.5 ATR from VWAP)
□ Divergence detected? (Divergence lines visible)
□ Reversal candle? (Wick rejection OR close reversal)
□ **Higher TF context?** (Daily Open / Weekly Midpoint / etc)
   → STATE THIS OUT LOUD: "Scalp at ______"
```

### Entry Calculation

```
Entry Price:    Where reversal candle closes/rejects
Stop:           Entry - (10-period ATR × 1.5-2.0)
Position Size:  $200 / (Entry - Stop) = # shares
Risk:           Entry - Stop (should be ~$0.30-$0.60)
Target 1:       Return to VWAP (take 50%)
Target 2:       Overbalance past VWAP (runner)
```

### Validate with Wingman

```
"Taking VWAP reversion scalp at [DAILY OPEN].
Entry $X.XX, Stop $X.XX, Target $X.XX
[shares] shares, $200 risk"
```

### Execute

```
□ Place entry limit order
□ Place stop loss (1 ATR below entry)
□ Place target orders (50% at VWAP, 50% runner)
□ Log position via /api/positions
□ Add to daily_log.md with -note
□ Monitor on dashboard
```

---

## Exit Rules (MANDATORY)

```
STOP HIT       → Exit immediately (no questions)
TARGET 1 HIT   → Take 50% profit, trail remaining
TARGET 2 HIT   → Take remaining profit
SETUP INVALID  → Exit (even if no stop hit)
4+ HOURS       → Exit if no progress
TIME-BASED     → Exit per daily plan
```

### Trail Stop Rules

```
After +0.5 ATR profit  → Move stop to breakeven
After +1.0 ATR profit  → Trail at +0.5 ATR
After +1.5 ATR profit  → Trail at +1.0 ATR
```

---

## Position Sizing Formula

```
Position = $200 (max risk) / (Entry Price - Stop Price)

Example:
Entry: $100.00
ATR:   $0.40
Stop:  $100.00 - ($0.40 × 1.5) = $99.40
Risk:  $0.60 per share
Shares: $200 / $0.60 = 333 shares ✓
```

---

## Daily Risk Management

```
Daily Max Loss:      $500 (HARD STOP)
Weekly Max Loss:     $1,000 (HARD STOP)
Max Risk Per Trade:  $200 (1%)
Max Open Positions:  5

Used Today: _____ / $500
Used This Week: _____ / $1,000

When limit hit → STOP TRADING IMMEDIATELY
```

---

## Trade Logging (When Trade Closes)

```json
{
  "trade_id": "SYMBOL_YYYYMMDD_001",
  "symbol": "SPY",
  "strategy": "vwap_reversion",
  "timeframe": "5-min",
  "higher_timeframe_context": "Daily Open",
  "divergence_confirmed_by": ["MACD", "RSI"],
  "divergence_count": 2,
  "vwap_distance_atr": 1.8,
  "entry_price": 450.25,
  "exit_price": 449.75,
  "quantity": 364,
  "realized_pnl": 182,
  "status": "closed"
}
```

---

## Divergence Indicators (Track These)

```
MACD         - Trend & momentum divergence
RSI          - Overbought/oversold divergence
Stochastic   - Momentum confirmation divergence
CCI          - Commodity Channel Index divergence
Momentum     - Price-momentum divergence
OBV          - Volume confirmation divergence
VWMACD       - Volume-weighted trend divergence
CMF          - Money flow divergence
MFI          - Money flow index divergence

After 20 trades: Identify your best combo
(Likely: MACD + RSI = highest win rate)
```

---

## VWAP Entry Zone Guide

```
Price above VWAP (Thinking SHORT):
┌─────────────────────────┐
│ Upper Band (2.5 ATR)    │ ← Too far extended
│ Mid-Upper (1.25 ATR)    │ ← Maybe entry
│ ███ ENTRY ZONE ███      │ ← BEST (1.5-2.5)
│ VWAP                    │ ← Target 1 (reversion)
│ ███ ENTRY ZONE ███      │ ← (below)
│ Lower Band              │ ← Don't enter here
└─────────────────────────┘

Price below VWAP (Thinking LONG):
Same zones, but inverted
```

---

## Higher Timeframe Context Options

```
DAILY Level
□ Daily Open (DO)
□ Previous Day High (PDH)
□ Previous Day Low (PDL)
□ Daily Midpoint
□ Daily Support/Resistance

WEEKLY Level
□ Weekly High (WH)
□ Weekly Low (WL)
□ Weekly Midpoint (WM)
□ Weekly Support/Resistance

MONTHLY Level (Rare but useful)
□ Monthly Open
□ Monthly High/Low
```

**RULE: Always state this before entry!**

---

## Dashboard Quick Check (Every 2 Hours)

```
□ Today's P&L vs $83.33 goal
□ Weekly P&L vs $577.25 goal
□ Daily risk used vs $500 limit
□ Weekly risk used vs $1,000 limit
□ Open positions (should have <5)
□ Session notes (any patterns?)
```

---

## Commands & Quick Actions

```
-note [text]              → Add session note (auto-timestamps)
node eod.js              → End of day automation (archives all)
dashboard.html           → Open real-time monitor
GET /api/positions       → View open trades
data/trades_journal.json → View closed trades
```

---

## TradingView Settings (Copy These)

```
Divergence + VWAP Reversion v4
├── Pivot Period: 5
├── Divergence Type: Regular/Hidden
├── Show Indicator Names: Full
├── Minimum Divergence: 1
├── Maximum Pivot Points: 10
├── Maximum Bars to Check: 100
├── Show Divergence Lines: ✓
├── Show Divergence Number: ✓
│
├── ATR Period: 10 (for scalps)
├── ATR Multiplier (Lower): 1.5
├── ATR Multiplier (Upper): 2.5
├── Highlight Entry Zone: ✓
├── Show VWAP Levels: ✓
│
└── Colors
    ├── VWAP Line: Blue
    ├── Entry Zone: Green (80% transparent)
    ├── Divergence Lines: Yellow/Navy/Green/Red
    └── Signal Alert: Orange circle
```

---

## Success Metrics (Track Weekly)

```
Weekly P&L:     $_______  (goal: +$577.25)
Trades Taken:   ___      (goal: 5-10/week)
Wins:           ___      (goal: >50%)
Best Trade:     $_______
Worst Trade:    $_______
Win Rate:       ____%    (goal: >50%)
Avg Win:        $_______
Avg Loss:       $_______

Best Indicator Combo:  _______________
Best TF Context:       _______________
Best ATR Distance:     _______________
```

---

## End of Day (Before You Leave)

```
□ Run: node eod.js
```

That's it! Automatic:
- Archives daily_log.md
- Updates account_summary.json
- Creates fresh daily_log.md for tomorrow

---

## Common Mistakes to AVOID

```
❌ Trading without higher TF context (ZERO EDGE)
❌ Taking divergence signal without entry zone
❌ Entering without reversal confirmation candle
❌ Sizing position >1% risk ($200)
❌ Moving stops to give "more room"
❌ Staying in losing trade "hoping" to recover
❌ Trading during low volume or news
❌ Overtrading (quality over quantity)
❌ Not following the checklist
❌ Ignoring daily/weekly loss limits
```

---

## Emergency Protocols

```
IF LOSING $100
→ Pause, take a break (15 min)
→ Review that trade decision
→ Don't revenge trade

IF LOSING $300 (60% of daily limit)
→ Cut position size by 50%
→ Slower, more deliberate entries

IF HITTING $500 DAILY LIMIT
→ STOP TRADING FOR THE DAY
→ Do not make one more trade
→ Journal what happened
→ Review with Wingman tomorrow

IF LOSING $1,000 WEEKLY
→ STOP TRADING FOR THE WEEK
→ Full system review
→ Return Monday with reduced risk (0.5%)
```

---

## Your Numbers (Customize)

```
Account Size:         $20,000
Starting Balance:     $20,000
Current Balance:      $_______
YTD P&L:            $_______
Daily Goal:          $83.33
Weekly Goal:         $577.25
Monthly Goal:        $2,500
Max Daily Loss:      $500
Max Weekly Loss:     $1,000
Risk Per Trade:      $200 (1%)
Win Rate Target:     >50%
Min R/R Ratio:       1.5:1
```

---

## References (Keep These Tabs Open)

```
TRADING:
□ TradingView (5-min chart with indicator)
□ dashboard.html (real-time monitor)

RULES:
□ VWAP_Reversion_with_Divergence_Checklist.md
□ TRADING_RULES.md
□ trading_plan.md

DATA:
□ /api/positions (open trades)
□ data/trades_journal.json
□ data/daily_log.md
```

---

## Weekly Review Template

```
Week: _________ (Mon-Fri)

P&L:              $_________ vs $577.25 goal
Trades:           _____ taken, _____ wins
Win Rate:         _____%
Best Trade:       $_________
Worst Trade:      $_________

Best Indicator Combo:   _______________
Best TF Context:        _______________
Hardest Lesson:         _______________

Plan for Next Week:
□ ____________________________________
□ ____________________________________
□ ____________________________________
```

---

**PRINT THIS OUT OR KEEP ON SECOND MONITOR**

**System is LIVE. Ready to trade.**

Last Updated: November 4, 2025
