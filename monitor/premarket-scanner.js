#!/usr/bin/env node
/**
 * PRE-MARKET SCANNER
 *
 * Runs 6:00 AM - 9:30 AM ET to identify pre-market opportunities.
 * Focuses on: gaps, futures direction, earnings, and pre-market volume.
 *
 * Data stored in SQLite (opportunity_history.db)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const signalDb = require('./signal-db');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    INTEL_API: 'http://192.168.10.239:3000',
    OPTIONS_API: 'http://192.168.10.239:8000',
    CONTROL_PORT: 8084,
    SCAN_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes
    PREMARKET_START_HOUR: 6,          // 6 AM ET
    PREMARKET_END_HOUR: 9,            // 9:30 AM ET
    PREMARKET_END_MINUTE: 30,
    MIN_GAP_PCT: 2.0,                 // Minimum gap to track
    OUTPUT_FILE: path.join(__dirname, '..', 'data', 'premarket.json')
};

// Scanner state
let isRunning = false;
let isPaused = false;
let scanCount = 0;
let lastScanTime = null;
let nextScanTime = null;

// Core symbols always checked
const CORE_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA'];

// Settings
const SETTINGS = {
    minPrice: 10,      // Skip penny stocks
    maxSymbols: 50     // Max symbols to check per scan
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function log(msg) {
    console.log(`[Pre-Market] ${msg}`);
}

function logError(msg) {
    console.error(`[Pre-Market ERROR] ${msg}`);
}

/**
 * Check if we're in pre-market hours (6 AM - 9:30 AM ET)
 */
