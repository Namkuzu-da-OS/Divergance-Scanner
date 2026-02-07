# Trades Journal Schema Documentation

**File:** `data/trades_journal.json`

---

## Overview

The trades_journal.json file contains a permanent record of all executed trades. It serves three purposes:

1. **Performance Tracking** - Calculate win rates, P&L, strategy effectiveness
2. **Pattern Analysis** - Identify what works, what doesn't
3. **AI Learning** - Help Wingman understand your best setups over time

---

## Trade Object Structure

### Core Fields (Always Required)

```json
{
  "trade_id": "TQQQ_20251103_001",
  "symbol": "TQQQ",
  "trade_type": "scalp|swing",
  "strategy": "daily_range_play|vwap_reversion|ma_reversion|midpoint_range_trade|weekly_range_play",
  "timeframe": "1-min|5-min|15-min|4h|daily|weekly",
  "entry_date": "YYYY-MM-DD",
  "entry_time": "HH:MM",
  "entry_price": 118.28,
  "quantity": 300,
  "side": "buy|sell",
  "exit_date": "YYYY-MM-DD",
  "exit_time": "HH:MM",
  "exit_price": 118.62
}
```

### Risk Management Fields (Always Required)

```json
{
  "stop_price": 117.50,          // Where stop loss was set
  "target_price": 119.50,        // Primary profit target
  "entry_value": 35484.00,       // Quantity × Entry Price
  "exit_value": 35586.00,        // Quantity × Exit Price
  "realized_pnl": 102.00,        // Exit Value - Entry Value
  "pnl_percent": 0.29            // (Realized PNL / Entry Value) × 100
}
```

### Position Duration

```json
{
  "hold_time_minutes": 437       // Total minutes held (useful for strategy analysis)
}
```

### Status

```json
{
  "status": "closed|open|stopped_out",
  "timestamp": "2025-11-03T14:30:00Z"  // When trade was closed/logged
}
```

---

## Divergence + VWAP Reversion Fields (NEW)

These fields are used to track performance of the **Divergence + VWAP Reversion scalp strategy** and help identify which indicator combinations work best.

### Higher Timeframe Context (CRITICAL for scalps)

```json
{
  "higher_timeframe_context": "Daily Open|Weekly Midpoint|Daily High|Weekly Low|Previous Support",
  // MANDATORY for all scalp trades
  // What daily/weekly level was your entry near?
  // This is THE edge for scalps - always state it

  // Examples:
  // "Near Daily Open"
  // "At Weekly Midpoint (support)"
  // "Daily High test"
  // "Near Weekly Low + 2% bounce"
}
```

### Divergence Confirmation Details

```json
{
  "divergence_confirmed_by": ["MACD", "RSI", "Stochastic"],
  // Array of indicators that showed divergence
  // Check your chart and list which indicators had the divergence
  // Possible values:
  // - "MACD" (price makes new high, MACD doesn't)
  // - "RSI" (RSI divergence)
  // - "Stochastic" (Stoch divergence)
  // - "CCI" (Commodity Channel Index divergence)
  // - "Momentum" (Momentum divergence)
  // - "OBV" (On Balance Volume divergence)
  // - "VWMACD" (Volume-Weighted MACD divergence)
  // - "CMF" (Chaikin Money Flow divergence)
  // - "MFI" (Money Flow Index divergence)
  // - Any other indicators checked in your script

  // Single indicator: ["MACD"]
  // Multiple: ["MACD", "RSI", "Stochastic"]
  // No divergence: null or []

  "divergence_count": 3,
  // How many indicators showed divergence?
  // Higher count = more confirmation
  // Track this to understand signal quality

  "vwap_distance_atr": 1.8,
  // How many ATR units away was your entry from VWAP?
  // Should be between 1.5-2.5 for VWAP reversions
  // Example: If VWAP is $100, ATR is $1, entry is $101.80, then vwap_distance_atr = 1.8

  "reversal_candle_type": "wick_rejection|close_reversal|inside_bar|gap_and_reverse",
  // What type of reversal confirmation was present?
  // Helps identify which candle patterns work best with divergences
}
```

### Complete VWAP Reversion Example

