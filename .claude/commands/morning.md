# /morning Command

Generate comprehensive pre-market structure report from both data backends.

## Usage
```
/morning          - Full market structure report
/morning sectors  - Sector rotation only
/morning levels   - Key levels only
```

---

## Report Sections

### 1. Market Regime
Determine overall market character based on:
- Which sectors leading (cyclicals vs defensives)
- VIX level and regime
- SPY/QQQ relative strength

**Regimes:**
- **Risk-On:** Cyclicals (XLB, XLI, XLF) leading, defensives (XLP, XLU) lagging
- **Risk-Off:** Defensives leading, cyclicals lagging
- **Tech-Led:** XLK/QQQ outperforming SPY
- **Rotation:** Mixed leadership, choppy

### 2. Sector Strength Rankings
Pull all sector ETFs and rank by:
- Daily change %
- 52-week position %
- Distance from key levels

**Sector ETFs:**
| ETF | Sector |
|-----|--------|
| XLK | Technology |
| XLF | Financials |
| XLE | Energy |
| XLV | Healthcare |
| XLI | Industrials |
| XLY | Consumer Discretionary |
| XLP | Consumer Staples |
| XLB | Materials |
| XLU | Utilities |
| XLRE | Real Estate |
| XLC | Communications |

### 3. SPY/QQQ Divergence
Compare broad market vs tech:
- Today's performance
- 52-week range position
- Which is leading/lagging
- Implications for trade selection

### 4. Key Levels
Pull from port 8000 for major ETFs:
- Gamma walls (call/put)
- Max pain
- VWAP and bands

### 5. VIX Context
- Current level and regime
- Position sizing modifier
- Risk adjustment needed

### 6. AI Outlook Summary
Pull condensed version of market narrative from port 3000.

---

## Data Sources

### Port 3000
```
GET /api/latest              → All ETF/VIX data
GET /api/market/outlook      → AI narrative
GET /api/x/sentiment/overview → Sentiment
```

### Port 8000
```
GET /api/levels/SPY          → SPY gamma levels
GET /api/levels/QQQ          → QQQ gamma levels
GET /api/market/context      → VIX regime, bias
```

---

## Output Format

```
══════════════════════════════════════════════════════
MARKET STRUCTURE REPORT - [Date] [Time] UTC
══════════════════════════════════════════════════════

REGIME: [Risk-On / Risk-Off / Tech-Led / Rotation]
VIX: [Level] ([Regime]) - [Sizing modifier]

──────────────────────────────────────────────────────
SECTOR STRENGTH (ranked)
──────────────────────────────────────────────────────
#  ETF   Sector          Change   52w Pos   Status
1. XLB   Materials       +0.93%   99.9%     AT HIGH
2. XLI   Industrials     +1.22%   99.8%     AT HIGH
...
11. XLP  Staples         +0.10%   24.9%     LAGGING

──────────────────────────────────────────────────────
SPY vs QQQ
──────────────────────────────────────────────────────
        Price    Change   52w Pos   IV
SPY     $690.75  +0.44%   99.6%     13.6%
QQQ     $622.16  +0.67%   93.7%     17.0%

Read: [Tech outperforming / SPY leading / Converging]

──────────────────────────────────────────────────────
KEY LEVELS
──────────────────────────────────────────────────────
SPY: Call Wall $690 | Put Wall $680 | Max Pain $687
QQQ: Call Wall $641 | Put Wall $590 | Max Pain $618

──────────────────────────────────────────────────────
AI OUTLOOK
──────────────────────────────────────────────────────
Intraday: [BULLISH/NEUTRAL/BEARISH]
Swing: [BULLISH/NEUTRAL/BEARISH]
Key Theme: [One-liner from AI narrative]

──────────────────────────────────────────────────────
TRADE BIAS
──────────────────────────────────────────────────────
FAVOR: [Sectors/direction to favor]
AVOID: [Sectors/setups to avoid]
WATCH: [Key levels/events to monitor]

══════════════════════════════════════════════════════
```

---

## When to Run

- Pre-market (before 9:30 AM ET)
- After significant market moves
- When reassessing bias mid-session

---

## Integration

After running /morning, the report context should inform:
- Which sectors to focus on for setups
- Whether to favor longs or shorts
- Position sizing based on VIX
- Key levels for entries/exits

## NEVER FABRICATE (NON-NEGOTIABLE)

Every number, level, date, and claim in this report must come from API data fetched this session, files read, or user input. If data is unavailable, say so — do not substitute guesses, general knowledge, or pattern-matched estimates. Economic calendar dates (FOMC, CPI, PPI, NFP) must come from a confirmed source, never from "general knowledge." No data = say "no data." This is a trading system — fabricated data causes real financial harm.
