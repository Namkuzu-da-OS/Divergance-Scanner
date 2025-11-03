# TRADING PLAN

**Version:** 1.0
**Last Updated:** November 2, 2025
**Status:** ACTIVE

---

## ACCOUNT PARAMETERS

**Account Size:** $20,000
**Risk Per Trade:** 1% ($200 maximum)
**Max Daily Loss:** $500 (2.5% of account)
**Max Weekly Loss:** $1,000 (5% of account)

### Risk Calculation Formula
```
Position Size = Risk Amount / (Entry Price - Stop Price)

Example:
- Account: $20,000
- Risk: 1% = $200
- Entry: $100
- Stop: $98
- Position Size = $200 / ($100 - $98) = $200 / $2 = 100 shares
```

---

## TRADE TYPE CLASSIFICATIONS

### Scalp Trades (Quick Turnover - Primary Focus)
**Execution Timeframe:** 1-minute, 5-minute, 15-minute charts
**Hold Time:** 5 minutes to 6 hours (rarely overnight)
**ATR Setting:** 10-period ATR on execution timeframe (NOT daily ATR)
**Stop Calculation:** Entry - (10-period ATR × 1.5 to 2.0)
**Target:** Fibonacci 127% extension (primary), with 50%/61.8% partial profits
**Example Position Size Calculation:**
- Entry: $100.00 on 5-min chart
- 10-period ATR (5-min): $0.40
- Stop: $100.00 - ($0.40 × 1.5) = $99.40
- Risk per trade: $200
- Position: $200 / ($100 - $99.40) = 333 shares
**CRITICAL RULE:** Must correlate with higher timeframe context (Daily/Weekly levels)

### Swing Trades (Multi-Day Holds)
**Execution Timeframe:** 4-hour, Daily, Weekly charts
**Hold Time:** 2 days to 3 months (intentional carries)
**ATR Setting:** 20-25 period ATR on DAILY chart
**Stop Calculation:** Entry - (20-25 period Daily ATR × 1.5 to 2.0)
**Target:** Multiple Fibonacci targets (50%, 61.8%, 127% extension)
**Example Position Size Calculation:**
- Entry: $100.00
- 20-period Daily ATR: $2.00
- Stop: $100.00 - ($2.00 × 2.0) = $96.00
- Risk per trade: $200
- Position: $200 / ($100 - $96) = 50 shares
**Key Strategies:** Weekly range plays, MA reversions, level confluence

### Strategy Type Matrix

| Strategy | Best For | Timeframes | ATR Setting | Target |
|----------|----------|-----------|-------------|---------|
| Range Trading (deviations) | SCALPS | 1/5/15-min | 10-period on TF | 127% Fib |
| VWAP Reversion | SCALPS | 5/15-min | 10-period on TF | Return to VWAP |
| Volatility Boxes | SCALPS | 5/15-min | 10-period on TF | 127% Fib |
| Weekly Range Plays | SWINGS | Daily/Weekly | 20-25 Daily | Fib targets |
| MA Reversions | BOTH | Varies | 10 (scalp) / 20-25 (swing) | Next MA |

---

## STOP LOSS SYSTEM

**Method:** ATR (Average True Range) - Timeframe Dependent
**Multiplier:** 1.5x to 2.0x ATR (use 2.0x for cleaner risk management)
**Adjustment Policy:** Only move stops to lock in profit, NEVER widen

### ATR Stop Calculation (SCALPS)
```
Stop Price = Entry Price - (10-period ATR × 1.5-2.0)

Example (5-min chart):
- Entry: $100.00
- 10-period ATR (on 5-min): $0.40
- Stop: $100.00 - ($0.40 × 1.5) = $99.40
- Risk: $0.60 per share
```

### ATR Stop Calculation (SWINGS)
```
Stop Price = Entry Price - (20-25 period Daily ATR × 1.5-2.0)

Example:
- Entry: $100.00
- 20-period Daily ATR: $2.00
- Stop: $100.00 - ($2.00 × 2.0) = $96.00
- Risk: $4.00 per share
```

### Stop Rules
1. **Set before entry** - Know your stop BEFORE buying
2. **Honor every stop** - Exit immediately when triggered
3. **No mental stops** - Use actual stop orders when possible
4. **Trail in profit** - Move stop to breakeven after 1R profit
5. **Never widen** - If stop needs widening, exit and reassess

---

## APPROVED TRADING STRATEGIES

### Strategy 1: Weekly Range Plays

**Setup:**
- Identify weekly high and low
- Wait for price to approach extreme (high or low)
- Look for reversal signals (volume, candlestick patterns)

**Entry Criteria:**
- Price at weekly high/low ± 0.5% tolerance
- Reversal confirmation (rejection candle, volume spike)
- Market structure supports reversal (support/resistance level)

**Stop Placement:**
- Beyond weekly extreme + 1 ATR
- Example: Weekly low at $95, ATR = $2, Stop = $93

**Target:**
- Minimum: Mid-range (50% retracement)
- Extended: Opposite weekly extreme
- Partial profit at mid-range, runner to extreme

