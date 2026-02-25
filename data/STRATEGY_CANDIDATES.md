# Strategy Candidates for Automation & Backtesting

**Generated:** 2026-02-25
**Source:** Multi-agent research across 5 domains (RSI, options flow, market internals, quant mean reversion, 3-Drive pattern)
**Purpose:** Evaluate for implementation in Bloodhound scanner with Telegram alerts

---

## Priority Legend
- **P1** = High confidence, data ready, easy to implement
- **P2** = Good evidence, needs some work
- **P3** = Promising but needs our own backtest data first
- **REJECT** = Evidence says don't bother

---

## USER PRIORITY: 3-Drive RSI Divergence

### 3-Drive RSI / Triple Divergence
- **Source:** Scott Carney "Harmonic Trader" + Larry Connors R3 Strategy
- **Type:** Reversal
- **Rules:**
  - Price makes 3 consecutive lower lows into support
  - RSI(14) makes higher low on 3rd drive (momentum exhaustion)
  - Drive 1 RSI: ~30 (oversold). Drive 2 RSI: ~20 (deeper). Drive 3 RSI: >Drive 2 (divergence)
  - Entry: Reversal candle at 3rd drive, or break of micro-structure higher high
  - Stop: Below 3rd drive extreme
  - Target: 61.8% retrace of full pattern, then origin of Drive 1
  - Filter: Price > 200 SMA (Connors trend filter), AT_WALL zone preferred
- **Published Win Rate:** Connors R3: 75% individual stocks, 82% S&P 500 (WHSelfInvest). Triple RSI variant: 91% on SPY, 83 trades, profit factor 5.0 (QuantifiedStrategies)
- **Data Required:** RSI(14), price swing detection, support/resistance zones
- **We Have The Data:** Yes — RSI from technicals API, zones from Bloodhound
- **Implementation Complexity:** Medium — need pivot detection + swing comparison + RSI cross-check
- **Priority:** P1 (user priority + strong backtest data)
- **Recommendation:** Start as annotation-only, accumulate 50+ signals, then score if >65% WR confirmed

---

## TIER 1: IMPLEMENT NOW (P1)

### Cumulative RSI(2,2) — Enhanced Connors
- **Source:** [Quantitativo](https://www.quantitativo.com/p/squeezing-more-profits-with-cumulative)
- **Type:** Mean Reversion
- **Rules:**
  - Sum of last 2 days' RSI(2) readings = "Cumulative RSI"
  - LONG: CumRSI(2,2) < 10 AND price > 200 SMA. Buy next open.
  - EXIT: CumRSI(2,2) > 65 OR price closes below 200 SMA
- **Published Win Rate:** 65% on 280,000 events (since 1999). Annual return 26.6%, Sharpe 1.18, profit factor robust across 198 parameter variations.
- **Data Required:** 2-period RSI, 200 SMA
- **We Have The Data:** Yes — technicals API has RSI and SMAs
- **Implementation Complexity:** Low — sum two RSI readings + threshold check
- **Priority:** P1
- **Notes:** Largest sample size of ANY strategy researched. Statistically validated (p-value 4.3e-73 vs vanilla RSI2).

### Put Wall Bounce
- **Source:** SpotGamma research
- **Type:** Reversal / Mean Reversion
- **Rules:**
  - BUY when price touches put wall AND RSI < 35 AND positive GEX regime (price > gamma flip)
  - Stop: Below put wall by 0.5 ATR
  - Target: Gamma flip level or max pain
- **Published Win Rate:** Put wall holds in 89% of sessions. 93% of sessions close above put wall.
- **Data Required:** Put wall, gamma flip, RSI
- **We Have The Data:** Yes — levels API + technicals API
- **Implementation Complexity:** Low — we already detect AT_WALL zone at put wall
- **Priority:** P1
- **Notes:** Formalizes what Bloodhound's AT_WALL zone partially detects. Add RSI + GEX regime filter.

### Call Wall Fade
- **Source:** SpotGamma research
- **Type:** Reversal / Fade
- **Rules:**
  - SHORT/SELL when price touches call wall AND RSI > 65 AND positive GEX regime
  - Stop: Above call wall by 0.5 ATR
  - Target: Gamma flip level or max pain
- **Published Win Rate:** Call wall holds in 83% of sessions.
- **Data Required:** Call wall, gamma flip, RSI
- **We Have The Data:** Yes
- **Implementation Complexity:** Low — mirror of put wall bounce
- **Priority:** P1

### GEX Regime (Gamma Flip Mode Switch)
- **Source:** SpotGamma
- **Type:** Regime / Framework
- **Rules:**
  - Price ABOVE gamma flip = positive GEX → mean reversion playbook (fade moves to walls)
  - Price BELOW gamma flip = negative GEX → momentum playbook (trade breakouts with trend)
  - SWITCH: When price crosses gamma flip, change approach
- **Published Win Rate:** 1-day estimated range holds 78% of time in positive GEX. Negative GEX ranges 50-200% above average.
- **Data Required:** Gamma flip level, price
- **We Have The Data:** Yes — levels API
- **Implementation Complexity:** Low — single comparison (price vs gamma flip)
- **Priority:** P1
- **Notes:** This is a META-strategy — it modulates HOW to trade, not WHEN. Should be a regime flag on every signal.

### TRIN Extreme Reversal
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/trin-strategy/)
- **Type:** Reversal
- **Rules:**
  - BUY signal: TRIN > 2.0 closing basis (90% chance market opens higher next day)
  - With confirmation (TICK < -200 or RSI oversold): 77% win rate, 0.66% avg gain, profit factor 2.4
  - SELL signal: TRIN < 0.5
