# R&D: Option Signal Tracker — Bloodhound Alert → Option Outcome

**Created:** 2026-02-09
**Status:** Phase 2+3 COMPLETE — Automated logging and tracking live
**Trigger:** AMZN Score 98 alert flagged $207.5C at $1.50, ran to $4.50 (+200%)

---

## The Concept

Bloodhound already identifies HIGH_CONVICTION setups AND flags the specific unusual option
contracts driving the flow. We're just not tracking whether those flagged options are profitable.

**Today's example:**
```
7:12 AM  Alert fires: AMZN Score 98, unusual CALL $207.5 02/09 (16.6x vol/OI, $8.8M)
         Contract: .AMZN260209C207.5 at ~$1.50
         AMZN at $206.67, target: $210 call wall

         ...AMZN rallies to ~$212...

~11:00AM Contract peaks at ~$4.50 (+200%, +$300 per contract)

3:00 PM  Contract at $1.84 (gave back gains, AMZN pulled back to $209.57)
```

One contract = $150 risk. Peak profit = $300. Within the $200 risk budget.

---

## How It Works

### Step 1: Alert Fires (Already Happens)

Bloodhound sends a Telegram alert with all the data we need:

```
🔥 BLOODHOUND: AMZN 🟢
Score: 98/100 | Direction: BULLISH | Price: $206.67

Signals:
• 🔥 Unusual CALL $207.5 02/09 (6.5x, $1.4M)    ← THIS IS THE TRADE
• RSI oversold (27.8)
• At put wall support ($205)
• Volume spike (3.5x avg)
• $49M net bullish premium

Key Levels:
• Put Wall: $205 (stop zone)
• Call Wall: $210 (profit target)
• Max Pain: $207.5
```

### Step 2: System Logs the Option Signal (NEW)

When Bloodhound logs a HIGH_CONVICTION signal to the `signals` table,
it ALSO logs the top unusual option to a new `option_signals` table:

```
┌─────────────────────────────────────────────────────────┐
│ OPTION SIGNAL LOGGED                                     │
├─────────────────────────────────────────────────────────┤
│ Symbol:      AMZN                                        │
│ Alert Time:  2026-02-09 07:12 PST                        │
│ Score:       98                                          │
│                                                          │
│ Contract:    .AMZN260209C207.5                           │
│ Type:        CALL                                        │
│ Strike:      $207.50                                     │
│ Expiry:      2026-02-09 (0DTE)                          │
│ Premium:     $1.50 (at alert)                            │
│ Delta:       0.865                                       │
│ Vol/OI:      16.6x                                       │
│ Flow:        $8.8M                                       │
│                                                          │
│ Stock Price: $206.67                                     │
│ Put Wall:    $205.00 (stop reference)                    │
│ Call Wall:   $210.00 (target)                            │
│ Max Pain:    $207.50                                     │
│                                                          │
│ Max Risk:    $150 (1 contract)                           │
│ Target:      $4.50+ (call wall hit)                      │
│ R:R:         ~2:1 at minimum                             │
└─────────────────────────────────────────────────────────┘
```

### Step 3: Track the Option Price (NEW)

A lightweight tracker polls the option price at intervals:

**For 0DTE contracts:** Every 15 minutes during market hours
**For 1-5 DTE contracts:** Every 30 minutes
**For 5+ DTE:** Every hour (or piggyback on scan cycle)

```
TIME        AMZN    .AMZN260209C207.5   GAIN     NOTE
──────────────────────────────────────────────────────────
07:12 AM    $206.67    $1.50            entry    Alert fired
07:30 AM    $207.20    $1.75            +17%
07:45 AM    $208.10    $2.30            +53%
08:00 AM    $209.00    $2.85            +90%
08:30 AM    $210.50    $3.80            +153%
09:00 AM    $211.80    $4.35            +190%
09:15 AM    $212.10    $4.50            +200%    ← PEAK (call wall hit)
09:30 AM    $211.50    $4.10            +173%
10:00 AM    $210.80    $3.40            +127%
11:00 AM    $210.20    $2.90            +93%
12:00 PM    $209.80    $2.40            +60%
01:00 PM    $209.50    $1.90            +27%
02:00 PM    $209.60    $1.85            +23%
03:00 PM    $209.57    $1.84            +23%
04:00 PM    $209.XX    $X.XX            ???      EXPIRED
```

### Step 4: Record Outcome

At expiration or EOD, log the final result:

