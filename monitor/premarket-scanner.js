#!/usr/bin/env node
/**
 * PRE-MARKET SCANNER
 *
 * Runs 6:00 AM - 9:30 AM ET to identify pre-market opportunities.
 * Focuses on: gaps, futures direction, earnings, and pre-market volume.
 *
 * Data stored in SQLite (wingman.db)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const signalDb = require('./signal-db');
const appConfig = require('./config-loader');
const { sendTelegram } = require('./telegram');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    INTEL_API: appConfig.apis.intel,
    OPTIONS_API: appConfig.apis.options,
    CONTROL_PORT: 8084,
    SCAN_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes
    PREMARKET_START_HOUR: 6,          // 6 AM ET
    PREMARKET_END_HOUR: 9,            // 9:30 AM ET
    PREMARKET_END_MINUTE: 30,
    MIN_GAP_PCT: 2.0                  // Minimum gap to track
};

// Scanner state
let isRunning = false;
let isPaused = false;
let scanCount = 0;
let lastScanTime = null;
let nextScanTime = null;

// Session watchlist - accumulates all discoveries for the day
let sessionDate = null;  // Format: 'YYYY-MM-DD'
let sessionWatchlist = new Map();  // symbol -> { first_seen, last_seen, peak_gap, data }

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
 * Get current ET time components (handles DST automatically via Intl)
 */
function getETTime() {
    const now = new Date();
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
    const [datePart, timePart] = etStr.split(', ');
    const [hour, minute] = timePart.split(':').map(Number);
    const day = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    return { hour, minute, day };
}

/**
 * Check if we're in pre-market hours (6 AM - 9:30 AM ET, weekdays only)
 */
function isPremarketHours() {
    const { hour, minute, day } = getETTime();

    // Skip weekends
    if (day === 0 || day === 6) return false;

    // Pre-market: 6:00 AM - 9:30 AM ET
    if (hour < CONFIG.PREMARKET_START_HOUR) return false;
    if (hour > CONFIG.PREMARKET_END_HOUR) return false;
    if (hour === CONFIG.PREMARKET_END_HOUR && minute >= CONFIG.PREMARKET_END_MINUTE) return false;

    return true;
}

/**
 * Get current ET time string
 */
function getETTimeString() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }) + ' ET';
}

/**
 * Get current ET date string (YYYY-MM-DD)
 */
function getETDateString() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Check and reset session watchlist if new day
 */
function checkSessionReset() {
    const today = getETDateString();
    if (sessionDate !== today) {
        log(`New session date: ${today} (was: ${sessionDate || 'none'})`);
        sessionDate = today;
        sessionWatchlist.clear();
        log('Session watchlist reset');
    }
}

/**
 * Restore session watchlist from SQLite database
 * Called on startup to recover from restarts
 */
function restoreSessionFromDb() {
    try {
        const movers = signalDb.getTodaySessionMovers();
        if (movers && movers.length > 0) {
            log(`[DB] Restoring ${movers.length} movers from today's session...`);
            for (const m of movers) {
                sessionWatchlist.set(m.symbol, {
                    symbol: m.symbol,
                    first_seen: m.first_seen,
                    last_seen: m.last_seen,
                    scan_count: m.scan_count,
                    peak_gap_pct: m.peak_gap_pct,
                    data: {
                        symbol: m.symbol,
                        prev_close: m.prev_close,
                        premarket_price: m.premarket_price,
                        gap_pct: m.gap_pct,
                        premarket_volume: m.premarket_volume,
                        gap_type: m.gap_type,
                        catalyst: m.catalyst,
                        tier: m.tier,
                        score: m.score,
                        discovery_score: 0,
                        discovery_sources: ['restored_from_db']
                    }
                });
            }
            log(`[DB] Restored session: ${Array.from(sessionWatchlist.keys()).join(', ')}`);
        } else {
            log('[DB] No session data to restore');
        }
    } catch (e) {
        logError(`Failed to restore session from DB: ${e.message}`);
    }
}

