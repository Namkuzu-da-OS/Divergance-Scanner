# WINGMAN TRADING SYSTEM

**Version:** 2.0
**Last Updated:** January 2026
**Status:** ACTIVE

---

## QUICK REFERENCE CARD

Print this page. Keep it visible.

### Stop Loss Formula (Hybrid Method)
```
MENTAL STOP = Entry - (ATR × VIX Multiplier)
HARD STOP   = Entry - (Mental Risk × 1.5)

VIX Multipliers:
  VIX <15:  1.5x ATR
  VIX 15-25: 2.0x ATR
  VIX 25-35: 2.5x ATR
  VIX >35:  3.0x ATR

EXIT RULE: Only exit if 5-min candle CLOSES below mental stop
           (wicks don't count - avoids stop hunts)
```

### Position Sizing
```
Shares = $200 / (Entry - Mental Stop)

Example: Entry $100, Mental Stop $98
         $200 / $2 = 100 shares
```

### Loss Limits
| Threshold | Action |
|-----------|--------|
| -$400 daily | Warning - slow down |
| -$500 daily | STOP for day |
| -$1,000 weekly | STOP for week |
| -10% account | Reduce to 0.5% risk |

### Entry Checklist (All Must Be True)
- [ ] HTF trend aligned (Daily/Weekly direction)
- [ ] At key level (VWAP zone, PDH/PDL, gamma wall)
- [ ] Reversal candle present
- [ ] Volume > 1.5x average
- [ ] Not in dead zone (11:30 AM - 1:30 PM)
- [ ] Not within 24h of FOMC/CPI/earnings

### Exit Triggers
1. **5-min candle CLOSES below mental stop** → Exit
2. **Target hit** → Take profit (50% at T1, 50% runner)
3. **Setup invalidated** → Exit regardless of stop
4. **Time stop** → No progress after 4 hours (scalp) / 5 days (swing)

---

## PART 1: RISK MANAGEMENT

### The Hybrid Stop System

**Problem Solved:** Fear of stop hunts, fear of placing stops.

**Solution:** Two stops + candle-close confirmation.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ENTRY PRICE ────────────────────────────────── $100.00    │
│                                                             │
│   MENTAL STOP (your real risk) ─────────────────  $98.00    │
│   • Set PRICE ALERT here                                    │
│   • When alert triggers, watch 5-min candle                 │
│   • Exit ONLY if candle CLOSES below this level             │
│   • Wicks through = HOLD (it's a hunt, they'll reverse)     │
│                                                             │
│   HARD STOP (disaster protection) ──────────────  $97.00    │
│   • Actual stop-loss order                                  │
│   • 1.5x your mental risk distance                          │
│   • Only triggers if you're away or catastrophic move       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Stop Placement Rules

**Step 1: Get ATR**
| Trade Type | ATR Period | Chart |
|------------|------------|-------|
| Scalp | 10-period | 5-min or 15-min |
| Swing | 14-20 period | Daily |

**Step 2: Get VIX Multiplier**
| VIX Level | Multiplier | Why |
|-----------|------------|-----|
| < 15 | 1.5x ATR | Low vol = tight stops OK |
| 15-25 | 2.0x ATR | Normal conditions |
| 25-35 | 2.5x ATR | Elevated vol = need room |
| > 35 | 3.0x ATR | Crisis = wide stops or don't trade |

**Step 3: Calculate Raw Stop**
```
LONG:  Mental Stop = Entry - (ATR × Multiplier)
SHORT: Mental Stop = Entry + (ATR × Multiplier)
```

**Step 4: Check for Obvious Levels (CRITICAL)**

Before placing stop, ask: "Would everyone else put a stop here?"

| If Stop Is At... | Then Move It To... |
|------------------|-------------------|
| Round number ($100, $50) | Shift by 0.3% ($99.70 or $50.15) |
| Previous day high/low | 0.5x ATR beyond the level |
| Swing high/low | 0.5x ATR beyond the level |
| VWAP exactly | 0.25x ATR beyond |