function isPremarketHours() {
    const now = new Date();
    // Convert to ET (UTC-5 or UTC-4 DST)
    const etOffset = isDST(now) ? -4 : -5;
    const etHour = (now.getUTCHours() + etOffset + 24) % 24;
    const etMinute = now.getUTCMinutes();

    // Pre-market: 6:00 AM - 9:30 AM ET
    if (etHour < CONFIG.PREMARKET_START_HOUR) return false;
    if (etHour > CONFIG.PREMARKET_END_HOUR) return false;
    if (etHour === CONFIG.PREMARKET_END_HOUR && etMinute >= CONFIG.PREMARKET_END_MINUTE) return false;

    return true;
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
 * Get current ET time string
 */
function getETTimeString() {
    const now = new Date();
    const etOffset = isDST(now) ? -4 : -5;
    const etTime = new Date(now.getTime() + etOffset * 60 * 60 * 1000);
    return etTime.toISOString().replace('T', ' ').substring(0, 19) + ' ET';
}

/**
 * Helper for HTTP GET requests
 */
async function httpGet(url) {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
}

/**
 * Load watchlist from file
 */
function loadWatchlist() {
    try {
        const watchlistPath = path.join(__dirname, '..', 'data', 'watchlist.json');
        const content = fs.readFileSync(watchlistPath, 'utf8');
        const data = JSON.parse(content);
        return data.symbols || [];
    } catch (e) {
        return [];
    }
}

/**
 * Helper to add/update symbol in discovery map
 */
function addSymbol(map, symbol, score, source) {
    if (!symbol || typeof symbol !== 'string') return;
    const existing = map.get(symbol) || { score: 0, sources: [] };
    existing.score += score;
    existing.sources.push(source);
    map.set(symbol, existing);
}

// ============================================
// DYNAMIC SYMBOL DISCOVERY
// ============================================

/**
 * Discover symbols dynamically from multiple market data sources
 * This finds gaps across the entire market, not just a fixed watchlist
 */
async function discoverSymbols() {
    const discovered = new Map();
    const sourceCounts = { core: 0, watchlist: 0, volume: 0, gainers: 0, losers: 0, nasdaq: 0 };

    // SOURCE 1: Core symbols (always scan for market context)
    CORE_SYMBOLS.forEach(s => {
        addSymbol(discovered, s, 100, 'core');
        sourceCounts.core++;
    });

    // SOURCE 2: Watchlist (user priorities)
    const watchlist = loadWatchlist();
    watchlist.forEach(s => {
        addSymbol(discovered, s, 50, 'watchlist');
        sourceCounts.watchlist++;
    });

    try {
        // SOURCE 3: Market Movers from S&P 500
        // These endpoints return today's biggest movers - perfect for finding gaps
        const [volumeMovers, gainers, losers] = await Promise.all([
            httpGet(`${CONFIG.OPTIONS_API}/api/movers/$SPX?sort=VOLUME`).catch(() => ({ screeners: [] })),
            httpGet(`${CONFIG.OPTIONS_API}/api/movers/$SPX?sort=PERCENT_CHANGE_UP`).catch(() => ({ screeners: [] })),
            httpGet(`${CONFIG.OPTIONS_API}/api/movers/$SPX?sort=PERCENT_CHANGE_DOWN`).catch(() => ({ screeners: [] }))
        ]);

        // Volume leaders (high activity = something happening)
        (volumeMovers.screeners || []).slice(0, 15).forEach(m => {
            if (m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 40, 'volume_leader');
                sourceCounts.volume++;
            }
        });

        // Big gainers (gapping UP - these are what we're looking for!)
        (gainers.screeners || []).slice(0, 15).forEach(m => {
            const changePct = Math.abs(m.netPercentChange || 0) * 100; // Convert to percentage
            if (changePct >= CONFIG.MIN_GAP_PCT && m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 60, 'gainer'); // High priority - this IS a gap
                sourceCounts.gainers++;
            }
        });

        // Big losers (gapping DOWN)
        (losers.screeners || []).slice(0, 15).forEach(m => {
            const changePct = Math.abs(m.netPercentChange || 0) * 100;
            if (changePct >= CONFIG.MIN_GAP_PCT && m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 60, 'loser'); // High priority - this IS a gap
                sourceCounts.losers++;
            }
        });

        // SOURCE 4: NASDAQ movers (catches tech/growth stocks)
        const nasdaqMovers = await httpGet(`${CONFIG.OPTIONS_API}/api/movers/$COMPX?sort=VOLUME`).catch(() => ({ screeners: [] }));
        (nasdaqMovers.screeners || []).slice(0, 15).forEach(m => {
            if (m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 35, 'nasdaq_mover');
                sourceCounts.nasdaq++;
            }
        });

    } catch (e) {
        logError(`Error in discovery: ${e.message}`);
    }

    // Sort by discovery score and limit
    const sorted = Array.from(discovered.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, SETTINGS.maxSymbols);

    // Log discovery stats
    const uniqueSources = Object.entries(sourceCounts)
        .filter(([_, count]) => count > 0)
        .map(([source, count]) => `${source}:${count}`)
        .join(', ');

    log(`Discovery: ${sorted.length} symbols from [${uniqueSources}]`);

    return sorted.map(([symbol, data]) => ({
        symbol,
        discoveryScore: data.score,
        sources: data.sources
    }));
}

// ============================================
// DATA FETCHING
// ============================================

/**
 * Fetch market data using DYNAMIC DISCOVERY
 * Pulls from movers APIs to find gaps across entire market
 */