```
┌─────────────────────────────────────────────────────────┐
│ OPTION SIGNAL OUTCOME                                    │
├─────────────────────────────────────────────────────────┤
│ Contract:     .AMZN260209C207.5                         │
│ Entry:        $1.50                                      │
│ Peak:         $4.50 at 09:15 AM (+200%)                 │
│ Close:        $1.84 at 04:00 PM (+23%)                  │
│                                                          │
│ Outcome:      WIN (peak ≥ 100%)                          │
│ Held to peak: +$300 per contract                         │
│ Held to close: +$34 per contract                         │
│ Left on table: 177% (peak vs close)                      │
│                                                          │
│ Stock moved:  $206.67 → $212.10 peak (+2.6%)            │
│ Hit call wall: YES ($210)                                │
│ Hit put wall:  NO                                        │
│                                                          │
│ Time to peak: 2h 3min                                    │
│ Optimal exit:  When stock hit call wall ($210)           │
└─────────────────────────────────────────────────────────┘
```

---

## The Dashboard (Analytics After 30+ Signals)

After collecting enough data, we'd see something like:

```
═══════════════════════════════════════════════════════════
          OPTION SIGNAL TRACKER — Performance Report
═══════════════════════════════════════════════════════════

Period: Feb 9 - Mar 15, 2026 (25 trading days)
Signals Tracked: 47

HEADLINE METRICS
────────────────────────────────────────────────────────
Win Rate (peak ≥ 50%):          72%  (34/47)
Win Rate (peak ≥ 100%):         53%  (25/47)
Avg Peak Gain:                  +145%
Avg Close Gain:                 +38%
Avg Time to Peak:               1.8 hours
Avg Left on Table:              107% (peak vs close)

RISK METRICS
────────────────────────────────────────────────────────
Total Risked (1 contract each):  $8,200
Total Peak P&L (if perfect):     $11,890
Total Close P&L (if held):       $3,116
Max Consecutive Losses:          3
Largest Single Loss:             -$280 (1 contract expired worthless)
Largest Single Win:              +$450 (NVDA 0DTE, +300%)

BY SCORE RANGE
────────────────────────────────────────────────────────
Score    Signals  Win%(50%+)  Win%(100%+)  Avg Peak
90-100      8       88%         75%         +210%
80-89      12       75%         58%         +155%
70-79      15       67%         47%         +120%
50-69      12       58%         33%         +95%

BY DTE
────────────────────────────────────────────────────────
DTE      Signals  Win%(50%+)  Avg Peak  Avg Hold to Peak
0DTE        18      78%       +170%     1.5 hours
1-2 DTE     14      71%       +140%     4.2 hours
3-5 DTE     10      60%       +110%     1.2 days
5+ DTE       5      50%       +85%      2.5 days

BY DIRECTION
────────────────────────────────────────────────────────
Direction  Signals  Win%(50%+)  Avg Peak  Notes
BULLISH       32      75%       +155%     Calls at put wall
BEARISH       15      60%       +120%     Puts at call wall

BY VIX REGIME
────────────────────────────────────────────────────────
Regime       Signals  Win%(50%+)  Avg Peak
Normal         28       71%       +135%
Elevated       12       75%       +170%     ← Fear = better entries
Complacent      7       57%       +95%

KEY INSIGHT: EXIT AT THE WALL
────────────────────────────────────────────────────────
Signals where stock hit the target wall:     31/47 (66%)
Avg option gain when wall was hit:           +185%
Avg option gain at close (same signals):     +42%

>>> Selling when the stock hits the call/put wall captures
>>> 4.4x more profit than holding to close.
>>> This is the exit rule.
```

---

## Proposed Exit Rules (To Test)

Based on what we know about gamma mechanics:

| Rule | Trigger | Rationale |
|------|---------|-----------|
| **Primary exit** | Stock hits call wall (bullish) or put wall (bearish) | Gamma wall = resistance/support, price stalls |
| **Time stop** | 2 hours after entry with no movement | 0DTE theta accelerates, cut losses early |
| **Trailing stop** | Option drops 50% from peak | Lock in gains, don't give back the whole move |
| **Hard stop** | Option drops to $0.10 | Near worthless, accept the loss |

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS option_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER,                  -- Links to signals table

    -- Alert context
    symbol TEXT NOT NULL,
    alert_time TEXT NOT NULL,
    stock_price_at_alert REAL,
    confluence_score INTEGER,
    direction TEXT,                      -- BULLISH / BEARISH

    -- The flagged option contract
    contract_symbol TEXT,                -- .AMZN260209C207.5
    option_type TEXT,                    -- CALL / PUT
    strike REAL,
    expiration TEXT,
    dte INTEGER,
    premium_at_alert REAL,
    delta_at_alert REAL,
    iv_at_alert REAL,
    vol_oi_ratio REAL,
    premium_flow REAL,                  -- Total $ flow on this contract

    -- Key levels from scanner
    put_wall REAL,
    call_wall REAL,
    max_pain REAL,

    -- Tracking results (updated throughout the day)
    premium_peak REAL,
    premium_peak_time TEXT,
    stock_price_at_peak REAL,
    premium_close REAL,
    stock_price_at_close REAL,

    -- Outcome
    peak_gain_pct REAL,
    close_gain_pct REAL,
    time_to_peak_min INTEGER,
    hit_target_wall INTEGER DEFAULT 0,  -- Did stock reach call/put wall?
    outcome TEXT,                        -- WIN / LOSS / BREAKEVEN

    -- Market context
    vix REAL,
    vix_regime TEXT,
    spy_trend TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
);