/**
 * Add or update symbol in session watchlist
 */
function updateSessionWatchlist(mover) {
    const symbol = mover.symbol;
    const now = new Date().toISOString();
    const gapPct = Math.abs(mover.gap_pct || 0);

    if (sessionWatchlist.has(symbol)) {
        const existing = sessionWatchlist.get(symbol);
        existing.last_seen = now;
        existing.scan_count++;
        // Track peak gap
        if (gapPct > existing.peak_gap_pct) {
            existing.peak_gap_pct = gapPct;
        }
        // Update to latest data
        existing.data = mover;
    } else {
        sessionWatchlist.set(symbol, {
            symbol,
            first_seen: now,
            last_seen: now,
            scan_count: 1,
            peak_gap_pct: gapPct,
            data: mover
        });
        log(`[Session] Added ${symbol} to watchlist (gap: ${mover.gap_pct?.toFixed(2)}%)`);
    }
}

/**
 * Get session watchlist as array, sorted by peak gap
 */
function getSessionWatchlistArray() {
    return Array.from(sessionWatchlist.values())
        .sort((a, b) => b.peak_gap_pct - a.peak_gap_pct);
}

// ============================================
// TELEGRAM ALERTS
// ============================================

// Track which symbols we've alerted today to avoid spam
const alertedToday = new Set();

// sendTelegram imported from ./telegram.js

/**
 * Send alert for HIGH_CONVICTION gap with historical fill rate
 */
async function sendGapAlert(mover, marketContext) {
    const symbol = mover.symbol;

    // Skip if already alerted today
    if (alertedToday.has(symbol)) {
        return;
    }

    // Only send Telegram alerts during pre-market and first 30 min after open (6:00 AM - 10:00 AM ET)
    const { hour: etHour } = getETTime();
    if (etHour >= 10) {
        return;
    }

    // Get historical fill rate for this ticker
    const tickerHistory = signalDb.getTickerGapHistory(symbol, 90);

    // Build the alert message
    const gapDir = mover.gap_pct >= 0 ? '📈' : '📉';
    const gapStr = mover.gap_pct >= 0 ? `+${mover.gap_pct.toFixed(1)}%` : `${mover.gap_pct.toFixed(1)}%`;

    let msg = `${gapDir} <b>HIGH CONVICTION GAP</b>\n\n`;
    msg += `<b>${symbol}</b> ${gapStr}\n`;
    msg += `Price: $${mover.premarket_price?.toFixed(2) || 'N/A'}\n`;
    msg += `Prev Close: $${mover.prev_close?.toFixed(2) || 'N/A'}\n`;

    if (mover.catalyst) {
        msg += `Catalyst: ${mover.catalyst === 'earnings_bmo' ? '📊 Earnings (BMO)' : mover.catalyst === 'earnings_amc' ? '📊 Earnings (AMC)' : mover.catalyst}\n`;
    }

    msg += `\n<b>Score:</b> ${mover.score}/100\n`;

    // Add historical context
    if (tickerHistory && tickerHistory.total_gaps > 0) {
        msg += `\n<b>📊 History (90d):</b>\n`;
        msg += `• ${tickerHistory.total_gaps} gaps recorded\n`;
        msg += `• Fill rate: ${(tickerHistory.fill_rate * 100).toFixed(0)}%\n`;

        if (tickerHistory.wins !== undefined && tickerHistory.losses !== undefined) {
            const winRate = tickerHistory.total_gaps > 0
                ? ((tickerHistory.wins / tickerHistory.total_gaps) * 100).toFixed(0)
                : 'N/A';
            msg += `• Win rate: ${winRate}%\n`;
        }

        // Show last few gaps
        if (tickerHistory.recent_gaps && tickerHistory.recent_gaps.length > 0) {
            const recent = tickerHistory.recent_gaps.slice(0, 3);
            const recentStr = recent.map(g => {
                const dir = g.gap_pct >= 0 ? '+' : '';
                const filled = g.gap_filled ? '✓' : '✗';
                return `${dir}${g.gap_pct.toFixed(1)}%${filled}`;
            }).join(', ');
            msg += `• Recent: ${recentStr}\n`;
        }
    } else {
        msg += `\n<i>🆕 First gap in 90 days</i>\n`;
    }

    // Market context
    msg += `\n<b>Market:</b> SPY ${marketContext.spyChange >= 0 ? '+' : ''}${marketContext.spyChange.toFixed(2)}% | VIX ${marketContext.vix.toFixed(1)}\n`;

    const success = await sendTelegram(msg);
    if (success) {
        alertedToday.add(symbol);
        log(`[Telegram] Sent HIGH_CONVICTION alert for ${symbol}`);
    }
}

