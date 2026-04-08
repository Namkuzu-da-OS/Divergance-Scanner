
## 2026-04-08 — Cache-first API architecture

### Problem
All API routes (, , , ) were fetching fresh data from Schwab API on every request — duplicating the exact same work the background polling service already does on a 300-second cycle. Response times were 6-15+ seconds. The web-server proxy had a 15-second timeout, causing frequent failures on the  endpoint.

### Fix
Added a cache layer to  with , , and  keys + timestamps. The polling service now stores computed results in the cache during its existing compute phases. All API routes were rewritten to serve from cache first, with cold-start fallback to live Schwab fetch (only on first boot before the first cycle completes).

### Files Changed
-  — Added  dict,  method, cache stores in , , 
-  — Full rewrite. All 4 endpoints cache-first.
-  —  cache-first when no specific pairs.
-  —  cache-first.

### Results
| Endpoint | Before | After |
|---|---|---|
| /regime | 4-15+ sec (often timed out) | 0.17s |
| /rankings | 6+ sec | 0.35s |
| /divergences | 11+ sec | 0.20s |

### Impact
- No more proxy timeouts on  session loads
- Frontend dashboard unaffected (same JSON response shape, same WebSocket broadcasts)
- Cold start handled gracefully (falls back to live fetch once, then cache serves all subsequent requests)


## 2026-04-08 - Cache-first API architecture

### Problem
All API routes (/rotation/regime, /rotation/rankings, /divergence/scan, /relative-strength/rankings) were fetching fresh data from Schwab API on every request - duplicating the exact same work the background polling service already does on a 300-second cycle. Response times were 6-15+ seconds. The web-server proxy had a 15-second timeout, causing frequent failures on the /regime endpoint.

### Fix
Added a cache layer to PollingService with rankings, regime, and divergences keys + timestamps. The polling service now stores computed results in the cache during its existing compute phases. All API routes were rewritten to serve from cache first, with cold-start fallback to live Schwab fetch (only on first boot before the first cycle completes).

### Files Changed
- backend/services/polling_service.py - Added cache dict, get_cached() method, cache stores
- backend/api/routes/rotation.py - Full rewrite. All 4 endpoints cache-first.
- backend/api/routes/divergence.py - /scan cache-first when no specific pairs.
- backend/api/routes/relative_strength.py - /rankings cache-first.

### Results
- /regime: 4-15+ sec (often timed out) -> 0.17s
- /rankings: 6+ sec -> 0.35s
- /divergences: 11+ sec -> 0.20s

### Impact
- No more proxy timeouts on /kungfu session loads
- Frontend dashboard unaffected (same JSON response shape, same WebSocket broadcasts)
- Cold start handled gracefully
