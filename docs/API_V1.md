# Wingman External API (v1)

**Base URL:** `http://localhost:8080/api/v1`
**Purpose:** Single entry point for AI integrations and external apps to access Wingman trading system context.
**Added:** 2026-02-23

---

## Overview

The v1 API provides two endpoints — a health check and a context bundle. The context endpoint returns everything an AI assistant needs to understand the current state of the Wingman trading system in one call: market intelligence notes, session state, scanner results, open positions, recent alerts, options flow, and market internals.

All responses use a consistent envelope format. CORS is enabled (all origins). No authentication required (local network only).

---

## Response Envelope

Every v1 response uses the same shape:

```json
// Success
{
  "ok": true,
  "ts": "2026-02-23T15:30:00.000Z",
  "data": { ... }
}

// Error
{
  "ok": false,
  "ts": "2026-02-23T15:30:00.000Z",
  "error": {
    "code": "NOT_FOUND",
    "message": "No v1 endpoint: GET /api/v1/foo"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | `true` on success, `false` on error |
| `ts` | string | ISO 8601 timestamp of response generation |
| `data` | object | Response payload (success only) |
| `error` | object | Error details (error only) |
| `error.code` | string | Machine-readable error code |
| `error.message` | string | Human-readable description |

**HTTP status codes used:** 200 (success), 404 (unknown endpoint), 500 (internal error)

---

## Endpoints

### GET /api/v1/health

Lightweight health check. Use this to verify Wingman is reachable before making heavier calls.

**Request:**
```bash
curl http://localhost:8080/api/v1/health
```

**Response:**
```json
{
  "ok": true,
  "ts": "2026-02-23T07:42:02.125Z",
  "data": {
    "status": "ok",
    "uptime_s": 497,
    "cache": {
      "total": 0,
      "fresh": 0,
      "stale": 0
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` if responding |
| `uptime_s` | number | Web server uptime in seconds |
| `cache.total` | number | Total entries in cross-process API cache |
| `cache.fresh` | number | Non-expired cache entries |
| `cache.stale` | number | Expired cache entries awaiting cleanup |

---

### GET /api/v1/context

The main endpoint. Returns the full Wingman context bundle — everything an AI needs in one call.

**Request:**
```bash
curl http://localhost:8080/api/v1/context
```

**Response `data` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `market_intel` | string \| null | Full contents of `MARKET_INTEL.md` — regime, rotation, watchlist, session recaps, gamma maps, scenario matrix |
| `session_state` | string \| null | Full contents of `SESSION_STATE.md` — intra-session checkpoint with market snapshot, positions, conclusions, action queue |
| `scan` | object \| null | Latest Bloodhound scanner results (see below) |
| `positions` | object | Open positions with P&L summary (see below) |
| `alerts` | array | Last 20 alerts from past 3 days (see below) |
| `options_flow` | array | Top 10 unusual options activity signals, score 50+ (see below) |
| `internals` | object \| null | Latest market internals snapshot (see below) |

---

#### `market_intel` (string)

The living market intelligence document, maintained across sessions. Contains:

- **Market regime** — VIX level, SPY/QQQ prices, gamma levels, risk appetite
- **Sector rotation** — RS rankings, rotation phase, active divergences
- **Active swing watchlist** — tiered setups (Tier 1/2/3) with entry zones, stops, targets
- **Open positions** — current trades with P&L
- **SPY gamma map** — key levels with annotations
- **Previous session recaps** — what happened and why
- **Next session focus** — scenario matrix, priority actions, what we're NOT doing
- **Macro calendar** — confirmed upcoming events only

This is Markdown text. Parse it as-is or extract sections by heading.

#### `session_state` (string)

Intra-session checkpoint saved via `/checkpoint` command. Contains:

- **Market snapshot** — real-time prices, VIX, internals at time of checkpoint
- **Bloodhound status** — ticker count, top signals
- **Watchlist status** — table of all watched tickers with tier, zone, score, sector wind
- **Positions** — current entries with marks
- **Key conclusions** — what was learned this session
- **Action queue** — next steps
- **Rotation regime** — sector context
- **Calendar** — confirmed dates only

This is Markdown text. The timestamp at the top tells you when it was written.

---

#### `scan` (object)

Latest Bloodhound scanner output, organized by tier.

```json
{
  "timestamp": "2026-02-20T21:01:25.404Z",
  "ticker_count": 47,
  "market_context": { ... },
  "tiers": {
    "high_conviction": [ ... ],
    "tradeable": [ ... ],
    "watch": [ ... ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | When the scan ran (UTC) |
| `ticker_count` | number | Total symbols scanned |
| `market_context` | object | Market-wide context (see below) |
| `tiers.high_conviction` | array | Score 40+ at wall, or score 60+ — highest confidence setups |
| `tiers.tradeable` | array | Score 35+ at wall with clear action |
| `tiers.watch` | array | Score 20+ near wall, or notable conditions |

**`market_context` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `vix` | number | Current VIX value |
| `vixRegime` | string | `"complacent"`, `"normal"`, `"elevated"`, `"fear"`, `"capitulation"` |
| `spyTrend` | string | `"bullish"`, `"bearish"`, `"neutral"` |
| `spyPrice` | number | SPY current price |
| `riskAppetite` | string | `"high"`, `"moderate"`, `"low"` |
| `regime` | string | Overall market regime |
| `positionSizeModifier` | number | Risk multiplier (1.0 = normal, 0.75 = reduced, 0.5 = defensive) |
| `spyLevels` | object | SPY gamma levels — call_wall, put_wall, gamma_flip, max_pain, vwap, expected_move, weekly_pivots |
| `qqqLevels` | object | QQQ gamma levels (same structure as spyLevels) |
| `rotationRegime` | object | Sector rotation phase, leading/lagging sectors, divergences |

**Ticker objects** (in each tier array):

```json
{
  "symbol": "OXY",
  "price": 51.84,
  "zone": "SELL_ZONE",
  "score": 58,
  "action": "SELL",
  "rsi": 71.91,
  "trend": "strong_uptrend",
  "signals": [
    "VELOCITY +33 pts",
    "RSI overbought (71.9)",
    "At call wall resistance ($52)",
    "Volume spike (2.9x avg)",
    "Flow confirmed by Opportunity Scanner (HC 646.0x $13.9M) [+8]"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Ticker symbol |
| `price` | number | Current price |
| `zone` | string | Gamma zone: `BUY_ZONE`, `SELL_ZONE`, `AT_WALL`, `MID_RANGE`, `PINNED`, `EXTENDED_HIGH`, `EXTENDED_LOW`, `HIGH_MOMENTUM`, `LOW_MOMENTUM` |
| `score` | number | Confluence score 0-100 |
| `action` | string | Suggested action: `BUY`, `SELL`, `WATCH`, `HOLD`, or null |
| `rsi` | number \| null | 14-period RSI |
| `trend` | string \| null | `"strong_uptrend"`, `"uptrend"`, `"neutral"`, `"downtrend"`, `"strong_downtrend"` |
| `signals` | array | Human-readable signal descriptions explaining the score |

---

#### `positions` (object)

```json
{
  "positions": [
    {
      "id": 1,
      "symbol": "QCOM",
      "direction": "long",
      "strategy": "Smart Money Dip Buy",
      "entry_price": 2.06,
      "stop_price": null,
      "target_price": null,
      "shares": null,
      "entry_date": "2026-02-11T22:45:00.000Z",
      "status": "open",
      "exit_price": null,
      "exit_date": null,
      "exit_reason": null,
      "pnl": null,
      "notes": "Mar 20 $150C paper trade"
    }
  ],
  "summary": {
    "total_open": 1,
    "total_exposure": 0,
    "total_risk": 0,
    "total_unrealized_pnl": 0,
    "total_unrealized_pnl_pct": 0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `positions` | array | All open position records |
| `summary.total_open` | number | Count of open positions |
| `summary.total_exposure` | number | Total dollar exposure (entry_price * shares) |
| `summary.total_risk` | number | Total dollar risk (based on stops) |
| `summary.total_unrealized_pnl` | number | Unrealized P&L in dollars |
| `summary.total_unrealized_pnl_pct` | number | Unrealized P&L percentage |

---

#### `alerts` (array)

Recent scanner alerts (Telegram notifications sent).

```json
[
  {
    "id": 123,
    "timestamp": "2026-02-20T15:30:00.000Z",
    "type": "bloodhound",
    "symbol": "AAPL",
    "message": "HIGH_CONVICTION: BUY at put wall...",
    "tier": "HIGH_CONVICTION",
    "score": 65
  }
]
```

Returns an empty array `[]` when no recent alerts exist.

---

#### `options_flow` (array)

Top 10 unusual options activity signals from the Opportunity Scanner (score 50+).

```json
[
  {
    "symbol": "SMCI",
    "score": 90,
    "tier": "HIGH_CONVICTION",
    "direction": "neutral",
    "signals": [
      "Vol/OI 40.9x (major positioning)",
      "Net premium: $14.8M bullish",
      "Call/Put ratio: 3.15 (strong bullish)",
      "20 unusual strikes (conviction)",
      "IV Rank: 82% (high - sell premium)"
    ]
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Ticker symbol |
| `score` | number | Opportunity score 0-100 |
| `tier` | string | `"HIGH_CONVICTION"`, `"TRADEABLE"`, `"WATCH"` |
| `direction` | string | `"bullish"`, `"bearish"`, `"neutral"` |
| `signals` | array | Human-readable signal descriptions |

---

#### `internals` (object)

Latest market internals snapshot (collected every 2 min during RTH 9:30 AM - 4:00 PM ET).

```json
{
  "timestamp": "2026-02-20T20:58:00.000Z",
  "tick": 209,
  "tick_high": 893,
  "tick_low": -477,
  "trin": 1.53,
  "advn": 1280,
  "decn": 1730,
  "ad_spread": -450,
  "uvol": 3200000000,
  "dvol": 6900000000,
  "vol_ratio": 0.46,
  "vix": 20.39,
  "vix_change_pct": 0.79,
  "spx": 6866.57,
  "spx_change_pct": 0.07,
  "compx": 22752.79,
  "compx_change_pct": 0.31,
  "dji": 49251.40,
  "dji_change_pct": -0.29
}
```

**Key internals interpretation:**

| Metric | Bullish | Neutral | Bearish | Extreme |
|--------|---------|---------|---------|---------|
| TICK | > +400 | -400 to +400 | < -400 | > +800 or < -800 |
| A/D Spread | > +400 | -400 to +400 | < -400 | > +1000 or < -1000 |
| TRIN | < 0.8 | 0.8 - 1.2 | > 1.2 | > 2.0 |
| Vol Ratio | > 2.0 | 1.0 - 2.0 | < 1.0 | > 3.0 |
| VIX | < 12 | 12 - 20 | 20 - 30 | > 30 |

Returns `null` when no internals data is available (outside RTH, or scanner not running).

---

## Timing Notes

- **Timestamps are UTC.** Convert to ET for trading context: UTC - 5 hours (EST) or UTC - 4 hours (EDT).
- **Scan data** refreshes every 5 minutes during market hours.
- **Internals** refresh every 2 minutes during RTH (9:30 AM - 4:00 PM ET).
- **MARKET_INTEL.md** and **SESSION_STATE.md** are updated manually during trading sessions. They may be stale on weekends or between sessions.
- **Options flow** refreshes every 5 minutes during market hours.

---

## Architecture

```
External App / AI
       |
       v
  GET /api/v1/context
       |
       v
  Port 8080 (web-server.js)
       |
       v
  api-v1.js  ──> signal-db.js (SQLite)
             ──> opportunity-db.js (SQLite)
             ──> data/MARKET_INTEL.md (file)
             ──> data/SESSION_STATE.md (file)
```

All data is read-only from existing SQLite databases and markdown files. No upstream API calls are made — everything comes from cached scanner results. Response time is typically < 100ms.

---

## Files

| File | Purpose |
|------|---------|
| `monitor/api-v1.js` | Route handler, envelope helpers, context aggregation |
| `monitor/web-server.js` | Hook: routes `/api/v1/*` to api-v1.js (5 lines added) |
| `data/MARKET_INTEL.md` | Living market intelligence document |
| `data/SESSION_STATE.md` | Intra-session checkpoint |
| `data/wingman.db` | SQLite database (scans, signals, positions, internals, etc.) |

---

## Extending

To add new v1 endpoints, edit `monitor/api-v1.js`:

1. Add a route match in `handleRequest()`
2. Add a handler function
3. Use `sendOk(res, data)` or `sendError(res, code, message, status)` for responses

The envelope format and CORS headers are handled automatically. No changes to web-server.js needed.