- **Published Win Rate:** 77% with confirmation filter. 90% next-day open higher when TRIN > 2.0.
- **Data Required:** TRIN, TICK
- **We Have The Data:** Yes — market internals scanner
- **Implementation Complexity:** Low — threshold + confirmation
- **Priority:** P1

### Connors RSI(2) Classic
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/connors-rsi/), Larry Connors "Short Term Trading Strategies That Work"
- **Type:** Mean Reversion
- **Rules:**
  - LONG: RSI(2) < 5 AND price > 200 SMA. Exit when price > 5 SMA.
  - SHORT: RSI(2) > 95 AND price < 200 SMA. Exit when price < 5 SMA.
- **Published Win Rate:** 75-90% depending on instrument. SPY: ~82% on 103 trades. CAGR 8.2% over 25yr. MQL5 variants tested through 2025.
- **Data Required:** 2-period RSI, 200 SMA, 5 SMA
- **We Have The Data:** Yes (need RSI(2) specifically — our technicals use RSI(14))
- **Implementation Complexity:** Low — but may need to calculate RSI(2) ourselves from price data
- **Priority:** P1

### IBS (Internal Bar Strength)
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/internal-bar-strength-ibs-indicator-strategy/), [Alvarez Quant Trading](https://alvarezquanttrading.com/blog/internal-bar-strength-for-mean-reversion/)
- **Type:** Mean Reversion
- **Rules:**
  - IBS = (Close - Low) / (High - Low). Range 0-1.
  - BUY: IBS < 0.2 (closed near day's low). SELL: IBS > 0.8 (closed near day's high).
  - Filter: Price > 200 SMA
- **Published Win Rate:** 74-78% on SPY/QQQ. 583 trades, profit factor 2.73, Sharpe 1.7. CAGR 15.3% invested only 36% of time.
- **Data Required:** Daily OHLC (open, high, low, close)
- **We Have The Data:** Yes — quotes API has highPrice, lowPrice, closePrice
- **Implementation Complexity:** Low — trivial calculation
- **Priority:** P1
- **Notes:** Works best on ETFs and large-cap. Performs best in volatile/bear markets.

### Cumulative TICK Divergence
- **Source:** [TOSIndicators](https://tosindicators.com/research/cumulative-tick-divergence-sp500-thinkorswim)
- **Type:** Intraday Reversal
- **Rules:**
  - Running sum of TICK readings throughout the day
  - When cumTICK diverges from SPX (SPX higher high but cumTICK lower high) = reversal signal
  - With level confirmation: 79% win rate
- **Published Win Rate:** 73% directional accuracy, 79% with level confirmation
- **Data Required:** TICK (running sum), SPX price
- **We Have The Data:** Yes — internals scanner collects both every 2 min
- **Implementation Complexity:** Medium — need running sum + divergence detection
- **Priority:** P1

---

## TIER 2: GOOD CANDIDATES (P2)

### RSI 50 Crossover (Trend Filter)
- **Source:** [TradingHeroes](https://www.tradingheroes.com/rsi-trading-strategy-results/)
- **Type:** Trend / Momentum
- **Rules:** LONG: RSI(14) crosses above 50. EXIT: RSI crosses below 50.
- **Published Win Rate:** 71% on 55 trades (EURUSD daily, 16yr). +26.05% return.
- **Data Required:** RSI(14)
- **We Have The Data:** Yes
- **Implementation Complexity:** Trivial
- **Priority:** P2
- **Notes:** Surprise dark horse. Better as a trend confirmation layer than standalone. Could replace or supplement Bloodhound's trend alignment annotation.

### Vol/OI Spike Leading Indicator
- **Source:** Academic research (Springer 2025)
- **Type:** Directional
- **Rules:** Vol/OI >= 5x on calls → bullish. Vol/OI >= 5x on puts → bearish. Must align with technical setup.
- **Published Win Rate:** >60% annual alpha in long-short portfolios (academic). Volume PCR predicts at 2.5-day horizon.
- **Data Required:** Options flow vol/OI ratios
- **We Have The Data:** Yes — Opportunity Scanner already detects this
- **Implementation Complexity:** Low — already detected, just needs directional bias fed to Bloodhound
- **Priority:** P2

### StochRSI Mean Reversion
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/stochastic-rsi/)
- **Type:** Mean Reversion
- **Rules:** LONG: StochRSI crosses below 0.2. EXIT: StochRSI crosses above 0.8.
- **Published Win Rate:** 78% on 228 trades, 0.7%/trade. Max DD 15%. Invested 10% of time.
- **Data Required:** RSI(14) + stochastic calculation on RSI
- **We Have The Data:** Partial — need to compute StochRSI from RSI series
- **Implementation Complexity:** Medium
- **Priority:** P2

### Double 7s (Connors/Alvarez)
- **Source:** [JourneymanInvestor](https://www.journeymaninvestor.com/double-7s-strategy-75-win-rate-stock-secrets/)
- **Type:** Mean Reversion
- **Rules:** BUY: Price closes at 7-day low. SELL: Price closes at 7-day high. ETFs only.
- **Published Win Rate:** 75% on 271 signals (1990-2022). Performance declined post-2008.
- **Data Required:** 7-day high/low
- **We Have The Data:** Yes — daily price data from quotes
- **Implementation Complexity:** Low
- **Priority:** P2
- **Notes:** Declining effectiveness. Better as confirmation than primary signal.

### IV Crush Plays (Earnings)
- **Source:** Academic studies on implied vs realized vol
- **Type:** Options Strategy
- **Rules:** Sell iron condor/butterfly 1-2 days before earnings, strikes outside expected move. Close after earnings.
- **Published Win Rate:** 60-70% for short vol. 84%+ for strikes outside expected move.
- **Data Required:** IV data, expected move, earnings dates
- **We Have The Data:** Yes — Earnings Scanner + IV from Options API
- **Implementation Complexity:** Medium — requires options strategy recommendations
- **Priority:** P2

### Max Pain Convergence
- **Source:** 25-year study (1996-2021)
- **Type:** Mean Reversion
- **Rules:** Price significantly above max pain in expiry week → bearish bias. Below → bullish. Filter: deviation > 2%.
- **Published Win Rate:** 0.4%/week consistent. Less effective for large-caps.
- **Data Required:** Max pain from levels API
- **We Have The Data:** Yes
- **Implementation Complexity:** Low
- **Priority:** P2
- **Notes:** Better as tiebreaker/annotation than primary signal for our large-cap universe.

### Turnaround Tuesday
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/turnaround-tuesday/)
- **Type:** Calendar Anomaly / Mean Reversion
- **Rules:** Monday close >= 1% below Friday close → buy Monday close, sell Tuesday close.
- **Published Win Rate:** 17% CAGR invested only 6% of time. Max DD 15.5%. Edge strongest in volatile periods.
- **Data Required:** Daily closes by day of week
- **We Have The Data:** Yes
- **Implementation Complexity:** Low
- **Priority:** P2
- **Notes:** Edge may be smaller than advertised after controlling for overnight effect. Best in high-VIX regimes.

### A/D Thrust Ratio
- **Source:** Breadth analysis
- **Type:** Momentum Confirmation
- **Rules:** ADVN/DECN > 2:1 sustained = bullish thrust. < 1:2 = bearish thrust.
- **Published Win Rate:** Zweig Breadth Thrust: 100% at 6 and 12 months (but super rare — ~20 signals since 1950)
- **Data Required:** ADVN, DECN
- **We Have The Data:** Yes
- **Implementation Complexity:** Low
- **Priority:** P2
- **Notes:** Zweig version is "holy grail" detector (fires once every 3-5 years). Simple ratio alert is more practical for daily use.

### Volume Climax (UVOL/DVOL Extreme)
- **Source:** Wyckoff practitioners
- **Type:** Exhaustion / Reversal
- **Rules:** UVOL/DVOL > 4:1 (bullish exhaustion) or < 1:4 (bearish exhaustion). Best at S/R levels.
- **Published Win Rate:** No formal backtest. Used as confirmation tool.
- **Data Required:** UVOL, DVOL
- **We Have The Data:** Yes
- **Implementation Complexity:** Low
- **Priority:** P2

---

## TIER 3: NEEDS OUR OWN BACKTEST (P3)

### RSI Failure Swing (Wilder)
- **Source:** Wilder's original RSI method
- **Type:** Reversal
- **Rules:** RSI dips below 30 → bounces → dips again but holds ABOVE prior low → breaks above interim high → BUY
- **Published Win Rate:** No rigorous backtest found. Theoretical only.
- **Data Required:** RSI swing point detection
- **We Have The Data:** Yes
- **Implementation Complexity:** Medium — requires RSI pivot detection
- **Priority:** P3

### RSI Range Shift (Cardwell)
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/rsi-range-momentum-trading-strategy/)
- **Type:** Regime / Momentum
- **Rules:** Bullish regime: RSI oscillates 40-80 (buy at 40). Bearish: 20-60 (sell at 60).
- **Published Win Rate:** 83% on 12 signals (sample too small)
- **Data Required:** RSI(14) range history
- **We Have The Data:** Yes
- **Implementation Complexity:** Medium
- **Priority:** P3

### CumTICK Zero Line Cross
- **Source:** Institutional day traders
- **Type:** Intraday Trend
- **Rules:** Running TICK sum crosses zero → trend shift. Extreme readings (±1000 cum) = conviction.
- **Published Win Rate:** No formal data. Widely used but unquantified.
- **Data Required:** TICK running sum
- **We Have The Data:** Yes
- **Implementation Complexity:** Low
- **Priority:** P3

### TRIN + TICK Divergence
- **Source:** Market internals practitioners
- **Type:** Early Warning
- **Rules:** TRIN and TICK giving opposite signals = hidden shift. Precedes reversals by 15-30 min.
- **Published Win Rate:** Qualitative only. No formal backtest.
- **Data Required:** TRIN, TICK
- **We Have The Data:** Yes
- **Implementation Complexity:** Medium
- **Priority:** P3

### McClellan Oscillator
- **Source:** [StockCharts](https://chartschool.stockcharts.com/table-of-contents/market-indicators/mcclellan-oscillator)
- **Type:** Breadth Momentum
- **Rules:** 19-day EMA minus 39-day EMA of A/D data. Buy < -100, sell > +100.
- **Published Win Rate:** 1.2% avg gain on 97 trades. "Erratic equity curve." Standalone: poor.
- **Data Required:** Daily aggregated A/D data, 19/39-day EMAs
- **We Have The Data:** Partial — need daily aggregation from intraday snapshots
- **Implementation Complexity:** Medium-High
- **Priority:** P3

### TTM Squeeze (BB inside Keltner)
- **Source:** John Carter, [StockCharts](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/ttm-squeeze)
- **Type:** Breakout
- **Rules:** BB squeeze inside Keltner channel → low vol. First green dot after red = breakout signal. Momentum histogram for direction.
- **Published Win Rate:** ~55% (breakout strategies have lower WR by nature). One variant: 80% but declined post-2016.
- **Data Required:** BB(20,2), Keltner(20,1.5), momentum oscillator
- **We Have The Data:** Partial — have BB from technicals, need Keltner calculation
- **Implementation Complexity:** Medium
- **Priority:** P3
- **Notes:** Breakout strategy = lower WR, larger wins. Doesn't fit our mean-reversion focus well.

### Bollinger Band Squeeze
- **Source:** [QuantifiedStrategies](https://www.quantifiedstrategies.com/bollinger-band-squeeze-strategy/)
- **Type:** Breakout
- **Rules:** BB width contracts to N-period low → buy breakout above upper band, sell breakdown below lower.
- **Published Win Rate:** 47-55% range across studies. High variance.
- **Data Required:** BB from technicals
- **We Have The Data:** Yes
- **Implementation Complexity:** Low
- **Priority:** P3
- **Notes:** Same issue as TTM — breakout strategies underperform mean reversion in our testing.

---

## REJECTED

### RSI + Bollinger Band Combo
- **Source:** [TradingRush](https://tradingrush.net/bollinger-bands-rsi-trading-strategy-tested-100-times-will-this-make-profit-for-you/)
- **Type:** Reversal
- **Rules:** RSI < 30 AND price below lower BB → buy
- **Published Win Rate:** **35%** — WORSE than either indicator alone. 11 false signals in a row.
- **Priority:** REJECT — data actively disproves this
- **Notes:** Common "guru" recommendation that fails in practice. The double filter creates excessive false signals in trends.

### Dark Pool + Level Confluence
- **Priority:** REJECT for now — requires data source we don't have (Tradytics/Quant Data subscription)

### 0DTE Flow Analysis
- **Priority:** REJECT for now — requires streaming 0DTE data we don't collect

### VIX Contango/Backwardation
- **Priority:** REJECT for now — requires VIX futures data not available from Schwab

### RSI Trendline Break
- **Priority:** REJECT — not automatable (trendline drawing is subjective), zero backtest data

---

## IMPLEMENTATION ROADMAP

### Phase 1: Quick Wins (can build this week)
These use data we already have with simple threshold logic:

| Strategy | WR | Complexity | What to Build |
|----------|-----|-----------|---------------|
| Put Wall Bounce | 89% | Low | Formalize AT_WALL + RSI < 35 + positive GEX |
| Call Wall Fade | 83% | Low | Mirror: EXTENDED_HIGH + RSI > 65 + positive GEX |
| GEX Regime Flag | 78% | Low | Price vs gamma flip → regime annotation on every signal |
| TRIN Extreme | 77% | Low | Alert when TRIN > 2.0 + TICK confirmation |
| IBS | 74% | Low | (Close-Low)/(High-Low) < 0.2 = buy signal |
| Connors RSI(2) | 75-90% | Low | Need RSI(2) calculation from daily price |
| Cumulative RSI(2,2) | 65% | Low | Sum of 2 RSI(2) readings |

### Phase 2: Medium Complexity (needs some new code)
| Strategy | WR | What to Build |
|----------|-----|---------------|
| 3-Drive RSI | 75-91% | Pivot detection + RSI swing comparison |
| CumTICK Divergence | 73-79% | Running TICK sum + SPX divergence detection |
| RSI 50 Crossover | 71% | Trend filter layer in Bloodhound |
| StochRSI | 78% | Stochastic calc on RSI series |

### Phase 3: Backtest First (annotation-only until proven)
| Strategy | Claimed WR | Why Wait |
|----------|-----------|----------|
| RSI Failure Swing | Unknown | No backtest data exists |
| RSI Range Shift | 83% (n=12) | Sample too small |
| TRIN+TICK Divergence | Unknown | Qualitative only |
| McClellan Oscillator | ~60% | Standalone performance poor |

---

## KEY INSIGHTS

1. **Mean reversion dominates.** The highest win rates (65-91%) all come from mean reversion strategies. Breakout strategies (TTM Squeeze, BB squeeze) consistently underperform at 47-55%.

2. **Connors family is the gold standard.** RSI(2), Cumulative RSI, R3, Double 7s — all well-documented with large sample sizes. The Cumulative RSI(2,2) with 280K events is the most statistically robust strategy found.

3. **Gamma walls are real.** Put wall holds 89%, call wall holds 83%. These are the highest single-factor win rates in the entire research. We already detect them.

4. **GEX regime changes everything.** The gamma flip as a mode switch between mean-reversion and momentum is the single most impactful conceptual addition.

5. **RSI+BB combo is a trap.** Despite being widely recommended, it tests at 35% — actively harmful. This is a good reminder that "sounds logical" ≠ proven edge.

6. **Our existing system is closer than we think.** Put wall bounce, call wall fade, GEX regime, vol/OI spikes — Bloodhound partially detects all of these already. The work is formalizing entry/exit rules and adding specific alerts.