**Step 5: Set Both Stops**
```
MENTAL STOP = Calculated level (set price alert)
HARD STOP   = Mental stop - (ATR × 0.5) ← disaster protection only
```

**Step 6: The Exit Rule**
```
When mental stop alert triggers:
1. Look at 5-min chart
2. Wait for current candle to CLOSE
3. If candle CLOSES below mental stop → EXIT
4. If candle WICKS below but CLOSES above → HOLD (it was a hunt)
5. If still holding, trail mental stop to new swing low - 0.5 ATR
```

### Why This Works

Research shows:
- **2x ATR stops** reduce max drawdown by 32%
- **Candle-close confirmation** filters out 60-70% of stop hunts
- **Stops 1 ATR beyond obvious levels** avoid 80%+ of liquidity sweeps

The fear goes away because:
- You know exactly where your risk is
- Wicks through your level don't take you out
- Only confirmed breakdowns trigger exits
- Hard stop protects against black swans

---

### Position Sizing

**The Formula**
```
Position Size = Risk Amount / (Entry - Mental Stop)

Account: $20,000
Risk: 1% = $200 per trade

Example:
- Entry: $100.00
- Mental Stop: $98.00 (2.0 ATR away)
- Risk per share: $2.00
- Position Size: $200 / $2.00 = 100 shares
- Total Position: 100 × $100 = $10,000
```

**VIX-Adjusted Sizing**
| VIX Level | Risk % | Dollar Risk |
|-----------|--------|-------------|
| < 15 | 1.0% | $200 |
| 15-25 | 1.0% | $200 |
| 25-35 | 0.75% | $150 |
| > 35 | 0.5% | $100 |

**Portfolio Heat Limits**
- Max single position: 25% of account ($5,000)
- Max total risk if all stops hit: 10% of account ($2,000)
- Max correlated positions: 2 (e.g., only 2 tech stocks at once)

---

### Loss Limits (Non-Negotiable)

| Threshold | Action | Return Rule |
|-----------|--------|-------------|
| -$400 daily | Warning - reduce size 50% | Continue with caution |
| -$500 daily | STOP for day | Next day, normal size |
| -$750 weekly | Warning - A+ setups only | |
| -$1,000 weekly | STOP for week | Return at 0.5% risk for 2 days |
| -10% account ($2,000) | Full review required | Return at 0.5% risk |
| -20% account ($4,000) | STOP 1 week | Return at 0.25% risk |

**Consecutive Loss Protocol**
- 2 losses in a row: 15-minute break, reduce next size by 25%
- 3 losses in a row: DONE for the day
- Hit daily limit: DONE for the day, no exceptions

---

## PART 2: ENTRY SYSTEM

### Higher Timeframe Context (MANDATORY)

**The Rule:** Never take a scalp without knowing the higher timeframe direction.

Before ANY entry, answer:
1. What is the Daily trend? (Above/below 20 EMA)
2. What is the Weekly trend? (Above/below 50 SMA)
3. Is SPY bullish or bearish today?
4. Am I trading WITH or AGAINST the trend?

**HTF Context Decision Matrix**
| Daily Trend | Weekly Trend | SPY Today | Trade Direction |
|-------------|--------------|-----------|-----------------|
| Bullish | Bullish | Bullish | LONG only |
| Bullish | Bullish | Bearish | LONG cautiously, reduced size |
| Bearish | Bearish | Bearish | SHORT only |
| Bearish | Bearish | Bullish | SHORT cautiously, reduced size |
| Mixed | Mixed | Any | Fade extremes only (mean reversion) |

### Key Levels to Watch

