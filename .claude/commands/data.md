# /data Command

Pull market intelligence from the data backend (192.168.10.239:3000) on demand.

## Usage
```
/data              - Full market snapshot (VIX, ETFs, sentiment)
/data vix          - VIX and volatility metrics only
/data etf          - SPY/QQQ/IWM price and levels
/data sentiment    - Social sentiment analysis
/data options      - Gamma exposure, max pain, flow
/data health       - Check if server is online
```

## What Gets Pulled

### Full Snapshot (`/data`)
- **VIX Level** - Current reading + regime (low/normal/elevated/crisis)
- **ETF Data** - SPY, QQQ, IWM latest prices
- **Key Levels** - Daily/weekly highs, lows, VWAP
- **Sentiment** - Aggregated social sentiment score
- **Gamma Exposure** - GEX levels if available

### VIX Regime Interpretation
| VIX Level | Regime | ATR Adjustment |
|-----------|--------|----------------|
| <15 | Low volatility | Use base multiplier |
| 15-25 | Normal | Use base multiplier |
| 25-35 | Elevated | Increase stops 50% |
| >35 | Crisis | Increase 50-100% or reduce size |

## Server Endpoints Used
- `GET /health` - Server status
- `GET /api/etf/latest` - ETF price data
- `GET /api/vix/latest` - VIX metrics
- `GET /api/sentiment/aggregate` - Sentiment scores
- `GET /api/options/gex` - Gamma exposure
- `GET /api/discovery` - Available capabilities

## Output
Data is displayed in formatted tables and optionally logged to `data/daily_log.md` with timestamp.

## When to Use
- Start of trading session (market context)
- Before entering a trade (validation)
- After significant market moves (reassess conditions)
- Anytime you need current intelligence

## Server Location
`http://192.168.10.239:3000`

Swagger docs: `http://192.168.10.239:3000/api-docs`
