/**
 * BLOODHOUND SCANNER
 *
 * Autonomous opportunity detection with confluence scoring.
 * Finds where to look, trader makes the decisions.
 *
 * Key Principles:
 * - Dynamic symbol discovery (not static watchlists)
 * - Confluence is everything (multiple factors must align)
 * - Market context matters (SPY/QQQ direction affects everything)
 * - Find, don't trade (system alerts, human decides)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Signal validation system
const signalLogger = require('./signal-logger');
const signalDb = require('./signal-db');

// Load config
const CONFIG = require('./config-loader');

const APIS = {
    intel: CONFIG.apis.intel,
    options: CONFIG.apis.options
};

const SETTINGS = {
    scanIntervalMs: 5 * 60 * 1000,  // 5 minutes
    minConfluenceScore: 35,          // Minimum score to alert (0-100 scale, data-driven)
    maxSymbols: 50,                  // Max symbols to scan per cycle
    alertCooldownMs: 30 * 60 * 1000, // 30 min cooldown per symbol
    ignoreMarketHours: false,        // Set true to bypass market hours check
    // Signal tracking settings
    velocityThreshold: 15,           // Points jump to trigger velocity alert (adjusted for new scale)
    autoTrackMinScore: 50,           // Minimum score to auto-track for outcomes
    signalExpirationDays: 5,         // Days before unresolved signal = EXPIRED
    // Display timezone
    displayTimezone: 'America/Los_Angeles', // PST/PDT for user display

    // === DATA-DRIVEN THRESHOLDS (from 179 signal backtest) ===
    // AT_WALL + EXTENDED_RSI = 89.5% win rate
    // ELEVATED_VOLUME = 76.9% win rate
    // VIX_ELEVATED = 66.7% win rate
    WALL_THRESHOLD_PCT: 1.0,        // Within 1% = "at wall"
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70,
    VOLUME_ELEVATED: 1.5,           // 1.5x average = elevated
    VIX_ELEVATED: 20,
    VIX_FEAR: 30,

    // Tier thresholds (0-100 scale)
    TIER_HIGH_CONVICTION: 50,       // Requires prime setup or multiple high-edge factors
    TIER_TRADEABLE: 35,
    TIER_WATCH: 20,
};

// ============================================
// TIMEZONE HELPER
// ============================================
function formatTimePST(date = new Date()) {
    return date.toLocaleString('en-US', {
        timeZone: SETTINGS.displayTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

// ============================================
// ADAPTIVE BACKOFF FOR API RATE LIMITING
// ============================================
const backoffState = {
    active: false,              // Whether backoff is currently active
    slowResponses: 0,           // Count of slow responses (>5s)
    fastResponses: 0,           // Count of fast responses (<2s)
    batchSize: 5,               // Symbols per batch when backoff active
    batchDelayMs: 300,          // Delay between batches
    slowThresholdMs: 5000,      // Response time to trigger backoff
    recoveryThreshold: 10,      // Fast responses needed to recover
    triggerThreshold: 3,        // Slow responses to trigger backoff
    lastLogTime: 0,             // Throttle logging
};

// Track response time and update backoff state
function updateBackoffState(responseTimeMs, endpoint) {
    const now = Date.now();

    if (responseTimeMs > backoffState.slowThresholdMs) {
        backoffState.slowResponses++;
        backoffState.fastResponses = 0;

        if (!backoffState.active && backoffState.slowResponses >= backoffState.triggerThreshold) {
            backoffState.active = true;
            console.log(`[Backoff] ⚠️ ACTIVATED - ${backoffState.slowResponses} slow responses (>${backoffState.slowThresholdMs}ms)`);
            console.log(`[Backoff]    Switching to batched mode: ${backoffState.batchSize} symbols, ${backoffState.batchDelayMs}ms delay`);
        }
    } else if (responseTimeMs < 2000) {
        backoffState.fastResponses++;

        if (backoffState.active && backoffState.fastResponses >= backoffState.recoveryThreshold) {
            backoffState.active = false;
            backoffState.slowResponses = 0;
            console.log(`[Backoff] ✅ RECOVERED - ${backoffState.fastResponses} fast responses, resuming parallel mode`);
        }
    }

    // Log every 30s when backoff is active
    if (backoffState.active && now - backoffState.lastLogTime > 30000) {
        backoffState.lastLogTime = now;
        console.log(`[Backoff] 📊 Active (slow: ${backoffState.slowResponses}, fast: ${backoffState.fastResponses})`);
    }
}

// Map non-tradeable symbols to their liquid ETF equivalents
const SYMBOL_MAP = {
    // Crypto → ETFs
    'BTC': 'IBIT',    // BlackRock Bitcoin ETF (most liquid)
    'ETH': 'ETHA',    // BlackRock Ethereum ETF
    'SOL': 'SOLQ',    // Solana ETF (if available)
    'TAO': 'GTAO',    // Grayscale TAO
    // Indices → ETFs
    'SPX': 'SPY',
    'NDX': 'QQQ',
    'DJI': 'DIA',
    'RUT': 'IWM',
    // Futures → ETFs
    'ES': 'SPY',
    'NQ': 'QQQ',
    'CL': 'USO',      // Oil ETF
    'GC': 'GLD',      // Gold ETF
};

// Symbols to filter out completely (no ETF equivalent)
const NON_TRADEABLE = new Set([
    'XRP', 'DOGE', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK',  // Crypto without liquid ETFs
    'VIX',  // Can't trade VIX directly (use VXX/UVXY but they're decay products)
    'YM', 'RTY', 'SI',  // Futures without common ETF mapping
    'USD', 'EUR', 'GBP', 'JPY', 'CNY',  // Currencies
]);

// Map individual stocks to their sector ETF for RS scoring
const SECTOR_MAP = {
    // Technology (XLK)
    AAPL: 'XLK', MSFT: 'XLK', NVDA: 'XLK', AMD: 'XLK', QCOM: 'XLK',
    AVGO: 'XLK', CRM: 'XLK', ADBE: 'XLK', INTC: 'XLK', TXN: 'XLK',
    MU: 'XLK', AMAT: 'XLK', LRCX: 'XLK', KLAC: 'XLK', MRVL: 'XLK',
    NOW: 'XLK', PANW: 'XLK', SNPS: 'XLK', CDNS: 'XLK', FTNT: 'XLK',
    // Consumer Discretionary (XLY)
    AMZN: 'XLY', TSLA: 'XLY', HD: 'XLY', MCD: 'XLY', NKE: 'XLY',
    LOW: 'XLY', SBUX: 'XLY', TJX: 'XLY', CMG: 'XLY', ORLY: 'XLY',
    BKNG: 'XLY', ABNB: 'XLY', ROST: 'XLY', DHI: 'XLY', LEN: 'XLY',
    // Communications (XLC)
    META: 'XLC', GOOGL: 'XLC', GOOG: 'XLC', NFLX: 'XLC', DIS: 'XLC',
    CMCSA: 'XLC', VZ: 'XLC', T: 'XLC', TMUS: 'XLC', EA: 'XLC',
    TTWO: 'XLC', DDOG: 'XLC', SNAP: 'XLC', PINS: 'XLC',
    // Financials (XLF)
    JPM: 'XLF', BAC: 'XLF', WFC: 'XLF', GS: 'XLF', MS: 'XLF',
    C: 'XLF', AXP: 'XLF', BLK: 'XLF', SCHW: 'XLF', COF: 'XLF',
    PYPL: 'XLF', V: 'XLF', MA: 'XLF', FISV: 'XLF', SQ: 'XLF',
    // Healthcare (XLV)
    UNH: 'XLV', JNJ: 'XLV', LLY: 'XLV', PFE: 'XLV', ABBV: 'XLV',
    MRK: 'XLV', TMO: 'XLV', ABT: 'XLV', DHR: 'XLV', BSX: 'XLV',
    ISRG: 'XLV', AMGN: 'XLV', GILD: 'XLV', VRTX: 'XLV', REGN: 'XLV',
    // Energy (XLE)
    XOM: 'XLE', CVX: 'XLE', COP: 'XLE', SLB: 'XLE', EOG: 'XLE',
    MPC: 'XLE', OXY: 'XLE', PSX: 'XLE', VLO: 'XLE', PXD: 'XLE',
    // Industrials (XLI)
    CAT: 'XLI', DE: 'XLI', UNP: 'XLI', HON: 'XLI', RTX: 'XLI',
    BA: 'XLI', LMT: 'XLI', GE: 'XLI', MMM: 'XLI', UBER: 'XLI',
    FDX: 'XLI', UPS: 'XLI', WM: 'XLI',
    // Consumer Staples (XLP)
    PG: 'XLP', KO: 'XLP', PEP: 'XLP', COST: 'XLP', WMT: 'XLP',
    PM: 'XLP', MO: 'XLP', CL: 'XLP', KHC: 'XLP', MDLZ: 'XLP',
    // Utilities (XLU)
    NEE: 'XLU', SO: 'XLU', DUK: 'XLU', AEP: 'XLU', D: 'XLU',
    // Real Estate (XLRE)
    AMT: 'XLRE', PLD: 'XLRE', CCI: 'XLRE', EQIX: 'XLRE', SPG: 'XLRE',
    // Materials (XLB)
    LIN: 'XLB', APD: 'XLB', SHW: 'XLB', FCX: 'XLB', NEM: 'XLB',
    // Crypto-related (use IBIT as sector proxy)
    IBIT: 'IBIT', MSTR: 'IBIT', MARA: 'IBIT', IREN: 'IBIT', COIN: 'IBIT',
    RIOT: 'IBIT', ETHA: 'IBIT',
};

// Translate symbol to tradeable equivalent
function mapSymbol(ticker) {
    if (SYMBOL_MAP[ticker]) {
        return SYMBOL_MAP[ticker];
    }
    if (NON_TRADEABLE.has(ticker)) {
        return null; // Filter out
    }
    return ticker; // Pass through
}

// ============================================
// FIBONACCI LEVEL DETECTION
// ============================================

/**
 * Calculate Fibonacci retracement and extension levels from swing points
 * @param {number} swingLow - Recent swing low price
 * @param {number} swingHigh - Recent swing high price
 * @returns {object} Fib levels with prices
 */
function calculateFibLevels(swingLow, swingHigh) {
    if (!swingLow || !swingHigh || swingLow >= swingHigh) {
        return null;
    }

    const range = swingHigh - swingLow;

    return {
        swingLow,
        swingHigh,
        range,
        // Retracements (from high going down toward low)
        retracements: {
            0.236: swingHigh - (range * 0.236),
            0.382: swingHigh - (range * 0.382),
            0.5: swingHigh - (range * 0.5),
            0.618: swingHigh - (range * 0.618),  // Golden Pocket
            0.786: swingHigh - (range * 0.786),
        },
        // Extensions (from low going up past high)
        extensions: {
            1.0: swingHigh,
            1.272: swingLow + (range * 1.272),
            1.618: swingLow + (range * 1.618),
            2.0: swingLow + (range * 2.0),
            2.618: swingLow + (range * 2.618),
        }
    };
}

/**
 * Check if price is near a Fibonacci level
 * @param {number} price - Current price
 * @param {object} fibLevels - Calculated Fib levels
 * @param {number} threshold - % threshold for "at level" (default 1%)
 * @returns {object|null} Nearest Fib level info or null
 */
function checkFibProximity(price, fibLevels, threshold = 1.0) {
    if (!fibLevels || !price) return null;

    const results = [];

    // Check retracements
    for (const [level, fibPrice] of Object.entries(fibLevels.retracements)) {
        const distance = Math.abs((price - fibPrice) / fibPrice * 100);
        if (distance <= threshold) {
            results.push({
                type: 'retracement',
                level: parseFloat(level),
                price: fibPrice,
                distance,
                isGoldenPocket: parseFloat(level) === 0.618,
            });
        }
    }

    // Check extensions
    for (const [level, fibPrice] of Object.entries(fibLevels.extensions)) {
        const distance = Math.abs((price - fibPrice) / fibPrice * 100);
        if (distance <= threshold) {
            results.push({
                type: 'extension',
                level: parseFloat(level),
                price: fibPrice,
                distance,
            });
        }
    }

    // Return closest match, preferring Golden Pocket
    if (results.length === 0) return null;

    // Sort by: Golden Pocket first, then by distance
    results.sort((a, b) => {
        if (a.isGoldenPocket && !b.isGoldenPocket) return -1;
        if (!a.isGoldenPocket && b.isGoldenPocket) return 1;
        return a.distance - b.distance;
    });

    return results[0];
}

/**
 * Check if Fib level aligns with a moving average
 * @param {number} fibPrice - Fibonacci level price
 * @param {object} technicals - Technical data with MAs
 * @param {number} threshold - % threshold for alignment (default 1%)
 * @returns {object|null} MA alignment info or null
 */
