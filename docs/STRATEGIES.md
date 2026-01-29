# STRATEGIES

## STRATEGY MATRIX

| Strategy | Type | Timeframe | Stop | Target | Min R:R |
|----------|------|-----------|------|--------|---------|
| Weekly Range | Swing | Daily | Beyond level + 1 ATR (Daily) | Opposite range extreme | 2:1 |
| VWAP Reversion | Scalp | 5/15min | Beyond swing + 0.5 ATR (max 1.5 ATR) | VWAP, then runner | 1.5:1 |
| MA Reversion | Both | Varies | 1 ATR beyond MA | Next MA or S/R | 2:1 |
| Mid-Point Range | Both | Daily | Beyond extreme + 1 ATR | 50% retrace, then 61.8% | 1.5:1 |
| Volatility Box | Scalp | 5/15min | Opposite side of box | 127% Fib extension | 2:1 |
| Golden Pocket + GEX | Both | 4H/Daily | Below -1 SD or 61.8% Fib | Call wall or 200 MA | 2:1 |
| **Smart Money Dip Buy** | Both | 4H/Daily | Below put wall (1-2%) | Gamma flip → Call wall | 2:1 |
| Earnings Flow Confluence | Swing | Daily | Below confluence zone | Call wall / Max pain | 2:1 |
| **VIX Fear Capitulation** | Swing | Daily | SPY swing low - 1 ATR | Hold 10-20 days | 2:1 |

## ENTRY DEFINITIONS

### Rejection Candle (required for most entries)
- Close is in opposite direction of move (bullish rejection = close > open after downmove)
- Close is in upper/lower 25% of candle range
- Wick extends beyond prior bar's extreme

### Momentum Shift
- RSI crosses above 50 (bullish) or below 50 (bearish)
- OR: Price closes back inside MA after penetration
- OR: MACD histogram changes direction

### Volume Confirmation
- Entry bar volume > 1.5x 20-bar average volume
- Without this: entry is lower probability

### Confluence
- Price within 0.5% of a key level (gamma wall, VWAP, MA, pivot)
- Multiple levels at same price = stronger confluence

## STRATEGY DETAILS

### 1. Weekly Range
| Component | Specification |
|-----------|---------------|
| Setup | Price at weekly high/low (within 0.5%) |
| Entry | Rejection candle + volume confirm |
| Stop | Beyond weekly level + 1 Daily ATR |
| Target | 50% at mid-range, runner to opposite extreme |
| Skip if | Mid-range, no rejection, news within 24h |

### 2. VWAP Reversion
| Component | Specification |
|-----------|---------------|
| Setup | Price 1.5-2.5 ATR from VWAP |
| Entry | Rejection candle OR RSI divergence + volume |
| Stop | Beyond swing + 0.5 ATR (max 1.5 ATR from entry) |
| Target | 50% at VWAP, 50% runner beyond |
| Skip if | ADX > 30, news-driven move, extension < 1.5 ATR |

### 3. MA Reversion
| Component | Specification |
|-----------|---------------|
| Setup | Price touches 20 EMA, 50 SMA, or 200 SMA |
| Entry | Momentum shift (close back inside) + confluence |
| Stop | 1 ATR beyond MA (use ATR matching trade type) |
| Target | Next MA level or major S/R |
| Skip if | Strong close beyond MA (> 1 ATR), counter-HTF trend |

### 4. Mid-Point Range
| Component | Specification |
|-----------|---------------|
| Setup | Price at range extreme (top/bottom 10%) |
| Entry | Rejection at extreme + momentum toward mid |
| Stop | Beyond extreme + 1 ATR |
| Target | Primary 50%, secondary 61.8% retracement |
| Skip if | Breakout beyond range, range < 2 ATR, mid already tested |

### 5. Volatility Box Breakout
| Component | Specification |
|-----------|---------------|
| Setup | Consolidation box (3+ touches each side) at key level |
| Entry | Breakout candle closes beyond box + volume > 2x average |
| Stop | Opposite side of box |
| Target | 127% Fib extension of box height |
| Skip if | Volume < 1.5x on breakout, no clear box (< 3 touches) |

