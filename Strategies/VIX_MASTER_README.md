# VIX Master Indicator - Documentation

Comprehensive VIX trading system for ThinkOrSwim based on proven, backtested strategies.

---

## Files

| File | Type | Purpose |
|------|------|---------|
| `VIX_Master_Indicator.ts` | Lower study | Full VIX chart with all signals, bands, thresholds |
| `VIX_Master_Labels.ts` | Upper study | Labels and arrows on SPY/QQQ chart |

---

## 5 Proven Strategies Included

### 1. CVR3 VIX Market Timing (Connors/Landry)

**Win Rate: 68%**

The most reliable VIX signal with documented backtesting from 2000+.

**Buy Signal Rules:**
1. VIX low must be ABOVE its 10-day moving average (entire bar above MA)
2. VIX close must be at least 10% above its 10-day moving average
3. Buy on the close

**Sell Signal Rules:**
1. VIX high must be BELOW its 10-day moving average (entire bar below MA)
2. VIX close must be at least 10% below its 10-day moving average
3. VIX close > VIX open (green candle)

**Exit:**
- Exit when VIX crosses back through the 10-day MA (mean reversion)
- Or exit within 2-4 days

**Source:** Larry Connors & Dave Landry
- https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/cvr3-vix-market-timing

---

### 2. VIX Stretch Strategy (Connors/Alvarez)

**Win Rate: 58% | Avg Gain: 0.23% per trade | Profit Factor: 1.5**

From "Short Term Trading Strategies That Work" (2009).

**Buy Signal Rules:**
1. SPY/SPX must be above its 200-day moving average (uptrend filter)
2. VIX must be stretched 5% or more above its 10-day moving average
3. VIX must stay stretched for 3 or more consecutive days
4. Buy on the close when condition 3 is met

**Exit:**
- Exit when SPY RSI(2) crosses above 65

**Key Finding:** Stretch values between 5-10% work best. Above 10%, returns fall off (market likely to continue falling).

**Source:** Larry Connors & Cesar Alvarez
- https://easycators.com/thinkscript/vix-stretches-trading-strategy-for-the-spy-or-spx-from-short-term-trading-strategies-that-work-by-connors-alvarez/

---

### 3. VIX RSI Strategy (Connors/Alvarez)

**Win Rate: ~60%**

Combines VIX overbought conditions with SPY oversold conditions.

**Buy Signal Rules:**
1. SPY must be above its 200-day moving average
2. SPY RSI(2) must be below 30 (oversold)
3. VIX RSI(2) must be above 90 (fear extreme)
4. VIX must open above prior day's close
5. Buy on the close

**Exit:**
- Exit when SPY RSI(2) crosses above 65

**Source:** Larry Connors & Cesar Alvarez
- https://easycators.com/thinkscript/vix-rsi-strategy-for-thinkorswim-by-connors-and-alvarez-from-short-term-trading-strategies-that-work/

---

### 4. Bollinger Band Re-Entry + Stretch Filter

**Win Rate: Positive expectancy (varies by filter)**

Classic mean reversion signal with added stretch filter for quality.

**Buy Signal Rules:**
1. Yesterday: VIX closed ABOVE the upper Bollinger Band (20, 2)
2. Today: VIX closes BACK INSIDE the upper Bollinger Band
3. Filter: Yesterday's close was at least 20% above the 20-day MA
4. SPY above 200-day MA (optional trend filter)

**Key Finding:** Every occurrence with 20% stretch filter showed positive returns within 2-20 days, except during regime changes (COVID March 2020).

**Caution:** VIX spikes in bull markets fade quickly. In bear markets, VIX can ride the upper band for extended periods.

**Source:** Options Hawk, Dr. Alexander Elder
- https://optionshawk.com/vix-rubber-band-reversion-setup/
- https://swingtradebot.com/blog/trading-the-vix-using-bollinger-bands

---

### 5. JPMorgan 50% Spike Signal

**Historical contrarian signal from institutional research.**

**Buy Signal Rules:**
1. VIX increases more than 50% above its 20-day (1-month) moving average
2. This indicates extreme fear and potential market bottom

**Source:** JPMorgan Research (Mislav Matejka)
- https://thinkscript101.com/vix-buy-signal-indicator-for-thinkorswim/

---

## VIX Regime Classification

| VIX Level | Regime | Trading Implication |
|-----------|--------|---------------------|
| < 12 | **COMPLACENT** | Spike probable - tighten stops, trim positions |
| 12-20 | **NORMAL** | Standard conditions |
| 20-30 | **ELEVATED** | Watch for setups forming |
| 30-40 | **FEAR** | Quality entries emerging |
| > 40 | **CAPITULATION** | Scale in - historically near bottoms |

**Historical Note:** VIX hit 89 on October 27, 2008 - the highest ever recorded.

---

## VIX Term Structure (VIX vs VIX3M)

The ratio of VIX to VIX3M reveals market fear structure.