```json
{
  "trade_id": "SPY_20251104_001",
  "symbol": "SPY",
  "trade_type": "scalp",
  "strategy": "vwap_reversion",
  "timeframe": "5-min",
  "entry_date": "2025-11-04",
  "entry_time": "10:15",
  "entry_price": 450.25,
  "quantity": 364,
  "side": "short",
  "exit_date": "2025-11-04",
  "exit_time": "10:22",
  "exit_price": 449.75,
  "stop_price": 450.80,
  "target_price": 449.00,
  "entry_value": 163791.00,
  "exit_value": 163602.00,
  "realized_pnl": 189.00,
  "pnl_percent": 0.12,
  "hold_time_minutes": 7,
  "higher_timeframe_context": "At Daily Open (resistance)",
  "divergence_confirmed_by": ["MACD", "RSI", "Stochastic"],
  "divergence_count": 3,
  "vwap_distance_atr": 2.1,
  "reversal_candle_type": "wick_rejection",
  "status": "closed",
  "timestamp": "2025-11-04T14:30:00Z",
  "notes": "Classic VWAP reversion: divergence + entry zone + reversal wick. MACD and RSI both showed exhaustion. Strong 3-indicator confirmation."
}
```

---

## Field Definitions & How to Populate

### trade_id
**Format:** `SYMBOL_YYYYMMDD_NNN`

- SYMBOL: Stock ticker (SPY, TQQQ, etc.)
- YYYYMMDD: Trade entry date
- NNN: Sequential number (001, 002, etc.) if multiple trades same symbol/day

Example: `SPY_20251104_001`

### symbol
Stock or crypto ticker. Examples: SPY, TQQQ, BTC, ETH

### trade_type
Choose one:
- **scalp** = 5min-6hr hold (primary focus)
- **swing** = 2-day to 3-month hold

### strategy
Choose one of your approved strategies:
- **daily_range_play** - Entry at daily extremes looking for mean reversion
- **vwap_reversion** - Entry 1.5-2.5 ATR from VWAP (NEW - with divergence)
- **ma_reversion** - Entry at key moving average with reversal
- **midpoint_range_trade** - Entry at range extreme targeting 50% midpoint
- **weekly_range_play** - Entry at weekly extremes on daily/4h chart

### timeframe
What chart did you use for entry?
- 1-min, 5-min, 15-min (scalps)
- 4h, daily, weekly (swings)

### Entry Details
- **entry_date/entry_time** - When you bought/sold
- **entry_price** - Execution price
- **quantity** - How many shares
- **side** - "buy" or "sell"

### Exit Details
- **exit_date/exit_time** - When trade closed
- **exit_price** - Close price
- **status** - How it closed:
  - "closed" = Hit target or manually exited
  - "stopped_out" = Stop loss hit
  - "open" = Still holding (rare in journal, more for /api/positions)

### Risk Fields
- **stop_price** - Your predetermined stop loss level
- **target_price** - Your profit target
- **realized_pnl** - Actual profit/loss = (Exit Price - Entry Price) × Quantity
- **pnl_percent** - Percentage return on that trade

### higher_timeframe_context (NEW - SCALPS ONLY)
**Required for ALL scalp trades.**

What level on the daily/weekly chart were you trading near?

Valid answers:
- Daily Open (DO)
- Previous Day's High (PDH)
- Previous Day's Low (PDL)
- Daily Midpoint
- Weekly High (WH)
- Weekly Low (WL)
- Weekly Midpoint (WM)
- Support/Resistance Level
- Moving Average

Examples:
```
"higher_timeframe_context": "Daily Open"
"higher_timeframe_context": "Near Weekly Midpoint - support"
"higher_timeframe_context": "Previous Day High test"
```

**This is THE edge for scalp trading.** If you can't state it, the trade has no edge.

### divergence_confirmed_by (NEW - VWAP REVERSIONS)
**For VWAP reversion trades, which indicators showed divergence?**

Look at your enhanced divergence indicator and list which showed signals:
```json
"divergence_confirmed_by": ["MACD", "RSI"]

// Possible indicators:
["MACD"]                                    // MACD alone
["MACD", "RSI"]                            // MACD + RSI
["MACD", "RSI", "Stochastic"]              // Multiple confirmations
["Stochastic", "Momentum"]
[]                                         // No divergence (shouldn't trade)
null                                       // Not applicable (non-divergence strategy)
```

### divergence_count
How many indicators agreed? Range: 0-11
- 1 = Weak signal
- 2 = Good signal
- 3+ = Strong signal

Over time you'll find that 2+ confirmations gives your best win rate.

### vwap_distance_atr
How far from VWAP was your entry, in ATR units?

**Calculation:**
```
Distance from VWAP = |Entry Price - VWAP Price|
vwap_distance_atr = Distance from VWAP / 10-period ATR

Example:
VWAP: $450.00
Entry: $451.80
ATR (10-period on 5-min): $1.00
Distance: |451.80 - 450.00| = 1.80
vwap_distance_atr = 1.80 / 1.00 = 1.8
```

Ideal range: **1.5 to 2.5**
- <1.5 = Not enough extension (weak setup)
- 1.5-2.5 = Optimal reversion zone
- >2.5 = Too far extended (trend is too strong)