function checkFibMAConfluence(fibPrice, technicals, threshold = 1.0) {
    if (!fibPrice || !technicals) return null;

    const mas = [
        { name: 'SMA 20', price: technicals.sma_20 },
        { name: 'SMA 50', price: technicals.sma_50 },
        { name: 'SMA 200', price: technicals.sma_200 || technicals.bb_middle }, // Use BB middle as proxy if no 200
    ].filter(ma => ma.price);

    for (const ma of mas) {
        const distance = Math.abs((fibPrice - ma.price) / ma.price * 100);
        if (distance <= threshold) {
            return {
                ma: ma.name,
                maPrice: ma.price,
                fibPrice,
                distance,
            };
        }
    }

    return null;
}

/**
 * Check if Fib extension aligns with a gamma wall
 * @param {object} fibLevels - Calculated Fib levels
 * @param {number} callWall - Call wall price
 * @param {number} putWall - Put wall price
 * @param {number} threshold - % threshold for alignment (default 1%)
 * @returns {object|null} Wall alignment info or null
 */
function checkFibWallConfluence(fibLevels, callWall, putWall, threshold = 1.0) {
    if (!fibLevels) return null;

    const alignments = [];

    // Helper: Check if Fib price matches wall within tight tolerance
    // Uses hybrid: $2 OR 0.3% of wall price, whichever is larger
    // This prevents false matches like "$703 Fib = $695 Call Wall"
    const isWithinTolerance = (fibPrice, wallPrice) => {
        const dollarDiff = Math.abs(wallPrice - fibPrice);
        const tolerance = Math.max(2.0, wallPrice * 0.003);  // $2 or 0.3%
        return dollarDiff <= tolerance;
    };

    // Check profit target extensions against call wall (resistance)
    // 1.272 = first target, 1.618 = extended target
    const targetExtensions = ['1.272', '1.618'];
    for (const ext of targetExtensions) {
        if (callWall && fibLevels.extensions[ext]) {
            const fibPrice = fibLevels.extensions[ext];
            if (isWithinTolerance(fibPrice, callWall)) {
                const distance = Math.abs((callWall - fibPrice) / callWall * 100);
                alignments.push({
                    type: 'resistance',
                    fibLevel: parseFloat(ext),
                    fibPrice,
                    wallType: 'call',
                    wallPrice: callWall,
                    distance,
                });
            }
        }
    }

    // Check Golden Zone retracements against put wall (support)
    // 0.5 = first support (strong trends), 0.618 = Golden Pocket (deeper pullback)
    const goldenZone = ['0.5', '0.618'];
    for (const ret of goldenZone) {
        if (putWall && fibLevels.retracements[ret]) {
            const fibPrice = fibLevels.retracements[ret];
            if (isWithinTolerance(fibPrice, putWall)) {
                const distance = Math.abs((putWall - fibPrice) / putWall * 100);
                alignments.push({
                    type: 'support',
                    fibLevel: parseFloat(ret),
                    fibPrice,
                    wallType: 'put',
                    wallPrice: putWall,
                    distance,
                });
            }
        }
    }

    return alignments.length > 0 ? alignments : null;
}

// State
const alertCooldowns = new Map();
let marketContext = null;
let rsContext = null;  // Relative strength data from divergence scanner

// ============================================
// MARKET HOURS DETECTION
// ============================================

/**
 * Check if regular market hours are active
 * Returns true only during regular trading hours (9:30 AM - 4:00 PM ET)
 * when options data is live. Pre-market gaps are handled by premarket-scanner.js.
 */
function isMarketOpen() {
    const now = new Date();

    // Convert to Eastern Time (market timezone)
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay(); // 0 = Sunday, 6 = Saturday
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    // Closed on weekends
    if (day === 0 || day === 6) {
        return false;
    }

    // Market hours: 9:30 AM - 4:00 PM ET (6:30 AM - 1:00 PM PST)
    // Only runs during regular hours when options data is live
    // Pre-market gaps are handled by premarket-scanner.js (6-9:30 AM ET)
    const marketOpen = 9 * 60 + 30;  // 9:30 AM ET (6:30 AM PST)
    const marketClose = 16 * 60;     // 4:00 PM ET (1:00 PM PST)

    return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
}

/**
 * Get next market open time as a human-readable string
 */
function getNextMarketOpen() {
    const now = new Date();
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    // If it's weekend
    if (day === 0) { // Sunday
        return 'Monday 9:30 AM ET (6:30 AM PST)';
    }
    if (day === 6) { // Saturday
        return 'Monday 9:30 AM ET (6:30 AM PST)';
    }

    // If it's a weekday before market open
    const marketOpen = 9 * 60 + 30;  // 9:30 AM ET
    if (timeInMinutes < marketOpen) {
        return 'Today 9:30 AM ET (6:30 AM PST)';
    }

    // If it's after market close, next open is tomorrow (or Monday if Friday)
    const marketClose = 16 * 60;
    if (timeInMinutes >= marketClose) {
        if (day === 5) { // Friday
            return 'Monday 9:30 AM ET (6:30 AM PST)';
        }
        return 'Tomorrow 9:30 AM ET (6:30 AM PST)';
    }

    return 'Now (scanner active)';
}

// ============================================
// SIGNAL TRACKING (Now uses SQLite database)
// ============================================

// In-memory cache for velocity tracking within a scan cycle
const velocityCache = new Map();

// Update signal history and calculate velocity (database-backed)
function updateSignalHistory(symbol, score, price, direction, analysis) {
    // Get velocity from database (comparing today vs yesterday)
    const velocityData = signalDb.getSymbolVelocity(symbol);
    const prevScore = velocityData.prevScore || 0;
    const velocity = score - prevScore;

    // Cache the current score for this scan cycle
    velocityCache.set(symbol, { score, price, direction, velocity });

    return { prevScore, velocity };
}

// Signal outcomes are now tracked via signalLogger and signal-db.js
// The resolveSignalOutcomes() and getSignalStats() functions have been moved there

// ============================================
// SCANNER HISTORY TRACKING (Now uses SQLite database only)
// ============================================

const HISTORY_RETENTION_DAYS = 14;

/**
 * Update scanner history in database
 * This replaces the JSON-based scanner_history.json
 */
function updateScannerHistory(analyses, marketContext) {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`\n[History] Updating scanner history for ${analyses.length} symbols...`);

    for (const analysis of analyses) {
        const symbol = analysis.symbol;

        // Calculate time in scanner for this symbol today
        const existingHistory = signalDb.getScannerHistory(symbol, 1);
        const todayEntry = existingHistory.find(h => h.date === today);
        let timeInScannerMins = 0;
        if (todayEntry && todayEntry.first_seen) {
            const firstScan = new Date(todayEntry.first_seen);
            timeInScannerMins = Math.floor((now - firstScan) / 60000);
        }

        // Calculate range_pct from high/low if available
        let rangePct = null;
        if (todayEntry && todayEntry.high_price && todayEntry.low_price && todayEntry.low_price > 0) {
            rangePct = ((todayEntry.high_price - todayEntry.low_price) / todayEntry.low_price) * 100;
        }

        // Write to database with all fields
        try {
            signalDb.upsertScannerHistory(symbol, today, {
                first_seen: now.toISOString(),
                score: analysis.totalScore,
                zone: analysis.zone,
                price: analysis.price,
                gap_pct: 0, // Will be calculated from previous day in DB
                rsi: analysis.technicals?.rsi,
                // Trend data
                trend: analysis.technicals?.trend,
                direction: analysis.direction,
                spy_trend: marketContext?.spyTrend,
                vix: marketContext?.vix,
                vix_regime: marketContext?.vixRegime,
                // New fields for full migration
                vwap: analysis.levels?.vwap,
                range_pct: rangePct,
                volume_ratio: analysis.technicals?.volumeRatio,
                volume_avg_20d: analysis.technicals?.volumeAvg,
                peak_direction: analysis.direction,
                peak_signals: analysis.signals?.slice(0, 5) || [],
                time_in_scanner_mins: timeInScannerMins,
                above_20ema: analysis.technicals?.above20EMA,
                above_50sma: analysis.technicals?.above50SMA,
                bb_position: analysis.technicals?.bbPosition || 'MIDDLE'
            });
        } catch (e) {
            console.error(`[History] DB write failed for ${symbol}:`, e.message);
        }
    }

    console.log(`[History] Updated ${analyses.length} symbols in database.`);
}

/**
 * Compute history status using database (replaces JSON-based version)
 * Uses signalDb.computeHistoryStatus() for actual computation
 */
function computeHistoryStatus(symbol) {
    return signalDb.computeHistoryStatus(symbol);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function fetchJSON(url, timeout = 10000, trackBackoff = false) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        // Track response time for backoff on heavy endpoints
        if (trackBackoff || url.includes('/api/levels/')) {
            updateBackoffState(responseTime, url);
        }

        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        console.error(`[API] Failed: ${url} — ${e.message} (${responseTime}ms)`);

        // Timeout/error counts as slow response
        if (trackBackoff || url.includes('/api/levels/')) {
            updateBackoffState(responseTime + 5000, url); // Treat errors as 5s+ response
        }

        return null;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function sendTelegram(message) {
    const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.telegram.chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        const result = await response.json();
        if (result.ok) {
            console.log(`[Telegram] Sent alert`);
        } else {
            console.error(`[Telegram] Failed:`, result.description);
        }
    } catch (e) {
        console.error(`[Telegram] Error:`, e.message);
    }
}

// ============================================
// WALL ACTIVITY CLASSIFICATION
// ============================================

/**
 * Classify wall activity level based on vol/OI ratio at the wall strike.
 * Uses already-fetched optionsAnalysis data (no additional API call).
 *
 * Returns: { status: 'ACTIVE'|'ENGAGED'|'DORMANT'|'UNKNOWN', volOiRatio, volume, openInterest }
 *
 * Principle: Only penalize DORMANT (stale OI). Don't reward ACTIVE
 * since we can't verify if activity is bullish or bearish.
 */
function classifyWallActivity(optionsAnalysis, wallPrice, wallType, wallExpiration, totalChainVolume) {
    if (!optionsAnalysis?.analysis) {
        return { status: 'UNKNOWN', volOiRatio: 0 };
    }

    const flowArray = wallType === 'put'
        ? optionsAnalysis.analysis.unusual_puts
        : optionsAnalysis.analysis.unusual_calls;

    // Tolerance: 0.2% of price OR $1.00, whichever is larger
    const tolerance = Math.max(wallPrice * 0.002, 1.0);

    // Normalize expiration format (defensive - handle ISO vs date-only)
    const normalizeExp = (exp) => exp?.split('T')[0];
    const targetExp = normalizeExp(wallExpiration);

    const activityAtWall = flowArray?.filter(f =>
        Math.abs(f.strike - wallPrice) <= tolerance &&
        normalizeExp(f.expiration) === targetExp
    ) || [];

    if (activityAtWall.length === 0) {
        // Distinguish UNKNOWN (illiquid) from DORMANT (liquid but inactive)
        const isLiquid = totalChainVolume >= 10000;
        return {
            status: isLiquid ? 'DORMANT' : 'UNKNOWN',
            volOiRatio: 0,
            volume: 0
        };
    }

    // Aggregate activity at wall
    const totalVolume = activityAtWall.reduce((sum, f) => sum + f.volume, 0);
    const totalOI = activityAtWall.reduce((sum, f) => sum + f.open_interest, 0);
    const volOiRatio = totalVolume / Math.max(totalOI, 1);

    // Classify activity level
    let status;
    if (volOiRatio >= 5) status = 'ACTIVE';
    else if (volOiRatio >= 2) status = 'ENGAGED';
    else status = 'DORMANT';

    return { status, volOiRatio, volume: totalVolume, openInterest: totalOI };
}

// ============================================
// WATCHLIST LOADING (Database only)
// ============================================

function loadWatchlist() {
    try {
        // Clean expired entries first
        try { signalDb.cleanExpiredWatchlist(); } catch (e) { /* ignore */ }

        const partitioned = signalDb.getWatchlistPartitioned();

        // Remove dynamic entries that duplicate a static symbol (static wins)
        const staticSet = new Set(partitioned.static);
        const dynamic = partitioned.dynamic.filter(d => !staticSet.has(d.symbol));

        if (partitioned.static.length === 0 && dynamic.length === 0) {
            console.log('[Watchlist] DB empty, using defaults: SPY, QQQ');
            return { static: ['SPY', 'QQQ'], dynamic: [] };
        }

        console.log(`[Watchlist] DB: ${partitioned.static.length} static, ${dynamic.length} dynamic`);
        return { static: partitioned.static, dynamic };
    } catch (e) {
        console.log(`[Watchlist] Database read failed: ${e.message}, using defaults`);
        return { static: ['SPY', 'QQQ'], dynamic: [] };
    }
}

// ============================================
// SYMBOL DISCOVERY
// ============================================