-- Price snapshots for the option
CREATE TABLE IF NOT EXISTS option_price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    option_signal_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    minutes_elapsed INTEGER,
    stock_price REAL,
    option_bid REAL,
    option_ask REAL,
    option_mark REAL,
    delta REAL,
    gain_pct REAL,                      -- vs premium_at_alert
    FOREIGN KEY (option_signal_id) REFERENCES option_signals(id)
);
```

---

## Implementation Phases

### Phase 1: Paper Track (Start Immediately)
- Manually log each HIGH_CONVICTION alert with unusual options
- Check option price at a few points during the day
- Record in a spreadsheet or simple JSON
- Goal: 20-30 data points to validate the concept
- **SKIPPED** — went straight to automated

### Phase 2: Automated Logging ✅ COMPLETE (2026-02-09)
- Extended `signals` table with 17 option tracking columns
- Extended `price_snapshots` table with 4 option columns
- Bloodhound captures structured option data (contract, type, strike, exp, DTE, vol/OI, flow)
- Signal logger fetches option mark/bid/ask from chain API at alert time
- Files modified: `signal-db.js`, `signal-logger.js`, `bloodhound-scanner.js`

### Phase 3: Automated Tracking ✅ COMPLETE (2026-02-09)
- `updateActiveSignalPrices()` now also fetches option chain for tracked signals
- Tracks option_premium_peak, peak_time, peak_gain_pct on every scan cycle
- Detects option expiration (removes from chain) and auto-closes
- Checks if stock hit target wall (call wall for bullish, put wall for bearish)
- Price snapshots include option_bid, option_ask, option_mark, option_gain_pct
- `closeOptionSignal()` records final outcome: WIN/PARTIAL_WIN/BREAKEVEN/LOSS
- API endpoint: `GET /api/signals/options?days=30`

### Phase 4: Analytics Dashboard
- Add option signal performance to analytics.html
- Win rate by score, DTE, direction, VIX regime
- "Exit at the wall" vs "hold to close" comparison
- Goal: Data-driven decision on whether to trade this live

### Phase 5: Alerts with Trade Suggestion
- When Bloodhound fires a HIGH_CONVICTION alert with unusual options,
  include a suggested trade in the Telegram message:
  ```
  💰 SUGGESTED TRADE:
  Buy 1x .AMZN260209C207.5 at ~$1.50
  Risk: $150 (1 contract)
  Target: $4+ when AMZN hits $210 call wall
  Exit: At wall hit, or 2h time stop, or 50% trail from peak
  ```
- Goal: Actionable alert that fits within risk parameters

---

## Risk Considerations

| Risk | Mitigation |
|------|-----------|
| IV crush on 0DTE | Track IV at entry — avoid contracts with extreme IV |
| Theta decay on losing trades | 2-hour time stop limits exposure |
| Gap risk on multi-day holds | 0DTE has no overnight risk |
| Overtrading | Max 2 option signals per day, max $400 total risk |
| Survivorship bias | Track ALL signals, not just winners |
| Liquidity | Only trade contracts with bid/ask spread < 10% |

---

## Why This Fits Our System

1. **Risk-defined**: Max loss = premium paid. Always within $200 budget for 1 contract.
2. **Already identified**: Bloodhound already flags the specific contracts. We just need to track outcomes.
3. **Clear exits**: Call wall (bullish) or put wall (bearish) = natural profit target from gamma mechanics.
4. **Measurable**: Every dimension is trackable (score, DTE, direction, VIX, outcome).
5. **Scalable**: Start with paper tracking, graduate to live when data supports it.

---

## Today's Signal (Reference)

```
Symbol:     AMZN
Score:      98
Contract:   .AMZN260209C207.5
Entry:      ~$1.50 at 7:12 AM PST
Peak:       ~$4.50 at ~9:15 AM PST (+200%)
Current:    $1.84 at 3:00 PM
Call Wall:  $210 (hit at peak)
Outcome:    WIN — stock hit call wall, option tripled
```

*This is signal #1. We need 29 more before drawing conclusions.*
