# WINGMAN MIND - AI Memory & Learning System

**Purpose:** Continuous knowledge transfer between AI instances running the Wingman workflow.

This file captures insights, patterns, and learnings that evolve as the trading system matures. When a new AI instance starts, it reads this file to understand what previous sessions have discovered.

---

## Session Learning Archive

### Trading Style Deep Dive (Initialized Nov 2, 2025)

**Trader Profile:**
- Primary focus: **Scalping + Swing Trading** (dual approach)
- Learning mindset: Strategies evolve with experience
- Platform: TradingView (charting/analysis) + ThinkOrSwim (execution)
- Risk approach: Disciplined, 1% per trade, hard stops at -$500 daily / -$1,000 weekly

**Scalp Execution (5min - 6hrs)**
- Timeframes: 1-min, 5-min, 15-min (correlated with higher TF context)
- ATR: 10-period on execution timeframe
- Hold: Rarely overnight
- Exit: Fibonacci extensions (127% primary target)
- Strategy focus: Range deviations, VWAP reversion, volatility boxes

**Swing Execution (Days - 3 months)**
- Timeframes: 4-hour, Daily, Weekly
- ATR: 20-25 period on Daily chart
- Hold: Multi-day, intentional carries
- Exit: Multiple Fibonacci targets (50%, 61.8%, 127%)
- Strategy focus: Range plays, level confluence, trend following

---

## Core Strategy Understanding (From ThinkOrSwim)

### 1. Range Trading (PRIMARY FOCUS)
- Identify key levels: Daily High/Low, Weekly High/Low, Monthly High/Low, Yearly High/Low
- Play deviations from range midpoints
- Key insight: Context of level is critical (daily vs weekly vs monthly)
- Fib retracements (50%, 61.8%) used as confluence points
- Volume confirmation required for strength

### 2. Fibonacci Strategy
- **Retracements:** 50%, 61.8% used as support/resistance
- **Extensions:** 127% = PRIMARY EXIT TARGET (high probability zone)
- Used to identify reversions and target levels
- Applied to identified ranges (daily, weekly, monthly)

### 3. VWAP Mean Reversion
- Entry: 1.5-2.5 ATR away from VWAP
- Exit: Return to VWAP or 127% Fib extension
- Best for: Scalps with clear daily context
- Volatility adjustment: Dynamic bands based on recent vs historical vol

### 4. Volatility Box Breakouts
- Identify boxes formed around price levels
- Watch for breakout with volume confirmation
- Entry on breakout, exit at next key level or 127% Fib extension

### 5. Multi-Timeframe Level Confluence
- ALL scalps must correlate with higher timeframe context
- Key levels to watch: Daily pivots, Weekly high/low, Monthly high/low
- Strength increases when multiple timeframes align
- Example: Scalp entry near Daily open + Weekly midpoint = high probability

---

## Critical Rules Discovered

1. **Higher Timeframe Context (NON-NEGOTIABLE FOR SCALPS)**
   - Scalp entries must align with daily/weekly context
   - Cannot just scalp lower timeframes in isolation
   - This is a discipline rule, not a suggestion

2. **127% Fibonacci Extension**
   - Primary exit target for most setups
   - High probability zone for reversals
   - First target on single-target scalps

3. **Key Level Context**
   - Always identify what level you're trading near:
     - Daily High/Low? Weekly High/Low? Monthly?
   - Levels with longer timeframe significance = higher probability

4. **Volume Confirmation**
   - Breakouts require above-average volume
   - Reversions need volume spike on entry signal
   - Low volume invalidates setup quality

---

## ATR Implementation

**For Scalps (10-period ATR on execution TF):**
- Stop placement: 1.5x-2x ATR below entry
- Position sizing: Risk / (Entry - Stop)
- Example: 5-min ATR = $0.50, stop = $0.75-$1.00 below entry

**For Swings (20-25 period ATR on Daily):**
- Stop placement: 1.5x-2x Daily ATR below entry
- Position sizing: Risk / (Entry - Stop)
- Dynamic adjustment: Reduce size if current ATR > 20-day average

---

## Questions for Future Sessions

1. **Range identification:** How to automatically detect good ranges? Visual + volume + timeframe?
2. **Volume filter:** What constitutes "above average" volume? Exact threshold?
3. **Volatility boxes:** Algorithmic way to detect box formations?
4. **Fib precision:** When price approaches 127% extension, how much tolerance? (±0.5%, ±1%, exact?)
5. **Overnight holds:** When is it acceptable to hold scalps overnight vs close them?
6. **Strategy cycling:** Do certain strategies perform better at different market times?

---

## Patterns Noticed (From Trading Sessions)

*To be filled in after first trading sessions.*

- [Session date]: [Observation about what worked/didn't work]
- [Pattern]: [How this pattern emerged from multiple trades]
- [Insight]: [Strategic adjustment based on pattern]

---

## Strategy Evolution Log

**v1.0 (Nov 2, 2025 - Initial)**
- Documented core 5 strategies from ThinkOrSwim
- Established scalp/swing definitions
- Integrated ATR best practices
- Established Fibonacci as primary target system

**v1.1 (TBD - After first trading week)**
- [To be updated with learnings from real trading]

---

## Integration Points for Next AI

When a new AI instance loads this file, it should:

1. **Understand the dual approach:** Scalping + Swinging, not pure day trading
2. **Know the critical rule:** Higher TF context required for ALL scalps
3. **Recognize strategy focus:** Range trading + Fibonacci targets are primary
4. **Apply ATR correctly:** 10-period for scalps, 20-25 for swings
5. **Validate trades:** Using the multi-timeframe confluence principle
6. **Track evolution:** Note what's working and update this file after significant sessions

---

## Learning Philosophy

This system is **not rigid**. As the trader gains experience and market conditions evolve:

- New strategies may be added
- Fib levels may be refined (e.g., discovery that 138% > 127% in certain conditions)
- ATR periods may be adjusted
- Higher TF requirement may be relaxed/tightened based on results

**Always update this file.** Each trading session teaches something. Patterns emerge. The system adapts.

---

**Last Updated:** November 2, 2025 - System Initialization
**Next Update:** After first week of trading (patterns will emerge)

