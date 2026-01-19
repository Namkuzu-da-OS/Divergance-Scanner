# Earnings Season Trading Strategies

This document describes the trading strategies implemented in the Earnings Season Scanner.

---

## Overview

Earnings season creates predictable patterns that can be exploited:

1. **Pre-earnings momentum** - Stocks drift in anticipation
2. **Post-earnings drift** - Surprises continue to move prices for weeks
3. **Gap trading** - Morning gaps after announcements have statistical fill rates
4. **IV dynamics** - Options pricing creates opportunities

**Important:** We trade STOCK POSITIONS to avoid IV crush. Options strategies are Phase 2.

---

## Strategy 1: PREM (Pre-Earnings Momentum)

### The Edge

Stocks with positive momentum and bullish flow tend to drift higher into earnings as institutions position themselves. This "anticipation premium" creates a tradeable pattern.

### Entry Rules

| Criteria | Requirement |
|----------|-------------|
| Days to earnings | 5-10 days out |
| PREM Score | ≥70 for alert, ≥80 for high conviction |
| Trend | Bullish or neutral (not bearish) |
| RSI | 40-70 preferred (not overbought) |
| Options Flow | Net bullish (call premium > put premium) |

### Exit Rules

| Exit Type | Timing |
|-----------|--------|
| **Primary Exit** | Day before earnings (close) |
| **Hold Through** | Only if conviction is HIGH and historical beat rate >70% |
| **Stop Loss** | -5% from entry |
| **Take Profit** | +8% or target reached |

### Position Sizing

- Standard: 1% risk ($200 on $20K account)
- Reduce size if RSI > 65 (overbought risk)
- Increase conviction (not size) with multiple confirmations

### Scoring Factors (0-100)

| Factor | Max Points | What to Look For |
|--------|------------|------------------|
| Momentum | 25 | RSI 40-70, bullish trend, recent strength |
| Options Flow | 20 | Net bullish delta, unusual call activity |
| IV Rank | 15 | Low IV rank = room to expand |
| Market Alignment | 10 | Aligned with SPY trend |
| Sentiment | 10 | Bullish social sentiment |
| Timing | 20 | 6-8 days optimal, earnings time preference |

### Example Trade

```
NVDA earnings: January 25 (after market)
Entry: January 17 (8 days out)
Score: 82/100 (HIGH_CONVICTION)
Price: $145.00
Signals:
  - RSI 55 (healthy momentum)
  - Bullish trend
  - +$5.2M net call delta
  - IV Rank 28% (low)
  - Aligned with SPY bullish

Exit: January 24 close
Target: $152.00 (+4.8%)
Stop: $137.75 (-5%)
```

---

## Strategy 2: PEAD (Post-Earnings Announcement Drift)

**Status:** Phase 2 (not yet implemented)

### The Edge

Academically documented since 1968. Stocks continue drifting in the direction of the earnings surprise for 20-60 days. This is ~12% annualized return historically.

### Entry Rules

| Criteria | Requirement |
|----------|-------------|
| Timing | 1-2 days after earnings |
| Surprise | >5% EPS beat or miss |
| Reaction | Stock moved in direction of surprise |
| Volume | >2x average on announcement day |

### Exit Rules

| Exit Type | Timing |
|-----------|--------|
| **Time Exit** | 20-60 days after entry |
| **Stop Loss** | -5% from entry |
| **Take Profit** | +10% or momentum fades |

### Why Wait 1-2 Days?

- Let the initial volatility settle
- Confirm direction isn't reversing
- Enter at better price than gap-chasers

---

## Strategy 3: GAPS (Gap Trading)

**Status:** Phase 2 (not yet implemented)

### The Edge

Earnings gaps have statistical fill probabilities:
- Gaps >10%: 65% fill probability
- Gaps 5-10%: 52% fill probability
- Gaps 3-5%: 58% fill probability

### Entry Rules

| Criteria | Requirement |
|----------|-------------|
| Timing | First 30 minutes after market open |
| Gap Size | >3% minimum, >10% ideal |
| Pre-market Volume | >500K shares |
| Direction | Fade the gap (expect fill) |

### Exit Rules

| Exit Type | Timing |
|-----------|--------|
| **Target** | 50% of gap filled |
| **Stop Loss** | Gap extends 50% further |
| **Time Exit** | End of day if no fill |

