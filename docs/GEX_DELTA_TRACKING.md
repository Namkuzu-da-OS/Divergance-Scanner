# GEX Delta Tracking: Wall Building & Decay Signals

## Concept Overview

Gamma walls don't just act as static support/resistance - their **change over time** provides leading indicators:

| Phase | What's Happening | Trading Signal |
|-------|------------------|----------------|
| **Wall Building** | OI accumulating at strike → dealers hedge more → "magnet" effect | Price likely heading to that level |
| **Price at Wall** | Dealer hedging creates support/resistance | Reaction zone - watch for reversal or breakout |
| **Wall Decay** | Positions closing/exercised → hedging flows complete | Momentum exhaustion - exit/profit target |

## Origin: IRM Observation (2026-01-16)

Watching IRM on a 1-minute chart:
1. ~$1M call wall appeared at $95
2. Built to ~$2M as price approached
3. Price pushed through $95
4. Walls pulled → dropped to ~$600K
5. Price lost support and fell back

**Key insight:** The wall building was the leading indicator that price would reach $95. The wall decay after touch was the exit signal.

## Research Findings

### Price Magnet Effect

From [Cheddar Flow](https://www.cheddarflow.com/blog/what-is-gamma-exposure-an-in-depth-analysis-for-traders/):
> "If there's large gamma at a certain strike, the hedging flows near that strike can cause the underlying to 'pin' around that price... that gravitational effect can become stronger as time approaches expiration."

### Dealer Hedging Dynamics

From [SpotGamma/LuxAlgo](https://www.luxalgo.com/blog/spotgamma-levels-reveal-dealer-positioning/):
> "Understanding where dealers are forced to hedge lets you anticipate where the market may stabilize, reverse, or accelerate. These aren't random moves - they're structural forces."

### Mechanism

1. **High OI at strike** → Dealers must hedge
2. **Hedging flows** → Creates buying/selling pressure toward strike
3. **Price reaches strike** → Options exercised/closed
4. **OI decreases** → Hedging flows complete → Magnet effect gone

## Proposed Tracking Signals

| Signal | Detection | Meaning |
|--------|-----------|---------|
| **Wall Appears** | GEX at strike goes from 0 to significant | New level of interest forming |
| **Wall Building** | GEX increases >50% between scans | Accumulation - price magnet strengthening |
| **Wall Holding** | Price at wall, GEX stable | Legitimate S/R - look for reaction |
| **Wall Decay** | GEX decreases >50% after price touch | Hedging complete - momentum fading |
| **Wall Breach** | Price through wall + GEX drops | Breakout confirmed - trend continuation |

## Implementation Approach

### Phase 1: Logging (No Alerts)

Store wall data between scans to observe patterns:

```javascript
// Store previous scan's walls
const previousWalls = {
    SPY: { callWall: { strike: 695, gex: 1500000 }, putWall: { strike: 690, gex: 1200000 } },
    // ...
};

// On each scan, compute delta
const wallDelta = {
    callWall: {
        gexChange: currentGex - previousGex,
        gexChangePct: ((currentGex - previousGex) / previousGex) * 100,
        priceDistance: (currentPrice - callWallStrike) / currentPrice * 100
    }
};

// Log to file for analysis
appendToFile('data/wall_changes.json', { timestamp, symbol, wallDelta });
```

### Phase 2: Analysis

After collecting data for 1-2 weeks:
- Does wall building consistently predict price approach?
- What % change threshold produces reliable signals?
- How does 0DTE noise affect accuracy?
- Which symbols show cleanest patterns?

### Phase 3: Alerts (If Patterns Hold)

```
📈 SPY: Call wall at $695 building (+120% GEX, now $2.1M)
   Price: $692.50 (0.4% away) - potential magnet

📉 SPY: Call wall at $695 decaying (-65% GEX after price touch)
   Signal: Momentum exhaustion - consider profit target
```

## Concerns & Caveats

| Issue | Mitigation |
|-------|------------|
| **Scan frequency (5 min)** | May miss fast intraday cycles. Consider faster scans for wall tracking only. |
| **0DTE noise** | Gamma explodes near expiration. Filter or discount 0DTE wall changes. |
| **Sample size** | Don't build rules from one observation. Collect data first. |
| **Actionability** | "Wall building" tells you *where*, not *when* or *how* to enter. |
| **Threshold tuning** | Start conservative (>100% change), loosen if too few signals. |

## Distance Filter

Only track walls within actionable range:

| Distance from Price | Priority |
|--------------------|----------|
| < 1% | High - imminent |
| 1-3% | Medium - approaching |
| > 3% | Low - background |

## Data Requirements

From our Options API (`/api/levels/{symbol}`):

```json
{
  "levels": {
    "call_wall": { "price": 695, "gex": 1934894181, "oi": 30473 },
    "put_wall": { "price": 690, "gex": 1389836521, "oi": 42490 }
  },
  "gex_by_strike": {
    "695.0": { "call_gex": 1934894181, "put_gex": -1327116571, "net_gex": 607777609 }
  }
}
```

Key fields to track:
- `call_wall.gex` / `put_wall.gex` - Main wall strength
- `call_wall.oi` / `put_wall.oi` - Open interest (confirms positioning)
- `gex_by_strike` - Granular GEX for specific strikes

## Next Steps

1. **Add wall snapshot storage** to Bloodhound scan cycle
2. **Log wall deltas** to `data/wall_changes.json`
3. **Observe for 1-2 weeks** before building alert logic
4. **Analyze patterns** - which thresholds work?
5. **Build alerts** only after validation

## Related Files

- `monitor/bloodhound-scanner.js` - Main scanner (would add wall tracking)
- `data/wingman.db` - Could add wall_history table
- `docs/CHANGELOG_2026-01-16.md` - Related scanner improvements

## Status

**Current:** Concept documented, not yet implemented

**Next:** Decide whether to implement Phase 1 logging