/**
 * Reset alerted set at start of new day
 */
function resetAlertedToday() {
    const today = getETDateString();
    if (sessionDate !== today) {
        alertedToday.clear();
    }
}

/**
 * Helper for HTTP GET requests
 */
async function httpGet(url) {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
}

/**
 * Load watchlist from SQLite database (single source of truth)
 */
function loadWatchlist() {
    try {
        return signalDb.getWatchlist();
    } catch (e) {
        console.error('[Premarket] Watchlist DB read failed:', e.message);
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
        // SOURCE 3: Market Movers from S&P 500 (sequential to respect API pacing)
        // These endpoints return today's biggest movers - perfect for finding gaps
        const volumeMovers = await httpGet(`${CONFIG.OPTIONS_API}/api/movers/$SPX?sort=VOLUME`).catch(() => ({ screeners: [] }));
        const gainers = await httpGet(`${CONFIG.OPTIONS_API}/api/movers/$SPX?sort=PERCENT_CHANGE_UP`).catch(() => ({ screeners: [] }));
        const losers = await httpGet(`${CONFIG.OPTIONS_API}/api/movers/$SPX?sort=PERCENT_CHANGE_DOWN`).catch(() => ({ screeners: [] }));

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

        // Fetch sequentially with inter-call delay (API pacing)
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
            // API pacing: 100ms between calls
            await new Promise(r => setTimeout(r, 100));
        }

        // Add VIX separately (from Intel API - VIX is an index, not available via quotes)
        try {
            const vixResponse = await axios.get(
                `${CONFIG.INTEL_API}/api/latest/VIX`,
                { timeout: 3000 }
            );
            const vixData = vixResponse.data?.data;
            if (vixData) {
                marketData['VIX'] = {
                    price: parseFloat(vixData.current_price),
                    previousClose: parseFloat(vixData.previous_close)
                };
            }
        } catch (e) {
            // VIX may not be available - try market context as fallback
            try {
                const contextResponse = await axios.get(
                    `${CONFIG.OPTIONS_API}/api/market/context`,
                    { timeout: 3000 }
                );
                if (contextResponse.data?.vix) {
                    marketData['VIX'] = {
                        price: contextResponse.data.vix,
                        previousClose: null  // Not available from context
                    };
                }
            } catch (e2) {
                // VIX not available
            }
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

/**
 * Check if a symbol has earnings today
 * Uses the Options API calendar endpoint
 */
async function checkEarningsToday(symbol) {
    try {
        const response = await axios.get(`${CONFIG.OPTIONS_API}/api/calendar/${symbol}`, { timeout: 5000 });
        const data = response.data;
        // Check if earnings are today (days_to_earnings === 0) or tomorrow before open
        if (data.has_earnings && data.days_to_earnings === 0) {
            return { hasEarnings: true, time: data.earnings_time, date: data.next_earnings };
        }
        return { hasEarnings: false };
    } catch (e) {
        return { hasEarnings: false };
    }
}

/**
 * Build earnings lookup for a list of symbols
 * Returns a Map of symbol -> earnings info
 */
async function buildEarningsLookup(symbols) {
    const earningsMap = new Map();

    // Batch check symbols (with rate limiting)
    for (const symbol of symbols) {
        const result = await checkEarningsToday(symbol);
        if (result.hasEarnings) {
            earningsMap.set(symbol, result);
            log(`[Earnings] ${symbol} reports ${result.time === 'before_open' ? 'BMO' : result.time === 'after_close' ? 'AMC' : result.time}`);
        }
        // Small delay to avoid hammering the API
        await new Promise(r => setTimeout(r, 50));
    }

    return earningsMap;
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

let _scanInProgress = false;

async function runScan() {
    if (_scanInProgress) { log('Scan already in progress — skipping'); return; }
    _scanInProgress = true;
    try {

    if (isPaused) {
        log('Scanner is paused');
        return;
    }

    // Check if we need to reset session watchlist (new day)
    checkSessionReset();
    resetAlertedToday();

    scanCount++;
    const timestamp = new Date().toISOString();
    log(`===== SCAN #${scanCount} =====`);
    log(`Time: ${getETTimeString()}`);

    // Check if we're in pre-market hours
    const inPremarket = isPremarketHours();
    if (!inPremarket) {
        log('Outside pre-market hours (6:00 AM - 9:30 AM ET) - skipping scan');
        return;
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

    // First pass: find symbols with significant gaps
    const gappingSymbols = symbols.filter(symbol => {
        const data = marketData[symbol];
        if (!data || !data.price) return false;
        const prevClose = data.previousClose || data.close;
        const gapPct = calculateGap(prevClose, data.price);
        return Math.abs(gapPct) >= CONFIG.MIN_GAP_PCT;
    });

    // Build earnings lookup for gapping symbols (checks calendar API)
    log(`Building earnings lookup for ${gappingSymbols.length} gapping symbols...`);
    const earningsLookup = await buildEarningsLookup(gappingSymbols);
    if (earningsLookup.size > 0) {
        log(`Found ${earningsLookup.size} symbols with earnings today`);
    }

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

            // Detect catalyst - check earnings lookup first
            let catalyst = null;
            const earningsInfo = earningsLookup.get(symbol);
            if (earningsInfo) {
                catalyst = earningsInfo.time === 'before_open' ? 'earnings_bmo' :
                           earningsInfo.time === 'after_close' ? 'earnings_amc' : 'earnings_today';
            } else if (data.news) {
                catalyst = 'news';
            }

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

            // Add to session watchlist (persists for the day)
            updateSessionWatchlist(mover);
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

    // Auto-add HIGH_CONVICTION gaps to watchlist (2-day window)
    // If symbol already exists, timer resets (repeat gaps deserve more attention)
    // Manual entries are protected by addToWatchlist() — never overwritten
    for (const mover of highConviction) {
        const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // Expires in 2 days
        const result = signalDb.addToWatchlist(mover.symbol, {
            notes: `Premarket gap ${mover.gap_pct > 0 ? '+' : ''}${mover.gap_pct.toFixed(1)}% - ${new Date().toISOString().split('T')[0]}`,
            source: 'premarket_gap',
            addedBy: 'premarket-scanner',
            gapPct: mover.gap_pct,
            scoreAtAdd: mover.score,
            tierAtAdd: mover.tier,
            expiresAt: expiresAt
        });
        if (result.action === 'added') {
            log(`[Watchlist] Auto-added ${mover.symbol} (${mover.gap_pct.toFixed(1)}% gap, score: ${mover.score})`);
        } else if (result.action === 'updated') {
            log(`[Watchlist] Reset timer for ${mover.symbol} (repeat gap ${mover.gap_pct.toFixed(1)}%, new expiry: 2 days)`);
        }

        // Send Telegram alert with historical fill rate
        sendGapAlert(mover, {
            spyChange: spyChange,
            vix: vixData.price,
            bias: marketBias
        });
    }

    // Get session watchlist
    const sessionList = getSessionWatchlistArray();

    // When outside pre-market, use session watchlist as movers so gaps persist all day
    let displayMovers = movers;
    let displayHighConviction = highConviction;
    let displayTradeable = tradeable;
    let displayWatch = watch;

    if (!inPremarket && movers.length === 0 && sessionList.length > 0) {
        // Convert session watchlist back to movers format for display
        displayMovers = sessionList.map(s => ({
            symbol: s.symbol,
            prev_close: s.data.prev_close,
            premarket_price: s.data.premarket_price,
            gap_pct: s.data.gap_pct,
            premarket_volume: s.data.premarket_volume,
            gap_type: s.data.gap_type,
            catalyst: s.data.catalyst,
            futures_aligned: s.data.futures_aligned,
            discovery_score: s.data.discovery_score,
            discovery_sources: s.data.discovery_sources,
            score: s.data.score,
            tier: s.data.tier,
            // Add session metadata
            first_seen: s.first_seen,
            peak_gap_pct: s.peak_gap_pct,
            scan_count: s.scan_count,
            from_session: true  // Flag that this is persisted data
        }));
        displayHighConviction = displayMovers.filter(m => m.tier === 'HIGH_CONVICTION');
        displayTradeable = displayMovers.filter(m => m.tier === 'TRADEABLE');
        displayWatch = displayMovers.filter(m => m.tier === 'WATCH');
        log(`[Session] Restored ${displayMovers.length} gaps from morning session`);
    }

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
            total_gaps: displayMovers.length,
            high_conviction: displayHighConviction.length,
            tradeable: displayTradeable.length,
            watch: displayWatch.length,
            session_total: sessionList.length
        },
        movers: displayMovers.slice(0, 50),  // Top 50 (from current scan or session)
        session: {
            date: sessionDate,
            symbols_discovered: sessionList.length,
            watchlist: sessionList.map(s => ({
                symbol: s.symbol,
                first_seen: s.first_seen,
                last_seen: s.last_seen,
                scan_count: s.scan_count,
                peak_gap_pct: s.peak_gap_pct,
                current_gap_pct: s.data.gap_pct,
                current_tier: s.data.tier,
                current_score: s.data.score,
                gap_type: s.data.gap_type,
                premarket_volume: s.data.premarket_volume
            }))
        }
    };

    // Removed: JSON file write (premarket.json) - data now served from SQLite via /api/premarket

    lastScanTime = new Date();
    log(`Scan complete. Next scan in ${CONFIG.SCAN_INTERVAL_MS / 60000} minutes`);

    } finally { _scanInProgress = false; }
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
        } else if (req.method === 'GET' && url === '/session') {
            // Get session watchlist
            const sessionList = getSessionWatchlistArray();
            res.writeHead(200);
            res.end(JSON.stringify({
                date: sessionDate,
                symbols_discovered: sessionList.length,
                watchlist: sessionList.map(s => ({
                    symbol: s.symbol,
                    first_seen: s.first_seen,
                    last_seen: s.last_seen,
                    scan_count: s.scan_count,
                    peak_gap_pct: s.peak_gap_pct,
                    current_gap_pct: s.data.gap_pct,
                    current_tier: s.data.tier,
                    current_score: s.data.score,
                    gap_type: s.data.gap_type
                }))
            }));
        } else if (req.method === 'POST' && url === '/session/clear') {
            // Manual session reset
            sessionWatchlist.clear();
            sessionDate = getETDateString();
            log('Session watchlist manually cleared');
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Session cleared', date: sessionDate }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });

    server.listen(CONFIG.CONTROL_PORT, '0.0.0.0', () => {
        log(`Control API running on http://0.0.0.0:${CONFIG.CONTROL_PORT} (accessible from network)`);
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

    // Initialize session date
    sessionDate = getETDateString();

    // Restore session watchlist from database (survives restarts)
    restoreSessionFromDb();

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

// Global error handlers — log and exit cleanly for PM2 restart
process.on('uncaughtException', (err) => {
    logError(`Uncaught exception: ${err.message}`);
    console.error(err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logError(`Unhandled rejection: ${reason}`);
    process.exit(1);
});

main().catch(e => {
    logError(`Fatal error: ${e.message}`);
    console.error(e);
    process.exit(1);
});
