# /data Command

Pull market intelligence from both data backends on demand.

## Usage
```
/data              - Full market snapshot
/data levels SPY   - Gamma walls and key levels
/data flow SPY     - Options flow analysis
/data sentiment    - Social sentiment overview
/data outlook      - AI market narrative
/data health       - Check both servers
```

---

## Data Sources

### Port 3000: Market Intelligence
| Endpoint | Data |
|----------|------|
| `/api/latest/SPY` | Price, IV, HV, P/C ratio |
| `/api/latest/VIX` | VIX level |
| `/api/x/sentiment/overview` | Twitter sentiment |
| `/api/confluence/SPY` | Multi-source agreement |
| `/api/market/outlook` | AI narrative |
| `/api/sequencer/high-conviction` | Trade signals |

### Port 8000: Options Analytics
| Endpoint | Data |
|----------|------|
| `/api/levels/{symbol}` | Gamma walls, VWAP, pivots |
| `/api/market/context` | VIX regime, bias |
| `/api/flow/{symbol}` | Options flow, delta |
| `/api/options/{symbol}/chain` | Full options chain |
| `/api/position/size` | Position sizing calc |

---

## Full Snapshot Output

```
/data

MARKET SNAPSHOT - [timestamp]

ETF/VIX
| Symbol | Price | Change | IV | HV |
| SPY    | $XXX  | +X.X%  | XX%| XX%|
| VIX    | XX.XX | +X.XX  | -  | -  |

LEVELS (SPY)
| Level      | Price | Distance |
| Call Wall  | $XXX  | +X.X%    |
| Put Wall   | $XXX  | -X.X%    |
| Gamma Flip | $XXX  | X.X%     |
| Max Pain   | $XXX  | X.X%     |

SENTIMENT (24h)
| Source   | Bullish | Bearish | Neutral |
| Twitter  | XX%     | XX%     | XX%     |

VIX REGIME: [Low/Normal/Elevated/High]
BIAS: [Bullish/Bearish/Neutral]
```

---

## VIX Regime → Risk Adjustment

| VIX | Regime | Action |
|-----|--------|--------|
| <15 | Low | Standard sizing |
| 15-25 | Normal | Standard sizing |
| 25-35 | Elevated | Widen stops 50% OR reduce size |
| >35 | Crisis | Reduce size 50%+, widen stops |

---

## When Wingman Auto-Pulls

On trade proposal, Wingman automatically runs:
1. `GET :8000/api/levels/{symbol}` → gamma walls
2. `GET :8000/api/market/context` → VIX regime
3. `GET :3000/api/x/sentiment/overview` → sentiment
4. Incorporates into APPROVE/CHALLENGE/RED FLAG

---

## Server Locations

- **Intelligence:** `http://192.168.10.239:3000`
- **Options:** `http://192.168.10.239:8000`

Swagger: `:3000/api/swagger-ui`
