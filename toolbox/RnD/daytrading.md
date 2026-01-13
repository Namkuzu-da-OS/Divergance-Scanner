# Profitable day trading strategies: the empirical evidence

**The most consistently profitable intraday strategies for SPY and QQQ show Sharpe ratios between 1.1 and 3.0 in academic backtests, though real-world implementation reveals significant decay and survival rates below 5%.** First-half-hour to last-half-hour momentum, cross-sectional end-of-day reversal, and opening range breakouts with catalyst filters demonstrate the strongest statistical validation, while simple technical patterns have eroded to unprofitability. This report synthesizes peer-reviewed research, institutional trading data, and practitioner backtests to rank the ten most viable strategies by risk-adjusted returns and current edge persistence.

---

## The academic foundation: what rigorous testing actually shows

The most cited study in intraday ETF trading remains Gao, Han, Li, and Zhou's 2018 Journal of Financial Economics paper "Market Intraday Momentum," which tested SPY from 1993-2013. Their central finding: the first half-hour return (9:30-10:00 AM) predicts the last half-hour return (3:30-4:00 PM) with a t-statistic of **4.08** and out-of-sample R² of **1.4%**. The market timing strategy generated a **Sharpe ratio of 1.08** and annualized returns of **6.67%** after transaction costs.

Cross-asset testing revealed the pattern extends to all major ETFs. QQQ showed in-sample R² of 1.43% with certainty equivalent returns of **7.38% annually**, while IYR (real estate) achieved the highest returns at **14.98%** CER. The predictability intensifies during high-volatility periods—during the 2007-2009 financial crisis, R² jumped to **6.9%** for the combined model.

More recent work by Zarattini, Aziz, and Barbon (Swiss Finance Institute, May 2024) refined this approach using intraday breakout signals based on 14-day average absolute deviation from open. Their SPY backtest from 2007-2024 generated **1,985% total return** with a **Sharpe ratio of 1.33** and annualized returns of **19.6%**—substantially outperforming the original Gao et al. methodology. Maróy (2025) pushed performance further by optimizing exit strategies, achieving Sharpe ratios exceeding **3.0** with VWAP-based and ladder exit approaches.

---

## The strategy rankings: ten approaches ordered by evidence strength

### 1. First-to-last half-hour momentum (Sharpe 1.08-1.33)

The strongest academically-validated edge with the deepest sample history. The strategy observes the return from market open to 10:00 AM and takes a directional position in the last 30 minutes. Key parameters from Gao et al.: **54.37% success rate**, **6.67% annualized return**, survives transaction costs post-decimalization. QuantConnect implementation showed the strategy **outperformed during the 2020 crash** with Sharpe of 1.452 and exhibited lower volatility than benchmark throughout all periods. The edge strengthens during recession periods, macro news days, and high VIX environments.

### 2. End-of-day cross-sectional reversal (9.5-17.3% annual)

Baltussen, Da, and Soebhag's April 2025 working paper documented that stocks' intraday returns reverse direction in the final 30 minutes. A long-short portfolio buying intraday losers and selling winners generated **value-weighted daily returns of 3.78 basis points** (t-stat 10.69) with a six-factor alpha of 3.71 bps/day. Equal-weighted returns reached **6.38 bps daily** (t-stat 17.30), translating to **17.3% annualized**. The effect appeared in almost every rolling three-year window from 1993-2019 and proved robust across size and liquidity subgroups.

### 3. Overnight-intraday reversal (Sharpe 16+ in some markets)

Liu, Liu, Wang, Zhou, and Zhu documented that buying assets with the lowest past overnight returns generates daily returns of **1.02%** in Continental Europe and **0.74%** in Japan, with Sharpe ratios of **16.79** and **16.25** respectively. US stocks show the effect at **5x the magnitude of traditional reversal strategies**. Lou, Polk, and Skouras (Journal of Financial Economics, 2019) found overnight return hedge portfolios earn **-3.24% per month intraday** (t-stat -9.34), indicating strong predictable reversal.

### 4. Opening range breakout with catalyst filter (Sharpe 2.4-2.8)