### 6. Golden Pocket + GEX Reversion
| Component | Specification |
|-----------|---------------|
| Setup | Price at golden pocket (50-61.8% Fib), at/below put wall, RSI <35 |
| Entry | Bottoming tail reclaims VWAP OR close above -1 SD after touch |
| Stop | Below 61.8% Fib / -2 SD / inefficiency zone low |
| Target | T1: Gamma flip, T2: 200 MA, T3: Call wall |
| Skip if | VIX >25, counter-trend to SPY |

**Confluence Checklist (need 4+ of 6):**
- Golden pocket (50-61.8% Fib of recent swing)
- At/near put wall or GEX -1 SD band
- RSI oversold (<35) or recovering from <30
- Unusual call activity (>5x vol/OI)
- Key MA nearby (100/200 SMA flat or as support)
- VWAP reclaimed after dip

**The Trigger (TSLA Pattern Jan 2026):**
When RSI hits oversold AND unusual call activity appears together = smart money buying the dip.
This combination caused a +35 point score jump in the scanner and preceded a 3%+ move to call wall.

**Signal Progression Example:**
```
Score 48  → Technical only (BB lower, put wall)
Score 72  → RSI oversold + unusual calls (TRIGGER)
```

### 7. Smart Money Dip Buy (PRIMARY REVERSAL STRATEGY)
| Component | Specification |
|-----------|---------------|
| Setup | RSI < 30, at put wall support, unusual call activity (Vol > 2x OI) |
| Entry | Bounce confirmation at put wall, 4+ of 6 confluence factors |
| Stop | Below put wall (1-2% below entry) |
| Target | T1: Gamma flip (50%), T2: Call wall (remaining) |
| Skip if | Market-wide selloff, VIX > 35, put wall already broken |

**Core Requirements (need all 3):**
- RSI < 35 (oversold momentum reset)
- At/near put wall support (within 1%)
- Unusual CALL activity (Vol > 2x Open Interest)

**Confluence Factors (need 2+ of 4):**
- Earnings in 5-14 days (PREM window) ← **Primary catalyst**
- Lower Bollinger Band touch
- C/P ratio > 2x (call volume dominates)
- Net call premium > $1M (real money flow)

**Optional Boosters:**
- Golden Pocket (50-61.8% Fib) = higher conviction
- VELOCITY signal = watch for continuation
- Confluence zone (multiple levels at same price) = stronger support

**The Trigger (Auto-Detected by Bloodhound):**
When RSI low momentum + unusual CALL activity + at put wall support all align:
```
🎯 TRIGGER: Smart Money Dip Buy
```

**Historical Performance (Jan 20-23, 2026):**
| Symbol | Peak Gain | Days to Earnings | Key Factors |
|--------|-----------|------------------|-------------|
| META | +10.5% | 5-8 days (Jan 28) | RSI 28, put wall, unusual calls |
| TSLA | +6.8% | 5-8 days (Jan 28) | RSI 29, put wall, call flow |
| NVDA | +4.9% | No earnings | RSI 31, put wall, C/P 2.3x |
| MSFT | +4.4% | 5-8 days (Jan 28) | RSI 27, put wall, unusual calls |
| AAPL | +3.2% | 6-9 days (Jan 29) | RSI 12, put wall, C/P 6.8x |

**Key Insight:** 4 of 5 top wins were in the PREM window (5-10 days before earnings). Earnings timing is a primary driver of the unusual call activity we're detecting.

**Full documentation:** [Strategies/smart-money-dip-buy.md](../Strategies/smart-money-dip-buy.md)

**The Thesis:** When smart money accumulates calls at gamma-supported oversold levels ahead of earnings, they're positioning for the pre-earnings run-up. The put wall acts as a floor (gamma mechanics), RSI exhaustion signals selling is done, and call accumulation shows institutional buying. Earnings timing (5-14 days out) is the primary catalyst driving this activity. Follow them.

## TARGET EXITS

| Level | Action | Position |
|-------|--------|----------|
| 50% Fib | Take partial profit | Exit 50% of position |
| 61.8% Fib | Trail stop or exit runner | Exit remaining if momentum fades |
| 127% Fib | PRIMARY EXIT | Exit all remaining |

Runner = portion of position held past initial target when momentum continues.

## ATR MAPPING

| Trade Type | ATR Period | Chart |
|------------|------------|-------|
| Scalp | 10-period | 5/15min |
| Swing | 20-period | Daily |
| Intraday (longer) | 14-period | Hourly |

## OPTIONS FLOW STRATEGIES

