#!/usr/bin/env node
/**
 * MARKET INTERNALS SCANNER
 *
 * Collects market internals (TICK, TRIN, breadth, volume, VIX, indices)
 * every 5 minutes during RTH (9:30 AM - 4:00 PM ET).
 * Stores in SQLite for dashboard display and historical analysis.
 *
 * Data collection only — no Telegram alerts.
 */

const http = require('http');
const axios = require('axios');
const signalDb = require('./signal-db');
const appConfig = require('./config-loader');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    OPTIONS_API: appConfig.apis.options,
    CONTROL_PORT: 8085,
    SCAN_INTERVAL_MS: 2 * 60 * 1000,  // 2 minutes
    RTH_START_HOUR: 9,
    RTH_START_MINUTE: 30,
    RTH_END_HOUR: 16,
    RTH_END_MINUTE: 0,
    API_DELAY_MS: 50  // Delay between API calls (rate limiting)
};

// Symbols to fetch
const SYMBOLS = ['$TICK', '$TRIN', '$ADVN', '$DECN', '$UVOL', '$DVOL', '$VIX', '$SPX', '$COMPX', '$DJI'];

// Scanner state
let isRunning = false;
let isPaused = false;
let scanCount = 0;
let lastScanTime = null;
let nextScanTime = null;
let lastSnapshot = null;

// ============================================
// UTILITY FUNCTIONS
// ============================================

function log(msg) {
    console.log(`[Internals] ${msg}`);
}

function logError(msg) {
    console.error(`[Internals ERROR] ${msg}`);
}

/**
 * Check if date is in DST
 */
function isDST(date) {
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset()) !== date.getTimezoneOffset();
}

/**
 * Get current ET hour and minute
 */
function getETTime() {
    const now = new Date();
    const etOffset = isDST(now) ? -4 : -5;
    const etHour = (now.getUTCHours() + etOffset + 24) % 24;
    const etMinute = now.getUTCMinutes();
    return { hour: etHour, minute: etMinute };
}

/**
 * Get current ET time string
 */
function getETTimeString() {
    const now = new Date();
    const etOffset = isDST(now) ? -4 : -5;
    const etTime = new Date(now.getTime() + etOffset * 60 * 60 * 1000);
    return etTime.toISOString().replace('T', ' ').substring(0, 19) + ' ET';
}

/**
 * Get current ET date string (YYYY-MM-DD)
 */
function getETDateString() {
    const now = new Date();
    const etOffset = isDST(now) ? -4 : -5;
    const etTime = new Date(now.getTime() + etOffset * 60 * 60 * 1000);
    return etTime.toISOString().substring(0, 10);
}

/**
 * Check if we're in Regular Trading Hours (9:30 AM - 4:00 PM ET)
 */
function isRTH() {
    const { hour, minute } = getETTime();
    const totalMin = hour * 60 + minute;
    const startMin = CONFIG.RTH_START_HOUR * 60 + CONFIG.RTH_START_MINUTE;  // 570
    const endMin = CONFIG.RTH_END_HOUR * 60 + CONFIG.RTH_END_MINUTE;        // 960
    return totalMin >= startMin && totalMin < endMin;
}

/**
 * Sleep for ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// DATA FETCHING
// ============================================

/**
 * Fetch a single quote from the Options API
 */
async function fetchQuote(symbol) {
    try {
        const resp = await axios.get(`${CONFIG.OPTIONS_API}/api/quotes/${encodeURIComponent(symbol)}`, {
            timeout: 10000
        });
        return resp.data;
    } catch (e) {
        logError(`Failed to fetch ${symbol}: ${e.message}`);
        return null;
    }
}

/**
 * Run a full internals scan — fetch all 9 symbols and store
 */