| Level | Definition | How to Use |
|-------|------------|------------|
| PDH/PDL | Previous Day High/Low | Strong S/R, fade extremes |
| Weekly Open | Monday's opening price | Magnet for price |
| VWAP | Volume-weighted average | Reversion target |
| VWAP +/- 1.5 ATR | Entry zones | Buy lower band, sell upper |
| VWAP +/- 2.5 ATR | Extreme zones | High probability reversals |
| Gamma Walls | Options market levels | Price magnets/barriers |
| 20 EMA (Daily) | Trend indicator | Above = bullish, below = bearish |
| 200 SMA | Long-term trend | Major S/R level |

### Entry Confirmation Requirements

**ALL entries require:**

1. **Reversal Candle**
   - Bullish: Close > Open, close in upper 25% of range, wick below prior low
   - Bearish: Close < Open, close in lower 25% of range, wick above prior high

2. **Volume Confirmation**
   - Entry bar volume > 1.5x 20-bar average
   - Without this: reduce size by 50% or skip

3. **Momentum Alignment**
   - RSI not diverging against your direction
   - MACD histogram moving in your favor

### Time Filters

**Trade Windows (ET)**
| Time | Action | Why |
|------|--------|-----|
| 9:30-9:45 | WATCH only | Opening volatility, stop hunts |
| **9:45-11:15** | **PRIME WINDOW** | Best setups, cleanest moves |
| 11:15-11:30 | Reduce new entries | European close triggers stops |
| **11:30-1:30** | **NO NEW TRADES** | Dead zone, chop, edge evaporates |
| 1:30-2:30 | Moderate opportunity | Post-lunch breakouts |
| **3:00-3:45** | **POWER HOUR** | High conviction only, big moves |
| 3:45-4:00 | Close positions | Don't open new positions |

---

## PART 3: STRATEGIES

### Strategy 1: VWAP Reversion (Primary Scalp)

| Component | Specification |
|-----------|---------------|
| Setup | Price 1.5-2.5 ATR from daily VWAP |
| Entry | Rejection candle + RSI divergence + volume confirm |
| Stop | Mental: Beyond swing + 0.5 ATR (max 1.5 ATR from entry) |
| Target | T1: VWAP (50%), T2: Opposite VWAP band (50%) |
| R:R | Minimum 1.5:1 |
| Skip if | ADX > 30, news-driven move, extension < 1.5 ATR |

**Visual:**
```
SELL ZONE ─────── 2.5 ATR above VWAP ─────── Extreme (short here)
           ─────── 1.5 ATR above VWAP ─────── Entry zone starts

VWAP ──────────── Target ──────────────────

           ─────── 1.5 ATR below VWAP ─────── Entry zone starts
BUY ZONE ──────── 2.5 ATR below VWAP ─────── Extreme (long here)
```

---

### Strategy 2: Golden Pocket + GEX Reversion (High Conviction)

| Component | Specification |
|-----------|---------------|
| Setup | Price at golden pocket (50-61.8% Fib), at/below put wall, RSI < 35 |
| Entry | Bottoming tail reclaims VWAP OR close above -1 SD after touch |
| Stop | Below 61.8% Fib / -2 SD / inefficiency zone low |
| Target | T1: Gamma flip, T2: 200 MA, T3: Call wall |
| R:R | Minimum 2:1 |
| Skip if | VIX > 25, no author consensus, counter-trend to SPY |

**Confluence Checklist (need 5+ of 8):**
- [ ] Golden pocket (50-61.8% Fib of recent swing)
- [ ] At/near put wall or GEX -1 SD band
- [ ] RSI oversold (< 35) or recovering from < 30
- [ ] 3+ authors bullish (established preferred)
- [ ] Unusual call activity (> 5x vol/OI)
- [ ] Key MA nearby (100/200 SMA flat or as support)
- [ ] VWAP reclaimed after dip
- [ ] Call wall above as magnet/target

**The Trigger Pattern (from TSLA Jan 2026):**
```
When RSI hits oversold AND unusual call activity appears together
= Smart money buying the dip

Score Progression:
  Score 60  → Technical only (BB lower, put wall)
  Score 95  → RSI oversold + unusual calls (TRIGGER)
  Score 100 → Author consensus confirms

This combo preceded a 3%+ move to call wall.
```