See [Strategies/](../Strategies/) folder for detailed case studies and scanner-driven strategies.

### 8. Earnings Flow Confluence
| Component | Specification |
|-----------|---------------|
| Setup | RSI < 30, C/P ratio > 2x, 7-14 days to earnings, net call premium > $1M |
| Entry | Pullback to High OI strike support, bounce confirmation |
| Stop | Below confluence zone (1-2% below entry) |
| Target | T1: Gamma flip, T2: Call wall / Max pain |
| Skip if | Market-wide selloff, earnings date shifted, IV already peaked |

**Full documentation:** [Strategies/earnings-flow-confluence.md](../Strategies/earnings-flow-confluence.md)

**The Thesis:** When smart money accumulates calls 7-14 days before earnings (Vol >> OI), they're positioning for the pre-earnings run-up. Entry on pullback to high OI support, target the call wall.

### 9. VIX Fear Capitulation (MARKET-WIDE BUY SIGNAL)
| Component | Specification |
|-----------|---------------|
| Setup | VIX > 30 AND $ADD < -1500 (NYSE breadth extreme) |
| Entry | Next day open OR bounce confirmation from SPY support |
| Stop | Below SPY swing low - 1 ATR |
| Target | Hold 10-20 trading days for mean reversion |
| Skip if | VIX still rising (wait for peak), major systemic event |

**Statistical Backtest (2016-2026, 10 years of data):**

| Signal | Count | 10d Win Rate | 20d Win Rate | Avg 20d Return |
|--------|-------|--------------|--------------|----------------|
| VIX > 25 (alone) | 357 | 68.1% | 75.6% | +3.10% |
| VIX > 30 (alone) | 152 | 74.3% | 85.5% | +5.17% |
| **VIX > 30 + A/D < -1500** | **94** | **69.1%** | **73.4%** | **+3.12%** |
| VIX > 30 + A/D < -2000 | 31 | 71.0% | 77.4% | +4.24% |
| VIX > 35 (alone) | 61 | 82.0% | 85.2% | +6.60% |
| VIX > 40 (panic) | 39 | 84.6% | 87.2% | +8.11% |

**Core Requirements (need BOTH):**
- VIX > 30 (market fear elevated)
- $ADD < -1500 (broad market selling, breadth washout)

**Why This Works:**
1. VIX > 30 = Extreme fear priced in, mean reversion kicks in
2. $ADD < -1500 = Broad selling exhaustion, not just index weight
3. Combined = Confirms fear is widespread, not sector-specific
4. Research: "When the VIX is high, it's time to buy"

**Signal Interpretation:**
```
VIX > 25           → Watch mode, prepare positions
VIX > 30 + A/D < -1500  → BUY signal, 73%+ win rate
VIX > 35           → High conviction, scale in
VIX > 40           → Panic/capitulation, aggressive entry
```

**Historical High-Conviction Signals (VIX > 30 + A/D < -2000):**
| Date | VIX | A/D | 10d Return | 20d Return |
|------|-----|-----|------------|------------|
| 2020-03-12 | 75.5 | -2911 | +5.28% | COVID bottom forming |
| 2020-03-16 | 82.7 | -2808 | +9.09% | COVID bottom |
| 2020-04-01 | 57.1 | -2589 | +13.39% | COVID recovery |
| 2024-08-05 | 38.6 | -2430 | +8.16% | Japan carry unwind |
| 2025-04-04 | 45.3 | -2298 | +1.70% | April selloff |
| 2025-04-10 | 40.7 | -2179 | +4.97% | April recovery |

**What DOESN'T Work (Skip These):**
- VIX < 12 sell signals: 26% win rate (market stays complacent)
- $ADD > +2000 shorts: 40% win rate (momentum continues)
- $ADD alone without VIX: 58% win rate (weak edge)

**Position Sizing:**
- Use reduced size (0.5% risk) for initial entry
- Scale in on further VIX spikes
- Full position only when VIX shows signs of peaking

**ThinkOrSwim Alert Setup:**
```
$VIX > 30 AND $ADD < -1500
```

**The Thesis:** When fear (VIX) and breadth (A/D) both hit extremes simultaneously, it signals broad capitulation selling. Historical data shows 73%+ probability of positive returns over 10-20 days. This is a market-wide mean reversion play that exploits the "blood in the streets" phenomenon.