| Ratio | State | Meaning |
|-------|-------|---------|
| < 1.0 | **Contango** | Normal - near-term calm, futures curve upward |
| > 1.0 | **Backwardation** | Fear - near-term panic, futures curve inverted |
| > 1.10 | **Steep Backwardation** | Extreme fear - contrarian buy signal |

**Key Finding:** VIX futures are in contango 80%+ of the time. Backwardation is relatively rare and signals panic.

**Research:** Inverted VIX curve has significant positive relation with subsequent S&P 500 returns. Normal curves did not have significant predictive power.

**Source:**
- https://macrosynergy.com/research/vix-term-structure-as-a-trading-signal/
- http://vixcentral.com/

---

## Composite Signal Scoring

The indicator counts how many of the 5 strategies are currently triggering:

| Signals | Interpretation |
|---------|----------------|
| 0 | No actionable setup |
| 1 | Single signal - proceed with caution |
| 2+ | **HIGH CONVICTION** - multiple strategies confirm |
| 3+ | Very strong setup |

---

## Installation Instructions

### ThinkOrSwim

1. Open ThinkOrSwim platform
2. Go to **Charts** tab
3. Click **Studies** > **Edit Studies**
4. Click **Create** button (bottom left)
5. Name it "VIX_Master_Indicator" or "VIX_Master_Labels"
6. Delete default code and paste the script
7. Click **OK** to save

### Applying the Studies

**Lower Study (VIX_Master_Indicator.ts):**
- Add to a VIX chart
- Shows full visualization with bands, thresholds, and arrows

**Upper Study (VIX_Master_Labels.ts):**
- Add to your SPY, QQQ, or any equity chart
- Shows labels and buy/sell arrows on price

---

## Configurable Inputs

| Input | Default | Description |
|-------|---------|-------------|
| showCVR3Signal | yes | Show CVR3 signals |
| showStretchSignal | yes | Show VIX Stretch signals |
| showRSISignal | yes | Show VIX RSI signals |
| showBBSignal | yes | Show Bollinger Band signals |
| showJPMorganSignal | yes | Show 50% spike signals |
| showTermStructure | yes | Show VIX/VIX3M ratio |
| showRegimeLabel | yes | Show VIX regime classification |
| useTrendFilter | yes | Require SPY > 200 MA |
| enableAlerts | yes | Sound alerts on signals |

---

## Backtest Performance Summary

| Strategy | Win Rate | Avg Gain/Trade | Time in Market | Max Drawdown |
|----------|----------|----------------|----------------|--------------|
| CVR3 | 68% | - | Short-term (2-4 days) | - |
| VIX Stretch | 58% | 0.23% | 10% | 16% |
| VIX RSI | ~60% | - | Short-term | - |
| BB Re-entry | Positive | - | 2-20 days | - |

**Note:** These are short-term mean reversion strategies. They are designed to capture quick reversals, not hold for extended periods.

---

## Important Caveats

1. **Trend Filter Matters:** All strategies work better when SPY is above its 200-day MA. Counter-trend signals in bear markets are less reliable.

2. **Regime Changes:** During major volatility regime shifts (like March 2020), VIX can stay elevated for extended periods. The 20% stretch filter helps avoid these.

3. **Not for VIX Products:** These strategies are for timing SPY/SPX entries. If you're trading VIX futures or UVXY/VXX, you need different approaches due to contango decay.

4. **Short-Term Focus:** Exit within 2-4 days typically. These are not swing or position trades.

5. **Combine with Price Action:** CVR3 buy signals should be matched with bullish indications on SPY chart. Don't trade signals blindly.

---

## Sources & Further Reading

### Primary Sources
- Connors, Larry & Alvarez, Cesar. "Short Term Trading Strategies That Work" (2009)
- Connors, Larry & Landry, Dave. "Trading Connors VIX Reversals"
- StockCharts ChartSchool: https://chartschool.stockcharts.com/

### Research Papers & Articles
- [CVR3 VIX Market Timing](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/cvr3-vix-market-timing)
- [VIX Term Structure as Trading Signal](https://macrosynergy.com/research/vix-term-structure-as-a-trading-signal/)
- [QuantifiedStrategies - VIX Trading](https://www.quantifiedstrategies.com/vix-trading-strategy/)
- [Options Hawk - VIX Rubber Band](https://optionshawk.com/vix-rubber-band-reversion-setup/)
- [TuringTrader - Connors VIX RSI](https://www.turingtrader.com/portfolios/connors-vix-rsi/)

### ThinkorSwim Resources
- [Official TOS VIX_Timing](https://toslc.thinkorswim.com/center/reference/Tech-Indicators/strategies/T-Z/VIX-Timing)
- [Easycators VIX Strategies](https://easycators.com/indicators/vix/)
- [useThinkScript VIX Indicators](https://usethinkscript.com/threads/vix-fear-greed-mean-reversion-indicator-for-thinkorswim.115/)

---

## Changelog

**v1.0 (January 2026)**
- Initial release
- 5 backtested strategies
- VIX regime classification
- Term structure monitoring
- Composite signal scoring