async function discoverSymbols() {
    // --- Load watchlist: static (reserved) + dynamic (compete) ---
    const watchlist = loadWatchlist();
    const staticSymbols = watchlist.static;
    const staticSet = new Set(staticSymbols);

    // Dynamic pool — watchlist dynamic entries + market_data + sector_rotation
    const dynamicPool = new Map(); // symbol -> { score, sources, ... }

    // Seed dynamic pool with watchlist dynamic entries (premarket_gap, signal_tracking, etc.)
    for (const entry of watchlist.dynamic) {
        dynamicPool.set(entry.symbol, { score: 60, sources: [`watchlist_${entry.source}`] });
    }

    // --- Context: AI Market Outlook ---
    let themes, intradayBias, swingBias;
    const outlook = await fetchJSON(`${APIS.intel}/api/market/outlook`);
    if (outlook?.success && outlook.data) {
        themes = outlook.data.key_themes || [];
        intradayBias = outlook.data.intraday_bias;
        swingBias = outlook.data.swing_bias;
    }

    // --- Market data + sector rotation ---
    const latest = await fetchJSON(`${APIS.intel}/api/latest`);
    const sectorETFs = [];
    if (latest?.success && latest.data) {
        latest.data.forEach(item => {
            if (!item.symbol) return;

            // Track sector ETFs separately for rotation analysis
            if (item.symbol.startsWith('XL')) {
                const pos52wk = item.fifty_two_week_range_position || 50;
                const volRatio = item.todays_volume && item.volume_avg_30_day
                    ? item.todays_volume / item.volume_avg_30_day : 1;
                sectorETFs.push({
                    symbol: item.symbol,
                    pos52wk,
                    volRatio,
                    change: parseFloat(item.daily_change) || 0
                });
            }

            // Skip VIX/VXX for main analysis
            if (item.symbol === 'VIX' || item.symbol === 'VXX') return;
            if (item.symbol.startsWith('XL')) return; // Handle sectors separately

            const ticker = mapSymbol(item.symbol); // Map BTC→IBIT, etc.
            if (!ticker) return;

            // Skip static symbols — they already have reserved slots
            if (staticSet.has(ticker)) return;

            // Check for interesting conditions
            const pos52wk = item.fifty_two_week_range_position || 50;
            const volRatio = item.todays_volume && item.volume_avg_30_day
                ? item.todays_volume / item.volume_avg_30_day
                : 1;

            // Score boost for extremes
            let boost = 0;
            if (pos52wk > 95) boost += 25; // Near 52-week high
            if (pos52wk < 10) boost += 25; // Near 52-week low
            if (volRatio > 1.5) boost += 20; // High relative volume
            if (volRatio > 2.0) boost += 10; // Extra boost for volume spike

            if (boost > 0) {
                const existing = dynamicPool.get(ticker) || { score: 0, sources: [] };
                existing.score += boost;
                existing.sources.push('market_data');
                existing.price = parseFloat(item.current_price);
                existing.pos52wk = pos52wk;
                existing.volRatio = volRatio;
                if (item.symbol !== ticker) existing.mappedFrom = item.symbol;
                dynamicPool.set(ticker, existing);
            }
        });

        // Identify sector rotation - add strongest/weakest sectors
        if (sectorETFs.length > 0) {
            sectorETFs.sort((a, b) => b.pos52wk - a.pos52wk);
            const strongestSector = sectorETFs[0];
            const weakestSector = sectorETFs[sectorETFs.length - 1];

            // Add strongest sector if showing momentum (skip if static)
            if ((strongestSector.pos52wk > 90 || strongestSector.volRatio > 1.3) && !staticSet.has(strongestSector.symbol)) {
                const existing = dynamicPool.get(strongestSector.symbol) || { score: 0, sources: [] };
                existing.score += 30;
                existing.sources.push('sector_leader');
                existing.pos52wk = strongestSector.pos52wk;
                dynamicPool.set(strongestSector.symbol, existing);
            }

            // Add weakest sector if showing reversal potential (skip if static)
            if (weakestSector.pos52wk < 30 && weakestSector.volRatio > 1.2 && !staticSet.has(weakestSector.symbol)) {
                const existing = dynamicPool.get(weakestSector.symbol) || { score: 0, sources: [] };
                existing.score += 25;
                existing.sources.push('sector_laggard');
                existing.pos52wk = weakestSector.pos52wk;
                dynamicPool.set(weakestSector.symbol, existing);
            }
        }
    }

    // --- Filter non-tradeable from dynamic pool ---
    for (const symbol of dynamicPool.keys()) {
        if (NON_TRADEABLE.has(symbol)) {
            dynamicPool.delete(symbol);
        }
    }

    // --- Assemble final list: reserved static + top dynamic ---
    const dynamicSlots = Math.max(0, SETTINGS.maxSymbols - staticSymbols.length);
    const sortedDynamic = Array.from(dynamicPool.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, dynamicSlots);

    // Build result: static first (score 100, source 'watchlist'), then dynamic
    const result = staticSymbols.map(symbol => ({ symbol, score: 100, sources: ['watchlist'] }));
    for (const [symbol, data] of sortedDynamic) {
        result.push({ symbol, ...data });
    }

    // Attach context to result
    result._context = { themes, intradayBias, swingBias };

    const dynamicCount = sortedDynamic.length;
    console.log(`[Discovery] ${staticSymbols.length} reserved + ${dynamicCount} dynamic = ${result.length} total`);

    return result;
}

// ============================================
// MARKET CONTEXT
// ============================================

async function getMarketContext() {
    // Sequential API calls to avoid overwhelming the Options API
    const sleep100 = () => new Promise(r => setTimeout(r, 100));
    const context = await fetchJSON(`${APIS.options}/api/market/context`, 15000);
    await sleep100();
    const spyLevels = await fetchJSON(`${APIS.options}/api/levels/SPY`, 15000);
    await sleep100();
    const qqqLevels = await fetchJSON(`${APIS.options}/api/levels/QQQ`, 15000);
    await sleep100();
    const outlook = await fetchJSON(`${APIS.intel}/api/market/outlook`);  // Multi-timeframe bias
    await sleep100();
    const spyIv = await fetchJSON(`${APIS.options}/api/options/SPY/iv`, 15000);  // IV rank

    if (!context) return null;

    // Calculate gamma regime from price vs gamma flip level
    // Price above gamma flip = dealers short gamma = BULLISH_SUPPORT (they buy dips)
    // Price below gamma flip = dealers long gamma = BEARISH_RESISTANCE (they sell rallies)
    let gammaRegime = 'NEUTRAL';
    const gammaFlip = spyLevels?.levels?.gamma_flip?.price;
    const spyPrice = context.spy_price;
    if (gammaFlip && spyPrice) {
        const pctFromFlip = ((spyPrice - gammaFlip) / gammaFlip) * 100;
        if (pctFromFlip > 1) {
            gammaRegime = 'BULLISH_SUPPORT';  // Well above gamma flip
        } else if (pctFromFlip > 0.3) {
            gammaRegime = 'BULLISH_TILT';     // Slightly above
        } else if (pctFromFlip < -1) {
            gammaRegime = 'BEARISH_RESISTANCE'; // Well below gamma flip
        } else if (pctFromFlip < -0.3) {
            gammaRegime = 'BEARISH_TILT';     // Slightly below
        } else {
            gammaRegime = 'NEUTRAL';          // Near gamma flip - choppy
        }
    }

    return {
        vix: context.vix,
        vixRegime: context.vix_regime,
        spyTrend: context.spy_trend,
        spyPrice: context.spy_price,
        riskAppetite: context.risk_appetite,
        regime: context.regime,
        positionSizeModifier: context.position_size_modifier,
        spyLevels: spyLevels?.levels ? { ...spyLevels.levels, underlying_price: spyLevels.underlying_price } : null,
        qqqLevels: qqqLevels?.levels ? { ...qqqLevels.levels, underlying_price: qqqLevels.underlying_price } : null,
        // Multi-timeframe bias from AI outlook
        intradayBias: outlook?.data?.intraday_bias || 'NEUTRAL',
        swingBias: outlook?.data?.swing_bias || 'NEUTRAL',
        // Gamma regime calculated from price vs gamma flip
        gammaRegime: gammaRegime,
        // IV rank from options IV endpoint
        ivRank: spyIv?.iv_percentile || 0
    };
}

// ============================================
// RELATIVE STRENGTH (DIVERGENCE SCANNER)
// ============================================

/**
 * Fetch relative strength rankings and rotation regime.
 * Reads directly from the divergence scanner's SQLite DB (instant) for rankings,
 * falls back to API if DB is unavailable. Regime comes from API (lightweight call).
 */
async function fetchRelativeStrength() {
    try {
        // Try direct DB read first (instant, no network latency)
        const rsFromDb = readRsFromDatabase();

        if (rsFromDb) {
            // Regime is not in the DB — fetch from API (small/fast response)
            const divergenceApi = CONFIG.apis.divergence;
            let regime = null;
            if (divergenceApi) {
                regime = await fetchJSON(`${divergenceApi}/api/rotation/regime`, 5000);
            }
            rsFromDb.regime = regime || null;
            return rsFromDb;
        }

        // Fallback: fetch both from API
        return await fetchRsFromApi();
    } catch (e) {
        console.warn(`[RS] Error fetching divergence data: ${e.message}`);
        return null;
    }
}

/**
 * Read RS rankings directly from the divergence scanner's SQLite database.
 * Returns null if DB doesn't exist or has no data.
 */
function readRsFromDatabase() {
    const DB_PATH = path.join(__dirname, '..', '..', 'divergence-scanner', 'data', 'divergence_scanner.db');

    try {
        if (!fs.existsSync(DB_PATH)) return null;

        const Database = require('better-sqlite3');
        const rsDb = Database(DB_PATH, { readonly: true, fileMustExist: true });

        // Get the latest complete snapshot batch (all symbols within same second)
        const latestBatch = rsDb.prepare(`
            SELECT SUBSTR(snapshot_at, 1, 19) as batch
            FROM rs_snapshots
            GROUP BY batch
            HAVING COUNT(*) >= 10
            ORDER BY batch DESC
            LIMIT 1
        `).get();

        if (!latestBatch) {
            rsDb.close();
            return null;
        }

        const rows = rsDb.prepare(`
            SELECT symbol, rs_score, rs_rank, performance_1d, performance_5d,
                   performance_20d, performance_60d, snapshot_at
            FROM rs_snapshots
            WHERE SUBSTR(snapshot_at, 1, 19) = ?
            ORDER BY rs_rank
        `).all(latestBatch.batch);

        rsDb.close();

        if (rows.length === 0) return null;

        // Build percentile map from rank
        const total = rows.length;
        const percentileMap = {};
        for (const row of rows) {
            percentileMap[row.symbol] = ((total - row.rs_rank + 1) / total) * 100;
        }

        const snapshotAge = Math.round((Date.now() - new Date(rows[0].snapshot_at).getTime()) / 60000);
        console.log(`[RS] Read ${total} rankings from DB (snapshot ${snapshotAge}m ago)`);

        return {
            percentileMap,
            regime: null, // filled in by caller
            assetCount: total
        };
    } catch (e) {
        console.warn(`[RS] DB read failed: ${e.message} — falling back to API`);
        return null;
    }
}

/**
 * Fallback: fetch RS data from the divergence scanner API.
 */
async function fetchRsFromApi() {
    const divergenceApi = CONFIG.apis.divergence;
    if (!divergenceApi) return null;

    const [rankings, regime] = await Promise.all([
        fetchJSON(`${divergenceApi}/api/relative-strength/rankings`, 15000),
        fetchJSON(`${divergenceApi}/api/rotation/regime`, 5000)
    ]);

    if (!rankings) {
        console.log('[RS] Divergence scanner unavailable — skipping RS scoring');
        return null;
    }

    const assets = rankings.rankings || rankings.assets || rankings;
    if (!Array.isArray(assets) || assets.length === 0) {
        console.log('[RS] No ranking data received');
        return null;
    }

    const total = assets.length;
    const percentileMap = {};
    for (const asset of assets) {
        const symbol = asset.symbol || asset.ticker;
        if (symbol) {
            percentileMap[symbol] = asset.rs_percentile != null
                ? asset.rs_percentile
                : ((total - (asset.rs_rank || 0)) / total) * 100;
        }
    }

    console.log(`[RS] Loaded ${total} asset rankings from API`);
    return { percentileMap, regime: regime || null, assetCount: total };
}

/**
 * Get RS percentile for a symbol by looking up its sector ETF in the rankings.
 * Returns { percentile, sectorEtf } or null if no mapping/data.
 */
function getSymbolRsPercentile(symbol, rsData) {
    if (!rsData || !rsData.percentileMap) return null;

    // Direct match first (for ETFs like XLK, XLE, IBIT, etc.)
    if (rsData.percentileMap[symbol] != null) {
        return { percentile: rsData.percentileMap[symbol], sectorEtf: symbol };
    }

    // Look up sector ETF via SECTOR_MAP
    const sectorEtf = SECTOR_MAP[symbol];
    if (!sectorEtf) return null;

    const percentile = rsData.percentileMap[sectorEtf];
    if (percentile == null) return null;

    return { percentile, sectorEtf };
}