**Risk/Reward:** Minimum 2:1
**Position Size:** Standard 1% risk calculation
**Max Positions:** 2 active weekly range plays simultaneously

**Disqualifiers:**
- Price in middle of range (wait for extreme)
- No clear reversal signal
- News/earnings within 24 hours
- Low volume environment

---

### Strategy 2: VWAP Reversions

**Setup:**
- Price extends >1.5 ATR from daily VWAP
- Clear momentum exhaustion (slowing momentum, volume climax)
- No major news driving extended move

**Entry Criteria:**
- Price 1.5-2.5 ATR from VWAP
- Reversal candle or momentum divergence
- Volume confirmation on reversal

**Stop Placement:**
- Beyond recent swing high/low + 0.5 ATR
- Maximum stop distance: 1.5 ATR from entry

**Target:**
- Primary: Return to VWAP
- Secondary: Opposite side of VWAP (overbalance)
- Scale out: 50% at VWAP, 50% runner

**Risk/Reward:** Minimum 1.5:1
**Position Size:** Standard 1% risk calculation
**Max Positions:** 3 VWAP reversion trades simultaneously

**Disqualifiers:**
- Strong trending day (ADX >30)
- News-driven move still developing
- Extension <1.5 ATR (insufficient edge)
- Choppy, low-volume conditions

---

### Strategy 3: MA Reversions

**Setup:**
- Price tests key moving average (20 EMA, 50 SMA, 200 SMA)
- Oversold/overbought conditions (RSI, stochastic)
- MA acting as support/resistance historically

**Entry Criteria:**
- Price touches or slightly penetrates MA
- Momentum shift confirmation (candle close back inside MA)
- Ideally confluence with other support/resistance

**Stop Placement:**
- 1 ATR beyond MA level
- Example: 50 SMA at $100, ATR = $2, Stop = $98 (for long)

**Target:**
- Next MA level (20 EMA to 50 SMA)
- Major support/resistance zone
- Trail stop using MA as dynamic support

**Risk/Reward:** Minimum 2:1
**Position Size:** Standard 1% risk calculation
**Max Positions:** 2 MA reversion trades simultaneously

**Disqualifiers:**
- MA breakdown (strong close beyond MA)
- Counter-trend to higher timeframe
- No historical respect for MA level
- Weak volume on test

---

### Strategy 4: Mid-Point Range Trades

**Setup:**
- Identify daily or weekly range (high to low)
- Price at range extreme (top 10% or bottom 10%)
- Calculate mid-point (50% level)

**Entry Criteria:**
- Price rejection at range extreme
- Momentum shifting toward mid-point
- Ideally confluence with VWAP or MA level

**Stop Placement:**
- Beyond range extreme + 1 ATR
- Maximum risk: 1.5% from entry to mid-point

**Target:**
- Primary: Mid-point (50% retracement)
- Secondary: 61.8% retracement
- Conservative: Take 100% profit at mid-point

**Risk/Reward:** Minimum 1.5:1
**Position Size:** Standard 1% risk calculation
**Max Positions:** 2 range trades active simultaneously

**Disqualifiers:**
- Breakout beyond range (wait for new range)
- Narrow range (<2 ATR wide)
- Mid-point already tested (diminished edge)
- Strong trend on higher timeframe

---

## MARKET CONDITIONS FILTER

### TRADE When:
- Market hours: 9:30 AM - 4:00 PM ET (stocks)
- Crypto: 24/7 but prefer high volume hours
- Clear market structure (defined ranges, trends)
- Normal volatility (VIX 12-30 range)
- Sufficient volume (above average)

### AVOID Trading When:
- First 15 minutes after open (let market settle)
- Last 15 minutes before close (unpredictable)
- Major news pending (FOMC, CPI, earnings)
- Extreme volatility (VIX >35)
- Low volume days (holidays, summer Fridays)
- Max daily/weekly loss hit (STOP immediately)

---

## POSITION MANAGEMENT

### Entry Rules
1. **Pre-plan every trade** - Entry, stop, target defined BEFORE execution
2. **Confirm setup** - All entry criteria must be met
3. **Calculate position size** - Use risk calculator, never guess
4. **Place stop order** - Set stop immediately after entry
5. **Record trade** - Log in trades_journal.json instantly

### Exit Rules
1. **Stop hit** - Exit immediately, no questions
2. **Target hit** - Take profit as planned (full or partial)
3. **Setup invalidated** - Exit even if stop not hit
4. **Time-based** - Exit if no progress after X hours/days
5. **EOD management** - Decide hold overnight or close

### Scaling Strategy
- **Aggressive:** 100% out at target
- **Moderate:** 50% at first target, 50% runner with trail stop
- **Conservative:** 33% at incremental levels (1R, 2R, 3R)

### Trail Stop Method
- After 1R profit: Move stop to breakeven
- After 2R profit: Trail stop at 1R
- After 3R profit: Trail stop at 2R
- Use ATR or MA as dynamic trail stop

---

## DAILY ROUTINE