---

### Strategy 3: Weekly Range (Swing)

| Component | Specification |
|-----------|---------------|
| Setup | Price at weekly high/low (within 0.5%) |
| Entry | Rejection candle + volume confirm |
| Stop | Beyond weekly level + 1 Daily ATR |
| Target | T1: Mid-range (50%), T2: Opposite extreme (runner) |
| R:R | Minimum 2:1 |
| Skip if | Mid-range, no rejection, news within 24h |

---

### Strategy 4: MA Reversion (Both)

| Component | Specification |
|-----------|---------------|
| Setup | Price touches 20 EMA, 50 SMA, or 200 SMA |
| Entry | Momentum shift (close back inside MA) + confluence |
| Stop | 1 ATR beyond MA |
| Target | Next MA level or major S/R |
| R:R | Minimum 2:1 |
| Skip if | Strong close beyond MA (> 1 ATR), counter-HTF trend |

---

### Strategy 5: Volatility Box Breakout (Scalp)

| Component | Specification |
|-----------|---------------|
| Setup | Consolidation box (3+ touches each side) at key level |
| Entry | Breakout candle closes beyond box + volume > 2x average |
| Stop | Opposite side of box |
| Target | 127% Fib extension of box height |
| R:R | Minimum 2:1 |
| Skip if | Volume < 1.5x on breakout, no clear box |

---

### Strategy 6: Mid-Point Range (Both)

| Component | Specification |
|-----------|---------------|
| Setup | Price at range extreme (top/bottom 10%) |
| Entry | Rejection at extreme + momentum toward mid |
| Stop | Beyond extreme + 1 ATR |
| Target | T1: 50% retracement, T2: 61.8% retracement |
| R:R | Minimum 1.5:1 |
| Skip if | Breakout beyond range, range < 2 ATR |

---

## PART 4: TRADE MANAGEMENT

### Scaling Protocol

**Standard Exit (Recommended):**
| Target Level | Action | Position |
|--------------|--------|----------|
| T1 (1R or 50% Fib) | Take 50% profit | Exit half |
| T2 (2R or 127% Fib) | Trail stop or exit | Exit remaining |

**After T1 Hit:**
- Move mental stop to breakeven
- Trail hard stop to entry - 0.5 ATR
- Let runner work

### Trailing Stop Protocol

| Profit Level | Stop Adjustment |
|--------------|-----------------|
| At 1R profit | Move mental stop to entry (breakeven) |
| At 1.5R profit | Move mental stop to +0.5R |
| At 2R+ profit | Trail using 9 EMA on 5-min chart |

**Chandelier Exit (for swings):**
- 22-period lookback
- 3x ATR from highest high
- Tighten to 2x ATR after 2R profit

### Time-Based Exits

| Trade Type | Time Stop |
|------------|-----------|
| Scalp | 4 hours with no progress → Exit |
| Intraday | End of day decision required |
| Swing | 5-10 days with no progress → Exit |

**Approaching Events:**
- Exit before earnings or reduce 50-75%
- Exit before FOMC/CPI or tighten stops
- Don't hold over weekend if at risk

---

## PART 5: DAILY ROUTINE

### Pre-Market (8:30-9:30 AM ET)

- [ ] Check overnight action (futures, Asia, Europe)
- [ ] Read market outlook (`/api/market/outlook`)
- [ ] Review scanner for opportunities
- [ ] Check VIX level → Set risk adjustment
- [ ] Identify 2-3 setups with entry/stop/target
- [ ] Set alerts at key levels
- [ ] Confirm daily loss limit remaining

### Market Hours (9:30 AM - 4:00 PM ET)

**9:30-9:45:** Watch only. Let market settle.

**9:45-11:15:** Prime window.
- Execute setups from pre-market plan
- Log trades immediately
- Validate with Wingman before entry

**11:15-11:30:** Wind down morning session.

**11:30-1:30:** No new trades. Review morning, eat lunch.

