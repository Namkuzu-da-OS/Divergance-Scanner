# Wingman TradingView Indicators

## wingman-master.pine

**Version:** 1.0
**Pine Script:** v5
**Status:** READY

---

## Features

### 1. Higher Timeframe Context
- **Daily Trend** - Above/below 20 EMA (BULLISH/BEARISH)
- **Weekly Trend** - Above/below 50 SMA (BULLISH/BEARISH)
- **SPY Direction** - Market context for trade direction

### 2. VWAP Entry Zones
- **VWAP line** - Daily volume-weighted average price
- **Inner Bands (1.5 ATR)** - Entry zone starts here
- **Outer Bands (2.5 ATR)** - Extreme zones (high probability reversals)
- **Zone Highlighting** - Green for buy zones, red for sell zones

### 3. Key Levels
- **PDH/PDL** - Previous Day High/Low (orange/purple)
- **Weekly Open** - Monday's opening price (blue)
- **Daily 20 EMA** - Trend indicator (yellow)

### 4. Position Sizing Calculator
- Automatically calculates shares based on:
  - Your account size
  - Risk percentage (default 1%)
  - Current ATR × VIX multiplier
- Updates in real-time as price moves

### 5. Confluence Score (0-100)
Scores based on:
| Factor | Max Points |
|--------|-----------|
| Technical (RSI, BB, MACD) | 25 |
| Levels (PDH/PDL, VWAP, Weekly Open) | 25 |
| Zone (VWAP bands position) | 20 |
| Volume (spike detection) | 15 |
| Context (trend alignment, SPY) | 15 |

### 6. VIX Regime
- Pulls VIX data and adjusts stop multipliers:
  - VIX < 15: 1.5x ATR (LOW)
  - VIX 15-25: 2.0x ATR (NORMAL)
  - VIX 25-35: 2.5x ATR (HIGH)
  - VIX > 35: 3.0x ATR (EXTREME)

### 7. Stop Levels
- **Mental Stop** - Your actual risk level (based on ATR × VIX multiplier)
- **Hard Stop** - Disaster protection (1.5x mental stop distance)

### 8. Entry Signals
- Buy signal: In buy zone + confluence ≥ 60 + volume spike + trend alignment
- Sell signal: In sell zone + confluence ≥ 60 + volume spike + trend alignment

---

## Installation

### Step 1: Open TradingView
Go to [tradingview.com](https://tradingview.com) and open any chart.

### Step 2: Open Pine Editor
Click the **Pine Editor** tab at the bottom of the screen.

### Step 3: Create New Script
Click **Open** → **New blank indicator**

### Step 4: Paste Code
1. Delete all existing code in the editor
2. Copy the entire contents of `wingman-master.pine`
3. Paste into the Pine Editor

### Step 5: Save & Add to Chart
1. Click **Save** (give it a name like "Wingman Master")
2. Click **Add to chart**

### Step 6: Configure Settings
Click the gear icon on the indicator to adjust:
- Account size
- Risk percentage
- Which levels to show
- Colors and display preferences

---

## Settings Reference

### Risk Management
| Setting | Default | Description |
|---------|---------|-------------|
| Account Size | $20,000 | Your trading account value |
| Risk Per Trade | 1.0% | Percentage to risk per trade |
| Show Position Size | Yes | Display shares calculator |

### ATR & Stops
| Setting | Default | Description |
|---------|---------|-------------|
| ATR Period (Scalp) | 10 | For 1/5/15-min charts |
| ATR Period (Swing) | 14 | For Daily charts |
| Show Stop Levels | Yes | Display mental/hard stop lines |

### VWAP & Entry Zones
| Setting | Default | Description |
|---------|---------|-------------|
| Show VWAP | Yes | Display VWAP line |
| Show VWAP Bands | Yes | Display ATR-based bands |
| Lower Band Multiplier | 1.5 | Inner band distance (ATR units) |
| Upper Band Multiplier | 2.5 | Outer band distance (ATR units) |
| Highlight Zones | Yes | Color fill when price in zone |

### Higher Timeframe Levels
| Setting | Default | Description |
|---------|---------|-------------|
| Show PDH/PDL | Yes | Previous day high/low |
| Show Weekly Open | Yes | Monday's opening price |
| Show Daily 20 EMA | Yes | Daily trend indicator |

### Confluence & Signals
| Setting | Default | Description |
|---------|---------|-------------|
| Show Confluence | Yes | Display score in panel |
| Min Confluence | 60 | Threshold for signals |
| Show Signals | Yes | Display buy/sell triangles |

---

## How to Use

### Pre-Market Setup
1. Apply indicator to your chart (5-min for scalps, Daily for swings)
2. Check the info panel:
   - VIX regime → Adjust expectations
   - Daily/Weekly trend → Know your direction
   - SPY status → Market context

### Finding Entries
1. **Wait for price to enter a zone**
   - Green highlight = Buy zone (1.5-2.5 ATR below VWAP)
   - Red highlight = Sell zone (1.5-2.5 ATR above VWAP)

2. **Check confluence score**
   - 60+ = Tradeable
   - 80+ = High conviction

3. **Confirm with HTF context**
   - Daily BULLISH + Weekly BULLISH + SPY BULLISH = Go LONG
   - All BEARISH = Go SHORT
   - Mixed = Be cautious or fade extremes only

4. **Use position sizing**
   - Panel shows exact shares to buy
   - Based on your account size and current ATR

### Managing Trades
1. **Mental stop** shows your risk level
2. **Exit rule**: Only exit if 5-min candle CLOSES below mental stop
3. **Target**: VWAP for T1, opposite band for T2

---

## Alerts

Set up alerts for:
- **Buy Signal** - All conditions met for long entry
- **Sell Signal** - All conditions met for short entry
- **Entered Buy Zone** - Price enters lower VWAP band
- **Entered Sell Zone** - Price enters upper VWAP band
- **High Confluence** - Score crosses above 80

To create an alert:
1. Right-click on chart → Create Alert
2. Select "Wingman Master" as condition
3. Choose the alert type
4. Set notification preferences

---

## Timeframe Recommendations

| Trading Style | Chart | ATR Used |
|---------------|-------|----------|
| Scalping | 5-min | 10-period |
| Day Trading | 15-min | 10-period |
| Swing Trading | Daily | 14-period |

The indicator auto-detects your timeframe and adjusts ATR period accordingly.

---

## Changelog

### v1.0 (January 2026)
- Initial release
- HTF context (Daily, Weekly, SPY)
- VWAP with ATR bands
- PDH/PDL and Weekly Open levels
- Confluence scoring system
- Position sizing calculator
- VIX regime integration
- Entry signals with volume confirmation

---

## Troubleshooting

### "No data" for VIX
- VIX data requires at least a free TradingView account
- Some brokers' data feeds don't include VIX
- Try using a different data source or the chart symbol CBOE:VIX

### Levels not showing
- Check if the display options are enabled in settings
- Some levels only show on intraday charts (not weekly/monthly)

### Position size seems wrong
- Verify your account size setting
- Check that risk percentage is correct
- ATR-based sizing varies with volatility

---

## Support

For issues or feature requests, see the main Wingman documentation:
- [TRADING_SYSTEM.md](../docs/TRADING_SYSTEM.md)
- [CLAUDE.md](../CLAUDE.md)