---

## IV Crush Explained

### What It Is

Implied volatility (IV) spikes before earnings as uncertainty is priced in. After the announcement, IV collapses 30-40% as the uncertainty is resolved. This is called "IV crush."

### Why We Trade Stocks

When you buy options before earnings:
- You pay inflated premium due to high IV
- Even if the stock moves in your favor, IV crush can make you lose money
- Example: Stock moves +3% but options drop 20% due to IV crush

When you buy stock:
- No IV exposure
- You capture the directional move
- Simpler risk management

### If You Must Trade Options

- Exit day before earnings (before IV crushes)
- Use spreads to reduce vega exposure
- Sell premium into high IV (iron condors) - but this is advanced

---

## Buyback Blackout Periods

### What They Are

Companies cannot buy back their own stock:
- Starting ~2 weeks before quarter end
- Ending ~2 days after earnings release

### Why It Matters

- Blackout = one less buyer in the market
- Some studies show slight weakness during blackouts
- Post-blackout = buying can resume (potential support)

### Scanner Behavior

- Stocks in blackout get -5 points
- Stocks 1 week post-blackout get +5 points
- This is a minor factor, not a primary signal

---

## Earnings Season Windows

| Season | Timing | Notes |
|--------|--------|-------|
| Q4 Earnings | Mid-Jan to Mid-Feb | We are here (Jan 2026) |
| Q1 Earnings | Mid-Apr to Mid-May | Tech heavy |
| Q2 Earnings | Mid-Jul to Mid-Aug | Summer volume |
| Q3 Earnings | Mid-Oct to Mid-Nov | Pre-holiday |

### Off-Season

- Keep scanner in manual mode
- Individual stocks still report (off-cycle)
- Focus on other Bloodhound signals

---

## Risk Management

### Position Sizing

| Account Size | Standard Risk | Max Position |
|--------------|---------------|--------------|
| $20,000 | $200 (1%) | $4,000 |
| $50,000 | $500 (1%) | $10,000 |
| $100,000 | $1,000 (1%) | $20,000 |

### Concentration Limits

- Max 3 earnings trades open at once
- No more than 2 in same sector
- Stagger entry dates if possible

### When NOT to Trade

- VIX > 25 (elevated fear)
- Major macro event same week (FOMC, CPI)
- Stock already extended (RSI > 75)
- Counter-trend to SPY (bearish stock, bullish market)

---

## Dashboard Quick Reference

### Scanner Control API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Scanner status, uptime, scan count |
| `/results` | GET | Latest PREM scan results |
| `/calendar` | GET | Earnings calendar data |
| `/pause` | POST | Pause scanner |
| `/resume` | POST | Resume scanner |
| `/scan` | POST | Trigger immediate scan |
| `/refresh-calendar` | POST | Refresh earnings calendar |
| `/test-alert` | POST | Send test Telegram alert |

### Running the Scanner

```bash
# Start scanner
node monitor/earnings-scanner.js

# Or with PM2
pm2 start monitor/earnings-scanner.js --name earnings

# Refresh calendar
node monitor/earnings-calendar-scraper.js

# Check status
curl http://localhost:8082/status
```

### Dashboard URL

`http://localhost:8080/earnings-scanner.html`

---

## Paper Trading

All PREM signals are tracked as paper trades for validation:

- Entry price, score, and signals captured
- Price tracked at 1h, 4h, 24h, 72h
- Outcome classified as WIN (≥+2%), LOSS (≤-2%), or BREAKEVEN
- Use analytics to validate strategy effectiveness

---

## Sources

- [Post-Earnings Announcement Drift - Quantpedia](https://quantpedia.com/strategies/post-earnings-announcement-effect)
- [Trading Around Earnings - TradeFundrr](https://tradefundrr.com/trading-around-earnings-announcements/)
- [IV Crush Guide - MenthorQ](https://menthorq.com/guide/iv-crush-understanding-the-earnings-driven-volatility-spike-and-how-to-capitalize-on-it/)
- [Buyback Blackout Impact - TradeAlgo](https://www.tradealgo.com/news/a-stock-market-buyback-blackout-could-spark-a-decline-as-earnings-season-begin)