**1:30-2:30:** Selective entries if A+ setups.

**3:00-3:45:** Power hour. High conviction only.

**3:45-4:00:** Close or decide holds.

### Post-Market (4:00-5:00 PM ET)

- [ ] Update positions and journal
- [ ] Calculate daily P&L
- [ ] Review each trade: followed system Y/N?
- [ ] Note lessons learned
- [ ] Set up for tomorrow

---

## PART 6: ENFORCEMENT

### Trade Validation (Before Every Entry)

Wingman checks:
1. Is there HTF context? (Daily/Weekly direction known)
2. Is entry at a key level? (Within 1 ATR of PDH/PDL/VWAP/gamma wall)
3. Is position size correct? ($200 max risk)
4. Is R:R acceptable? (Minimum per strategy)
5. Are loss limits clear? (Not at daily/weekly max)
6. Is timing OK? (Not in dead zone, not before news)

**Verdict:** APPROVE / CHALLENGE / REJECT

### Rejection Triggers (Automatic No)

- [ ] Entry NOT at a key level
- [ ] No reversal candle confirmation
- [ ] Volume < 1.5x average
- [ ] Within dead zone (11:30-1:30)
- [ ] Within 24h of FOMC/CPI/NFP/earnings
- [ ] Daily/weekly loss limit already hit
- [ ] Risk exceeds current allowance
- [ ] No documented stop price

### Deviation Tracking

Every trade is logged with:
- Did it follow the system? (Y/N)
- If N, what was the deviation?
- Outcome (W/L)
- Lesson

Monthly review: Deviations vs outcomes. If deviations win more, update system. If deviations lose more, enforce harder.

---

## APPENDIX A: ATR Reference Table

### Scalp (5-min chart, 10-period ATR)

| Stock | Typical ATR | 2x Stop Distance | $200 Risk = Shares |
|-------|-------------|------------------|-------------------|
| SPY | $0.30-0.50 | $0.60-1.00 | 200-333 |
| QQQ | $0.50-0.80 | $1.00-1.60 | 125-200 |
| NVDA | $1.00-2.00 | $2.00-4.00 | 50-100 |
| TSLA | $1.50-3.00 | $3.00-6.00 | 33-67 |

### Swing (Daily chart, 14-period ATR)

| Stock | Typical ATR | 2x Stop Distance | $200 Risk = Shares |
|-------|-------------|------------------|-------------------|
| SPY | $3.00-5.00 | $6.00-10.00 | 20-33 |
| QQQ | $5.00-8.00 | $10.00-16.00 | 12-20 |
| NVDA | $8.00-15.00 | $16.00-30.00 | 7-12 |
| TSLA | $10.00-20.00 | $20.00-40.00 | 5-10 |

---

## APPENDIX B: VIX Quick Reference

| VIX Level | Regime | ATR Multiplier | Position Size | Action |
|-----------|--------|----------------|---------------|--------|
| < 12 | Very Low | 1.5x | 100% | Normal trading |
| 12-15 | Low | 1.5x | 100% | Normal trading |
| 15-20 | Normal | 2.0x | 100% | Normal trading |
| 20-25 | Elevated | 2.0x | 100% | Tighten selection |
| 25-30 | High | 2.5x | 75% | A+ setups only |
| 30-35 | Very High | 2.5x | 50% | Very selective |
| > 35 | Extreme | 3.0x | 25% | Consider sitting out |

---

## APPENDIX C: Indicator Setup (TradingView)

See: [indicators/wingman-master.pine](../indicators/wingman-master.pine)

The indicator shows:
1. Higher timeframe trend (Daily/Weekly)
2. VWAP with ATR bands (1.5x and 2.5x)
3. PDH/PDL levels
4. Confluence score (0-100)
5. Position sizing calculator
6. Entry zone highlights

---

**END OF TRADING SYSTEM**

This is your complete system. Trust it. Follow it. Update it based on results, not emotions.

When in doubt, check this document. If it's not in here, don't trade it.