### reversal_candle_type
What confirmation did you see on the 5-min candle?
- **wick_rejection** - Long wick back into previous candle
- **close_reversal** - Candle opens one direction, closes opposite
- **inside_bar** - Smaller candle inside previous candle
- **gap_and_reverse** - Gap away from VWAP, then reversal
- **volume_climax** - High volume spike at extreme

### status
- **closed** = Trade exited at target or manually closed with profit/loss
- **stopped_out** = Stop loss executed
- **open** = Still holding (rare in historical journal)

### timestamp
ISO 8601 format when trade was recorded:
`2025-11-04T14:30:00Z`

---

## Analysis: What to Track Long-Term

### By divergence_confirmed_by
After 20+ VWAP reversion trades, create a breakdown:

```
MACD alone: 12 trades, 75% win rate
RSI alone: 8 trades, 62% win rate
MACD + RSI: 15 trades, 87% win rate ← BEST COMBO
Stochastic: 5 trades, 60% win rate
```

**Action:** Focus on MACD + RSI combo, skip Stochastic-only signals.

### By higher_timeframe_context
```
Daily Open: 18 trades, 83% win rate
Weekly Midpoint: 12 trades, 79% win rate
Support Level: 8 trades, 71% win rate
```

**Action:** Daily Open has best edge, prioritize those.

### By vwap_distance_atr
```
1.5-1.8 ATR: 14 trades, 86% win rate ← SWEET SPOT
1.8-2.1 ATR: 12 trades, 75% win rate
2.1-2.5 ATR: 9 trades, 67% win rate
```

**Action:** Prefer entries closer to 1.5-1.8 range.

---

## Example: How to Log a VWAP Reversion Win

**Scenario:** You take a short scalp on SPY at Daily Open with MACD + RSI divergence

**Step 1: Watch the trade**
- Entry: 10:15 AM at $450.25 (short)
- Exit: 10:22 AM at $449.75
- Stop was $450.80
- Note: MACD showed higher low while price made lower low = divergence
- Note: RSI showed divergence too
- Note: 2.1 ATR from VWAP ($450.00 + 2.1×$1.00 = $452.10)

**Step 2: Log it**
```json
{
  "trade_id": "SPY_20251104_001",
  "symbol": "SPY",
  "trade_type": "scalp",
  "strategy": "vwap_reversion",
  "timeframe": "5-min",
  "entry_date": "2025-11-04",
  "entry_time": "10:15",
  "entry_price": 450.25,
  "quantity": 222,
  "side": "short",
  "exit_date": "2025-11-04",
  "exit_time": "10:22",
  "exit_price": 449.75,
  "stop_price": 450.80,
  "target_price": 448.50,
  "entry_value": 99955.50,
  "exit_value": 99847.50,
  "realized_pnl": 108.00,
  "pnl_percent": 0.11,
  "hold_time_minutes": 7,
  "higher_timeframe_context": "Daily Open (strong resistance)",
  "divergence_confirmed_by": ["MACD", "RSI"],
  "divergence_count": 2,
  "vwap_distance_atr": 2.1,
  "reversal_candle_type": "wick_rejection",
  "status": "closed",
  "timestamp": "2025-11-04T14:30:00Z",
  "notes": "Clean VWAP reversion scalp at Daily Open. MACD + RSI divergence (price lower low, indicators didn't confirm). Wick rejection at 2.1 ATR zone. Quick 7-min hit."
}
```

---

## Quick Reference: Field Checklist

When logging a trade, ensure you have:

```
✓ trade_id (format: SYMBOL_YYYYMMDD_NNN)
✓ symbol, trade_type, strategy, timeframe
✓ entry_date, entry_time, entry_price, quantity, side
✓ exit_date, exit_time, exit_price
✓ stop_price, target_price
✓ realized_pnl, pnl_percent
✓ hold_time_minutes
✓ status, timestamp

For VWAP Reversions Add:
✓ higher_timeframe_context (what daily/weekly level?)
✓ divergence_confirmed_by (which indicators?)
✓ divergence_count (how many?)
✓ vwap_distance_atr (how far from VWAP?)
✓ reversal_candle_type (what confirmation?)

Optional but helpful:
✓ notes (your observations about the trade)
```

---

## Tips for Better Data

1. **Be consistent** - Use same strategy names, don't abbreviate randomly
2. **Fill in divergence fields** - This is how Wingman learns what works
3. **Always note higher TF context for scalps** - This is your edge
4. **Track which indicators work** - Over time you'll see patterns
5. **Update in real-time** - Don't wait until EOD to fill in details (you'll forget)

---

**Last Updated:** November 4, 2025
**Schema Version:** 2.0 (Added divergence + VWAP reversion tracking)
**Status:** Live and in use