Zarattini and Aziz's 2023 SSRN paper tested ORB on QQQ from 2016-2023, generating **33% annualized alpha** net of commissions. The strategy uses a 5-minute opening range and enters on breakouts with ATR-based stops. Critical finding: **68% of parameter combinations outperformed benchmark**, and beta was near-zero at **-0.042**. However, backtests on broader samples show the edge **requires filtering for "stocks in play"** (high-activity due to news catalysts). Without filters, Option Alpha found 60-minute ORB achieved **89.4% win rate** but recent Backtestedit.com tests (2022-2025) showed only **63% win rate with 0.51 Sharpe**—evidence of decay.

### 5. VWAP trend strategy (Sharpe 2.1, 671% return)

Zarattini and Aziz's SSRN Paper #4631351 tested a simple VWAP-based system on QQQ from January 2018 to September 2023: go long when price exceeds VWAP, short when below, using trailing stops and 2% volatility targeting. Results: **$25,000 grew to $192,656** (671% return) with **Sharpe ratio of 2.1** and maximum drawdown of **9.4%**—compared to buy-and-hold's 126% return, 37% drawdown, and 0.7 Sharpe. Using TQQQ (3x leveraged) generated **8,242% total return**. Important caveat: QuantConnect community review noted the study uses trade prices at bar close ignoring bid-ask spreads, with real transaction cost drag estimated at **16.7% of returns**.

### 6. Gap fade strategy (69-92% fill rate)

Quantified gap fill statistics show SPY gaps of **0.15% down fill 92% of the time same-day**, while **0.35% down gaps fill 69%**. The optimal strategy enters when gaps fall between **0.15% and 0.6%**—larger gaps show reduced mean reversion. Day-of-week analysis reveals Tuesday and Wednesday gap-downs show highest fill rates (**77% for NQ on Wednesday**), while Monday gap-ups offer **61% intraday fill rate**. The edge remains relatively stable through 2020-2025, though combining with ORB entry improves results.

### 7. Intraday residual reversal (162.3% annualized)

Brogaard, Han, and Kim's February 2024 SSRN paper documented that buying stocks with negative intraday residuals (from factor-based models) and selling positive residual stocks generated **162.3% annualized returns**. The strategy captures returns to liquidity provision against transitory price components. However, this represents gross returns before implementation costs on a broad stock universe—the precise SPY/QQQ applicability requires further validation.

### 8. RSI(2) mean reversion (62% win rate, 7.6% CAGR)

QuantConnect community backtests on SPY from 2010-2022 show aggressive RSI(2) oversold entries (below 15) with exit when close exceeds prior day's high generated **158% total profit** over 852 trades with **62% win rate** and **23.5% maximum drawdown**. CAGR of **7.57%** underperformed buy-and-hold but with reduced volatility exposure. QuantifiedStrategies found 5-day VWAP mean reversion achieved **8.18% CAGR** on SPY—short lookback mean reversion consistently outperformed trend-following approaches.

### 9. Statistical arbitrage ETF mean reversion (Sharpe 1.1-1.5)

Avellaneda and Lee's 2010 Quantitative Finance paper tested PCA-based and ETF-based mean reversion from 1997-2007. The ETF + Volume strategy achieved **Sharpe ratio of 1.51** from 2003-2007, though performance degraded significantly post-2002 and collapsed during the August 2007 quant crisis. This strategy requires institutional infrastructure and has shown substantial crowding effects.

### 10. Volatility filter breakout (5.6% CAGR, 4.6% time-in-market)

QuantifiedStrategies tested Larry Williams-style volatility breakouts with a critical filter: **trade only when SPY is below its 200-day moving average**. Results showed **0.7% average gain per trade** versus 0.12% without filter, with CAGR of **5.6%** while being invested only **4.6% of the time**. This represents an efficiency-maximizing approach for stressed market conditions where volatility expansion creates genuine breakout opportunities.

---

## Market microstructure: where retail edges exist and don't

The HFT industry demonstrates what's possible at the institutional level. CFTC data from Baron, Brogaard, and Kirilenko (2014) on E-mini S&P 500 futures revealed median HFT firm **Sharpe ratios of 4.3** with **22% annualized four-factor alpha**. Passive HFTs (market makers) achieved **Sharpe of 5.85**, while aggressive HFTs showed **90%+ alpha** with Sharpe of 4.29. Each rank improvement in speed correlates with **4x higher profits**.

These edges are inaccessible to retail. Federal Reserve research shows equity ETF mispricing averages **8.44 basis points** with half-life of 0.37 days, but exploitation requires AP status and **$25 million minimum for SPY creation units**. Spread capture economics show professional market makers profit approximately **$0.46 per contract** with 55% win rate—requiring sub-$0.10 transaction costs versus retail's $1-2.

