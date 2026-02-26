/**
 * API V1 — Clean external API for AI integrations
 *
 * Single entry point for external apps to pull Wingman context.
 * All existing endpoints remain untouched — this is purely additive.
 * Mounted in web-server.js under the /api/v1/ prefix.
 *
 * Full documentation: docs/API_V1.md
 *
 * Endpoints:
 *   GET /api/v1/health   — Service health + cache stats
 *   GET /api/v1/context  — Full Wingman context bundle:
 *       market_intel    — MARKET_INTEL.md (regime, rotation, watchlist, recaps, checkpoint)
 *       session_state   — DEPRECATED (null) — checkpoint now in MARKET_INTEL.md
 *       scan            — Bloodhound results by tier (HC/tradeable/watch)
 *       positions       — Open positions with P&L summary
 *       alerts          — Last 20 alerts (3 days)
 *       options_flow    — Top 10 unusual flow signals (score 50+)
 *       internals       — Latest market internals (TICK, TRIN, A/D, VIX, etc.)
 *
 * Response envelope: { ok, ts, data } on success; { ok, ts, error } on failure
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Response Envelope ───────────────────────────────────────────────

function sendOk(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString(), data }));
}

function sendError(res, code, message, status = 500) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, ts: new Date().toISOString(), error: { code, message } }));
}

// ─── Helpers ─────────────────────────────────────────────────────────

function readFileOrNull(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

// ─── Route Handler ───────────────────────────────────────────────────

function handleRequest(req, res, urlPath) {
    if (req.method === 'GET' && (urlPath === '/api/v1' || urlPath === '/api/v1/')) {
        return handleDiscovery(req, res);
    }

    if (req.method === 'GET' && urlPath === '/api/v1/health') {
        return handleHealth(req, res);
    }

    if (req.method === 'GET' && urlPath === '/api/v1/context') {
        return handleContext(req, res);
    }

    sendError(res, 'NOT_FOUND', `No v1 endpoint: ${req.method} ${urlPath}`, 404);
}

// ─── GET /api/v1/ — Discovery ───────────────────────────────────────

function handleDiscovery(req, res) {
    sendOk(res, {
        name: 'Wingman Trading System',
        version: 'v1',
        description: 'Autonomous opportunity detection for options trading. '
            + 'Finds confluence across technicals, gamma levels, options flow, and sector rotation. '
            + 'The system scans, scores, and alerts — the trader makes all final decisions.',
        endpoints: [
            {
                method: 'GET',
                path: '/api/v1/',
                description: 'This discovery endpoint — describes the API and available endpoints'
            },
            {
                method: 'GET',
                path: '/api/v1/health',
                description: 'Service health check with uptime and cache stats'
            },
            {
                method: 'GET',
                path: '/api/v1/context',
                description: 'Full context bundle — everything an AI needs in one call',
                returns: {
                    market_intel: 'Markdown — market regime, sector rotation, swing watchlist, session recaps, gamma maps, scenario matrix, session checkpoint',
                    session_state: 'DEPRECATED — always null. Checkpoint is now in the SESSION CHECKPOINT section of market_intel.',
                    scan: 'Latest Bloodhound scanner results grouped by tier (high_conviction, tradeable, watch) with scores, zones, signals',
                    positions: 'Open positions with entry/stop/target prices and P&L summary',
                    alerts: 'Last 20 scanner alerts from past 3 days',
                    options_flow: 'Top 10 unusual options activity signals (score 50+) from Opportunity Scanner',
                    internals: 'Latest market internals — TICK, TRIN, advance/decline, up/down volume, VIX, indices'
                }
            }
        ],
        scanners: {
            bloodhound: 'Core scanner — discovers symbols dynamically, scores confluence 0-100, classifies into tiers, sends alerts',
            opportunity: 'Detects unusual options activity — vol/OI ratios, premium flow, call/put imbalances',
            premarket: 'Pre-market gap detection (>=2%) from 6:00-9:30 AM ET',
            earnings: 'Earnings calendar tracking with IV analysis and flow confluence',
            internals: 'Market breadth — TICK, TRIN, advance/decline, volume ratio, VIX'
        },
        data_sources: {
            market_intel: 'data/MARKET_INTEL.md — updated each trading session',
            session_state: 'DEPRECATED — merged into MARKET_INTEL.md SESSION CHECKPOINT section',
            database: 'data/wingman.db — SQLite, all scanner results, signals, positions, internals'
        },
        docs: 'docs/API_V1.md'
    });
}

// ─── GET /api/v1/health ──────────────────────────────────────────────

function handleHealth(req, res) {
    const apiCache = require('./api-cache');
    const cacheStats = apiCache.stats();

    sendOk(res, {
        status: 'ok',
        uptime_s: Math.floor(process.uptime()),
        cache: cacheStats
    });
}

// ─── GET /api/v1/context ─────────────────────────────────────────────

function handleContext(req, res) {
    try {
        const signalDb = require('./signal-db');
        const opportunityDb = require('./opportunity-db');

        // 1. Read markdown context file (checkpoint is now inline in MARKET_INTEL.md)
        const marketIntel = readFileOrNull(path.join(DATA_DIR, 'MARKET_INTEL.md'));

        // 2. Latest bloodhound scan (summarized)
        const rawScan = signalDb.getLatestBloodhoundScan();
        let scan = null;
        if (rawScan) {
            const results = rawScan.results || [];
            scan = {
                timestamp: rawScan.timestamp || rawScan.marketContext?.timestamp,
                ticker_count: results.length,
                market_context: rawScan.marketContext || {},
                tiers: {
                    high_conviction: results.filter(r => r.sourceInfo?.tier === 'HIGH_CONVICTION').map(summarizeTicker),
                    tradeable: results.filter(r => r.sourceInfo?.tier === 'TRADEABLE').map(summarizeTicker),
                    watch: results.filter(r => r.sourceInfo?.tier === 'WATCH').map(summarizeTicker)
                }
            };
        }

        // 3. Open positions
        const positionsData = signalDb.getOpenPositions();

        // 4. Recent alerts (last 20)
        const alertsData = signalDb.getAlertsForDashboard({ limit: 20, days: 3 });

        // 5. Latest opportunity flow (top items)
        const oppScan = opportunityDb.getLatestOpportunityScan();
        let topFlow = [];
        if (oppScan?.results) {
            topFlow = oppScan.results
                .filter(r => r.score >= 50)
                .slice(0, 10)
                .map(r => ({
                    symbol: r.symbol,
                    score: r.score,
                    tier: r.tier,
                    direction: r.direction,
                    signals: r.signals || []
                }));
        }

        // 6. Latest internals snapshot
        const internals = signalDb.getLatestInternals();

        sendOk(res, {
            market_intel: marketIntel,
            session_state: null,  // DEPRECATED — checkpoint now in MARKET_INTEL.md SESSION CHECKPOINT section
            scan,
            positions: positionsData,
            alerts: alertsData?.alerts || [],
            options_flow: topFlow,
            internals: internals || null
        });
    } catch (e) {
        console.error('[API v1] Error building context:', e.message);
        sendError(res, 'INTERNAL_ERROR', e.message);
    }
}

// ─── Ticker Summary (keep response compact) ─────────────────────────

function summarizeTicker(r) {
    return {
        symbol: r.symbol,
        price: r.price,
        zone: r.zone,
        score: r.sourceInfo?.score || 0,
        action: r.action,
        rsi: r.technicals?.rsi || null,
        trend: r.technicals?.trend || null,
        signals: r.sourceInfo?.signals || []
    };
}

module.exports = { handleRequest };