async function fetchMarketData() {
    try {
        // Step 1: DYNAMIC DISCOVERY - find symbols that are moving
        const discoveredSymbols = await discoverSymbols();
        const symbols = discoveredSymbols.map(d => d.symbol);

        log(`Fetching quotes for ${symbols.length} discovered symbols...`);

        // Step 2: Fetch quotes from Options API (has closePrice for gap calculation)
        const marketData = {};

        // Fetch in batches to avoid overwhelming the API
        for (const symbol of symbols) {
            try {
                const quoteResponse = await axios.get(
                    `${CONFIG.OPTIONS_API}/api/quotes/${symbol}`,
                    { timeout: 3000 }
                );
                const quote = quoteResponse.data?.quote;
                if (quote) {
                    // Find discovery info for this symbol
                    const discoveryInfo = discoveredSymbols.find(d => d.symbol === symbol);

                    marketData[symbol] = {
                        price: quote.lastPrice || quote.mark,
                        previousClose: quote.closePrice,
                        close: quote.closePrice,
                        volume: quote.totalVolume || 0,
                        change: quote.netChange,
                        changePct: quote.netPercentChange,
                        // Include discovery metadata
                        discoveryScore: discoveryInfo?.discoveryScore || 0,
                        discoverySources: discoveryInfo?.sources || []
                    };
                }
            } catch (e) {
                // Skip symbols that fail
            }
        }

        // Add VIX separately
        try {
            const vixResponse = await axios.get(
                `${CONFIG.OPTIONS_API}/api/quotes/VIX`,
                { timeout: 3000 }
            );
            const vixQuote = vixResponse.data?.quote;
            if (vixQuote) {
                marketData['VIX'] = {
                    price: vixQuote.lastPrice || vixQuote.mark,
                    previousClose: vixQuote.closePrice
                };
            }
        } catch (e) {
            // VIX may not be available
        }

        return marketData;
    } catch (e) {
        logError(`Failed to fetch market data: ${e.message}`);
        return null;
    }
}

/**
 * Fetch quote data for a symbol
 */
async function fetchQuote(symbol) {
    try {
        const response = await axios.get(`${CONFIG.OPTIONS_API}/api/quotes/${symbol}`, { timeout: 5000 });
        return response.data;
    } catch (e) {
        return null;
    }
}

/**
 * Fetch technicals for a symbol
 */
async function fetchTechnicals(symbol) {
    try {
        const response = await axios.get(`${CONFIG.OPTIONS_API}/api/technicals/${symbol}`, { timeout: 5000 });
        return response.data;
    } catch (e) {
        return null;
    }
}

/**
 * Fetch earnings calendar
 */
async function fetchEarningsCalendar() {
    try {
        const response = await axios.get(`${CONFIG.OPTIONS_API}/api/calendar/earnings`, { timeout: 10000 });
        return response.data;
    } catch (e) {
        return [];
    }
}

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

/**
 * Calculate gap percentage
 */
function calculateGap(prevClose, currentPrice) {
    if (!prevClose || !currentPrice) return 0;
    return ((currentPrice - prevClose) / prevClose) * 100;
}

/**
 * Classify gap type
 */
function classifyGap(gapPct) {
    const absGap = Math.abs(gapPct);
    if (absGap >= 5) return 'HUGE';
    if (absGap >= 3) return 'LARGE';
    if (absGap >= 2) return 'MODERATE';
    if (absGap >= 1) return 'SMALL';
    return 'FLAT';
}

/**
 * Score a pre-market mover
 */
function scoreMover(mover) {
    let score = 0;

    // Gap size (0-40 points)
    const absGap = Math.abs(mover.gap_pct);
    if (absGap >= 5) score += 40;
    else if (absGap >= 3) score += 30;
    else if (absGap >= 2) score += 20;
    else if (absGap >= 1) score += 10;

    // Pre-market volume (0-20 points)
    if (mover.premarket_volume > 1000000) score += 20;
    else if (mover.premarket_volume > 500000) score += 15;
    else if (mover.premarket_volume > 100000) score += 10;

    // Catalyst (0-20 points)
    if (mover.catalyst) {
        if (mover.catalyst.includes('earnings')) score += 20;
        else if (mover.catalyst.includes('news')) score += 15;
        else score += 10;
    }

    // Direction alignment with futures (0-20 points)
    if (mover.futures_aligned) score += 20;

    return score;
}

/**
 * Determine tier based on score
 */
function determineTier(score) {
    if (score >= 70) return 'HIGH_CONVICTION';
    if (score >= 50) return 'TRADEABLE';
    if (score >= 30) return 'WATCH';
    return 'FILTERED';
}