// ============================================
// SYMBOL ANALYSIS
// ============================================

async function analyzeSymbol(symbol, discoveryData) {
    // Sequential API calls to avoid overwhelming the Options API
    const levels = await fetchJSON(`${APIS.options}/api/levels/${symbol}`, 15000);
    if (!levels) return null; // Can't analyze without levels

    await new Promise(r => setTimeout(r, 100));
    const technicals = await fetchJSON(`${APIS.options}/api/technicals/${symbol}`, 15000);
    if (!technicals) return null; // Can't analyze without technicals

    await new Promise(r => setTimeout(r, 100));
    const optionsAnalysis = await fetchJSON(`${APIS.options}/api/options/${symbol}/analysis`, 15000);

    const price = levels.underlying_price || technicals.current;
    if (!price) return null;

    // ============================================
    // DATA-DRIVEN CONFLUENCE SCORING (0-100)
    // Based on backtest of 179 signals:
    // - AT_WALL + EXTENDED_RSI = 89.5% win rate
    // - ELEVATED_VOLUME = 76.9% win rate
    // - VIX_ELEVATED = 66.7% win rate
    // ============================================

    const scores = {
        base: 0,       // AT_WALL + EXTENDED_RSI (0-50 with combo)
        highEdge: 0,   // Volume + VIX factors (0-35)
        standard: 0    // BB, trend, flow, confluence (0-25)
    };

    const signals = [];
    let direction = 'neutral';

    // Track key conditions for combo detection
    let atWallCondition = false;
    let extendedRsiCondition = false;

    // --- BASE CONDITION: EXTENDED RSI (15 pts) ---
    const rsi = technicals.rsi || 50;
    const trend = technicals.trend || 'neutral';
    const bbPosition = technicals.bb_position || 0.5;

    // Check for extended RSI (oversold/overbought) - 89.5% win rate when combined with wall
    if (rsi <= SETTINGS.RSI_OVERSOLD) {
        scores.base += 15;
        extendedRsiCondition = true;
        signals.push(`RSI oversold (${rsi.toFixed(1)})`);
        direction = 'bullish';
    } else if (rsi >= SETTINGS.RSI_OVERBOUGHT) {
        scores.base += 15;
        extendedRsiCondition = true;
        signals.push(`RSI overbought (${rsi.toFixed(1)})`);
        direction = 'bearish';
    } else if (rsi <= 40 && trend === 'uptrend') {
        scores.standard += 5;
        signals.push(`RSI pullback in uptrend (${rsi.toFixed(1)})`);
        direction = 'bullish';
    } else if (rsi >= 60 && trend === 'downtrend') {
        scores.standard += 5;
        signals.push(`RSI bounce in downtrend (${rsi.toFixed(1)})`);
        direction = 'bearish';
    }

    // --- STANDARD FACTOR: Bollinger Bands (5 pts) ---
    if (bbPosition <= 0.1) {
        scores.standard += 5;
        signals.push('At lower Bollinger Band');
        direction = direction || 'bullish';
    } else if (bbPosition >= 0.9) {
        scores.standard += 5;
        signals.push('At upper Bollinger Band');
        direction = direction || 'bearish';
    }

    // --- FIBONACCI SCORE (bonus points) ---
    // Calculate Fib levels from recent swing high/low
    const swingHigh = technicals.recent_high;
    const swingLow = technicals.recent_low;
    const fibLevels = calculateFibLevels(swingLow, swingHigh);
    let fibSignal = null;
    let fibMAConfluence = null;

    if (fibLevels) {
        // Check if price is at a Fib level (1.5% threshold)
        fibSignal = checkFibProximity(price, fibLevels, 1.5);

        if (fibSignal) {
            if (fibSignal.isGoldenPocket) {
                // Golden Pocket (0.618) - deeper pullback entry in Golden Zone
                scores.standard += 5;
                signals.push(`📐 At Golden Pocket (0.618 @ $${fibSignal.price.toFixed(2)})`);
                if (direction === 'neutral') direction = 'bullish'; // Fib support = bullish bias

                // Check for MA confluence at Golden Pocket
                fibMAConfluence = checkFibMAConfluence(fibSignal.price, technicals, 1.5);
                if (fibMAConfluence) {
                    scores.standard += 3;
                    signals.push(`📐 Golden Pocket + ${fibMAConfluence.ma} confluence`);
                }
            } else if (fibSignal.type === 'retracement' && fibSignal.level === 0.5) {
                // 50% retracement - first entry in Golden Zone (strong trends)
                scores.standard += 4;
                signals.push(`📐 At 50% Fib ($${fibSignal.price.toFixed(2)})`);
                if (direction === 'neutral') direction = 'bullish';

                // Check for MA confluence at 50%
                fibMAConfluence = checkFibMAConfluence(fibSignal.price, technicals, 1.5);
                if (fibMAConfluence) {
                    scores.standard += 3;
                    signals.push(`📐 50% Fib + ${fibMAConfluence.ma} confluence`);
                }
            } else if (fibSignal.type === 'extension' && fibSignal.level === 1.272) {
                // 1.272 extension - first profit target
                scores.standard += 3;
                signals.push(`🎯 At 1.272 extension ($${fibSignal.price.toFixed(2)}) - TP1`);
                if (direction === 'neutral') direction = 'bearish'; // Extension = potential reversal
            } else if (fibSignal.type === 'extension' && fibSignal.level === 1.618) {
                // 1.618 extension - extended profit target
                scores.standard += 3;
                signals.push(`🎯 At 1.618 extension ($${fibSignal.price.toFixed(2)}) - TP2`);
                if (direction === 'neutral') direction = 'bearish'; // Extension = potential reversal
            }
            // Only track: 0.5, 0.618 (Golden Zone entries) + 1.272, 1.618 (profit targets)
        }
    }

    // --- BASE CONDITION: AT WALL (15 pts) + COMBO BONUS ---
    const callWall = levels.levels?.call_wall?.price;
    const putWall = levels.levels?.put_wall?.price;
    const maxPain = levels.levels?.max_pain?.price;
    const gammaFlip = levels.levels?.gamma_flip?.price;
    const vwap = levels.levels?.vwap;

    // Distance calculations
    const distToCallWall = callWall ? ((callWall - price) / price * 100) : null;
    const distToPutWall = putWall ? ((price - putWall) / price * 100) : null;
    const distToVwap = vwap ? ((price - vwap) / price * 100) : null;

    // Using data-driven threshold (1% = at wall)
    const wallThresholdPct = SETTINGS.WALL_THRESHOLD_PCT;
    const atPutWall = distToPutWall !== null && Math.abs(distToPutWall) <= wallThresholdPct;
    const atCallWall = distToCallWall !== null && Math.abs(distToCallWall) <= wallThresholdPct;
    const isPinned = atPutWall && atCallWall;

    // Check for extended scenarios (breakouts/breakdowns)
    const aboveCallWall = distToCallWall !== null && distToCallWall < -0.3; // Price above call wall
    const belowPutWall = distToPutWall !== null && distToPutWall < -0.3; // Price below put wall

    if (isPinned) {
        // Pinned between walls - both at support and resistance
        scores.base += 15;
        atWallCondition = true;
        signals.push(`📍 PINNED between walls ($${putWall}-$${callWall})`);
        direction = 'pinned';
    } else if (aboveCallWall) {
        // Breakout above call wall - already moved, less actionable
        scores.standard += 8;
        const distAbove = Math.abs(distToCallWall).toFixed(1);
        signals.push(`🚀 BREAKOUT above call wall ($${callWall}) +${distAbove}%`);
        direction = 'bullish';
        if (gammaFlip && price > gammaFlip) {
            scores.standard += 4;
            signals.push(`Above gamma flip ($${gammaFlip.toFixed(2)})`);
        }
    } else if (belowPutWall) {
        // Breakdown below put wall - already moved, less actionable
        scores.standard += 8;
        const distBelow = Math.abs(distToPutWall).toFixed(1);
        signals.push(`💥 BREAKDOWN below put wall ($${putWall}) -${distBelow}%`);
        direction = 'bearish';
        if (gammaFlip && price < gammaFlip) {
            scores.standard += 4;
            signals.push(`Below gamma flip ($${gammaFlip.toFixed(2)})`);
        }
    } else {
        // AT WALL - This is the key condition (89.5% win rate when combined with extended RSI)
        if (atPutWall) {
            scores.base += 15;
            atWallCondition = true;
            signals.push(`At put wall support ($${putWall})`);
            if (direction === 'neutral') direction = 'bullish';
        }
        if (atCallWall) {
            scores.base += 15;
            atWallCondition = true;
            signals.push(`At call wall resistance ($${callWall})`);
            if (direction === 'neutral') direction = 'bearish';
        }
    }

    // === COMBO BONUS: AT_WALL + EXTENDED_RSI (89.5% historical win rate) ===
    if (atWallCondition && extendedRsiCondition) {
        scores.base += 20;
        signals.unshift('⭐ PRIME SETUP: Wall + Extended RSI');
    }

    // --- STANDARD FACTORS: VWAP, Confluence ---
    if (distToVwap !== null && Math.abs(distToVwap) <= 0.3) {
        scores.standard += 5;
        signals.push(`At VWAP ($${vwap})`);
    }

    // Fib + Wall Confluence
    if (fibLevels && (callWall || putWall)) {
        const fibWallAlignments = checkFibWallConfluence(fibLevels, callWall, putWall, 1.5);
        if (fibWallAlignments) {
            for (const alignment of fibWallAlignments) {
                scores.standard += 3;
                if (alignment.type === 'resistance') {
                    signals.push(`🎯 ${alignment.fibLevel} Fib ($${alignment.fibPrice.toFixed(0)}) = Call Wall ($${alignment.wallPrice})`);
                } else {
                    signals.push(`🎯 ${alignment.fibLevel} Fib ($${alignment.fibPrice.toFixed(0)}) = Put Wall ($${alignment.wallPrice})`);
                }
            }
        }
    }

    // Confluence zones from API
    if (levels.confluence_zones?.length > 0) {
        const nearbyZone = levels.confluence_zones.find(z =>
            Math.abs(z.distance_pct) <= 0.5 && z.count >= 2
        );
        if (nearbyZone) {
            scores.standard += 5;
            signals.push(`Confluence zone (${nearbyZone.count} levels)`);
        }
    }

    // --- WALL ACTIVITY CHECK ---
    let wallActivity = null;
    const atWall = atPutWall || atCallWall;

    if (atWall) {
        const wallType = atPutWall ? 'put' : 'call';
        const wallPrice = atPutWall ? putWall : callWall;

        if (wallPrice) {
            const wallExpiration = levels.levels?.max_pain?.expiration;
            const totalChainVolume = optionsAnalysis?.analysis?.total_volume || 0;

            wallActivity = classifyWallActivity(
                optionsAnalysis, wallPrice, wallType, wallExpiration, totalChainVolume
            );

            // Only penalize DORMANT - don't reward ACTIVE (can't verify direction)
            if (wallActivity.status === 'DORMANT') {
                scores.standard -= 3;
                signals.push(`⚠️ ${wallType.toUpperCase()} wall dormant (stale OI)`);
            } else if (wallActivity.status === 'ACTIVE') {
                // Log for visibility but no score change - activity doesn't tell us direction
                signals.push(`${wallType.toUpperCase()} wall ACTIVE (${wallActivity.volOiRatio.toFixed(1)}x vol/OI)`);
            } else if (wallActivity.status === 'ENGAGED') {
                signals.push(`${wallType.toUpperCase()} wall engaged (${wallActivity.volOiRatio.toFixed(1)}x vol/OI)`);
            }
            // UNKNOWN: No action (illiquid symbol)
        }
    }

    // --- HIGH-EDGE FACTOR: ELEVATED VOLUME (76.9% win rate) ---
    const volRatio = discoveryData?.volRatio || technicals.volume_ratio || 1;

    if (volRatio >= 2) {
        scores.highEdge += 20;
        signals.push(`Volume spike (${volRatio.toFixed(1)}x avg)`);
    } else if (volRatio >= SETTINGS.VOLUME_ELEVATED) {
        scores.highEdge += 15;
        signals.push(`Elevated volume (${volRatio.toFixed(1)}x avg)`);
    }

    // --- OPTIONS FLOW SCORE (0-25) ---
    let unusualOption = null;  // Structured data for option signal tracking

    if (optionsAnalysis?.analysis) {
        const opts = optionsAnalysis.analysis;

        // Check for unusual options activity
        const unusualCalls = opts.unusual_calls || [];
        const unusualPuts = opts.unusual_puts || [];

        // Filter out illiquid strikes (noise) - only consider strikes with meaningful OI
        const MIN_OI_THRESHOLD = 50;
        const liquidCalls = unusualCalls.filter(c => (c.open_interest || 0) >= MIN_OI_THRESHOLD);
        const liquidPuts = unusualPuts.filter(p => (p.open_interest || 0) >= MIN_OI_THRESHOLD);

        // Find the option with max vol/OI ratio from LIQUID strikes only
        const topCall = liquidCalls.reduce((max, c) =>
            (c.vol_oi_ratio || 0) > (max?.vol_oi_ratio || 0) ? c : max, null);
        const topPut = liquidPuts.reduce((max, p) =>
            (p.vol_oi_ratio || 0) > (max?.vol_oi_ratio || 0) ? p : max, null);
        const maxCallVolOI = topCall?.vol_oi_ratio || 0;
        const maxPutVolOI = topPut?.vol_oi_ratio || 0;

        // Helper: Calculate DTE from expiration string (e.g., "2026-01-16")
        const getDTE = (expiration) => {
            if (!expiration) return null;
            const expDate = new Date(expiration + 'T16:00:00-05:00'); // 4PM ET
            const now = new Date();
            return Math.max(0, Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)));
        };

        // Score based on unusual activity
        if (maxCallVolOI >= 5 || maxPutVolOI >= 5) {
            scores.highEdge += 10;
            if (maxCallVolOI > maxPutVolOI) {
                const exp = topCall.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topCall.premium || 0) / 1000000).toFixed(1);
                signals.push(`🔥 Unusual CALL $${topCall.strike} ${exp} (${maxCallVolOI.toFixed(1)}x, $${prem}M)`);
                if (direction === 'neutral') direction = 'bullish';

                // Capture structured option data for signal tracking
                const callDTE = getDTE(topCall.expiration);
                const expFmt = (topCall.expiration || '').replace(/-/g, '').slice(2);
                unusualOption = {
                    contract: `.${symbol}${expFmt}C${topCall.strike}`,
                    type: 'CALL',
                    strike: topCall.strike,
                    expiration: topCall.expiration,
                    dte: callDTE,
                    vol_oi: maxCallVolOI,
                    premium_flow: topCall.premium || 0
                };
            } else {
                // Context-aware PUT interpretation based on research:
                // - ITM puts (strike > spot) = bearish conviction (paying intrinsic value)
                // - ATM puts (within 0.5% of spot) = directional bet, treat as bearish
                // - OTM puts (strike < spot by >0.5%) = protective hedge, "charm bid" (supportive)
                // - 0DTE ITM/ATM = often expiration mechanics, less directional signal
                const exp = topPut.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topPut.premium || 0) / 1000000).toFixed(1);
                const strike = topPut.strike;
                const dte = getDTE(topPut.expiration);

                // Moneyness calculation
                const distFromSpot = (strike - price) / price * 100;  // positive = ITM, negative = OTM
                const isITM = distFromSpot > 0.5;   // Strike > spot by more than 0.5%
                const isATM = Math.abs(distFromSpot) <= 0.5;  // Within 0.5% of spot
                const isOTM = distFromSpot < -0.5;  // Strike < spot by more than 0.5%

                if ((isITM || isATM) && dte === 0) {
                    // 0DTE ITM/ATM = expiration mechanics (exercise, closing, gamma hedge)
                    signals.push(`🔥 Unusual PUT $${strike} 0DTE (expiration activity, ${maxPutVolOI.toFixed(1)}x, $${prem}M)`);
                    // Don't change direction - this is expiration noise
                } else if (isITM) {
                    // ITM with DTE = bearish conviction (someone paying intrinsic value)
                    signals.push(`🔥 Unusual PUT $${strike} ITM (bearish, ${maxPutVolOI.toFixed(1)}x, $${prem}M)`);
                    if (direction === 'neutral') direction = 'bearish';
                } else if (isATM) {
                    // ATM puts = directional bet at current price level
                    signals.push(`🔥 Unusual PUT $${strike} ATM (bearish, ${maxPutVolOI.toFixed(1)}x, $${prem}M)`);
                    if (direction === 'neutral') direction = 'bearish';
                } else {
                    // OTM puts = protective hedge, creates "charm bid" (supportive, not bearish)
                    signals.push(`🔥 Unusual PUT $${strike} OTM (hedge, ${maxPutVolOI.toFixed(1)}x, $${prem}M)`);
                    // OTM puts are hedges - don't flag as bearish
                }

                // Capture structured option data for signal tracking (all PUT cases)
                const expFmt = (topPut.expiration || '').replace(/-/g, '').slice(2);
                unusualOption = {
                    contract: `.${symbol}${expFmt}P${strike}`,
                    type: 'PUT',
                    strike: strike,
                    expiration: topPut.expiration,
                    dte: dte,
                    vol_oi: maxPutVolOI,
                    premium_flow: topPut.premium || 0
                };
            }
        } else if (maxCallVolOI >= 2 || maxPutVolOI >= 2) {
            scores.standard += 5;
            if (maxCallVolOI > maxPutVolOI) {
                const exp = topCall.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topCall.premium || 0) / 1000000).toFixed(1);
                signals.push(`Elevated call $${topCall.strike} ${exp} (${maxCallVolOI.toFixed(1)}x, $${prem}M)`);
            } else {
                const exp = topPut.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topPut.premium || 0) / 1000000).toFixed(1);
                signals.push(`Elevated put $${topPut.strike} ${exp} (${maxPutVolOI.toFixed(1)}x, $${prem}M)`);
            }
        }

        // Net premium direction
        const netPremium = opts.net_premium || 0;
        const cpRatio = opts.call_put_ratio || 1;

        if (Math.abs(netPremium) >= 10000000) { // $10M+ net premium
            scores.standard += 5;
            const premDir = netPremium > 0 ? 'bullish' : 'bearish';
            signals.push(`$${(Math.abs(netPremium) / 1000000).toFixed(0)}M net ${premDir} premium`);

            // Alignment bonus (flow aligned with direction)
            if ((netPremium > 0 && direction === 'bullish') ||
                (netPremium < 0 && direction === 'bearish')) {
                scores.standard += 5;
            }
        }

        // Call/Put ratio extremes
        if (cpRatio >= 2) {
            signals.push(`Heavy call bias (${cpRatio.toFixed(2)} C/P)`);
        } else if (cpRatio <= 0.5) {
            signals.push(`Heavy put bias (${cpRatio.toFixed(2)} C/P)`);
        }
    }

    // --- STANDARD FACTOR: Discovery source bonus ---
    if (discoveryData) {
        // Bonus for AI outlook mentions
        if (discoveryData.sources?.includes('ai_outlook')) {
            scores.standard += 5;
            signals.push(`📌 AI Outlook highlight`);
        }
    }

    // --- CONTEXT & VIX SCORING ---
    if (marketContext) {
        const spyTrend = marketContext.spyTrend;
        const vix = marketContext.vix || 0;

        // Skip SPY trend comparison for index ETFs (SPY can't be counter-trend to itself)
        const isIndexETF = symbol === 'SPY' || symbol === 'QQQ';

        if (isIndexETF) {
            signals.push(`Market: VIX ${vix.toFixed(1)}`);
        }
        else if (direction === 'pinned') {
            signals.push(`Market: SPY ${spyTrend}, VIX ${vix.toFixed(1)}`);
        }
        // Aligned with market
        else if ((direction === 'bullish' && spyTrend === 'bullish') ||
            (direction === 'bearish' && spyTrend === 'bearish')) {
            scores.standard += 5;
            signals.push(`Aligned with SPY ${spyTrend}`);
        }
        // Against market (note it, but data shows counter-trend can work)
        else if (direction !== 'neutral' && spyTrend && direction !== spyTrend) {
            signals.push(`⚠️ Against SPY ${spyTrend}`);
            // BACKTEST: Counter-trend bullish in bearish SPY = 63.6% win rate
            // So we don't heavily penalize counter-trend anymore
            if (direction === 'bearish' && spyTrend === 'bullish') {
                direction = 'pinned';
                signals.push(`📍 Downgraded to PINNED (counter-trend)`);
            }
        }

        // --- HIGH-EDGE FACTOR: VIX ELEVATED/FEAR (66.7% win rate) ---
        if (vix >= SETTINGS.VIX_FEAR) {
            scores.highEdge += 15;
            signals.push(`🔥 VIX fear (${vix.toFixed(1)}) - quality entries`);
        } else if (vix >= SETTINGS.VIX_ELEVATED) {
            scores.highEdge += 10;
            signals.push(`VIX elevated (${vix.toFixed(1)})`);
        }

        // --- STANDARD FACTOR: Multi-timeframe alignment ---
        if (marketContext.intradayBias && marketContext.swingBias) {
            const swingBias = marketContext.swingBias.toLowerCase();
            const intradayBias = marketContext.intradayBias.toLowerCase();

            const setupAligned = (direction === 'bullish' && swingBias === 'bullish') ||
                                 (direction === 'bearish' && swingBias === 'bearish');
            const tfAligned = swingBias === intradayBias;

            if (setupAligned && tfAligned) {
                scores.standard += 5;
                signals.push(`✅ TF aligned: both ${marketContext.swingBias}`);
            } else if (setupAligned && !tfAligned) {
                scores.standard += 3;
                signals.push(`Swing ${marketContext.swingBias}, intraday ${marketContext.intradayBias}`);
            }
            // Don't penalize counter-trend as heavily - data shows it can work
        }
    }

    // --- STANDARD FACTOR: Sector Relative Strength (±8 pts) ---
    let symbolRsData = null;
    if (rsContext) {
        symbolRsData = getSymbolRsPercentile(symbol, rsContext);
        if (symbolRsData) {
            const pct = symbolRsData.percentile;
            if (pct >= 75) {
                scores.standard += 8;
                signals.push(`Strong sector RS (${symbolRsData.sectorEtf} top quartile)`);
            } else if (pct >= 50) {
                scores.standard += 4;
                signals.push(`Above-avg sector RS (${symbolRsData.sectorEtf})`);
            } else if (pct >= 25) {
                scores.standard -= 3;
                signals.push(`Weak sector RS (${symbolRsData.sectorEtf})`);
            } else {
                scores.standard -= 5;
                signals.push(`⚠️ Sector headwind (${symbolRsData.sectorEtf} bottom quartile)`);
            }
        }
    }

    // ============================================
    // FINAL SCORE (0-100 scale, data-driven)
    // Base: AT_WALL + EXTENDED_RSI + combo (0-50)
    // HighEdge: Volume + VIX (0-35)
    // Standard: BB, trend, flow, confluence (0-25+RS)
    // ============================================

    const totalScore = Math.max(0, Math.min(100,
        scores.base + scores.highEdge + scores.standard
    ));

    // Track if this is a "prime setup" for tier determination
    const isPrimeSetup = atWallCondition && extendedRsiCondition;

    // ============================================
    // ZONE CLASSIFICATION (for zone-scanner UI)
    // ============================================

    let zone = 'MID_RANGE';
    let tradeable = false;
    let action = null;
    let tier = 'FILTERED';

    // Near wall checks (2% for watch zone)
    const watchThreshold = 2.0;
    const watchNearPutWall = distToPutWall !== null && Math.abs(distToPutWall) <= watchThreshold;
    const watchNearCallWall = distToCallWall !== null && Math.abs(distToCallWall) <= watchThreshold;

    // Step 1: Determine BASE ZONE
    if (rsi >= SETTINGS.RSI_OVERBOUGHT) {
        zone = 'HIGH_MOMENTUM';
    } else if (rsi <= SETTINGS.RSI_OVERSOLD) {
        zone = 'LOW_MOMENTUM';
        if (atPutWall) {
            zone = 'BUY_ZONE';
            action = 'BUY';
        }
    } else if (aboveCallWall) {
        zone = 'EXTENDED_HIGH';
    } else if (belowPutWall) {
        zone = 'EXTENDED_LOW';
    } else if (isPinned) {
        zone = 'PINNED';
    } else if (atPutWall) {
        zone = 'BUY_ZONE';
        action = 'BUY';
    } else if (atCallWall) {
        zone = 'SELL_ZONE';
        action = 'SELL';
    }

    // Extended high = reversal watch, not bullish continuation
    if (zone === 'EXTENDED_HIGH' && direction === 'bullish') {
        direction = 'pinned';
        signals.push(`📍 Extended high - reversal watch`);
    }

    // ============================================
    // DATA-DRIVEN TIER ASSIGNMENT
    // Based on 179 signal backtest:
    // - PRIME SETUP (AT_WALL + EXTENDED_RSI) = 89.5% win rate
    // - Score 50+ with prime setup = HIGH_CONVICTION
    // - Score 50+ without prime = TRADEABLE
    // - Score 35-49 = WATCH
    // - Score <35 = FILTERED
    // ============================================

    // Exclude historically bad zones from tradeable tiers
    const badZones = ['EXTENDED_HIGH', 'HIGH_MOMENTUM'];
    const notBadZone = !badZones.includes(zone);

    // HIGH_CONVICTION: Prime setup (AT_WALL + EXTENDED_RSI) with good score
    // OR very high score (65+) with action
    if (isPrimeSetup && totalScore >= 40 && notBadZone) {
        tradeable = true;
        tier = 'HIGH_CONVICTION';
    }
    // HIGH_CONVICTION: Very high score at wall (multiple high-edge factors)
    else if (totalScore >= SETTINGS.TIER_HIGH_CONVICTION && atWallCondition && action && notBadZone) {
        tradeable = true;
        tier = 'HIGH_CONVICTION';
    }
    // TRADEABLE: Good score at wall
    else if (totalScore >= SETTINGS.TIER_TRADEABLE && atWallCondition && action && notBadZone) {
        tradeable = true;
        tier = 'TRADEABLE';
    }
    // WATCH: Moderate score near wall or waiting for setup
    else if (totalScore >= SETTINGS.TIER_WATCH && (watchNearPutWall || watchNearCallWall)) {
        tier = 'WATCH';
    }
    // WATCH: Extended low with oversold RSI (potential reversal)
    else if (zone === 'EXTENDED_LOW' && extendedRsiCondition && totalScore >= SETTINGS.TIER_WATCH) {
        tier = 'WATCH';
        action = 'WATCH_REVERSAL';
    }
    // WATCH: High score in mid-range (waiting for level)
    else if (zone === 'MID_RANGE' && totalScore >= SETTINGS.TIER_TRADEABLE) {
        tier = 'WATCH';
        action = 'WATCH_LEVEL';
    }
    // WATCH: Pinned with good score (waiting for direction)
    else if (zone === 'PINNED' && totalScore >= SETTINGS.TIER_TRADEABLE) {
        tier = 'WATCH';
        action = 'WATCH_BREAKOUT';
    }

    // Calculate distances for output
    const distances = {
        toPutWall: distToPutWall,
        toCallWall: distToCallWall,
        rangeSize: callWall && putWall ? ((callWall - putWall) / price * 100) : 0,
        positionInRange: callWall && putWall && callWall !== putWall
            ? (price - putWall) / (callWall - putWall)
            : null
    };

    // ============================================
    // STRATEGY TRIGGERS (Pattern Detection)
    // ============================================

    // Strategy #1: Smart Money Dip Buy
    // When RSI low momentum + unusual CALL activity + at put wall support = smart money buying the dip
    const hasRsiLowMomentum = signals.some(s => s.includes('RSI low momentum'));
    const hasUnusualCall = signals.some(s => s.includes('Unusual CALL'));
    const hasAtPutWall = signals.some(s => s.includes('put wall support'));

    if (hasRsiLowMomentum && hasUnusualCall && hasAtPutWall) {
        signals.unshift('🎯 TRIGGER: Smart Money Dip Buy');
    }

    return {
        symbol,
        price,
        direction,
        totalScore,
        scores,
        signals,
        // Zone data for zone-scanner UI
        zone,
        tradeable,
        tier,  // NEW: HIGH_CONVICTION, TRADEABLE, WATCH, or FILTERED
        action,
        levels: {
            callWall,
            putWall,
            maxPain,
            vwap,
            gammaFlip
        },
        distances,
        technicals: {
            rsi,
            trend,
            bbPosition,
            momentum5d: technicals.momentum_5d,
            momentum20d: technicals.momentum_20d,
            volumeSignal: technicals.volume_signal
        },
        fibonacci: fibLevels ? {
            swingHigh,
            swingLow,
            range: fibLevels.range,
            retracements: fibLevels.retracements,
            extensions: fibLevels.extensions,
            atLevel: fibSignal ? {
                type: fibSignal.type,
                level: fibSignal.level,
                price: fibSignal.price,
                isGoldenPocket: fibSignal.isGoldenPocket || false
            } : null,
            maConfluence: fibMAConfluence ? {
                ma: fibMAConfluence.ma,
                maPrice: fibMAConfluence.maPrice
            } : null
        } : null,
        context: {
            spyTrend: marketContext?.spyTrend,
            vixRegime: marketContext?.vixRegime,
            vix: marketContext?.vix,
            intradayBias: marketContext?.intradayBias,
            swingBias: marketContext?.swingBias
        },
        // Wall activity data for filtering/display
        atWall,
        wallActivity: wallActivity?.status || null,
        wallVolOiRatio: wallActivity?.volOiRatio || null,
        // Top unusual option contract (for option signal tracking)
        unusualOption,
        // Sector relative strength
        sectorRs: symbolRsData
    };
}

