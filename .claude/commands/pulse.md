Quick market internals check. Run anytime during the session for a real-time read on market conditions.

## DATA PULL (Single Subagent — Keep Main Context Clean)

Launch ONE subagent to pull all data in parallel and return a compact summary:

```
Task tool with subagent_type=Explore:
"Pull all of the following data and return a compact, pre-interpreted summary. Make ALL API calls, do not skip any.

**1. Market Internals (batch these):**
- http://192.168.10.60:8000/api/quotes/$VIX
- http://192.168.10.60:8000/api/quotes/$TICK
- http://192.168.10.60:8000/api/quotes/$ADD
- http://192.168.10.60:8000/api/quotes/$TRIN
- http://192.168.10.60:8000/api/quotes/$UVOL
- http://192.168.10.60:8000/api/quotes/$DVOL

**2. Index Prices:**
- http://192.168.10.60:8000/api/quotes/$SPX
- http://192.168.10.60:8000/api/quotes/$COMPX
- http://192.168.10.60:8000/api/quotes/$DJI

**3. SPY + QQQ Technicals:**
- http://192.168.10.60:8000/api/technicals/SPY
- http://192.168.10.60:8000/api/technicals/QQQ

**4. SPY + QQQ Gamma Levels:**
- http://192.168.10.60:8000/api/levels/SPY
- http://192.168.10.60:8000/api/levels/QQQ

**5. Market Context:**
- http://192.168.10.60:8000/api/market/context

**6. Recent Alerts:**
- http://localhost:8080/api/alerts?days=1&limit=5

Return the data in this EXACT format:

---
MARKET INTERNALS:
- VIX: [lastPrice] ([netChange] / [netPercentChange]%) | Open: [open] High: [high] Low: [low]
- TICK: [lastPrice]
- ADD: [lastPrice]
- TRIN: [lastPrice]
- Up Volume: [UVOL lastPrice] | Down Volume: [DVOL lastPrice] | Ratio: [UVOL/DVOL calculated]

INDICES:
- SPX: [lastPrice] ([netChange] / [netPercentChange]%) | High: [high] Low: [low]
- COMPX: [lastPrice] ([netChange] / [netPercentChange]%)
- DJI: [lastPrice] ([netChange] / [netPercentChange]%)

SPY:
- Price: [last] | Change: [netChange] ([pct]%)
- RSI: [value] | Trend: [trend] | BB Position: [value]
- MAs: 5 SMA [val], 20 SMA [val], 50 SMA [val], 200 SMA [val]
- Gamma: Call Wall [price] | Put Wall [price] | Max Pain [price]
- VWAP: [price] | Bands: [lower1] - [upper1]
- Gamma Flip: [price] ([above/below] price)
- Position: [describe where price is relative to walls, VWAP, and key MAs]

QQQ:
- Price: [last] | Change: [netChange] ([pct]%)
- RSI: [value] | Trend: [trend] | BB Position: [value]
- MAs: 5 SMA [val], 20 SMA [val], 50 SMA [val], 200 SMA [val]
- Gamma: Call Wall [price] | Put Wall [price] | Max Pain [price]
- VWAP: [price] | Bands: [lower1] - [upper1]
- Gamma Flip: [price] ([above/below] price)
- Position: [describe where price is relative to walls, VWAP, and key MAs]

MARKET CONTEXT:
- VIX Regime: [regime]
- Risk Appetite: [appetite]
- Position Size Modifier: [modifier]x

RECENT ALERTS (last 24h):
[List any alerts, or 'None' if empty]
---

Be precise with numbers. Do not round excessively. Include ALL fields listed above."
```

## INTERPRETATION (Done by Wingman in Main Context)

After receiving the subagent data, present the Market Pulse using this framework:

### Section 1: INTERNALS DASHBOARD

| Indicator | Value | Read |
|-----------|-------|------|
| $VIX | [value] | [interpret] |
| $TICK | [value] | [interpret] |
| $ADD | [value] | [interpret] |
| $TRIN | [value] | [interpret] |
| Vol Ratio | [UVOL:DVOL] | [interpret] |

**Interpretation Guide (use these thresholds):**

$TICK:
- > +800: Extreme buying (potential exhaustion if sustained)
- +400 to +800: Strong buying pressure
- -400 to +400: Normal / choppy
- -400 to -800: Strong selling pressure
- < -800: Extreme selling (potential capitulation bounce)

$ADD:
- > +2000: Very strong breadth (exhaustion watch)
- +1000 to +2000: Healthy broad advance
- -1000 to +1000: Mixed / rotational
- -1000 to -2000: Broad selling
- < -2000: Capitulation territory (VIX Fear strategy trigger zone)

$TRIN:
- < 0.80: Bullish (advancing stocks getting more than their share of volume)
- 0.80 to 1.20: Neutral
- 1.20 to 2.00: Bearish (declining stocks absorbing volume)
- > 2.00: Extreme selling (potential reversal signal)

Volume Ratio ($UVOL / $DVOL):
- > 3:1: Strong buying dominance
- 2:1 to 3:1: Moderate buying
- 1:1 to 2:1: Slight edge to buyers
- < 1:1: Sellers in control

### Section 2: INDEX POSITIONING

| Index | Price | Change | vs Key Levels |
|-------|-------|--------|---------------|
| SPY | [price] | [chg%] | [vs call wall / put wall / VWAP / max pain] |
| QQQ | [price] | [chg%] | [vs call wall / put wall / VWAP / max pain] |
| $SPX | [price] | [chg%] | [vs high/low of day] |

**Gamma context:** Where is SPY sitting relative to its walls? Pinned? Approaching breakout? Approaching breakdown?

### Section 3: MARKET VERDICT

One concise paragraph combining all signals into a directional read:
- What are internals saying? (breadth + volume + tick)
- What is gamma saying? (pinned, breakout, breakdown)
- What is VIX saying? (fear level + direction)
- **Net read:** Bullish / Bearish / Neutral / Choppy
- **Trading implication:** Be aggressive / standard / defensive / sit on hands

### Section 4: ALERTS & CHANGES

- Any scanner alerts fired in last hour?
- Has anything changed since last pulse check?
- Any approaching thresholds to watch? (VIX near regime change, SPY near wall, etc.)

**Keep it tight. This is a quick-check, not a deep dive. The whole output should fit on one screen.**
