# Scanner History & Day 2 Detection

**Status:** Stage 1 & 2 Complete | Stage 3 Pending
**Branch:** `feature/scanner-history`
**Dashboard:** [Zone Scanner](http://localhost:8080) (`zone-scanner.html`)

---

## Overview

The Scanner History system tracks tickers over time to identify **Day 2 follow-through opportunities** - setups where a ticker surged yesterday and may continue today.

Academic research shows this edge exists but is **conditional** - it requires filtering on volume, price structure, social momentum, and market alignment.

---

## Stage 1: Data Capture ✅

### What It Does

Logs full daily snapshots for every ticker that appears in the scanner.

### Data Structure

**File:** `data/scanner_history.json`

```json
{
  "meta": {
    "last_updated": "2026-01-12T15:36:47.352Z",
    "retention_days": 14,
    "total_symbols_tracked": 17
  },
  "symbols": {
    "RVMD": {
      "first_seen": "2026-01-08T15:22:00Z",
      "last_seen": "2026-01-09T17:00:00Z",
      "daily_snapshots": [
        {
          "date": "2026-01-08",
          "first_scan": "2026-01-08T15:22:00Z",
          "scans_today": 12,
          "peak_score": 65,

          "price_action": {
            "open": 105.50,
            "high": 112.80,
            "low": 104.20,
            "close": 108.50,
            "vwap": 107.30,
            "range_pct": 8.2,
            "gap_from_prev_pct": 4.5
          },

          "volume": {
            "total": 3200000,
            "avg_20d": 850000,
            "ratio": 3.76,
            "vs_yesterday": null
          },

          "social": {
            "x_mentions": 42,
            "sentiment_score": 68,
            "author_count": 4,
            "author_direction": "BULLISH"
          },

          "scanner_data": {
            "peak_zone": "BREAKOUT",
            "peak_direction": "BULLISH",
            "peak_signals": ["breakout", "volume_spike", "author_consensus"],
            "time_in_scanner_mins": 240
          },

          "technicals_eod": {
            "rsi": 72,
            "above_20ema": true,
            "above_50sma": true,
            "bb_position": "UPPER"
          }
        },
        {
          "date": "2026-01-09",
          // Day 2 snapshot...
        }
      ]
    }
  }
}
```

### What Gets Captured

| Category | Data Points |
|----------|-------------|
| **Price** | Open, high, low, close, VWAP, gap % from prev day, range % |
| **Volume** | Total, 20d avg, ratio, vs yesterday |
| **Social** | X mentions, sentiment score, author count, direction |
| **Scanner** | Peak score, zone, direction, signals, time in scanner |
| **Technicals** | RSI, above 20EMA, above 50SMA, BB position |

### Retention

- **14 days** rolling history
- Auto-prunes old snapshots
- Removes symbols with no recent activity

---

## Stage 2: Badge Tagging ✅

### What It Does

Computes history status for each ticker and displays badges in the Zone Scanner UI.

### Labels

| Label | Meaning | Badge |
|-------|---------|-------|
| **NEW** | First appearance (day 1) | 🆕 NEW (blue) |
| **DAY_2** | Second consecutive day | 📈 Day 2 (green) |
| **STREAK** | 3+ consecutive days | 🔥 3d, 4d, etc (orange) |
| **RETURNED** | Was gone, now back | ↩️ Back (gray) |

### Trend Indicators

| Trend | Meaning | Indicator |
|-------|---------|-----------|
| **RISING** | Score up 15+ points | ↗ |
| **FADING** | Score down 15+ points | ↘ |
| **STABLE** | Score changed < 15 points | (none) |

### Implementation

**Backend:** `monitor/bloodhound-scanner.js`

```javascript
function computeHistoryStatus(symbol) {
    // Counts consecutive days (no gaps)
    // Calculates days since first seen
    // Finds peak score across all history
    // Determines trend (RISING/FADING/STABLE)
    // Returns: { label, consecutive_days, days_since_first, trend, peak_score_ever, current_vs_peak }
}
```

**Frontend:** `zone-scanner.html`

```javascript
function renderHistoryBadge(historyStatus) {
    // Renders colored badge with emoji + trend indicator
    // Appears next to ticker symbol
}
```

### Where It Shows

- **Zone Scanner Dashboard:** [http://localhost:8080](http://localhost:8080)
- **JSON Outputs:** `scanner.json`, `dynamic_scan.json`, `bloodhound.json`

---

## Stage 3: Grading & Telegram Alerts (Pending)

### What It Will Do

Grade Day 2 setups (A/B/C/F) and enrich Telegram alerts with Day 2 context.

### Grading Criteria

| Criteria | Weight | A Grade | B Grade | C Grade | F Grade |
|----------|--------|---------|---------|---------|---------|
| **Volume holding** | High | ≥75% Day 1 | 50-74% | 30-49% | <30% |
| **Not exhausted** | High | RSI <75, not at BB extreme | RSI <80 | RSI <85 | RSI ≥85 |
| **Price structure** | High | Gap up OR hold above Day 1 close | Within 2% | Within 5% | Below by >5% |
| **Social momentum** | Medium | Mentions rising or stable | -20% | -40% | -60%+ |
| **Market alignment** | Medium | Same direction as SPY | Neutral | Against | Strong divergence |
| **Score trajectory** | Low | Not down >10 pts | Down 10-20 | Down 20-30 | Down >30 |

### Alert Format (Stage 3)

**Current (Stage 2):**
```
🟢 NVDA BULLISH

Score: 80/100 | Zone: BUY_ZONE

Signals:
- RSI oversold (28)
- At put wall support
- Volume spike 2.3x
```

**Enhanced (Stage 3):**
```
📈 NVDA BULLISH [Day 2 - Grade A]

Score: 80/100 | Zone: BUY_ZONE

Signals:
- RSI oversold (28)
- At put wall support
- Volume spike 2.3x

📊 Day 2 Context:
Day 1: $145.20 (+6%, 4.2x vol)
Today: $148.60 (+2.3%)
✅ Volume: 78% of Day 1 (healthy)
✅ Holding above Day 1 close
✅ Social: 56 mentions (rising)

Entry: $147.80 | Stop: $145.00
```

**Key:** One alert per ticker. History context is **appended** to existing alerts, not sent separately.

---

## Files Modified

| File | Changes |
|------|---------|
| `monitor/bloodhound-scanner.js` | Added `updateScannerHistory()`, `loadScannerHistory()`, `saveScannerHistory()`, `computeHistoryStatus()` |
| `zone-scanner.html` | Added `renderHistoryBadge()`, integrated badges into ticker display |
| `data/scanner_history.json` | NEW - Historical ticker data |

---

## Usage

### Viewing the Scanner

1. **Open dashboard:** [http://localhost:8080](http://localhost:8080)
2. **Check badges:** Look for 🆕, 📈, 🔥 next to ticker symbols
3. **Filter:** Use dashboard filters (Buy Zone, Sell Zone, etc.) - badges persist

### Querying History

```bash
# View raw history
cat data/scanner_history.json

# Check specific ticker
cat data/scanner_history.json | jq '.symbols.RVMD'

# Count tracked symbols
cat data/scanner_history.json | jq '.meta.total_symbols_tracked'
```

### Testing

**Day 1:**
- Run scanner, observe tickers get **🆕 NEW** badge

**Day 2:**
- Same tickers reappear, should show **📈 Day 2** badge
- Volume holding? Price up? → Future Grade A candidate

**Day 3+:**
- Still showing? Badge becomes **🔥 3d** (streak)

---

## Research Backing

### Academic Evidence

**[Daily Momentum and New Investors](https://wxiong.mycpanel.princeton.edu/papers/DailyMomentum.pdf)** (Princeton):
> "Stocks that perform well today often continue their rise tomorrow"

**[Intraday Option Return](https://www3.nd.edu/~zda/IntraOption.pdf)** (Notre Dame):
> "Open return (first 30 min) today positively predicts open return tomorrow"

### Practical Backtests

**[Second Day Gap Strategy](https://quantsavvy.com/second-day-gap-daytrading-strategy/)** (Quant Savvy):
- Profit factor < 1.8 (barely profitable after costs)
- Long side near breakeven (1.0 profit factor)
- **Conclusion:** Edge exists but requires filtering

### Key Insight

Day 2 continuation works **only with filtering**:
- Volume holding (≥50% of Day 1)
- Price structure (not exhausted)
- Market alignment (with SPY trend)
- Social momentum (stable or rising)

**Without filters:** Coin flip. **With filters:** Potential edge.

---

## Next Steps

### Stage 3 Implementation

1. **Add `gradeDay2Setup()` function**
   - Evaluate all 6 criteria
   - Assign A/B/C/F grade

2. **Enrich Telegram alerts**
   - Check if ticker has Day 2 history
   - Append graded context to alert
   - No separate alert - single message

3. **Outcome tracking**
   - Extend `signal_tracking.json`
   - Track Day 2 win rate by grade
   - Tune filters based on results

### Stage 4 Validation

1. **Collect data (2-3 weeks)**
2. **Analyze outcomes:**
   - Grade A win rate?
   - Grade B vs Grade A?
   - Which filters matter most?
3. **Tune or kill** based on results

---

## Rollback

Delete `data/scanner_history.json` and revert:

```bash
git checkout main
git branch -D feature/scanner-history
```

All changes are isolated to the feature branch.

---

## Notes

- **No impact on existing scanner logic** - History is additive, not replacement
- **Confluence scoring unchanged** - Still uses technical, levels, sentiment, volume, context
- **Alert triggers unchanged** - Still fires on score ≥60, TF aligned, wall not dormant
- **Day 2 is bonus context** - Doesn't change WHEN alerts fire or WHAT scores are

