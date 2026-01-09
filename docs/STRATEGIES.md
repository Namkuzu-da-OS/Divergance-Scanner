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
| Skip if | VIX >25, no author consensus, counter-trend to SPY |

**Confluence Checklist (need 5+ of 8):**
- Golden pocket (50-61.8% Fib of recent swing)
- At/near put wall or GEX -1 SD band
- RSI oversold (<35) or recovering from <30
- 3+ authors bullish (established preferred)
- Unusual call activity (>5x vol/OI)
- Key MA nearby (100/200 SMA flat or as support)
- VWAP reclaimed after dip
- Call wall above as magnet/target

**The Trigger (TSLA Pattern Jan 2026):**
When RSI hits oversold AND unusual call activity appears together = smart money buying the dip.
This combination caused a +35 point score jump in the scanner and preceded a 3%+ move to call wall.

**Signal Progression Example:**
```
Score 60  → Technical only (BB lower, put wall)
Score 95  → RSI oversold + unusual calls (TRIGGER)
Score 100 → Author consensus confirms
```

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