// ============================================
// ALERT GENERATION
// ============================================

function shouldAlert(analysis) {
    if (!analysis) return false;
    if (analysis.totalScore < SETTINGS.minConfluenceScore) return false;

    // Check cooldown
    const lastAlert = alertCooldowns.get(analysis.symbol);
    if (lastAlert && Date.now() - lastAlert < SETTINGS.alertCooldownMs) {
        return false;
    }

    return true;
}

/**
 * Check if setup direction aligns with higher timeframe bias
 * Used for tier filtering - HIGH CONVICTION requires alignment
 */
function isTimeframeAligned(analysis, ctx) {
    // If no swing bias available, don't filter
    if (!ctx?.swingBias || ctx.swingBias === 'NEUTRAL') return true;

    const swing = ctx.swingBias.toLowerCase();

    // Pinned and neutral setups are always allowed (no directional conflict)
    if (analysis.direction === 'pinned' || analysis.direction === 'neutral') {
        return true;
    }

    // Bullish setup must align with bullish swing, bearish with bearish
    return analysis.direction === swing;
}

/**
 * Determine alert tier and collect warning annotations.
 * Preserves the tier earned during zone classification — never downgrades.
 * Returns { tier: string, warnings: string[] }
 */
function getAlertTier(analysis, ctx) {
    let tier = analysis.tier || 'FILTERED';
    if (tier === 'FILTERED') return { tier: 'FILTERED', warnings: [] };

    // Collect warnings (informational only — tier is never downgraded)
    const warnings = [];

    if (!isTimeframeAligned(analysis, ctx)) {
        const swingDir = (ctx?.swingBias || 'UNKNOWN').toUpperCase();
        warnings.push(`Counter-trend (swing: ${swingDir})`);
    }

    if (analysis.atWall && analysis.wallActivity === 'DORMANT') {
        warnings.push('Dormant wall');
    }

    return { tier, warnings };
}

