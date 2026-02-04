# Wingman UI Unification

**Date:** 2026-02-03
**Status:** Complete

## Overview

Unified the navigation and layout across all 8 Wingman dashboard pages to create a consistent, professional look.

## What Was Done

### 1. Shared Navigation CSS (css/nav.css)

Created a single shared stylesheet for all navigation styles:
- Consistent nav button styling (size, colors, hover states)
- Active state: cyan (#00d4aa) border and background
- Dropdown menu for INSIGHTS (Analytics, Strategies)
- Responsive breakpoints for smaller screens
- Header layout using absolute positioning for centered nav

### 2. Container Width Standardization

All pages now use the same container width: max-width 1600px

**Before:** Pages had varying widths (1400px, 1600px, 1800px)
**After:** All pages use 1600px

### 3. Header Structure

All pages now use consistent header HTML structure:
- header-left: Page title
- header-center: Navigation links (absolutely positioned for centering)
- header-right: Status indicators and controls

### 4. Scanner Control Updates (Options & Earnings)

For opportunity-scanner.html and earnings-scanner.html:
- **Status dot** is now clickable - shows popup with stale/live details
- **PAUSE and SCAN NOW** buttons moved into dropdown menu (gear icon)
- **REFRESH button** removed (auto-refresh handles updates)
- **"Last update" text** hidden - only shows in popup when clicking status dot

**Status dot colors:**
- Green (pulsing): Live/Active
- Yellow: Paused
- Red: Stale/Error

### 5. Page Title Cleanup

| Page | Old Title | New Title |
|------|-----------|-----------|
| opportunity-scanner.html | OPTIONS FLOW SCANNER | OPTIONS SCANNER |
| earnings-scanner.html | Earnings Season Scanner | EARNINGS SCANNER |
| premarket.html | Pre-Market Scanner | GAP SCANNER |
| scanner.html | WINGMAN MARKET SCANNER | MARKET SCANNER |
| analytics.html | Signal Analytics | ANALYTICS |

### 6. Session Gaps Table Consolidation (premarket.html)

Combined two redundant sections into one unified table:

**Before:**
- "Pre-Market Movers" section (from JSON, latest scan only)
- "Session Watchlist" section (from database, all day's discoveries)

**After:**
- Single "Session Gaps" table with all columns:
  - Symbol, Gap%, Prev Close, Pre-Mkt Price, Type, Score, Tier, Volume, Catalyst, First Seen

**Technical Changes:**
- Updated `getSessionWatchlist()` in signal-db.js to return all needed columns
- Uses subquery to join aggregated stats with latest row per symbol
- UI reads directly from database instead of JSON lookup
- Removed dead code (`updateMoversTable`, `moverLookup`)

**Catalyst Detection:**
- Currently detects earnings only (earnings_bmo, earnings_amc)
- Symbols without catalyst = gapping for unknown reason (sympathy, macro, etc.)

## Files Changed

### Modified HTML Files
- morning.html
- zone-scanner.html
- premarket.html
- earnings-scanner.html
- opportunity-scanner.html
- scanner.html
- analytics.html
- strategies.html

### Modified JS Files
- monitor/signal-db.js - Updated getSessionWatchlist() query

### New Files
- css/nav.css - Shared navigation styles

## How to Modify Navigation

### Adding a new nav item:
1. Edit css/nav.css if new styles needed
2. Add the link to all 8 HTML files in the .nav-links section

### Changing active states:
The active page is marked with class="nav-link active". Each page should have only one active link.

### Changing colors:
Edit css/nav.css:
- Active color: #00d4aa (cyan)
- Hover color: #00d4aa
- Default text: #8b92a8 (gray)
- Border: #2a3641

## CSS Load Order

The nav.css file is loaded AFTER inline styles in each HTML file to ensure it takes precedence. The link tag appears right before the closing head tag.

## Rollback Instructions

If needed, revert these commits:
```bash
# View recent commits
git log --oneline -10

# Revert specific commit (creates new commit)
git revert <commit-hash>

# Or reset to before changes (destructive)
git reset --hard <commit-hash-before-changes>
```

Key commits:
- `28f617b` - Fix Session Gaps table to use database data directly
- `207c402` - UI unification changes (check git log for exact hash)

## Future Improvements

- [ ] Consider moving more shared styles to external CSS
- [ ] Add mobile hamburger menu for very small screens
- [ ] Add news detection for catalyst field
- [ ] Add "sympathy" detection (related ticker has earnings)