### Pre-Market (8:30-9:30 AM)
- [ ] Read WINGMAN_CONTEXT.md + ACTIVE_SESSION.md
- [ ] Review open positions (positions.json)
- [ ] Check overnight news and market movers
- [ ] Identify potential setups for the day
- [ ] Set alerts for key levels
- [ ] Confirm risk limits (daily loss remaining)

### During Market Hours
- [ ] Monitor open positions
- [ ] Track daily P&L in real-time
- [ ] Execute setups matching approved strategies
- [ ] Update positions.json with any changes
- [ ] Log all trades in trades_journal.json
- [ ] Ask Wingman to validate trades before entry

### Post-Market (4:00-5:00 PM)
- [ ] Close daily_log.md with session summary
- [ ] Update account_summary.json
- [ ] Review trades with Wingman
- [ ] Archive positions and trades to /archive
- [ ] Update ACTIVE_SESSION.md for next session
- [ ] Identify lessons learned

---

## RISK MANAGEMENT RULES

### Position Limits
- Maximum 1% risk per trade ($200)
- Maximum 5 open positions simultaneously
- Maximum 3% total portfolio risk at any time
- No more than 2 positions in correlated assets

### Loss Limits (HARD STOPS)
- **Daily Loss:** If down $500, STOP trading for the day
- **Weekly Loss:** If down $1,000, STOP trading for the week
- **Consecutive Losses:** After 3 losses in a row, reduce size by 50%
- **Drawdown:** If account drops 10%, review plan with Wingman

### Recovery Rules
- After max daily loss: Step away, analyze trades, journal emotions
- After max weekly loss: Full review of all trades, adjust plan if needed
- Return to trading only when calm and objective
- Consider reducing risk to 0.5% per trade until confidence restored

---

## DISCIPLINE & MISTAKE PREVENTION

### Common Mistakes to Avoid
1. **Revenge Trading** - Don't trade to "get back" losses
2. **FOMO Entries** - Wait for YOUR setup, don't chase
3. **Overleveraging** - Respect 1% rule always
4. **Moving Stops** - Never widen a stop to "give it room"
5. **Hope Trading** - Exit when setup invalidated, don't hope
6. **Overtrading** - Quality over quantity
7. **Ignoring Plan** - If it's not in the plan, don't trade it

### Wingman's Authority
- **Wingman CAN challenge** any trade that doesn't match the plan
- **Wingman SHOULD warn** when risk limits being approached
- **Wingman MUST alert** when daily/weekly loss limits hit
- **Wingman WILL document** all deviations from plan
- Trader has final decision, but Wingman provides accountability

---

## PERFORMANCE METRICS

### Track Weekly
- Total Trades
- Win Rate (% winning trades)
- Average Win vs Average Loss
- Profit Factor (Gross Profit / Gross Loss)
- Largest Win / Largest Loss
- Expectancy per trade
- Sharpe Ratio (if sufficient data)

### Track Monthly
- Total P&L
- Return on Account (%)
- Max Drawdown
- Max Consecutive Wins/Losses
- Best Strategy Performance
- Worst Strategy Performance
- Discipline Score (% trades matching plan)

### Success Criteria (Monthly)
- Win Rate: >50%
- Profit Factor: >1.5
- Risk/Reward: Average >2:1
- Discipline: >90% plan adherence
- Drawdown: <10%
- Return: >5% monthly (stretch goal)

---

## PLAN REVIEW & UPDATES

### Weekly Review
- Review all trades for the week
- Calculate performance metrics
- Identify best and worst setups
- Adjust watchlist and market focus
- Update market conditions in WINGMAN_CONTEXT.md

### Monthly Review
- Full performance analysis
- Strategy effectiveness evaluation
- Risk management assessment
- Plan adjustments if needed (document changes)
- Goals for next month

### When to Update This Plan
1. Strategy not working (after 20+ trade sample)
2. Risk tolerance changes
3. Account size changes significantly (>20%)
4. Market regime shift (trend to range, etc.)
5. New strategy proven through testing
6. Consistent rule violations (adjust plan to reality)

---

## EMERGENCY PROTOCOLS

### If Account Down 10%
1. STOP all trading immediately
2. Full review of all trades with Wingman
3. Identify what went wrong (strategy, discipline, market)
4. Adjust plan or reduce risk to 0.5% per trade
5. Paper trade until confidence restored
6. Resume with smaller size

### If Account Down 20%
1. STOP all trading for 1 week
2. Complete system review
3. Consider external review (mentor, trading group)
4. Rebuild from fundamentals
5. Return with 0.25% risk per trade
6. Prove consistency before scaling up

### If Emotional Compromise
- Feeling revenge, FOMO, fear, overconfidence
- STOP and step away from screens
- Journal the emotions
- Talk to Wingman about what's happening
- Don't trade until objective and calm
- Consider ending day early

---

**END OF TRADING PLAN**

This is a living document. Update as you learn and grow.
Discipline + Edge + Time = Success

Next: [ACTIVE_SESSION.md](../data/ACTIVE_SESSION.md)
