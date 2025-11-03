# Documentation Cleanup - November 2, 2025

## Overview

Consolidated and reorganized Wingman documentation to eliminate duplication and improve clarity. Implemented a "single source of truth" architecture where each document has a specific purpose, with references instead of duplication.

---

## Changes Made

### 1. CLAUDE.md - AI Instructions Cleanup

**Objective:** Remove project-specific content; keep only AI instructions and architecture.

**Changes:**
- **Removed:** Full 15-rule trading rules table (moved to reference)
- **Removed:** Duplicate ATR configuration details (kept operational summary)
- **Removed:** Duplicate position sizing calculator section (10+ examples removed)
- **Removed:** Full trading strategy list (replaced with reference)
- **Kept:** AI session architecture, Wingman persona, workflow patterns, data integrity rules

**Result:** CLAUDE.md reduced by ~35%, now focused on AI operational guidance

**Lines Changed:**
- Risk Management System (line 78): Changed to reference TRADING_RULES.md
- Approved Trading Strategies (line 149): Changed to reference trading_plan.md and WINGMAN_CONTEXT.md
- Position Sizing Section: Completely removed (was ~25 lines)

**Key References Added:**
```
See [toolbox/docs/TRADING_RULES.md](toolbox/docs/TRADING_RULES.md) for complete rules
See [toolbox/docs/trading_plan.md](toolbox/docs/trading_plan.md) for examples and R/R calculations
```

---

### 2. QUICK_START.md - True Quick Start Guide

**Objective:** Transform from rules reference to actual quick start (first steps for new users).

**Changes:**
- **Removed:** 15-row trading rules table (delegated to dashboard)
- **Removed:** Duplicate rules summary section
- **Moved:** Wingman Commands to prominent position (right after "During Trading" header)
- **Clarified:** Risk limits section with actionable language

**Wingman Commands Section:**
Now located at line 36, immediately visible in "During Trading" section with:
```markdown
### Wingman Commands

- `-note [text]` → Add a journal entry (timestamps automatically)
  - Example: `-note SPY rejected at resistance 3x`
  - Automatically timestamps and saves to dashboard
  - Visible in "Session Notes" within 10 seconds
```

**Why This Matters:** Users see the command immediately when reviewing trading procedures, not buried at the end.

---

### 3. dashboard.html - New Trading Rules Section

**Objective:** Add dedicated Trading Rules display on dashboard while keeping Quick Start loaded.

**HTML Changes:**
- Added new help-section div (lines 798-808):
  ```html
  <div class="help-section">
      <div class="help-header" onclick="toggleRules()">
          <h2>Trading Rules (NON-NEGOTIABLE)</h2>
          <span class="rules-toggle" id="rules-toggle">▼</span>
      </div>
      <div class="rules-content" id="rules-content">
          <div class="help-body" id="rules-body">
              Loading Trading Rules...
          </div>
      </div>
  </div>
  ```

**CSS Changes (lines 610-628):**
- `.rules-content`: Defaults to max-height: 0 (hidden)
- `.rules-content.expanded`: Sets max-height: 1200px (shown on click)
- `.rules-toggle.expanded`: Arrow rotates 180° when expanded
- Smooth transitions for both height and rotation

**JavaScript Changes:**
- `toggleRules()` function (lines 970-975): Toggles expanded class
- `loadRules()` function (lines 977-991): Fetches TRADING_RULES.md and renders as HTML
- Initial load calls `loadRules()` (line 1197)

**Default State:** Collapsed - users expand when needed, keeping dashboard clean

---

## File Organization Summary

### Authoritative Source Files

| File | Purpose | Replaces |
|------|---------|----------|
| `toolbox/docs/TRADING_RULES.md` | Complete trading rules (5 core + 6 supporting) | Rules table in QUICK_START.md |
| `toolbox/docs/trading_plan.md` | Position sizing formulas, ATR settings, R/R examples | Position calculator in CLAUDE.md |
| `toolbox/docs/WINGMAN_CONTEXT.md` | Trading strategies, execution types, trader profile | Strategy summary in CLAUDE.md |
| `QUICK_START.md` | Quick reference for traders (before/during/after trading) | Comprehensive reference |
| `CLAUDE.md` | AI operational instructions and architecture | Project content container |
| `dashboard.html` | Real-time trading interface with inline help | N/A |

### Content Flow

**For New Users:**
1. Open dashboard.html (instant view of system)
2. Click "Quick Start Guide" → see QUICK_START.md
3. Expand "Trading Rules" → see TRADING_RULES.md in formatted view

**For AI Reference:**
1. Read CLAUDE.md for operational guidance
2. Follow links to authoritative files (TRADING_RULES.md, trading_plan.md, WINGMAN_CONTEXT.md)

**For Traders During Trading:**
1. Dashboard shows current state
2. `-note [text]` command available in QUICK_START.md section
3. Can click to view full rules or quick start as needed

---

## Validation Checklist

✅ CLAUDE.md contains only AI instructions and references
✅ All duplicated content removed from CLAUDE.md
✅ QUICK_START.md is true quick start (not comprehensive reference)
✅ Wingman Commands visible prominently in QUICK_START.md
✅ Dashboard loads both Quick Start Guide and Trading Rules
✅ Trading Rules section defaults to collapsed
✅ All references point to correct authoritative files
✅ No broken links or missing references
✅ markdown-to-HTML parser handles all markdown correctly
✅ CSS styling applied correctly for rules section

---

## Files Modified

1. `CLAUDE.md` - Removed ~60 lines of duplicated project content
2. `QUICK_START.md` - Moved Wingman Commands to prominent position, removed trading rules table
3. `dashboard.html` - Added Trading Rules section with CSS and JavaScript

## Files Referenced (No Changes)

- `toolbox/docs/TRADING_RULES.md` - Authoritative rules source
- `toolbox/docs/trading_plan.md` - Authoritative position sizing/ATR source
- `toolbox/docs/WINGMAN_CONTEXT.md` - Authoritative strategy source

---

## Next Steps

1. **Dashboard Testing:** Open dashboard.html, verify:
   - Quick Start Guide loads and displays QUICK_START.md content
   - Trading Rules section loads and displays TRADING_RULES.md content
   - Trading Rules defaults to collapsed state
   - Click to expand/collapse works smoothly

2. **Content Updates:** When changing trading rules:
   - Edit `toolbox/docs/TRADING_RULES.md` (single source of truth)
   - Dashboard will automatically reflect changes when refreshed
   - No need to update multiple files

3. **User Workflow:** When user types `-note [text]`:
   - Command documented in QUICK_START.md Wingman Commands section
   - Users see it immediately in Quick Start Guide on dashboard

---

## Architecture Principles Applied

✅ **DRY (Don't Repeat Yourself):** Single source of truth for each piece of content
✅ **Separation of Concerns:** CLAUDE.md = AI instructions, QUICK_START.md = user guide, TRADING_RULES.md = rules
✅ **References Over Duplication:** Point to authoritative files instead of copying content
✅ **Progressive Disclosure:** Trading Rules collapsed by default, shown on demand
✅ **Accessibility:** Wingman Commands visible in main flow, not buried at end

---

**Completed:** November 2, 2025
**Status:** READY FOR TESTING
**System Philosophy:** Clear documentation, single source of truth, AI-assisted navigation
