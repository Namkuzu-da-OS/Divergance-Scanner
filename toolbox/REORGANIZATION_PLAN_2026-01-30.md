# Wingman Project Reorganization Plan
**Goal:** Organize project professionally without breaking anything.
**Status:** SAVED FOR WEEKEND EXECUTION
**Created:** 2026-01-30

---

## Dependency Map Summary

| Category | Files | Code Dependencies | Doc References |
|----------|-------|-------------------|----------------|
| HTML Dashboards | 9 | **web-server.js (line 432)** | 141+ in markdown |
| Scripts | 5 | None (CLI tools) | 2 references |
| Backtesting | 3 | None (CLI tools) | 4 references |
| eod.js | 1 | None | **9+ docs say `node eod.js`** |
| Calculations | 1 | None | 0 references |
| Indicators | 2 | None (PineScript) | 0 references |
| Root Markdown | 5 | dashboard.html fetches QUICK_START.md | 50+ cross-refs |

---

## Critical Blockers

### 1. web-server.js (MUST FIX FIRST)
```javascript
// Line 432 - currently serves from ROOT
filePath = path.join(ROOT, urlPath === '/' ? 'morning.html' : urlPath);
```
**Fix:** Update to serve from `dashboards/` folder

### 2. dashboard.html relative path
```javascript
// Fetches QUICK_START.md with relative path
fetch('./QUICK_START.md')
```
**Fix:** Either keep QUICK_START.md in root OR update fetch path

### 3. eod.js command references
9+ docs tell users to run `node eod.js` from root
**Options:**
- A) Keep eod.js in root (simplest)
- B) Create symlink: `ln -s toolbox/scripts/eod.js eod.js`
- C) Update all 9+ docs (tedious)

---

## Execution Order

### Phase 1: Update web-server.js
Edit `monitor/web-server.js` to serve dashboards from new location:
```javascript
// Check dashboards/ folder first, then fall back to root
const dashboardPath = path.join(ROOT, 'dashboards', urlPath);
const rootPath = path.join(ROOT, urlPath);
filePath = fs.existsSync(dashboardPath) ? dashboardPath : rootPath;
```

### Phase 2: Create dashboards/ and move HTML
```bash
mkdir -p dashboards
mv analytics.html dashboards/
mv dashboard.html dashboards/
mv earnings-scanner.html dashboards/
mv morning.html dashboards/
mv opportunity-scanner.html dashboards/
mv premarket.html dashboards/
mv scanner.html dashboards/
mv strategies.html dashboards/
mv zone-scanner.html dashboards/
```

### Phase 3: Test dashboards still work
```bash
pm2 restart webserver
curl -s http://localhost:8080 | head -c 100        # Should return HTML
curl -s http://localhost:8080/zone-scanner.html | head -c 100
```

### Phase 4: Move safe items to toolbox/
```bash
# Scripts (no code dependencies)
mkdir -p toolbox/scripts
mv scripts/divergence-analysis-v3.js toolbox/scripts/
mv scripts/ad_backtest.js toolbox/scripts/
mv scripts/internals_backtest.js toolbox/scripts/
mv scripts/divergence-analysis.js toolbox/archive/
mv scripts/divergence-analysis-v2.js toolbox/archive/
rmdir scripts

# Backtesting
mv backtesting/signal-backtester.js toolbox/scripts/
mv backtesting/analyze-failures.js toolbox/scripts/
mv backtesting/wingman_backtest.py toolbox/scripts/
mv backtesting/wingman-strategy.pine toolbox/archive/
mv backtesting/README.md toolbox/scripts/BACKTESTING.md
rmdir backtesting

# Other utilities
mv calculations toolbox/
mv indicators toolbox/
```

### Phase 5: Handle eod.js (Option B - symlink)
```bash
mv eod.js toolbox/scripts/
ln -s toolbox/scripts/eod.js eod.js
```
This preserves `node eod.js` command while organizing the file.

### Phase 6: Organize markdown (minimal moves)
**Keep in root:** README.md, CLAUDE.md, QUICK_START.md (dashboard.html needs it)
**Move to docs/:**
```bash
mv QUICK_REFERENCE_CARD.md docs/
mv SYSTEM_STATUS.md docs/
mv SYSTEM_AUDIT.md docs/
mv DOCUMENTATION_SUMMARY.md docs/
```

### Phase 7: Delete actual cruft
```bash
rm -rf toolbox/ChatExport_2026-01-09/   # Telegram export
rm toolbox/RULES.md.backup
rm toolbox/STRATEGIES.md.backup
rm monitor/tmpclaude-*-cwd 2>/dev/null
rm -rf monitor/_legacy/

# Deprecated JSON (replaced by SQLite)
rm data/signal_log.json
rm data/signal_tracking.json
rm data/scanner_history.json
rm data/alerts_log.json
```

### Phase 8: Update documentation references
Update these files to reflect new paths:
- CLAUDE.md - dashboard URLs still work (no change needed)
- docs/QUICK_REFERENCE_CARD.md - update any relative paths
- Strategies/vix-fear-capitulation.md - update script paths

---

## Final Structure

```
wingman/
├── README.md
├── CLAUDE.md
├── QUICK_START.md            # Kept for dashboard.html fetch
├── eod.js → toolbox/scripts/eod.js (symlink)
├── package.json
├── ecosystem.config.js
│
├── dashboards/               # All 9 HTML files
├── monitor/                  # Scanner services
├── data/                     # Runtime data
├── docs/                     # Documentation (+ 4 moved from root)
│   ├── QUICK_REFERENCE_CARD.md
│   ├── SYSTEM_STATUS.md
│   └── ...
│
└── toolbox/                  # Consolidated utilities
    ├── scripts/              # All JS scripts + eod.js
    ├── calculations/
    ├── indicators/
    ├── docs/                 # Reference materials
    ├── ai/
    ├── RnD/
    └── archive/              # Old versions
```

---

## Verification Checklist

After each phase:
```bash
# Services running
pm2 list

# Dashboards accessible
curl http://localhost:8080
curl http://localhost:8080/zone-scanner.html
curl http://localhost:8080/analytics.html

# Scanner working
curl http://localhost:8081/status

# EOD command works
node eod.js --help 2>/dev/null || echo "Check symlink"
```

---

## Files Summary

**Moved:**
- 9 HTML → dashboards/
- 8 scripts → toolbox/scripts/
- calculations/, indicators/ → toolbox/
- 4 markdown → docs/

**Symlinked:**
- eod.js (root → toolbox/scripts/)

**Deleted:**
- ChatExport folder
- Backup files
- Temp files
- Legacy folder
- 4 deprecated JSON files

**Updated:**
- monitor/web-server.js (serve from dashboards/)
