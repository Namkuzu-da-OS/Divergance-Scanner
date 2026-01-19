# Wingman Codebase Reorganization Plan

## Current State Issues

1. **Root folder chaos** - 6 HTML files, 5 orphan markdown files, random `nul` file
2. **Monitor temp pollution** - 5 `tmpclaude-*` files
3. **No structure** - Everything flat, mixed concerns
4. **127+ hardcoded path dependencies**

---

## Target Structure

```
wingman/
├── dashboards/                    # All HTML dashboards (NEW)
│   ├── zone-scanner.html
│   ├── analytics.html
│   ├── earnings-scanner.html
│   ├── opportunity-scanner.html
│   ├── scanner.html               # Legacy
│   └── dashboard.html             # Legacy
│
├── monitor/                       # Runtime services (REORGANIZE)
│   ├── scanners/                  # Scanner implementations (NEW)
│   │   ├── bloodhound-scanner.js
│   │   ├── earnings-scanner.js
│   │   ├── opportunity-scanner.js
│   │   └── dynamic-scanner.js
│   ├── services/                  # Support services (NEW)
│   │   ├── web-server.js
│   │   ├── wingman-monitor.js
│   │   ├── paper-trade-manager.js
│   │   ├── earnings-calendar-scraper.js
│   │   ├── trade-client.js
│   │   ├── watchlist.js
│   │   └── scanner-validator.js
│   ├── config.json                # Stays here
│   ├── README.md
│   ├── SETUP.md
│   └── _legacy/                   # Keep as-is
│
├── backtesting/                   # Backtesting suite (REORGANIZE)
│   ├── scripts/
│   │   ├── signal-backtester.js
│   │   └── analyze-failures.js
│   ├── strategies/
│   │   ├── wingman-strategy.pine
│   │   └── wingman_backtest.py
│   └── README.md
│
├── indicators/                    # TradingView indicators (KEEP)
│   ├── wingman-master.pine
│   └── README.md
│
├── docs/                          # Documentation (REORGANIZE)
│   ├── architecture/
│   │   ├── VISION.md
│   │   ├── TRADING_SYSTEM.md
│   │   └── SCANNER_HISTORY.md
│   ├── strategies/
│   │   ├── STRATEGIES.md
│   │   ├── EARNINGS_STRATEGIES.md
│   │   └── RULES.md
│   ├── plans/
│   │   ├── EARNINGS_SCANNER_PLAN.md
│   │   └── KNOWN_ISSUES.md
│   ├── changelogs/
│   │   └── CHANGELOG_2026-01-14.md
│   └── archive/                   # Old/stale docs
│       ├── SCANNER_HISTORY_STATUS.md  # Duplicate
│       ├── DOCUMENTATION_SUMMARY.md   # From root
│       ├── QUICK_REFERENCE_CARD.md    # From root
│       ├── QUICK_START.md             # From root
│       ├── SYSTEM_AUDIT.md            # From root
│       └── SYSTEM_STATUS.md           # From root
│
├── toolbox/                       # Utilities (KEEP)
│   └── archive/
│
├── data/                          # Runtime data (KEEP - DON'T MOVE)
│   └── ...
│
├── calculations/                  # Keep as-is
├── node_modules/                  # Keep as-is
│
├── CLAUDE.md                      # Update paths
├── README.md                      # Keep
├── package.json                   # Keep
├── package-lock.json              # Keep
├── .gitignore                     # Update
└── eod.js                         # Move to toolbox/ or monitor/services/
```

---

## Breaking Changes & Fixes

### Phase 1: HTML Dashboard Migration

**Move:** Root HTML files → `dashboards/`

**Files to update:**

| File | Change Required |
|------|-----------------|
| `zone-scanner.html` | `./data/` → `../data/` |
| `analytics.html` | `/data/` → `../data/` |
| `earnings-scanner.html` | No data fetch changes |
| `opportunity-scanner.html` | `./data/` → `../data/` |
| `scanner.html` | `./data/` → `../data/` |
| `dashboard.html` | `./data/` → `../data/`, `./toolbox/` → `../toolbox/` |

**Inter-dashboard links to update (all files):**
```javascript
// OLD
href="zone-scanner.html"
href="analytics.html"
href="scanner.html"

// NEW (no change needed - relative links still work within dashboards/)
href="zone-scanner.html"  // Still works!
```

### Phase 2: Web Server Update

**File:** `monitor/web-server.js`

**Current logic:**
```javascript
const ROOT = path.join(__dirname, '..');  // Points to wingman/
app.use(express.static(ROOT));
// Default route serves zone-scanner.html
```

**Required change:**
```javascript
const ROOT = path.join(__dirname, '..');
const DASHBOARDS = path.join(ROOT, 'dashboards');

// Serve dashboards from /dashboards or root
app.use('/dashboards', express.static(DASHBOARDS));
app.use(express.static(ROOT));  // Still serve data/, etc.

// Update default route
app.get('/', (req, res) => {
  res.sendFile(path.join(DASHBOARDS, 'zone-scanner.html'));
});
```

**Data endpoint update:**
```javascript
// paper_trades.json endpoint - path stays same
const PAPER_TRADES_FILE = path.join(ROOT, 'data', 'paper_trades.json');
```

### Phase 3: Monitor Reorganization (OPTIONAL - Higher Risk)

**Risk Level: HIGH** - All scanner files use `__dirname` for paths

If we move scanners to `monitor/scanners/`:

| File | Current Path | New Path Logic |
|------|--------------|----------------|
| bloodhound-scanner.js | `path.join(__dirname, '..', 'data', ...)` | `path.join(__dirname, '..', '..', 'data', ...)` |
| earnings-scanner.js | Same pattern | Add one more `..` |
| All others | Same pattern | Add one more `..` |

