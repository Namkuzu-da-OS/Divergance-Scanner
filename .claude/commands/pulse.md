Quick market internals check. Run anytime during the session for a real-time read on market conditions.

## DATA PULL (Single Subagent — Keep Main Context Clean)

Launch ONE subagent to pull all data in parallel and return a compact summary:

```
Task tool with subagent_type=Explore:
"Pull all of the following data and return a compact, pre-interpreted summary. Make ALL API calls, do not skip any.

**1. Market Internals (from internals scanner):**
- http://localhost:8080/api/internals/latest

**2. SPY + QQQ Technicals:**
- http://192.168.10.60:8000/api/technicals/SPY
- http://192.168.10.60:8000/api/technicals/QQQ

**3. SPY + QQQ Gamma Levels:**
- http://192.168.10.60:8000/api/levels/SPY
- http://192.168.10.60:8000/api/levels/QQQ

**4. Market Context:**
- http://192.168.10.60:8000/api/market/context

**5. Recent Alerts:**
- http://localhost:8080/api/alerts?days=1&limit=5

**6. Rotation Regime:**
- http://localhost:8080/api/rotation/regime
(If this returns a 502 or timeout, just note 'Divergence scanner unavailable' and skip this section)

Return the data in this EXACT format:

---
MARKET INTERNALS:
- VIX: [vix] (change: [vix_change] / [vix_change_pct]%) | Open: [vix_open] High: [vix_high] Low: [vix_low]
- TICK: [tick] (High: [tick_high] Low: [tick_low])
- TRIN: [trin]
- ADVN: [advn]
- Up Volume: [uvol] | Down Volume: [dvol] | Ratio: [vol_ratio]:1
- Internals Timestamp: [timestamp]

INDICES:
- SPX: [spx] (change: [spx_change] / [spx_change_pct]%) | High: [spx_high] Low: [spx_low]
- COMPX: [compx] (change: [compx_change] / [compx_change_pct]%)
- DJI: [dji] (change: [dji_change] / [dji_change_pct]%)

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

ROTATION REGIME:
- Phase: [phase] (confidence: [confidence])
- Leading: [leading sectors]
- Lagging: [lagging sectors]
(Or 'Divergence scanner unavailable' if endpoint failed)
---

Be precise with numbers. Do not round excessively. Include ALL fields listed above.
If /api/internals/latest returns empty or has no timestamp, note that the internals scanner may not be running and fall back to individual quote calls:
- http://192.168.10.60:8000/api/quotes/$VIX
- http://192.168.10.60:8000/api/quotes/$TICK
- http://192.168.10.60:8000/api/quotes/$TRIN
- http://192.168.10.60:8000/api/quotes/$UVOL
- http://192.168.10.60:8000/api/quotes/$DVOL
- http://192.168.10.60:8000/api/quotes/$SPX
- http://192.168.10.60:8000/api/quotes/$COMPX
- http://192.168.10.60:8000/api/quotes/$DJI
"
```

## INTERPRETATION (Done by Wingman in Main Context)

After receiving the subagent data, present the Market Pulse using this framework:

### Section 1: INTERNALS DASHBOARD

| Indicator | Value | Read |
|-----------|-------|------|
| $VIX | [value] | [interpret] |
| $TICK | [value] | [interpret] |
| $TRIN | [value] | [interpret] |
| ADVN | [value] | [interpret] |
| Vol Ratio | [UVOL:DVOL] | [interpret] |

**Interpretation Guide (use these thresholds):**

$TICK:
- > +800: Extreme buying (potential exhaustion if sustained)
- +400 to +800: Strong buying pressure
- -400 to +400: Normal / choppy
- -400 to -800: Strong selling pressure
- < -800: Extreme selling (potential capitulation bounce)

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
- **Rotation regime:** [phase] — favor [leading], avoid [lagging] (if available)
- **Net read:** Bullish / Bearish / Neutral / Choppy
- **Trading implication:** Be aggressive / standard / defensive / sit on hands

### Section 4: ALERTS & CHANGES

- Any scanner alerts fired in last hour?
- Has anything changed since last pulse check?
- Any approaching thresholds to watch? (VIX near regime change, SPY near wall, etc.)

**Keep it tight. This is a quick-check, not a deep dive. The whole output should fit on one screen.**