async function runScan() {
    if (isPaused) {
        log('Scanner paused, skipping scan');
        return;
    }

    if (!isRTH()) {
        log(`Outside RTH (${getETTimeString()}), skipping scan`);
        return;
    }

    const scanStart = Date.now();
    log(`--- Scan #${scanCount + 1} starting (${getETTimeString()}) ---`);

    const quotes = {};
    for (const symbol of SYMBOLS) {
        const data = await fetchQuote(symbol);
        if (data) {
            quotes[symbol] = data;
        }
        await sleep(CONFIG.API_DELAY_MS);
    }

    // Extract values from quotes
    const get = (sym, field) => {
        const q = quotes[sym];
        if (!q) return null;
        // Handle different response shapes
        if (q[field] !== undefined) return q[field];
        if (q.quote && q.quote[field] !== undefined) return q.quote[field];
        return null;
    };

    const uvol = get('$UVOL', 'lastPrice');
    const dvol = get('$DVOL', 'lastPrice');
    const volRatio = (uvol && dvol && dvol > 0) ? Math.round((uvol / dvol) * 100) / 100 : null;

    const advn = get('$ADVN', 'lastPrice');
    const decn = get('$DECN', 'lastPrice');
    const adSpread = (advn != null && decn != null) ? Math.round(advn - decn) : null;

    const snapshot = {
        timestamp: new Date().toISOString(),
        date: getETDateString(),
        tick: get('$TICK', 'lastPrice'),
        tick_high: get('$TICK', 'highPrice'),
        tick_low: get('$TICK', 'lowPrice'),
        trin: get('$TRIN', 'lastPrice'),
        advn: advn,
        decn: decn,
        ad_spread: adSpread,
        uvol: uvol,
        dvol: dvol,
        vol_ratio: volRatio,
        vix: get('$VIX', 'lastPrice'),
        vix_open: get('$VIX', 'openPrice'),
        vix_high: get('$VIX', 'highPrice'),
        vix_low: get('$VIX', 'lowPrice'),
        vix_change: get('$VIX', 'netChange'),
        vix_change_pct: get('$VIX', 'netPercentChange'),
        spx: get('$SPX', 'lastPrice'),
        spx_change: get('$SPX', 'netChange'),
        spx_change_pct: get('$SPX', 'netPercentChange'),
        spx_high: get('$SPX', 'highPrice'),
        spx_low: get('$SPX', 'lowPrice'),
        compx: get('$COMPX', 'lastPrice'),
        compx_change: get('$COMPX', 'netChange'),
        compx_change_pct: get('$COMPX', 'netPercentChange'),
        dji: get('$DJI', 'lastPrice'),
        dji_change: get('$DJI', 'netChange'),
        dji_change_pct: get('$DJI', 'netPercentChange')
    };

    // Store in database
    try {
        const id = signalDb.insertMarketInternals(snapshot);
        lastSnapshot = snapshot;
        scanCount++;
        lastScanTime = new Date();

        const parts = [];
        if (snapshot.tick != null) parts.push(`TICK:${snapshot.tick}`);
        if (snapshot.trin != null) parts.push(`TRIN:${snapshot.trin}`);
        if (adSpread != null) parts.push(`A/D:${adSpread > 0 ? '+' : ''}${adSpread}`);
        if (snapshot.vix != null) parts.push(`VIX:${snapshot.vix}`);
        if (volRatio != null) parts.push(`Vol:${volRatio}:1`);
        if (snapshot.spx != null) parts.push(`SPX:${snapshot.spx}`);

        const scanElapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
        log(`Stored snapshot #${id} (${scanElapsed}s): ${parts.join(' | ')}`);
    } catch (e) {
        logError(`Failed to store snapshot: ${e.message}`);
    }
}

// ============================================
// CONTROL API SERVER
// ============================================

function startControlServer() {
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        const url = req.url.split('?')[0];

        if (req.method === 'GET' && url === '/status') {
            res.writeHead(200);
            res.end(JSON.stringify({
                scanner: 'market-internals',
                running: isRunning,
                paused: isPaused,
                in_rth: isRTH(),
                scan_count: scanCount,
                last_scan: lastScanTime?.toISOString(),
                next_scan: nextScanTime?.toISOString(),
                current_time_et: getETTimeString(),
                rth_window: '9:30 AM - 4:00 PM ET',
                symbols: SYMBOLS
            }));
        } else if (req.method === 'POST' && url === '/pause') {
            isPaused = true;
            log('Scanner PAUSED');
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, paused: true }));
        } else if (req.method === 'POST' && url === '/resume') {
            isPaused = false;
            log('Scanner RESUMED');
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, paused: false }));
        } else if (req.method === 'POST' && url === '/scan') {
            log('Manual scan triggered');
            runScan();
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Scan triggered' }));
        } else if (req.method === 'GET' && url === '/latest') {
            const data = lastSnapshot || signalDb.getLatestInternals();
            res.writeHead(200);
            res.end(JSON.stringify(data || { error: 'No data yet' }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(CONFIG.CONTROL_PORT, '0.0.0.0', () => {
        log(`Control API running on http://0.0.0.0:${CONFIG.CONTROL_PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logError(`Port ${CONFIG.CONTROL_PORT} already in use`);
        } else {
            logError(`Server error: ${err.message}`);
        }
    });
}

// ============================================
// MAIN
// ============================================

async function main() {
    log('========================================');
    log('  MARKET INTERNALS SCANNER - Starting');
    log('========================================');
    log(`Current time: ${getETTimeString()}`);
    log(`RTH window: 9:30 AM - 4:00 PM ET`);
    log(`Scan interval: ${CONFIG.SCAN_INTERVAL_MS / 60000} minutes`);
    log(`Symbols: ${SYMBOLS.join(', ')}`);
    log('');

    // Start control server
    startControlServer();

    // Initial scan
    isRunning = true;
    await runScan();

    // Schedule scans
    setInterval(async () => {
        nextScanTime = new Date(Date.now() + CONFIG.SCAN_INTERVAL_MS);
        await runScan();
    }, CONFIG.SCAN_INTERVAL_MS);
}

main().catch(e => {
    logError(`Fatal error: ${e.message}`);
    console.error(e);
    process.exit(1);
});
