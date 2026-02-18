Quick market internals check. Run anytime during the session for a real-time read on market conditions.

## STEP 0: Establish Current Time + Pull Alerts Directly (ALWAYS FIRST)

Run these in parallel:
1. `TZ='America/New_York' date '+%Y-%m-%d %H:%M:%S %Z'` — current Eastern Time for report header
2. `curl -s "http://localhost:8080/api/alerts?days=1&limit=10"` — pull alerts DIRECTLY (do NOT delegate to subagent)

Use the time in your report. Present alerts in Section 4. NEVER infer time from API timestamps (often UTC) or prior checkpoint files.

## DATA PULL (Single Subagent — Keep Main Context Clean)

Launch ONE subagent to pull all data in parallel and return a compact summary:

```
Task tool with subagent_type=Explore:
"Pull all of the following data and return a compact, pre-interpreted summary. Make ALL API calls, do not skip any.

**1. Market Internals (from internals scanner):**
- http://localhost:8080/api/internals/latest

**2. SPY + QQQ Quotes (for price/change):**
- http://192.168.10.60:8000/api/quotes/SPY
- http://192.168.10.60:8000/api/quotes/QQQ

**3. SPY + QQQ Technicals (for RSI/trend/MAs/BBs):**
- http://192.168.10.60:8000/api/technicals/SPY
- http://192.168.10.60:8000/api/technicals/QQQ

**4. SPY + QQQ Gamma Levels:**
- http://192.168.10.60:8000/api/levels/SPY
- http://192.168.10.60:8000/api/levels/QQQ

**5. Market Context:**
- http://192.168.10.60:8000/api/market/context

**6. Rotation Regime:**
- http://localhost:8080/api/rotation/regime

(If rotation regime returns a 502 or timeout, just note 'Divergence scanner unavailable' and skip that section)

**PACING: Call localhost endpoints first (they're fast local calls), then Options API endpoints (192.168.10.60:8000) one at a time, never in parallel. The Options API is shared across all scanners and will timeout if overloaded.**

Return the data in this EXACT format:

---
MARKET INTERNALS:
- VIX: [vix] (change: [vix_change] / [vix_change_pct]%) | Open: [vix_open] High: [vix_high] Low: [vix_low]
- TICK: [tick]
- TRIN: [trin]
- A/D Spread: [ad_spread] (ADVN: [advn] / DECN: [decn])
- Up Volume: [uvol] | Down Volume: [dvol] | Ratio: [vol_ratio]:1
- Internals Timestamp: [timestamp]

INDICES:
- SPX: [spx] (change: [spx_change] / [spx_change_pct]%) | High: [spx_high] Low: [spx_low]
- COMPX: [compx] (change: [compx_change] / [compx_change_pct]%)
- DJI: [dji] (change: [dji_change] / [dji_change_pct]%)

SPY (quotes from /api/quotes/SPY, technicals from /api/technicals/SPY, levels from /api/levels/SPY):
- Price: [quote.lastPrice] | Change: [quote.netChange] ([quote.netPercentChange]%) | High: [quote.highPrice] Low: [quote.lowPrice]
- RSI: [technicals.rsi] | Trend: [technicals.trend] | BB Position: [technicals.bb_position]
- MAs: 5 SMA [technicals.sma_5 or current], 20 SMA [technicals.sma_20], 50 SMA [technicals.sma_50], 200 SMA [technicals.sma_200]
- Gamma: Call Wall [levels.call_wall] | Put Wall [levels.put_wall] | Max Pain [levels.max_pain]
- VWAP: [levels.vwap] | Bands: [lower1] - [upper1]
- Gamma Flip: [levels.gamma_flip] ([above/below] price)
- Position: [describe where price is relative to walls, VWAP, and key MAs]

QQQ (quotes from /api/quotes/QQQ, technicals from /api/technicals/QQQ, levels from /api/levels/QQQ):
- Price: [quote.lastPrice] | Change: [quote.netChange] ([quote.netPercentChange]%) | High: [quote.highPrice] Low: [quote.lowPrice]
- RSI: [technicals.rsi] | Trend: [technicals.trend] | BB Position: [technicals.bb_position]
- MAs: 5 SMA [technicals.sma_5 or current], 20 SMA [technicals.sma_20], 50 SMA [technicals.sma_50], 200 SMA [technicals.sma_200]
- Gamma: Call Wall [levels.call_wall] | Put Wall [levels.put_wall] | Max Pain [levels.max_pain]
- VWAP: [levels.vwap] | Bands: [lower1] - [upper1]
- Gamma Flip: [levels.gamma_flip] ([above/below] price)
- Position: [describe where price is relative to walls, VWAP, and key MAs]

MARKET CONTEXT:
- VIX Regime: [regime]
- Risk Appetite: [appetite]
- Position Size Modifier: [modifier]x

ROTATION REGIME:
- Phase: [phase] (confidence: [confidence])
- Leading: [leading sectors]
- Lagging: [lagging sectors]
(Or 'Divergence scanner unavailable' if endpoint failed)
---

Be precise with numbers. Do not round excessively. Include ALL fields listed above.

**IMPORTANT — Data source mapping:**
- SPY/QQQ **price, change, high/low** → from `/api/quotes/` response: `lastPrice`, `netChange`, `netPercentChange`, `highPrice`, `lowPrice`
  - WARNING: `netPercentChangeInDouble` is often 0 — always use `netPercentChange` instead
- SPY/QQQ **RSI, trend, MAs, BBs** → from `/api/technicals/` response: `rsi`, `trend`, `sma_20`, `sma_50`, `bb_position`, `current` (current price)
  - NOTE: The technicals endpoint does NOT have change/netChange fields. Do not try to extract them from technicals.
- SPY/QQQ **walls, VWAP, gamma flip** → from `/api/levels/` response
- **Market internals** → from `/api/internals/latest`: use field names exactly as returned (`ad_spread`, `advn`, `decn`, `vol_ratio`, etc.)

If /api/internals/latest returns empty or has no timestamp, note that the internals scanner may not be running and fall back to individual quote calls:
- http://192.168.10.60:8000/api/quotes/$VIX
- http://192.168.10.60:8000/api/quotes/$TICK
- http://192.168.10.60:8000/api/quotes/$TRIN
- http://192.168.10.60:8000/api/quotes/$ADVN
- http://192.168.10.60:8000/api/quotes/$DECN
- http://192.168.10.60:8000/api/quotes/$UVOL
- http://192.168.10.60:8000/api/quotes/$DVOL
- http://192.168.10.60:8000/api/quotes/$SPX
- http://192.168.10.60:8000/api/quotes/$COMPX
- http://192.168.10.60:8000/api/quotes/$DJI
Compute A/D spread manually: ADVN lastPrice - DECN lastPrice.
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
| A/D Spread | [value] | [interpret] |
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

A/D Spread (ADVN - DECN):
- > +1000: Extreme bullish breadth
- +400 to +1000: Bullish breadth
- -400 to +400: Neutral / narrow
- -400 to -1000: Bearish breadth
- < -1000: Extreme bearish breadth (potential capitulation)

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

## NEVER FABRICATE (NON-NEGOTIABLE)

Every number, level, and claim in this report must come from the API data the subagent just fetched. If an API call failed or returned empty, say so — do not substitute guesses, general knowledge, or pattern-matched estimates. No data = say "no data." This is a trading system — fabricated data causes real financial harm.