**Recommendation:** Keep monitor/ flat for now. Lower risk.

### Phase 4: Backtesting Reorganization

**Low risk** - These files don't reference each other or data/

```
backtesting/
├── scripts/
│   ├── signal-backtester.js   # Move from root
│   └── analyze-failures.js    # Move from root
├── strategies/
│   ├── wingman-strategy.pine  # Move from root
│   └── wingman_backtest.py    # Move from root
└── README.md                  # Keep in root of backtesting/
```

**No path updates needed** - these are standalone tools.

### Phase 5: Documentation Reorganization

**Low risk** - Only CLAUDE.md references these

**Moves:**
```
docs/VISION.md → docs/architecture/VISION.md
docs/TRADING_SYSTEM.md → docs/architecture/TRADING_SYSTEM.md
docs/SCANNER_HISTORY.md → docs/architecture/SCANNER_HISTORY.md
docs/STRATEGIES.md → docs/strategies/STRATEGIES.md
docs/EARNINGS_STRATEGIES.md → docs/strategies/EARNINGS_STRATEGIES.md
docs/RULES.md → docs/strategies/RULES.md
docs/EARNINGS_SCANNER_PLAN.md → docs/plans/EARNINGS_SCANNER_PLAN.md
docs/KNOWN_ISSUES.md → docs/plans/KNOWN_ISSUES.md
docs/CHANGELOG_2026-01-14.md → docs/changelogs/CHANGELOG_2026-01-14.md
docs/SCANNER_HISTORY_STATUS.md → docs/archive/SCANNER_HISTORY_STATUS.md

# From root to docs/archive/
DOCUMENTATION_SUMMARY.md → docs/archive/DOCUMENTATION_SUMMARY.md
QUICK_REFERENCE_CARD.md → docs/archive/QUICK_REFERENCE_CARD.md
QUICK_START.md → docs/archive/QUICK_START.md
SYSTEM_AUDIT.md → docs/archive/SYSTEM_AUDIT.md
SYSTEM_STATUS.md → docs/archive/SYSTEM_STATUS.md
```

### Phase 6: CLAUDE.md Path Updates

Every path reference must be updated:

| Old Path | New Path |
|----------|----------|
| `docs/VISION.md` | `docs/architecture/VISION.md` |
| `docs/RULES.md` | `docs/strategies/RULES.md` |
| `docs/STRATEGIES.md` | `docs/strategies/STRATEGIES.md` |
| `scanner.html` | `dashboards/scanner.html` |
| `zone-scanner.html` | `dashboards/zone-scanner.html` |
| `analytics.html` | `dashboards/analytics.html` |
| `earnings-scanner.html` | `dashboards/earnings-scanner.html` |

### Phase 7: Cleanup

**Delete:**
- `nul` (Windows artifact)
- `monitor/tmpclaude-*` (5 temp files)

**Move:**
- `eod.js` → `toolbox/eod.js` or `monitor/services/eod.js`
- `data/HANDOFF_2026-01-15.md` → `docs/handoffs/HANDOFF_2026-01-15.md`

---

## Execution Order (Minimize Downtime)

### Step 1: Stop Services
```bash
pm2 stop all
```

### Step 2: Create New Directories
```bash
mkdir -p dashboards
mkdir -p backtesting/scripts
mkdir -p backtesting/strategies
mkdir -p docs/architecture
mkdir -p docs/strategies
mkdir -p docs/plans
mkdir -p docs/changelogs
mkdir -p docs/archive
mkdir -p docs/handoffs
```

### Step 3: Move Files (by risk level)

**3a. Low Risk - Backtesting (no dependencies)**
```bash
mv backtesting/signal-backtester.js backtesting/scripts/
mv backtesting/analyze-failures.js backtesting/scripts/
mv backtesting/wingman-strategy.pine backtesting/strategies/
mv backtesting/wingman_backtest.py backtesting/strategies/
```

**3b. Low Risk - Documentation**
```bash
mv docs/VISION.md docs/architecture/
mv docs/TRADING_SYSTEM.md docs/architecture/
# ... etc
```

**3c. Medium Risk - Dashboards**
```bash
mv *.html dashboards/
```

**3d. Update web-server.js** (before starting services)

**3e. Update all HTML fetch paths**

### Step 4: Update CLAUDE.md

### Step 5: Cleanup
```bash
rm nul
rm monitor/tmpclaude-*
```

### Step 6: Test
```bash
pm2 start all
# Open http://localhost:8080 - verify dashboard loads
# Verify data fetches work
```

### Step 7: Commit
```bash
git add -A
git commit -m "Reorganize codebase structure"
```

---

## Rollback Plan

If anything breaks:
```bash
git checkout -- .
pm2 restart all
```

---

## Files That Need Code Changes

| File | Changes Required |
|------|------------------|
| `monitor/web-server.js` | Update static serving paths, default route |
| `dashboards/zone-scanner.html` | `./data/` → `../data/` |
| `dashboards/analytics.html` | `/data/` → `../data/` |
| `dashboards/scanner.html` | `./data/` → `../data/` |
| `dashboards/dashboard.html` | `./data/` → `../data/`, `./toolbox/` → `../toolbox/` |
| `dashboards/opportunity-scanner.html` | `./data/` → `../data/` |
| `CLAUDE.md` | ~25 path references |

---

## Decision Points

1. **Monitor subfolder structure** - Skip for now? (HIGH RISK)
2. **Keep legacy dashboards** (scanner.html, dashboard.html) or archive them?
3. **Handoff files** - Move to docs/handoffs/ or keep in data/?

---

## Estimated Impact

- **Files moved:** ~25
- **Files edited:** ~8
- **Path changes in code:** ~50
- **Downtime:** 5-10 minutes (while services restart)