// ============================================
// MAIN SCAN LOGIC
// ============================================

async function runScan() {
    if (isPaused) {
        log('Scanner is paused');
        return;
    }

    scanCount++;
    const timestamp = new Date().toISOString();
    log(`===== SCAN #${scanCount} =====`);
    log(`Time: ${getETTimeString()}`);

    // Check if we're in pre-market hours
    const inPremarket = isPremarketHours();
    if (!inPremarket) {
        log('Outside pre-market hours (6:00 AM - 9:30 AM ET)');
        log('Scanner will continue monitoring but data may be stale');
    }

    // Fetch market data
    const marketData = await fetchMarketData();
    if (!marketData) {
        logError('Failed to fetch market data, skipping scan');
        return;
    }

    // Extract futures/index data
    const spyData = marketData.SPY || {};
    const qqqData = marketData.QQQ || {};
    const vixData = marketData.VIX || {};

    // Calculate overnight/pre-market change
    const spyPrevClose = spyData.previousClose || spyData.close;
    const qqqPrevClose = qqqData.previousClose || qqqData.close;
    const spyChange = calculateGap(spyPrevClose, spyData.price);
    const qqqChange = calculateGap(qqqPrevClose, qqqData.price);

    // Determine market bias
    let marketBias = 'NEUTRAL';
    const avgChange = (spyChange + qqqChange) / 2;
    if (avgChange > 0.5) marketBias = 'BULLISH';
    else if (avgChange < -0.5) marketBias = 'BEARISH';

    log(`VIX: ${vixData.price?.toFixed(2) || 'N/A'}`);
    log(`SPY: $${spyData.price?.toFixed(2)} (${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(2)}%)`);
    log(`QQQ: $${qqqData.price?.toFixed(2)} (${qqqChange >= 0 ? '+' : ''}${qqqChange.toFixed(2)}%)`);
    log(`Market Bias: ${marketBias}`);

    // Find gapping stocks
    const movers = [];
    const symbols = Object.keys(marketData).filter(s =>
        !['SPY', 'QQQ', 'VIX', 'IWM', 'DIA'].includes(s) &&
        !s.startsWith('$')
    );

    log(`Checking ${symbols.length} symbols for gaps...`);

    for (const symbol of symbols) {
        const data = marketData[symbol];
        if (!data || !data.price) continue;

        const prevClose = data.previousClose || data.close;
        const gapPct = calculateGap(prevClose, data.price);

        // Only track significant gaps
        if (Math.abs(gapPct) >= CONFIG.MIN_GAP_PCT) {
            const gapType = classifyGap(gapPct);
            const direction = gapPct > 0 ? 'UP' : 'DOWN';

            // Check if aligned with market
            const futuresAligned = (gapPct > 0 && avgChange > 0) || (gapPct < 0 && avgChange < 0);

            // Detect catalyst (basic - could be enhanced)
            let catalyst = null;
            if (data.earningsToday) catalyst = 'earnings_today';
            else if (data.news) catalyst = 'news';

            const mover = {
                symbol,
                prev_close: prevClose,
                premarket_price: data.price,
                gap_pct: gapPct,
                premarket_volume: data.volume || 0,
                gap_type: `${gapType}_${direction}`,
                catalyst,
                futures_aligned: futuresAligned,
                // Discovery metadata - shows WHERE we found this symbol
                discovery_score: data.discoveryScore || 0,
                discovery_sources: data.discoverySources || []
            };

            mover.score = scoreMover(mover);
            mover.tier = determineTier(mover.score);

            movers.push(mover);
        }
    }

    // Sort by absolute gap percentage
    movers.sort((a, b) => Math.abs(b.gap_pct) - Math.abs(a.gap_pct));

    // Log results
    const highConviction = movers.filter(m => m.tier === 'HIGH_CONVICTION');
    const tradeable = movers.filter(m => m.tier === 'TRADEABLE');
    const watch = movers.filter(m => m.tier === 'WATCH');

    log(`Found ${movers.length} gapping stocks:`);
    log(`  HIGH_CONVICTION: ${highConviction.length}`);
    log(`  TRADEABLE: ${tradeable.length}`);
    log(`  WATCH: ${watch.length}`);

    // Display top movers
    if (movers.length > 0) {
        log('Top Gaps:');
        movers.slice(0, 10).forEach(m => {
            const dir = m.gap_pct > 0 ? '↑' : '↓';
            const sources = m.discovery_sources?.join(',') || 'unknown';
            log(`  ${m.symbol}: ${dir} ${Math.abs(m.gap_pct).toFixed(2)}% (${m.tier}) [from: ${sources}]`);
        });
    }

    // Save to database
    const scanId = signalDb.insertPremarketScan({
        timestamp,
        market_open: !inPremarket,
        es_price: spyData.price,
        es_change_pct: spyChange,
        nq_price: qqqData.price,
        nq_change_pct: qqqChange,
        vix: vixData.price,
        market_bias: marketBias,
        scan_summary: `${movers.length} gaps: ${highConviction.length} HC, ${tradeable.length} T, ${watch.length} W`
    });

    // Save movers
    for (const mover of movers) {
        signalDb.insertPremarketMover(scanId, {
            timestamp,
            symbol: mover.symbol,
            prev_close: mover.prev_close,
            premarket_price: mover.premarket_price,
            gap_pct: mover.gap_pct,
            premarket_volume: mover.premarket_volume,
            gap_type: mover.gap_type,
            catalyst: mover.catalyst,
            tier: mover.tier,
            score: mover.score
        });
    }

    log(`[DB] Saved scan #${scanId} with ${movers.length} movers`);

    // Write JSON for dashboard
    const output = {
        timestamp,
        scan_id: scanId,
        in_premarket: inPremarket,
        market: {
            spy: { price: spyData.price, change_pct: spyChange },
            qqq: { price: qqqData.price, change_pct: qqqChange },
            vix: vixData.price,
            bias: marketBias
        },
        summary: {
            total_gaps: movers.length,
            high_conviction: highConviction.length,
            tradeable: tradeable.length,
            watch: watch.length
        },
        movers: movers.slice(0, 50)  // Top 50
    };

    fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`Wrote ${CONFIG.OUTPUT_FILE}`);

    lastScanTime = new Date();
    log(`Scan complete. Next scan in ${CONFIG.SCAN_INTERVAL_MS / 60000} minutes`);
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
            const now = new Date();
            const etTime = getETTimeString();

            res.writeHead(200);
            res.end(JSON.stringify({
                scanner: 'premarket',
                running: isRunning,
                paused: isPaused,
                in_premarket: isPremarketHours(),
                scan_count: scanCount,
                last_scan: lastScanTime?.toISOString(),
                next_scan: nextScanTime?.toISOString(),
                current_time_et: etTime,
                premarket_window: '6:00 AM - 9:30 AM ET'
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
            const data = signalDb.getLatestPremarketData();
            res.writeHead(200);
            res.end(JSON.stringify(data || { error: 'No data' }));
        } else if (req.method === 'GET' && url === '/today') {
            const stats = signalDb.getTodayPremarketStats();
            res.writeHead(200);
            res.end(JSON.stringify(stats));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(CONFIG.CONTROL_PORT, () => {
        log(`Control API running on http://localhost:${CONFIG.CONTROL_PORT}`);
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
    log('  PRE-MARKET SCANNER - Starting');
    log('========================================');
    log(`Current time: ${getETTimeString()}`);
    log(`Pre-market window: 6:00 AM - 9:30 AM ET`);
    log(`Scan interval: ${CONFIG.SCAN_INTERVAL_MS / 60000} minutes`);
    log(`Min gap threshold: ${CONFIG.MIN_GAP_PCT}%`);
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
