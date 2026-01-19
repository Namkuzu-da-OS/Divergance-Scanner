# Wingman Backtesting

Two backtesting approaches: TradingView (visual, quick) and Python (rigorous, statistical).

---

## 1. TradingView Strategy (Quick Validation)

### File: `wingman-strategy.pine`

A Pine Script v5 strategy version of the Wingman indicator for backtesting in TradingView.

### Installation
1. Open TradingView
2. Go to Pine Editor
3. Create new strategy (not indicator)
4. Paste `wingman-strategy.pine`
5. Add to chart

### Settings
| Setting | Default | Description |
|---------|---------|-------------|
| Strategy | VWAP Reversion | Which strategy to test |
| Direction | Both | Long Only, Short Only, or Both |
| Risk % | 1.0 | Risk per trade |
| ATR Mult | 2.0 | Stop distance multiplier |
| Target Mult | 1.5 | R:R target |

### Built-in Filters
- Volume spike filter (1.5x average)
- RSI filter (oversold/overbought)
- Trend filter (above/below daily EMA)
- Time filter (avoid lunch hour)

### Results Panel
The strategy displays a live results table showing:
- Net Profit
- Win Rate
- Profit Factor
- Total Trades
- Average Win/Loss
- Max Drawdown

### Limitations
- TradingView's backtester doesn't model realistic slippage well
- Commission set to 0.05% (adjust in code if needed)
- Can't test across multiple symbols simultaneously

---

## 2. Python Backtrader (Rigorous Testing)

### File: `wingman_backtest.py`

A Python backtesting script using Backtrader for more realistic strategy validation.

### Installation

```bash
# Install dependencies
pip install backtrader pandas yfinance numpy matplotlib
```

### Usage

```bash
# Basic backtest on SPY, 6 months, 5-minute data
python wingman_backtest.py --symbol SPY --period 6mo --interval 5m

# Backtest QQQ with different settings
python wingman_backtest.py --symbol QQQ --period 1y --capital 25000 --risk 0.5

# Run parameter optimization
python wingman_backtest.py --symbol SPY --optimize

# Quiet mode (no trade log)
python wingman_backtest.py --symbol NVDA --quiet
```

### Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| --symbol | SPY | Stock symbol to test |
| --period | 6mo | Data period (1mo, 3mo, 6mo, 1y) |
| --interval | 5m | Data interval (1m, 5m, 15m, 1h, 1d) |
| --capital | 20000 | Initial capital |
| --risk | 1.0 | Risk per trade (%) |
| --atr | 2.0 | ATR multiplier for stops |
| --optimize | false | Run parameter optimization |
| --quiet | false | Suppress trade log |

### Output

The script prints:
- Trade-by-trade log (entry, exit, P&L)
- Final portfolio value
- Total profit/loss
- Win rate
- Max drawdown
- Sharpe ratio (if available)

### Optimization

Run `--optimize` to test multiple parameter combinations:
- ATR multiplier: 1.5, 2.0, 2.5, 3.0
- VWAP inner band: 1.0, 1.5, 2.0
- VWAP outer band: 2.0, 2.5, 3.0

### Advantages Over TradingView
- Realistic slippage modeling (0.1%)
- Proper commission handling (0.05%)
- Multi-symbol testing
- Parameter optimization
- Statistical analysis

---

## What to Validate

### 1. Stop Loss Methodology
Test different ATR multipliers to find optimal balance between:
- Avoiding stop hunts (wider stops)
- Preserving capital (tighter stops)

### 2. Entry Zones
Test different VWAP band settings:
- Inner band: When zone "starts"
- Outer band: When zone "ends"

### 3. Filters
Test with/without filters:
- RSI confirmation
- Volume spike requirement
- Trend alignment

### 4. Time Filters
Validate the "dead zone" hypothesis:
- Compare results with/without lunch hour filter
- Test different trading windows

---

## Interpreting Results

### Good Results
| Metric | Target |
|--------|--------|
| Win Rate | > 40% (for 2:1 R:R) |
| Profit Factor | > 1.5 |
| Max Drawdown | < 15% |
| Sharpe Ratio | > 1.0 |

### Red Flags
- Win rate < 30% with < 2:1 R:R = negative expectancy
- Max drawdown > 20% = too much risk
- Very few trades = not enough data
- Sharpe < 0.5 = poor risk-adjusted returns

---

## Next Steps

After backtesting:

1. **Paper Trade** - Test in live market conditions without real money
2. **Small Position Test** - Start with 0.25% risk
3. **Scale Up** - Gradually increase to 1% risk as system proves itself
4. **Track Live Results** - Compare to backtest expectations

---

## Files

| File | Purpose |
|------|---------|
| `wingman-strategy.pine` | TradingView strategy for visual backtesting |
| `wingman_backtest.py` | Python backtester for rigorous testing |
| `README.md` | This documentation |