function formatAlert(analysis) {
    const dirEmoji = analysis.direction === 'bullish' ? '🟢' :
                     analysis.direction === 'bearish' ? '🔴' :
                     analysis.direction === 'pinned' ? '📍' : '⚪';

    const scoreEmoji = analysis.totalScore >= 60 ? '🔥' :
                       analysis.totalScore >= 50 ? '⭐' : '📊';

    const timeStr = formatTimePST();

    let msg = `${scoreEmoji} <b>BLOODHOUND: ${escapeHtml(analysis.symbol)}</b> ${dirEmoji}\n`;
    msg += `<code>${timeStr} PST</code>\n\n`;
    msg += `<b>Confluence Score:</b> ${analysis.totalScore}/100\n`;
    msg += `<b>Direction:</b> ${analysis.direction.toUpperCase()}\n`;
    msg += `<b>Price:</b> $${analysis.price.toFixed(2)}\n\n`;

    msg += `<b>Signals:</b>\n`;
    analysis.signals.forEach(s => {
        msg += `• ${escapeHtml(s)}\n`;
    });

    msg += `\n<b>Key Levels:</b>\n`;
    if (analysis.levels.putWall) msg += `• Put Wall: $${analysis.levels.putWall}\n`;
    if (analysis.levels.callWall) msg += `• Call Wall: $${analysis.levels.callWall}\n`;
    if (analysis.levels.maxPain) msg += `• Max Pain: $${analysis.levels.maxPain}\n`;

    msg += `\n<b>Context:</b>\n`;
    msg += `• SPY: ${analysis.context.spyTrend || 'unknown'}\n`;
    msg += `• VIX: ${analysis.context.vix || '?'} (${analysis.context.vixRegime || '?'})\n`;

    if (analysis.alertWarnings && analysis.alertWarnings.length > 0) {
        msg += `\n<b>Note:</b>\n`;
        analysis.alertWarnings.forEach(w => {
            msg += `• ⚠️ ${escapeHtml(w)}\n`;
        });
    }

    msg += `\n<i>Review chart before trading</i>`;

    return msg;
}

// ============================================
// PAUSE CONTROL
// ============================================

const PAUSE_FILE = path.join(__dirname, '..', 'data', '.bloodhound_paused');
const CONTROL_PORT = 8081;

// Scanner state for control API
const scannerState = {
    startedAt: new Date().toISOString(),
    lastScanAt: null,
    lastScanDuration: null,
    nextScanAt: null,
    scanCount: 0,
    isScanning: false,
    previousVixRegime: null  // Track for regime change alerts
};

function isPaused() {
    return fs.existsSync(PAUSE_FILE);
}

function setPaused(paused) {
    if (paused) {
        fs.writeFileSync(PAUSE_FILE, new Date().toISOString());
    } else if (fs.existsSync(PAUSE_FILE)) {
        fs.unlinkSync(PAUSE_FILE);
    }
}

// Queue for manual scan requests
let manualScanRequested = false;

// ============================================
// HTTP CONTROL API (for web interface)
// ============================================