The only microstructure edge accessible to retail is **optimal execution timing**. The U-shaped volume pattern shows trading at 9:30-10:00 AM and 3:00-4:00 PM offers tighter spreads and better fills, with estimated savings of **1-5 basis points per trade**. Avoiding the 12:45-13:00 lunch lull when volume drops 40-60% prevents adverse execution.

---

## Strategy decay: what has disappeared versus what remains

Maven Securities research quantifies alpha decay at **5.6% annually** in US markets and **9.9%** in Europe, with acceleration during volatility. Strategy lifespans by type: HFT edges last **days to weeks**, momentum-based algos **3-6 months**, swing systems **6-18 months**. Quant fund proliferation from 2,700 to 8,000+ has intensified crowding and erosion.

Evidence of persisting edges concentrates in **capacity-constrained niches**. University of St. Gallen research on ORB across 7,000+ US stocks found "Stocks in Play" (high activity from news catalysts) generated **1,600% total return** with **36% annualized alpha** net of costs—the limited capacity prevents crowding. SMB Capital's documented approach emphasizes exponential bet sizing: **1-2% risk for routine trades, 15-20% for A+ setups**, with "Stocks in Play" selection as the critical differentiator.

What has decayed to unprofitability: simple technical patterns, generic momentum without news catalysts, basic arbitrage, and all publicly-disclosed systematic strategies. The August 2007 quant meltdown demonstrated crowding's destructive potential, with coordinated unwinding creating cascading losses.

---

## Implementation reality: costs, capital, and survival rates

Day trading success rates are brutal: **13% achieve 6-month profitability**, **1%** remain profitable over 5+ years, and **72%** show net losses in any given year. Prop firm data reveals **7% payout rates** across 300,000 accounts, with **71% failing due to daily drawdown breaches**. Average traders purchase **7 challenge attempts** before achieving payout.

Transaction cost analysis shows effective round-trip costs of **0.06-0.08%** including spread, slippage, and fees. For 40 daily trades, this consumes **>4% of equity daily**. A 20,000-share SPY order experiences approximately **$0.036/share slippage** ($720 cost). Break-even requires **>0.1% gross profit per trade**—strategies with sub-5 bps edges are eliminated after fees.

Capital requirements: US Pattern Day Trader rules mandate **$25,000 minimum** for margin accounts. Practical minimums for meaningful income (**$50-100K annually**) require **$100,000-$250,000** in capital. Strategy capacity limits range from **$140K-$5M for short-term scalping** to **$5-10M for intraday momentum** before degradation—beyond which market impact erodes returns.

Infrastructure thresholds: competitive latency requires **<100 milliseconds**, achieved through direct market access, fiber connections, and trading VPS ($50-200/month). Co-location costs **$5,000-$50,000+ monthly** for HFT-level speed. Most retail infrastructure is adequate for strategies with minute-level holding periods but insufficient for sub-second edges.

---

## Conclusion: actionable rankings for systematic implementation

The empirical evidence supports a clear hierarchy for SPY/QQQ day trading:

**Tier 1 (Strong academic validation, persistent edge):** First-to-last half-hour momentum, end-of-day cross-sectional reversal, and overnight-intraday reversal strategies show Sharpe ratios of 1.0-1.5 with 15-25 year sample histories and statistical significance exceeding t=4. These edges survive transaction costs on liquid ETFs and show continued presence in 2020-2025 data.

**Tier 2 (Strong backtest results, requires filtering):** Opening range breakout and VWAP trend strategies achieve Sharpe 2.0+ in optimized backtests but require news/catalyst filters and careful parameter selection. Edge has partially decayed from widespread adoption. Gap fade strategies show 69-92% fill rates within defined parameters but represent lower-frequency opportunities.

**Tier 3 (Capacity-constrained or infrastructure-dependent):** Statistical arbitrage, residual reversal, and volatility breakout strategies show documented profitability but face severe crowding, require institutional infrastructure, or offer limited trade frequency.

The 1-4% survival rate reflects that most traders lack the combination of **sufficient capital ($100K+)**, **disciplined risk management** (1-2% per trade), **strategy adaptation** (3-6 month refresh cycles), and **implementation quality** (sub-0.1% transaction costs). The edges exist—exploiting them requires treating day trading as an infrastructure and risk management problem, not a signal generation problem.