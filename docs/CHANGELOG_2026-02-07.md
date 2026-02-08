# Changelog: 2026-02-07

## Bug Fix: Session Gaps Dropdown Missing Most Recent Trading Day

### Problem
The "Session Gaps" date picker dropdown on the Gap Scanner dashboard (`premarket.html`) was missing Friday's data when viewed on a weekend.

**Root cause:** `loadSessionDates()` always called `data.sessions.slice(1)`, assuming `sessions[0]` was "today" and already covered by the default "Today" option. On weekends/holidays, "today" has no session in the database, so `sessions[0]` is actually the most recent trading day (e.g., Friday). That day got silently dropped from the dropdown.

- "Today" option loaded Saturday's empty data
- Dropdown started at Thursday, skipping Friday entirely

### Fix
**File:** `premarket.html` (line 376)

Before:
```javascript
for (const session of data.sessions.slice(1)) {
```

After:
```javascript
const today = new Date().toISOString().slice(0, 10);
const sessions = (data.sessions[0]?.date === today) ? data.sessions.slice(1) : data.sessions;
for (const session of sessions) {
```

Only skips the first session if its date actually matches today. On weekends and holidays, all sessions (including the most recent trading day) appear in the dropdown.