function startControlServer() {
    const server = http.createServer((req, res) => {
        // Enable CORS for web interface
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = req.url;

        // GET /status - Full scanner status
        if (req.method === 'GET' && url === '/status') {
            const paused = isPaused();
            let pausedAt = null;
            if (paused) {
                try {
                    pausedAt = fs.readFileSync(PAUSE_FILE, 'utf8');
                } catch (e) {}
            }

            // Calculate uptime
            const uptimeMs = Date.now() - new Date(scannerState.startedAt).getTime();
            const uptimeMin = Math.floor(uptimeMs / 60000);
            const uptimeHrs = Math.floor(uptimeMin / 60);
            const uptime = uptimeHrs > 0
                ? `${uptimeHrs}h ${uptimeMin % 60}m`
                : `${uptimeMin}m`;

            // Calculate next scan countdown
            let nextScanIn = null;
            if (scannerState.nextScanAt && !paused) {
                const msUntil = new Date(scannerState.nextScanAt).getTime() - Date.now();
                if (msUntil > 0) {
                    nextScanIn = Math.ceil(msUntil / 1000);
                }
            }

            res.writeHead(200);
            res.end(JSON.stringify({
                paused,
                pausedAt,
                status: paused ? 'paused' : (scannerState.isScanning ? 'scanning' : 'running'),
                uptime,
                startedAt: scannerState.startedAt,
                lastScanAt: scannerState.lastScanAt,
                lastScanDuration: scannerState.lastScanDuration,
                nextScanAt: scannerState.nextScanAt,
                nextScanIn,
                scanCount: scannerState.scanCount,
                isScanning: scannerState.isScanning,
                scanInterval: SETTINGS.scanIntervalMs / 1000,
                backoff: {
                    active: backoffState.active,
                    slowResponses: backoffState.slowResponses,
                    fastResponses: backoffState.fastResponses,
                    batchSize: backoffState.batchSize,
                    batchDelayMs: backoffState.batchDelayMs
                }
            }));
            return;
        }

        // POST /pause - Pause the scanner
        if (req.method === 'POST' && url === '/pause') {
            setPaused(true);
            console.log(`[Control] Scanner PAUSED via web interface`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, status: 'paused' }));
            return;
        }

        // POST /resume - Resume the scanner
        if (req.method === 'POST' && url === '/resume') {
            setPaused(false);
            console.log(`[Control] Scanner RESUMED via web interface`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, status: 'running' }));
            return;
        }

        // POST /scan - Trigger immediate scan
        if (req.method === 'POST' && url === '/scan') {
            if (isPaused()) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: 'Scanner is paused' }));
                return;
            }
            if (scannerState.isScanning) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: 'Scan already in progress' }));
                return;
            }
            manualScanRequested = true;
            console.log(`[Control] Manual scan triggered via web interface`);
            // Trigger scan immediately
            runScan().catch(console.error);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Scan started' }));
            return;
        }

        // POST /clear-cooldowns - Clear all alert cooldowns
        if (req.method === 'POST' && url === '/clear-cooldowns') {
            const count = alertCooldowns.size;
            alertCooldowns.clear();
            console.log(`[Control] Cleared ${count} alert cooldowns`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, cleared: count }));
            return;
        }

        // POST /test-alert - Send a test alert to Telegram
        if (req.method === 'POST' && url === '/test-alert') {
            console.log(`[Control] Sending test alert to Telegram...`);
            const testMsg = `🧪 <b>BLOODHOUND TEST ALERT</b>\n\n` +
                `This is a test message to verify Telegram integration.\n\n` +
                `<b>Status:</b> ✅ Working\n` +
                `<b>Time:</b> ${new Date().toISOString()}\n` +
                `<b>Scanner:</b> ${scannerState.scanCount} scans completed\n\n` +
                `<i>Ready for market open!</i>`;

            sendTelegram(testMsg).then(() => {
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: 'Test alert sent' }));
            }).catch(err => {
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: err.message }));
            });
            return;
        }

        // GET /watchlist - Get current watchlist (from SQLite)
        if (req.method === 'GET' && url === '/watchlist') {
            try {
                const entries = signalDb.getWatchlistFull();
                res.writeHead(200);
                res.end(JSON.stringify({ symbols: entries }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to load watchlist' }));
            }
            return;
        }

        // POST /watchlist/add - Add symbol to watchlist (SQLite)
        if (req.method === 'POST' && url.startsWith('/watchlist/add')) {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { symbol, notes } = JSON.parse(body);
                    if (!symbol) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Symbol required' }));
                        return;
                    }
                    const ticker = symbol.toUpperCase().trim();
                    const result = signalDb.addToWatchlist(ticker, {
                        source: 'manual',
                        notes: notes || null
                    });

                    if (result.action === 'skipped_manual') {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: `${ticker} already in watchlist` }));
                        return;
                    }

                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, symbol: ticker, action: result.action }));
                } catch (e) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // POST /watchlist/remove - Remove symbol from watchlist (SQLite)
        if (req.method === 'POST' && url.startsWith('/watchlist/remove')) {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { symbol } = JSON.parse(body);
                    if (!symbol) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Symbol required' }));
                        return;
                    }
                    const ticker = symbol.toUpperCase().trim();
                    const removed = signalDb.removeFromWatchlist(ticker);

                    if (!removed) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: `${ticker} not in watchlist` }));
                        return;
                    }

                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, symbol: ticker }));
                } catch (e) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // 404 for unknown routes
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(CONTROL_PORT, '0.0.0.0', () => {
        console.log(`[Control] HTTP control server on http://0.0.0.0:${CONTROL_PORT} (accessible from network)`);
        console.log(`         GET  /status  - Check scanner status`);
        console.log(`         POST /pause   - Pause scanner`);
        console.log(`         POST /resume  - Resume scanner`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Control] Port ${CONTROL_PORT} in use - control server disabled`);
        } else {
            console.error(`[Control] Server error:`, err.message);
        }
    });
}

// ============================================
// MAIN SCAN LOOP
// ============================================

async function runScan() {
    // Check if paused
    if (isPaused()) {
        console.log(`\n[${new Date().toISOString()}] 💤 Bloodhound PAUSED - skipping scan`);
        console.log('   Run: node bloodhound-scanner.js resume');
        // Update next scan time even when paused
        scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();
        return;
    }

    // Check market hours (can be bypassed with SETTINGS.ignoreMarketHours)
    if (!SETTINGS.ignoreMarketHours && !isMarketOpen()) {
        const nextOpen = getNextMarketOpen();
        console.log(`\n[${new Date().toISOString()}] 🌙 Market CLOSED - scanner idle`);
        console.log(`   Next market open: ${nextOpen}`);
        // Update next scan time
        scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();
        return;
    }

    // Track scan state
    const scanStartTime = Date.now();
    scannerState.isScanning = true;

    console.log('\n' + '='.repeat(60));
    console.log(`[${new Date().toISOString()}] Running Bloodhound scan...`);
    console.log('='.repeat(60));

    // 1. Get market context first
    marketContext = await getMarketContext();
    if (marketContext) {
        console.log(`[Context] VIX: ${marketContext.vix} (${marketContext.vixRegime}) | SPY: ${marketContext.spyTrend}`);

        // VIX Regime Change Detection (consolidated from wingman-monitor)
        const currentRegime = marketContext.vixRegime;
        if (scannerState.previousVixRegime && currentRegime !== scannerState.previousVixRegime) {
            const regimeEmoji = {
                'complacent': '😴',
                'normal': '⚪',
                'elevated': '⚠️',
                'fear': '😨',
                'capitulation': '🔥'
            };
            const emoji = regimeEmoji[currentRegime] || '📊';
            const vixMsg = `${emoji} <b>VIX REGIME CHANGE</b>\n\n` +
                `<b>From:</b> ${scannerState.previousVixRegime.toUpperCase()}\n` +
                `<b>To:</b> ${currentRegime.toUpperCase()}\n` +
                `<b>VIX:</b> ${marketContext.vix}\n\n` +
                `<i>${formatTimePST()} PST</i>`;
            await sendTelegram(vixMsg);
            console.log(`[VIX] Regime change: ${scannerState.previousVixRegime} → ${currentRegime}`);

            // Log VIX regime change to database (replaces alerts_log.json)
            try {
                signalDb.insertAlert({
                    type: 'VIX_REGIME',
                    priority: currentRegime === 'fear' || currentRegime === 'capitulation' ? 'HIGH' : 'MEDIUM',
                    message: `VIX regime change: ${scannerState.previousVixRegime} → ${currentRegime}`,
                    details: {
                        from: scannerState.previousVixRegime,
                        to: currentRegime,
                        vix: marketContext.vix,
                        spy_price: marketContext.spyPrice
                    }
                });
            } catch (e) {
                console.error(`[VIX] Failed to log alert to DB:`, e.message);
            }
        }
        scannerState.previousVixRegime = currentRegime;
    } else {
        console.log('[Context] Could not fetch market context');
    }

    // 1.5. Validate old signals (4h window)
    await signalLogger.validateOldSignals().catch(e => {
        console.error('[Signal Validation] Error:', e.message);
    });

    // 1.6. Fetch relative strength data from divergence scanner
    rsContext = await fetchRelativeStrength();
    if (rsContext) {
        const regime = rsContext.regime;
        if (regime) {
            const phase = regime.phase || regime.cycle_phase || 'unknown';
            console.log(`[RS] Rotation regime: ${phase} | ${rsContext.assetCount} assets ranked`);
        } else {
            console.log(`[RS] Rankings loaded (${rsContext.assetCount} assets), no regime data`);
        }
    }

    // 2. Discover symbols from all sources
    const symbols = await discoverSymbols();
    const discoveryContext = symbols._context || {};
    delete symbols._context;

    console.log(`[Discovery] Found ${symbols.length} symbols to scan`);

    // Log themes if available
    if (discoveryContext.themes?.length > 0) {
        console.log(`[Themes] ${discoveryContext.themes.slice(0, 3).join(' | ')}`);
    }
    if (discoveryContext.intradayBias) {
        console.log(`[Bias] Intraday: ${discoveryContext.intradayBias} | Swing: ${discoveryContext.swingBias || 'N/A'}`);
    }

    // Show top discovered symbols with their sources
    console.log(`[Top Discoveries]`);
    symbols.slice(0, 8).forEach((s, i) => {
        const src = s.sources.join('+');
        const extra = s.narrative ? ' (AI)' : '';
        console.log(`  ${i + 1}. ${s.symbol} (score: ${s.score}, ${src})${extra}`);
    });

    // 3. Analyze each symbol and track velocity
    const analyses = [];
    const velocityAlerts = [];

    // Helper for batched processing with delays
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < symbols.length; i++) {
        const symbolData = symbols[i];

        // Pace requests: small delay between every symbol to avoid overwhelming the API
        if (i > 0) {
            await sleep(200);
        }

        let analysis = await analyzeSymbol(symbolData.symbol, symbolData);

        // Retry once for static watchlist symbols that failed
        if (!analysis && symbolData.sources?.includes('watchlist')) {
            console.warn(`[Bloodhound] ${symbolData.symbol} failed (watchlist), retrying in 2s...`);
            await sleep(2000);
            analysis = await analyzeSymbol(symbolData.symbol, symbolData);
        }

        if (analysis) {
            // Track signal history and calculate velocity
            const { prevScore, velocity } = updateSignalHistory(
                analysis.symbol,
                analysis.totalScore,
                analysis.price,
                analysis.direction,
                analysis
            );

            // Check for velocity spike
            if (velocity >= SETTINGS.velocityThreshold) {
                velocityAlerts.push({
                    symbol: analysis.symbol,
                    prevScore,
                    newScore: analysis.totalScore,
                    velocity,
                    price: analysis.price,
                    direction: analysis.direction
                });
                analysis.velocitySpike = true;
                analysis.signals.unshift(`VELOCITY +${velocity} pts`);
            }

            analyses.push(analysis);
        } else {
            console.warn(`[Bloodhound] DROPPED: ${symbolData.symbol} — API returned no data`);
        }
    }

    // Log velocity alerts
    if (velocityAlerts.length > 0) {
        console.log(`\n[VELOCITY ALERTS]`);
        for (const va of velocityAlerts) {
            const dir = va.direction === 'bullish' ? '🟢' : va.direction === 'bearish' ? '🔴' : '📍';
            console.log(`  🚀 ${va.symbol}: +${va.velocity} pts (${va.prevScore}→${va.newScore}) ${dir}`);
            // Velocity is shown in the Bloodhound alert signals list, no separate message needed
        }
    }

    // Signal outcomes are now resolved via signalLogger.validateOldSignals()
    // (called at end of scan cycle)

    // 4. Sort by confluence score
    analyses.sort((a, b) => b.totalScore - a.totalScore);

    // 4.5. Update scanner history (Stage 1: Data Capture)
    updateScannerHistory(analyses, marketContext);

    // 5. Log results
    console.log(`\n[Results] Analyzed ${analyses.length} symbols:`);
    analyses.forEach(a => {
        const emoji = a.totalScore >= SETTINGS.minConfluenceScore ? '✅' : '⬜';
        const dir = a.direction === 'bullish' ? '🟢' :
                    a.direction === 'bearish' ? '🔴' :
                    a.direction === 'pinned' ? '📍' : '⚪';
        console.log(`  ${emoji} ${a.symbol}: ${a.totalScore}/100 ${dir} - ${a.signals.slice(0, 2).join(', ')}`);
    });

    // 6. Tier-based filtering and alerts
    // HIGH_CONVICTION: Score ≥70 + at wall + TF aligned → Telegram alert + Paper trade
    // TRADEABLE: Score ≥60 + at wall + trend aligned → Paper trade (no Telegram)
    // WATCH: Near wall or counter-trend or high score waiting for level → Dashboard only
    // FILTERED: Doesn't meet criteria → No output

    const tieredAnalyses = analyses.map(a => {
        const { tier, warnings } = getAlertTier(a, marketContext);
        return {
            ...a,
            tier,
            alertWarnings: warnings,
            history_status: computeHistoryStatus(a.symbol)
        };
    });

    const highConviction = tieredAnalyses.filter(a =>
        a.tier === 'HIGH_CONVICTION' && shouldAlert(a)
    );
    const tradeable = tieredAnalyses.filter(a => a.tier === 'TRADEABLE');
    const watchList = tieredAnalyses.filter(a => a.tier === 'WATCH');

    // Log tier breakdown
    console.log(`\n[Tiers] HIGH_CONVICTION: ${highConviction.length} | TRADEABLE: ${tradeable.length} | WATCH: ${watchList.length} | FILTERED: ${analyses.length - highConviction.length - tradeable.length - watchList.length}`);

    if (highConviction.length > 0) {
        console.log(`[HIGH CONVICTION]`);
        highConviction.forEach(a => {
            const dir = a.direction === 'bullish' ? '🟢' :
                        a.direction === 'bearish' ? '🔴' :
                        a.direction === 'pinned' ? '📍' : '⚪';
            const warn = a.alertWarnings.length > 0 ? ` [${a.alertWarnings.join(', ')}]` : '';
            console.log(`  🔥 ${a.symbol}: ${a.totalScore}/100 ${dir}${warn}`);
        });
    }

    if (tradeable.length > 0) {
        console.log(`[TRADEABLE]`);
        tradeable.forEach(a => {
            const dir = a.direction === 'bullish' ? '🟢' :
                        a.direction === 'bearish' ? '🔴' : '⚪';
            const warn = a.alertWarnings.length > 0 ? ` [${a.alertWarnings.join(', ')}]` : '';
            console.log(`  ✅ ${a.symbol}: ${a.totalScore}/100 ${dir} (${a.action})${warn}`);
        });
    }

    if (watchList.length > 0) {
        console.log(`[WATCH LIST]`);
        watchList.slice(0, 5).forEach(a => {
            const reason = a.action === 'WATCH_REVERSAL' ? '(reversal watch)' :
                           a.action === 'WATCH_LEVEL' ? '(waiting for level)' :
                           a.totalScore < SETTINGS.TIER_HIGH_CONVICTION ? `(score ${a.totalScore})` : '';
            console.log(`  👀 ${a.symbol}: ${a.totalScore}/100 ${reason}`);
        });
    }

    // Send Telegram alerts for HIGH_CONVICTION only
    if (highConviction.length > 0) {
        console.log(`\n[Alerts] Sending ${highConviction.length} HIGH CONVICTION alert(s)...`);
        for (const analysis of highConviction) {
            const message = formatAlert(analysis);
            await sendTelegram(message);
            alertCooldowns.set(analysis.symbol, Date.now());

            // Log signal for validation tracking
            const logData = {
                symbol: analysis.symbol,
                price: analysis.price,
                direction: analysis.direction,
                score: analysis.totalScore,
                zone: analysis.zone,
                tier: analysis.tier,
                signals: analysis.signals,
                vix: marketContext?.vix,
                vix_regime: marketContext?.vixRegime,
                spy_trend: marketContext?.spyTrend,
                spy_price: marketContext?.spyPrice,
                gamma_regime: marketContext?.gammaRegime,
                intraday_bias: marketContext?.intradayBias,
                signal_type: analysis.tier,
                history_status: analysis.history_status?.label,
                consecutive_days: analysis.history_status?.consecutive_days
            };

            // Include unusual option data for option signal tracking
            if (analysis.unusualOption) {
                const opt = analysis.unusualOption;
                logData.option_contract = opt.contract;
                logData.option_type = opt.type;
                logData.option_strike = opt.strike;
                logData.option_expiration = opt.expiration;
                logData.option_dte = opt.dte;
                logData.option_vol_oi = opt.vol_oi;
                logData.option_premium_flow = opt.premium_flow;
            }

            await signalLogger.logSignal(logData);
        }
    } else {
        console.log(`\n[Alerts] No high-conviction opportunities (${tradeable.length} tradeable, ${watchList.length} on watch)`);
    }

    // 7. Write results to file (format compatible with scanner.html)
    const output = {
        timestamp: new Date().toISOString(),
        // Format expected by scanner.html
        vix: {
            price: marketContext?.vix || 0,
            regime: marketContext?.vixRegime || 'unknown'
        },
        spy: {
            price: marketContext?.spyPrice || 0,
            change_pct: 0, // TODO: get from API if needed
            levels: marketContext?.spyLevels || {},
            context: {
                regime: marketContext?.regime,
                gamma_regime: marketContext?.gammaRegime || 'unknown',
                iv_rank: marketContext?.ivRank || 0
            }
        },
        qqq: {
            price: analyses.find(a => a.symbol === 'QQQ')?.price || 0,
            change_pct: 0,
            levels: marketContext?.qqqLevels || {},
            context: {}
        },
        market_context: {
            vix_regime: marketContext?.vixRegime,
            spy_trend: marketContext?.spyTrend,
            risk_appetite: marketContext?.riskAppetite,
            position_size_modifier: marketContext?.positionSizeModifier,
            bias: marketContext?.intradayBias || 'NEUTRAL',
            swing_bias: marketContext?.swingBias || 'NEUTRAL',
            gamma_regime: marketContext?.gammaRegime || 'unknown',
            iv_rank: marketContext?.ivRank || 0,
            rotation_regime: rsContext?.regime || null
        },
        // Bloodhound-specific data
        discovery: {
            themes: discoveryContext.themes || [],
            intradayBias: discoveryContext.intradayBias,
            swingBias: discoveryContext.swingBias,
            sourcesUsed: ['watchlist', 'ai_outlook', 'market_data', 'sector_rotation']
        },
        symbolsScanned: analyses.length,
        topOpportunities: tieredAnalyses.slice(0, 15).map(a => ({
            symbol: a.symbol,
            score: a.totalScore,
            direction: a.direction,
            tier: a.tier,
            signals: a.signals,
            atWall: a.atWall,
            wallActivity: a.wallActivity,
            sources: symbols.find(s => s.symbol === a.symbol)?.sources || [],
            history_status: a.history_status
        })),
        alertsSent: highConviction.length,
        watchListCount: watchList.length
    };

    // 8. Write to database (replaces scanner.json, dynamic_scan.json, bloodhound.json)
    const tradeableResults = analyses.filter(a => a.tradeable);

    // Build reasoning array based on zone and signals
    const buildReasoning = (a) => {
        const reasons = [];

        // Zone-specific reasoning
        if (a.zone === 'BUY_ZONE') {
            if (a.technicals.rsi <= 30) {
                reasons.push(`RSI ${a.technicals.rsi.toFixed(1)} < 30 (low momentum)`);
                reasons.push('At put wall support + momentum reset = Strong buy');
            } else {
                reasons.push(`Within 0.5% of put wall ($${a.levels.putWall?.toFixed(2) || 'N/A'})`);
                reasons.push(`RSI ${a.technicals.rsi?.toFixed(1) || 'N/A'} - momentum not extended`);
            }
        } else if (a.zone === 'SELL_ZONE') {
            reasons.push(`Within 0.5% of call wall ($${a.levels.callWall?.toFixed(2) || 'N/A'})`);
            reasons.push(`RSI ${a.technicals.rsi?.toFixed(1) || 'N/A'} - momentum not depleted`);
        } else if (a.zone === 'EXTENDED_HIGH') {
            reasons.push('Price above call wall (breakout or reversal)');
        } else if (a.zone === 'EXTENDED_LOW') {
            reasons.push('Price below put wall (breakdown or reversal)');
        } else if (a.zone === 'PINNED') {
            reasons.push(`Pinned between walls ($${a.levels.putWall} - $${a.levels.callWall})`);
        } else if (a.zone === 'HIGH_MOMENTUM') {
            reasons.push(`RSI ${a.technicals.rsi?.toFixed(1) || 'N/A'} > 70 (high momentum)`);
        } else if (a.zone === 'LOW_MOMENTUM') {
            reasons.push(`RSI ${a.technicals.rsi?.toFixed(1) || 'N/A'} < 30 (low momentum)`);
        } else {
            reasons.push(`Mid-range (${((a.distances.positionInRange || 0) * 100).toFixed(0)}% between walls)`);
            reasons.push('Wait for price to reach support or resistance');
        }

        // Add trend alignment if tradeable
        if (a.tradeable && a.technicals.trend) {
            reasons.push(`Trend aligned: ${a.technicals.trend}`);
        }

        return reasons;
    };

    // Insert scan metadata to database
    const scanTimestamp = new Date().toISOString();
    try {
        const scanId = signalDb.insertBloodhoundScan({
            timestamp: scanTimestamp,
            vix: marketContext?.vix || 0,
            vixRegime: marketContext?.vixRegime || 'unknown',
            spyTrend: marketContext?.spyTrend || 'unknown',
            spyPrice: marketContext?.spyPrice || 0,
            riskAppetite: marketContext?.riskAppetite || 'unknown',
            regime: marketContext?.regime || 'unknown',
            positionSizeModifier: marketContext?.positionSizeModifier || 1,
            spyLevels: { ...(marketContext?.spyLevels || {}), gammaRegime: marketContext?.gammaRegime, ivRank: marketContext?.ivRank, rotationRegime: rsContext?.regime || null },
            qqqLevels: marketContext?.qqqLevels || {},
            scanCount: analyses.length,
            tradeableCount: tradeableResults.length,
            alertsSent: highConviction.length,
            watchlistCount: watchList.length,
            sources: ['watchlist', 'ai_outlook', 'market_data', 'sector_rotation']
        });

        // Insert individual ticker results
        const resultsForDb = analyses.map(a => ({
            symbol: a.symbol,
            price: a.price,
            zone: a.zone,
            tradeable: a.tradeable,
            action: a.action,
            reasoning: buildReasoning(a),
            levels: {
                putWall: a.levels.putWall,
                callWall: a.levels.callWall,
                maxPain: a.levels.maxPain,
                gammaFlip: a.levels.gammaFlip,
                vwap: a.levels.vwap
            },
            distances: a.distances,
            technicals: {
                rsi: a.technicals.rsi,
                trend: a.technicals.trend,
                momentum5d: a.technicals.momentum5d,
                momentum20d: a.technicals.momentum20d,
                bbPosition: a.technicals.bbPosition,
                volumeSignal: a.technicals.volumeSignal
            },
            fibonacci: a.fibonacci ? {
                swingHigh: a.fibonacci.swingHigh,
                swingLow: a.fibonacci.swingLow,
                atLevel: a.fibonacci.atLevel,
                maConfluence: a.fibonacci.maConfluence,
                goldenPocket: a.fibonacci.retracements?.[0.618],
                fib50: a.fibonacci.retracements?.[0.5],
                fib382: a.fibonacci.retracements?.[0.382],
                ext1272: a.fibonacci.extensions?.[1.272],
                ext1618: a.fibonacci.extensions?.[1.618]
            } : null,
            sourceInfo: {
                sources: symbols.find(s => s.symbol === a.symbol)?.sources || ['watchlist'],
                score: a.totalScore,
                direction: a.direction,
                signals: a.signals,
                isWatchlist: symbols.find(s => s.symbol === a.symbol)?.sources?.includes('watchlist') || false,
                tier: a.tier
            },
            history_status: computeHistoryStatus(a.symbol),
            sectorRsPercentile: a.sectorRs?.percentile ?? null,
            sectorEtf: a.sectorRs?.sectorEtf ?? null
        }));

        signalDb.insertBloodhoundResults(scanId, resultsForDb);

        // Cleanup old scans (keep 30 days for internals backtesting)
        signalDb.cleanupOldBloodhoundScans(30);

        console.log(`[Bloodhound] Wrote ${analyses.length} results to database (scan_id: ${scanId})`);
    } catch (e) {
        console.error('[Bloodhound] Database write error:', e.message);
    }

    // Update scanner state
    scannerState.isScanning = false;
    scannerState.lastScanAt = new Date().toISOString();
    scannerState.lastScanDuration = Math.round((Date.now() - scanStartTime) / 1000);
    scannerState.scanCount++;
    scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();

    const backoffStatus = backoffState.active ? ` [BACKOFF ACTIVE: batch ${backoffState.batchSize}, delay ${backoffState.batchDelayMs}ms]` : '';
    console.log(`\n[Bloodhound] Scan complete (${scannerState.lastScanDuration}s).${backoffStatus} Next scan in ${SETTINGS.scanIntervalMs / 60000} minutes.`);

    // Signal validation: update prices and check for checkpoint validations
    // Build price cache from scan results to avoid duplicate API calls
    const priceCache = new Map();
    for (const analysis of tieredAnalyses) {
        if (analysis.price && analysis.symbol) {
            priceCache.set(analysis.symbol, analysis.price);
        }
    }
    console.log(`[Signal Logger] Price cache built with ${priceCache.size} symbols`);

    try {
        await signalLogger.updateActiveSignalPrices(priceCache);
        await signalLogger.validateOldSignals(priceCache);
    } catch (e) {
        console.error('[Bloodhound] Signal validation error:', e.message);
    }
}

// ============================================
// STARTUP
// ============================================

// Handle CLI commands
const command = process.argv[2]?.toLowerCase();

if (command === 'pause' || command === 'sleep') {
    fs.writeFileSync(PAUSE_FILE, new Date().toISOString());
    console.log('💤 Bloodhound PAUSED');
    console.log('   Scans will be skipped until resumed.');
    console.log('   Run: node bloodhound-scanner.js resume');
    process.exit(0);
}

if (command === 'resume' || command === 'wake') {
    if (fs.existsSync(PAUSE_FILE)) {
        fs.unlinkSync(PAUSE_FILE);
        console.log('✅ Bloodhound RESUMED');
        console.log('   Scans will continue on next interval.');
    } else {
        console.log('ℹ️  Bloodhound is not paused.');
    }
    process.exit(0);
}

if (command === 'status') {
    if (isPaused()) {
        const pausedAt = fs.readFileSync(PAUSE_FILE, 'utf8');
        console.log(`💤 Bloodhound is PAUSED (since ${pausedAt})`);
    } else {
        console.log('✅ Bloodhound is ACTIVE');
    }
    process.exit(0);
}

async function main() {
    console.log('='.repeat(60));
    console.log('       BLOODHOUND SCANNER');
    console.log('       Autonomous Opportunity Detection');
    console.log('='.repeat(60));
    console.log(`Intel API: ${APIS.intel}`);
    console.log(`Options API: ${APIS.options}`);
    console.log(`Min Confluence Score: ${SETTINGS.minConfluenceScore}/100 (data-driven)`);
    console.log(`Scan Interval: ${SETTINGS.scanIntervalMs / 1000}s`);
    if (isPaused()) {
        console.log(`Status: 💤 PAUSED`);
    }
    console.log('='.repeat(60));

    // Start HTTP control server for web interface
    startControlServer();

    // Initial scan
    await runScan();

    // Schedule recurring scans
    setInterval(runScan, SETTINGS.scanIntervalMs);

    console.log('\nBloodhound running. Press Ctrl+C to stop.');
    console.log('Commands: node bloodhound-scanner.js [pause|resume|status]');
}

main().catch(console.error);
