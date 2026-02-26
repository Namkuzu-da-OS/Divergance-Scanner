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
const { sendTelegram, escapeHtml } = require('./telegram');

// MA bounce detection (backtest-validated per-ticker configs)
const maBounce = require('./ma-bounce');

// Divergence + Bollinger Band detection (backtest-validated per-ticker configs)
const divergenceBb = require('./divergence-bb');

// Opportunity scanner DB — feed discovered symbols into Bloodhound
const opportunityDb = require('./opportunity-db');

// Shared API cache — reduces redundant Schwab calls across all PM2 processes
const apiCache = require('./api-cache');

// Shared API client — routes through gateway for concurrency/circuit breaking
const apiClient = require('./api-client');

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
    ignoreMarketHours: false,        // Set true for off-hours testing
    // Signal tracking settings
    velocityThreshold: 15,           // Points jump to trigger velocity alert (adjusted for new scale)
    autoTrackMinScore: 50,           // Minimum score to auto-track for outcomes
    signalExpirationDays: 5,         // Days before unresolved signal = EXPIRED
    // Display timezone
    displayTimezone: 'America/Los_Angeles', // PST/PDT for user display

    // === DATA-DRIVEN THRESHOLDS (223 signal backtest, Feb 2026) ===
    // BUY_ZONE + bullish: 75.3% WR | Elevated VIX: 92.9% WR
    // Dip buy (bullish + bearish SPY): 100% WR (13/13)
    // Score 60+: 63.1% WR | Score 50-59: 28.6% WR
    WALL_THRESHOLD_PCT: 1.0,        // Within 1% = "at wall"
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70,
    VOLUME_ELEVATED: 1.5,           // 1.5x average = elevated
    VIX_ELEVATED: 20,
    VIX_FEAR: 30,

    // Tier thresholds (0-100 scale)
    TIER_HIGH_CONVICTION: 60,       // Data: 60+ = 63.1% WR, 50-59 = 28.6% WR (223 signals)
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
    batchDelayMs: 1000,         // Delay between batches when backoff active
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

// State
const setupTracker = new Map(); // symbol → { zone, direction, score, firstSeen, lastAlerted, alertCount }
const DEDUP = {
    sameSetupCooldownMs: 4 * 60 * 60 * 1000,  // 4 hours for same setup
    scoreJumpThreshold: 15,                      // Re-alert if score jumps 15+ pts
    maxAlertsPerSetup: 2,                        // Max 2 alerts per day for same setup
    setupExpiryMs: 24 * 60 * 60 * 1000,         // Clear tracker after 24h
};
let marketContext = null;
let rsContext = null;  // Relative strength data from divergence scanner
let latestInternals = null;  // Market internals snapshot for scoring

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

    // Closed on weekends and market holidays
    if (day === 0 || day === 6 || signalDb.isMarketHoliday()) {
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
                peak_signals: analysis.signals || [],
                time_in_scanner_mins: timeInScannerMins,
                above_20ema: analysis.technicals?.sma20 ? (analysis.price > analysis.technicals.sma20 ? 1 : 0) : null,
                above_50sma: analysis.technicals?.sma50 ? (analysis.price > analysis.technicals.sma50 ? 1 : 0) : null,
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
    const startTime = Date.now();
    const data = await apiClient.fetchJSON(url, timeout);
    const responseTime = Date.now() - startTime;

    if (data === null) {
        console.error(`[API] Failed: ${url} (${responseTime}ms)`);
        // Timeout/error counts as slow response for backoff
        if (trackBackoff || url.includes('/api/levels/')) {
            updateBackoffState(responseTime + 5000, url);
        }
        return null;
    }

    // Track response time for backoff on heavy endpoints
    if (trackBackoff || url.includes('/api/levels/')) {
        updateBackoffState(responseTime, url);
    }

    return data;
}

// escapeHtml and sendTelegram imported from ./telegram.js

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
            if (pos52wk > 85) boost += 25; // Near 52-week high (widened from 95)
            if (pos52wk < 20) boost += 25; // Near 52-week low (widened from 10)
            if (volRatio > 1.3) boost += 20; // High relative volume (widened from 1.5)
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

    // --- Opportunity scanner: pipe high-scoring discoveries into dynamic pool ---
    let opportunityCount = 0;
    const oppFlowMap = new Map();
    try {
        const oppSymbols = opportunityDb.getRecentHighScoreSymbols(24);
        for (const opp of oppSymbols) {
            const ticker = mapSymbol(opp.symbol) || opp.symbol;
            if (staticSet.has(ticker)) continue; // Already has reserved slot

            // Score boost based on opportunity tier
            let boost = 0;
            if (opp.tier === 'HIGH_CONVICTION' && opp.maxScore >= 70) {
                boost = 35;
            } else if (opp.tier === 'TRADEABLE' || (opp.tier === 'HIGH_CONVICTION' && opp.maxScore < 70)) {
                boost = 25;
            }

            if (boost > 0) {
                const existing = dynamicPool.get(ticker) || { score: 0, sources: [] };
                existing.score += boost;
                if (!existing.sources.includes('opportunity_scanner')) {
                    existing.sources.push('opportunity_scanner');
                }
                dynamicPool.set(ticker, existing);
                opportunityCount++;
            }
        }
        // Build flow lookup for cross-scanner scoring in analyzeSymbol
        for (const opp of oppSymbols) {
            const ticker = mapSymbol(opp.symbol) || opp.symbol;
            if (opp.tier === 'HIGH_CONVICTION' || opp.tier === 'TRADEABLE') {
                oppFlowMap.set(ticker, {
                    tier: opp.tier,
                    score: opp.maxScore,
                    direction: opp.direction,
                    volOiRatio: opp.vol_oi_ratio,
                    netPremium: opp.net_premium
                });
            }
        }
        if (opportunityCount > 0) {
            console.log(`[Discovery] Opportunity scanner contributed ${opportunityCount} symbols (${oppFlowMap.size} with flow data)`);
        }
    } catch (err) {
        console.error(`[Discovery] Opportunity scanner feed error (non-fatal): ${err.message}`);
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
    result._context = { themes, intradayBias, swingBias, oppFlowMap };

    const dynamicCount = sortedDynamic.length;
    // Source breakdown for diagnostics
    const sourceCounts = {};
    for (const [, data] of sortedDynamic) {
        for (const src of (data.sources || [])) {
            const key = src.startsWith('watchlist_') ? 'watchlist' : src;
            sourceCounts[key] = (sourceCounts[key] || 0) + 1;
        }
    }
    const breakdown = Object.entries(sourceCounts).map(([k, v]) => `${k}: ${v}`).join(', ');
    console.log(`[Discovery] ${result.length} symbols: ${staticSymbols.length} static + ${dynamicCount} dynamic (${breakdown || 'none'})`);

    return result;
}

// ============================================
// MARKET CONTEXT
// ============================================

async function getMarketContext() {
    // Sequential API calls to avoid overwhelming the Options API
    const sleep100 = () => new Promise(r => setTimeout(r, 100));
    const contextUrl = `${APIS.options}/api/market/context`;
    const context = await apiCache.wrap(contextUrl, apiCache.TTL.CONTEXT, () => fetchJSON(contextUrl, 15000), 'bloodhound');
    await sleep100();
    const spyLevels = await fetchJSON(`${APIS.options}/api/levels/SPY`, 15000);  // Never cached — real-time gamma
    await sleep100();
    const qqqLevels = await fetchJSON(`${APIS.options}/api/levels/QQQ`, 15000);  // Never cached — real-time gamma
    await sleep100();
    const outlook = await fetchJSON(`${APIS.intel}/api/market/outlook`);  // Multi-timeframe bias (Intel API, not cached)
    await sleep100();
    const spyIvUrl = `${APIS.options}/api/options/SPY/iv`;
    const spyIv = await apiCache.wrap(spyIvUrl, apiCache.TTL.IV, () => fetchJSON(spyIvUrl, 15000), 'bloodhound');  // IV rank

    if (!context) return null;

    // Calculate SPY trend from raw MAs (don't trust API's spy_trend — it only checks
    // 5/20 SMA cross direction, ignoring where price actually is relative to the MAs)
    let spyTrend = 'neutral';
    const spyPrice = context.spy_price;
    const sma5 = context.spy_sma_5;
    const sma20 = context.spy_sma_20;
    if (spyPrice && sma5 && sma20) {
        const aboveSma5 = spyPrice > sma5;
        const aboveSma20 = spyPrice > sma20;
        const sma5Above20 = sma5 > sma20;

        if (aboveSma5 && aboveSma20 && sma5Above20) {
            spyTrend = 'bullish';       // Price > 5 > 20 — aligned uptrend
        } else if (aboveSma5 && aboveSma20) {
            spyTrend = 'recovering';    // Price above both but 5/20 cross lagging
        } else if (!aboveSma5 && aboveSma20) {
            spyTrend = 'weakening';     // Pulling back below 5 SMA, still above 20
        } else if (!aboveSma5 && !aboveSma20 && !sma5Above20) {
            spyTrend = 'bearish';       // Price < 5 < 20 — aligned downtrend
        } else if (!aboveSma5 && !aboveSma20) {
            spyTrend = 'declining';     // Below both but 5/20 cross lagging
        } else {
            spyTrend = 'mixed';
        }
    }

    // Calculate gamma regime from price vs gamma flip level
    // Price above gamma flip = dealers short gamma = BULLISH_SUPPORT (they buy dips)
    // Price below gamma flip = dealers long gamma = BEARISH_RESISTANCE (they sell rallies)
    let gammaRegime = 'NEUTRAL';
    const gammaFlip = spyLevels?.levels?.gamma_flip?.price;
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
        spyTrend: spyTrend,
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

    // Sequential to respect API pacing (was Promise.all)
    const rankings = await fetchJSON(`${divergenceApi}/api/relative-strength/rankings`, 15000);
    const regime = await fetchJSON(`${divergenceApi}/api/rotation/regime`, 5000);

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

async function analyzeSymbol(symbol, discoveryData, bounceHistoryCache, divBbHistoryCache) {
    // Sequential API calls to avoid overwhelming the Options API
    const levels = await fetchJSON(`${APIS.options}/api/levels/${symbol}`, 15000);  // Never cached — real-time gamma
    if (!levels) return null; // Can't analyze without levels

    await new Promise(r => setTimeout(r, 100));
    const techUrl = `${APIS.options}/api/technicals/${symbol}`;
    const technicals = await apiCache.wrap(techUrl, apiCache.TTL.TECHNICALS, () => fetchJSON(techUrl, 15000), 'bloodhound');
    if (!technicals) return null; // Can't analyze without technicals

    await new Promise(r => setTimeout(r, 100));
    const analysisUrl = `${APIS.options}/api/options/${symbol}/analysis`;
    const optionsAnalysis = await apiCache.wrap(analysisUrl, apiCache.TTL.ANALYSIS, () => fetchJSON(analysisUrl, 15000), 'bloodhound');

    const price = levels.underlying_price || technicals.current;
    if (!price) return null;

    // Compute history status early — needed for scoring and tier gates
    const historyStatus = computeHistoryStatus(symbol);

    // ============================================
    // DATA-DRIVEN CONFLUENCE SCORING (0-100)
    // Updated Feb 2026 audit (517 observations, R²=0.009 on old formula)
    // Combo-first architecture: standalone factors mostly annotation-only,
    // validated 2-factor combos get score bonuses.
    // See data/AUDIT_FINDINGS.md for full methodology.
    // ============================================

    const scores = {
        base: 0,       // AT_WALL + EXTENDED_RSI (0-50 with combo)
        highEdge: 0,   // Volume spike + VIX factors (0-35)
        standard: 0    // BB, trend, flow, MA structure, confluence (0-25)
    };

    const signals = [];
    let direction = 'neutral';

    // Track key conditions for combo detection
    let atWallCondition = false;
    let extendedRsiCondition = false;

    // Track conditions for audit-validated combo bonuses (Feb 2026, 517 obs)
    let isOversold = false;
    let isOverbought = false;
    let hasUpperBB = false;
    let hasLowerBB = false;
    let wallIsDormant = false;
    let hasElevatedVolume = false;
    let hasHeavyPuts = false;
    let hasConfluenceZone = false;

    // --- BASE CONDITION: EXTENDED RSI (15 pts) ---
    const rsi = technicals.rsi || 50;
    const trend = technicals.trend || 'neutral';
    const bbPosition = technicals.bb_position ?? 0.5;

    // Extended RSI: Overbought standalone = 85.7% 5d WR (n=7). Oversold standalone = 26.3% (n=38).
    // Oversold only scores via AT_WALL combo (absorbed into combo bonus below).
    if (rsi <= SETTINGS.RSI_OVERSOLD) {
        // No standalone score — 26.3% 5d WR. Score only via AT_WALL + EXTENDED_RSI combo.
        extendedRsiCondition = true;
        isOversold = true;
        signals.push(`RSI oversold (${rsi.toFixed(1)})`);
        direction = 'bullish';
    } else if (rsi >= SETTINGS.RSI_OVERBOUGHT) {
        scores.base += 15;  // KEEP — 85.7% 5d WR (n=7), best standalone factor
        extendedRsiCondition = true;
        isOverbought = true;
        signals.push(`RSI overbought (${rsi.toFixed(1)})`);
        direction = 'bearish';
    } else if (rsi <= 40 && trend === 'uptrend') {
        // No score — RSI pullback/bounce unproven. Annotation only (Feb 2026 factor analysis).
        signals.push(`ℹ️ RSI pullback in uptrend (${rsi.toFixed(1)})`);
        direction = 'bullish';
    } else if (rsi >= 60 && trend === 'downtrend') {
        signals.push(`ℹ️ RSI bounce in downtrend (${rsi.toFixed(1)})`);
        direction = 'bearish';
    }

    // --- BOLLINGER BANDS (audit: lower BB 33.9% WR = no edge; upper BB 56.3% WR = +23% edge) ---
    if (bbPosition <= 0.1) {
        // No standalone score — 33.9% 5d WR (n=59), at baseline. Scores only via combos.
        hasLowerBB = true;
        signals.push('At lower Bollinger Band');
        if (direction === 'neutral') direction = 'bullish';
    } else if (bbPosition >= 0.9) {
        scores.standard += 5;  // 56.3% 5d WR (n=16), +23% edge. Appears in top combos.
        hasUpperBB = true;
        signals.push('At upper Bollinger Band');
        if (direction === 'neutral') direction = 'bearish';
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
    const wallSpreadPct = (callWall && putWall && price > 0)
        ? (Math.abs(callWall - putWall) / price * 100) : null;
    const wallsConvergent = wallSpreadPct !== null && wallSpreadPct < 0.5;
    const isPinned = atPutWall && atCallWall && !wallsConvergent;

    // Check for extended scenarios (breakouts/breakdowns)
    const aboveCallWall = distToCallWall !== null && distToCallWall < -wallThresholdPct; // Price above call wall (beyond AT_WALL zone)
    const belowPutWall = distToPutWall !== null && distToPutWall < -wallThresholdPct; // Price below put wall (beyond AT_WALL zone)

    if (wallsConvergent && atPutWall && atCallWall) {
        signals.push(`🧲 Convergent walls ($${putWall}/$${callWall}) — gamma magnet`);
    } else if (isPinned) {
        // No score — PINNED has 20.8% 5d WR (n=24). Was 100% in 106 signals (survivorship bias).
        signals.push(`📍 PINNED between walls ($${putWall}-$${callWall})`);
        direction = 'pinned';
    } else if (aboveCallWall) {
        // No score — breakout/breakdown unproven. Annotation only (Feb 2026 factor analysis).
        const distAbove = Math.abs(distToCallWall).toFixed(1);
        signals.push(`🚀 BREAKOUT above call wall ($${callWall}) +${distAbove}%`);
        direction = 'bullish';
        if (gammaFlip && price > gammaFlip) {
            signals.push(`ℹ️ Above gamma flip ($${gammaFlip.toFixed(2)})`);
        }
    } else if (belowPutWall) {
        // No score — breakout/breakdown unproven. Annotation only (Feb 2026 factor analysis).
        const distBelow = Math.abs(distToPutWall).toFixed(1);
        signals.push(`💥 BREAKDOWN below put wall ($${putWall}) -${distBelow}%`);
        direction = 'bearish';
        if (gammaFlip && price < gammaFlip) {
            signals.push(`ℹ️ Below gamma flip ($${gammaFlip.toFixed(2)})`);
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
        // Oversold RSI has 0 standalone score, so combo absorbs it (+35 = old 15+20).
        // Overbought RSI already has +15 standalone, so combo adds +20.
        const comboBonus = isOversold ? 35 : 20;
        scores.base += comboBonus;
        signals.unshift('⭐ PRIME SETUP: Wall + Extended RSI');
    }

    // --- ANNOTATION: VWAP (no score — unproven, Feb 2026 factor analysis) ---
    if (distToVwap !== null && Math.abs(distToVwap) <= 0.3) {
        signals.push(`ℹ️ At VWAP ($${vwap})`);
    }

    // Confluence zones from API
    if (levels.confluence_zones?.length > 0) {
        const nearbyZone = levels.confluence_zones.find(z =>
            Math.abs(z.distance_pct) <= 0.5 && z.count >= 2
        );
        if (nearbyZone) {
            // No standalone score — but CONFLUENCE_ZONE + UPPER_BB = 70% 5d WR (n=10).
            hasConfluenceZone = true;
            signals.push(`ℹ️ Confluence zone (${nearbyZone.count} levels)`);
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

            // Wall activity (audit: ENGAGED 34.5% WR = no edge; ACTIVE keep -8; DORMANT in top combos)
            if (wallActivity.status === 'ENGAGED') {
                // No score — 34.5% 5d WR (n=29), no edge. Annotation only.
                signals.push(`${wallType.toUpperCase()} wall ENGAGED (${wallActivity.volOiRatio.toFixed(1)}x vol/OI)`);
            } else if (wallActivity.status === 'ACTIVE') {
                scores.standard -= 8;  // KEEP penalty — cascade risk
                signals.push(`⚠️ ${wallType.toUpperCase()} wall ACTIVE (${wallActivity.volOiRatio.toFixed(1)}x vol/OI — cascade risk)`);
            } else if (wallActivity.status === 'DORMANT') {
                // No penalty — WALL_DORMANT appears in 5 of top 13 winning combos.
                wallIsDormant = true;
                signals.push(`${wallType.toUpperCase()} wall dormant`);
            }
            // UNKNOWN: No action (illiquid symbol)
        }
    }

    // --- VOLUME (audit: VOLUME_SPIKE 12.0% 5d WR n=25 — worst standalone factor) ---
    const volRatio = discoveryData?.volRatio || technicals.volume_ratio || 1;

    if (volRatio >= 2) {
        // No standalone score — 12.0% 5d WR (n=25). Scores only via combos (AT_PUT_WALL + ELEVATED_VOLUME = 80% 3d).
        hasElevatedVolume = true;
        signals.push(`Volume spike (${volRatio.toFixed(1)}x avg)`);
    } else if (volRatio >= SETTINGS.VOLUME_ELEVATED) {
        // No score — 1.5-2x elevated volume has 20% WR (3W/12L). Annotation for trader visibility only.
        signals.push(`ℹ️ Elevated volume (${volRatio.toFixed(1)}x avg)`);
    }

    // --- OPTIONS FLOW ANALYSIS ---
    let unusualOption = null;  // Structured data for option signal tracking
    let hasOtmPutHedge = false;  // Track OTM PUT hedge for ENGAGED wall combo

    if (optionsAnalysis?.analysis) {
        const opts = optionsAnalysis.analysis;

        // Check for unusual options activity
        const unusualCalls = opts.unusual_calls || [];
        const unusualPuts = opts.unusual_puts || [];

        // Filter out illiquid strikes (noise) — require meaningful OI AND volume
        // Raised from 50 to 200 OI (2026-02-17 audit: RGTI/KHC/EEM noise at OI 50-100)
        const MIN_OI_THRESHOLD = 200;
        const MIN_VOLUME = 500;  // Minimum contracts on strike — ratio alone isn't enough
        const liquidCalls = unusualCalls.filter(c =>
            (c.open_interest || 0) >= MIN_OI_THRESHOLD && (c.volume || 0) >= MIN_VOLUME);
        const liquidPuts = unusualPuts.filter(p =>
            (p.open_interest || 0) >= MIN_OI_THRESHOLD && (p.volume || 0) >= MIN_VOLUME);

        // Find the option with max vol/OI ratio from LIQUID strikes only
        // Used for elevated flow (2x) annotations
        const topCall = liquidCalls.reduce((max, c) =>
            (c.vol_oi_ratio || 0) > (max?.vol_oi_ratio || 0) ? c : max, null);
        const topPut = liquidPuts.reduce((max, p) =>
            (p.vol_oi_ratio || 0) > (max?.vol_oi_ratio || 0) ? p : max, null);
        const maxCallVolOI = topCall?.vol_oi_ratio || 0;
        const maxPutVolOI = topPut?.vol_oi_ratio || 0;

        // Premium filter: institutional-grade flow requires $500K+ premium
        // Raised from $100K (2026-02-17 audit: <$500K = 33% WR, $500K-$3M = 50% WR)
        // Industry standard: Unusual Whales uses $500K
        const MIN_PREMIUM = 500000;
        const significantCalls = liquidCalls.filter(c => (c.premium || 0) >= MIN_PREMIUM);
        const significantPuts = liquidPuts.filter(p => (p.premium || 0) >= MIN_PREMIUM);

        // Top picks from premium-filtered lists (used for 5x+ unusual flow)
        const sigTopCall = significantCalls.reduce((max, c) =>
            (c.vol_oi_ratio || 0) > (max?.vol_oi_ratio || 0) ? c : max, null);
        const sigTopPut = significantPuts.reduce((max, p) =>
            (p.vol_oi_ratio || 0) > (max?.vol_oi_ratio || 0) ? p : max, null);
        const maxSigCallVolOI = sigTopCall?.vol_oi_ratio || 0;
        const maxSigPutVolOI = sigTopPut?.vol_oi_ratio || 0;

        // Helper: Calculate DTE from expiration string (e.g., "2026-01-16")
        const getDTE = (expiration) => {
            if (!expiration) return null;
            const expDate = new Date(expiration + 'T16:00:00-05:00'); // 4PM ET
            const now = new Date();
            return Math.max(0, Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)));
        };

        // Unusual activity detection (premium-filtered: $500K+, OI 200+, vol 500+)
        // No generic score bonus. Wall-activity scoring (above) handles the reward
        // when flow is AT a wall. Unanchored flow is informational only.
        // ENGAGED wall + OTM PUT hedge combo scored separately below (+12 highEdge).
        if (maxSigCallVolOI >= 5 || maxSigPutVolOI >= 5) {
            // Annotate when flow is NOT at a wall (informational, no score)
            if (!wallActivity || wallActivity.status === 'UNKNOWN') {
                signals.push(`ℹ️ Options flow detected (not at wall — informational)`);
            }
            if (maxSigCallVolOI > maxSigPutVolOI) {
                const exp = sigTopCall.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((sigTopCall.premium || 0) / 1000000).toFixed(1);
                scores.standard -= 5;  // Unusual CALL = 27.9% 5d WR (n=61), anti-signal
                signals.push(`🔥 Unusual CALL $${sigTopCall.strike} ${exp} (${maxSigCallVolOI.toFixed(1)}x, $${prem}M) [-5]`);
                if (direction === 'neutral') direction = 'bullish';

                // Capture structured option data for signal tracking
                const callDTE = getDTE(sigTopCall.expiration);
                const expFmt = (sigTopCall.expiration || '').replace(/-/g, '').slice(2);
                unusualOption = {
                    contract: `.${symbol}${expFmt}C${sigTopCall.strike}`,
                    type: 'CALL',
                    strike: sigTopCall.strike,
                    expiration: sigTopCall.expiration,
                    dte: callDTE,
                    vol_oi: maxSigCallVolOI,
                    premium_flow: sigTopCall.premium || 0
                };
            } else {
                // Context-aware PUT interpretation based on research:
                // - ITM puts (strike > spot) = bearish conviction (paying intrinsic value)
                // - ATM puts (within 0.5% of spot) = directional bet, treat as bearish
                // - OTM puts (strike < spot by >0.5%) = protective hedge, "charm bid" (supportive)
                // - 0DTE ITM/ATM = often expiration mechanics, less directional signal
                const exp = sigTopPut.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((sigTopPut.premium || 0) / 1000000).toFixed(1);
                const strike = sigTopPut.strike;
                const dte = getDTE(sigTopPut.expiration);

                // Moneyness calculation
                const distFromSpot = (strike - price) / price * 100;  // positive = ITM, negative = OTM
                const isITM = distFromSpot > 0.5;   // Strike > spot by more than 0.5%
                const isATM = Math.abs(distFromSpot) <= 0.5;  // Within 0.5% of spot
                const isOTM = distFromSpot < -0.5;  // Strike < spot by more than 0.5%

                if ((isITM || isATM) && dte === 0) {
                    // 0DTE ITM/ATM = expiration mechanics (exercise, closing, gamma hedge)
                    signals.push(`🔥 Unusual PUT $${strike} 0DTE (expiration activity, ${maxSigPutVolOI.toFixed(1)}x, $${prem}M)`);
                    // Don't change direction - this is expiration noise
                } else if (isITM) {
                    // ITM with DTE = bearish conviction (someone paying intrinsic value)
                    signals.push(`🔥 Unusual PUT $${strike} ITM (bearish, ${maxSigPutVolOI.toFixed(1)}x, $${prem}M)`);
                    if (direction === 'neutral') direction = 'bearish';
                } else if (isATM) {
                    // ATM puts = directional bet at current price level
                    signals.push(`🔥 Unusual PUT $${strike} ATM (bearish, ${maxSigPutVolOI.toFixed(1)}x, $${prem}M)`);
                    if (direction === 'neutral') direction = 'bearish';
                } else {
                    // OTM puts = protective hedge, creates "charm bid" (supportive, not bearish)
                    // 62.5% WR standalone, 100% WR when combined with ENGAGED wall (5/5)
                    hasOtmPutHedge = true;
                    signals.push(`🔥 Unusual PUT $${strike} OTM (hedge, ${maxSigPutVolOI.toFixed(1)}x, $${prem}M)`);
                    // OTM puts are hedges - don't flag as bearish
                }

                // Capture structured option data for signal tracking (all PUT cases)
                const expFmt = (sigTopPut.expiration || '').replace(/-/g, '').slice(2);
                unusualOption = {
                    contract: `.${symbol}${expFmt}P${strike}`,
                    type: 'PUT',
                    strike: strike,
                    expiration: sigTopPut.expiration,
                    dte: dte,
                    vol_oi: maxSigPutVolOI,
                    premium_flow: sigTopPut.premium || 0
                };
            }
        } else if (maxCallVolOI >= 2 || maxPutVolOI >= 2) {
            // No score — elevated flow (2-5x) has 50% WR (n=5), no proven edge.
            // Annotation only with $250K premium floor to avoid noise.
            const MIN_ELEVATED_PREMIUM = 250000;
            if (maxCallVolOI > maxPutVolOI && (topCall?.premium || 0) >= MIN_ELEVATED_PREMIUM) {
                const exp = topCall.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topCall.premium || 0) / 1000000).toFixed(1);
                signals.push(`ℹ️ Elevated call $${topCall.strike} ${exp} (${maxCallVolOI.toFixed(1)}x, $${prem}M)`);
            } else if (maxPutVolOI >= maxCallVolOI && (topPut?.premium || 0) >= MIN_ELEVATED_PREMIUM) {
                const exp = topPut.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topPut.premium || 0) / 1000000).toFixed(1);
                signals.push(`ℹ️ Elevated put $${topPut.strike} ${exp} (${maxPutVolOI.toFixed(1)}x, $${prem}M)`);
            }
        }

        // Flow direction alignment annotation (informational, no score change)
        if (maxCallVolOI >= 2 || maxPutVolOI >= 2) {
            const flowDirection = (maxCallVolOI > maxPutVolOI) ? 'bullish' : 'bearish';
            if (direction !== 'neutral' && direction !== 'pinned' && flowDirection !== direction) {
                signals.push(`⚠️ Flow direction (${flowDirection}) opposes signal (${direction})`);
            }
        }

        // Net premium direction
        const netPremium = opts.net_premium || 0;
        const cpRatio = opts.call_put_ratio || 1;

        if (Math.abs(netPremium) >= 10000000) { // $10M+ net premium
            // No score — net premium has 29% WR (9W/22L). Annotation only.
            const premDir = netPremium > 0 ? 'bullish' : 'bearish';
            signals.push(`ℹ️ $${(Math.abs(netPremium) / 1000000).toFixed(0)}M net ${premDir} premium`);
        }

        // Call/Put ratio extremes (audit: HEAVY_CALLS 31.4% WR = anti-signal; HEAVY_PUTS 50% = edge)
        if (cpRatio >= 2) {
            scores.standard -= 3;  // Heavy calls = 31.4% 5d WR (n=51)
            signals.push(`Heavy call bias (${cpRatio.toFixed(2)} C/P) [-3]`);
        } else if (cpRatio <= 0.5) {
            hasHeavyPuts = true;  // Heavy puts at put wall = 89% 3d WR combo
            signals.push(`Heavy put bias (${cpRatio.toFixed(2)} C/P)`);
        }
    }

    // === COMBO BONUS: ENGAGED WALL + OTM PUT HEDGE (100% WR, 5/5 signals) ===
    // Institutions hedging longs with OTM puts while the wall is actively defended.
    // HOOD +7.2%, GOOG +2.2%, AAPL +4.3%, TSLA +3.7%, NVDA +4.9% — zero losses.
    if (wallActivity?.status === 'ENGAGED' && hasOtmPutHedge) {
        scores.highEdge += 12;
        signals.unshift('⭐ SMART FLOW: Engaged wall + OTM PUT hedge (100% WR)');
    }

    // === AUDIT-VALIDATED COMBO BONUSES (Feb 2026, 517 observations) ===
    // These combos showed 70%+ WR at 3d/5d horizon with n>=5.
    // Only ONE combo fires per signal (best match, no stacking).
    let comboFired = false;

    // AT_PUT_WALL + HEAVY_PUTS: 89% 3d (n=9), 80% 5d (n=5)
    if (!comboFired && atPutWall && hasHeavyPuts) {
        scores.standard += 10;
        signals.unshift('⭐ COMBO: Put wall + Heavy puts (89% 3d WR)');
        comboFired = true;
    }
    // UPPER_BB + WALL_DORMANT: 89% 3d (n=9)
    if (!comboFired && hasUpperBB && wallIsDormant) {
        scores.standard += 8;
        signals.unshift('⭐ COMBO: Upper BB + Dormant wall (89% 3d WR)');
        comboFired = true;
    }
    // RSI_OVERBOUGHT + WALL_DORMANT: 83% 3d (n=12)
    if (!comboFired && isOverbought && wallIsDormant) {
        scores.standard += 8;
        signals.unshift('⭐ COMBO: RSI overbought + Dormant wall (83% 3d WR)');
        comboFired = true;
    }
    // AT_PUT_WALL + ELEVATED_VOLUME: 80% 3d (n=15) — best sample size
    if (!comboFired && atPutWall && hasElevatedVolume) {
        scores.standard += 8;
        signals.unshift('⭐ COMBO: Put wall + Volume spike (80% 3d WR)');
        comboFired = true;
    }
    // CONFLUENCE_ZONE + UPPER_BB: 70% 5d (n=10)
    if (!comboFired && hasConfluenceZone && hasUpperBB) {
        scores.standard += 8;
        signals.unshift('⭐ COMBO: Confluence zone + Upper BB (70% 5d WR)');
        comboFired = true;
    }

    // --- CROSS-SCANNER FLOW CONFIRMATION (Opportunity Scanner independently flagged this symbol) ---
    const oppFlow = discoveryData?.oppFlow;
    if (oppFlow) {
        if (oppFlow.tier === 'HIGH_CONVICTION') {
            scores.standard += 8;
            const volStr = oppFlow.volOiRatio ? ` ${oppFlow.volOiRatio.toFixed(1)}x` : '';
            const premStr = oppFlow.netPremium ? ` $${(Math.abs(oppFlow.netPremium) / 1e6).toFixed(1)}M` : '';
            signals.push(`📡 Flow confirmed by Opportunity Scanner (HC${volStr}${premStr}) [+8]`);
        } else if (oppFlow.tier === 'TRADEABLE') {
            scores.standard += 5;
            const volStr = oppFlow.volOiRatio ? ` ${oppFlow.volOiRatio.toFixed(1)}x` : '';
            signals.push(`📡 Flow confirmed by Opportunity Scanner (T${volStr}) [+5]`);
        }
    }

    // --- ANNOTATION: Discovery source (no score — unproven, Feb 2026 factor analysis) ---
    if (discoveryData) {
        if (discoveryData.sources?.includes('ai_outlook')) {
            signals.push(`ℹ️ AI Outlook highlight`);
        }
    }

    // --- CONTEXT & VIX SCORING ---
    if (marketContext) {
        const spyTrend = marketContext.spyTrend;
        const vix = marketContext.vix || 0;

        // Skip SPY trend comparison for index ETFs (SPY can't be counter-trend to itself)
        const isIndexETF = symbol === 'SPY' || symbol === 'QQQ';

        if (isIndexETF) {
            // SPY/QQQ: 0% WR in 19 signals. Index ETFs have circular confluence —
            // "SPY at SPY's put wall during bullish SPY trend" is self-referential.
            // Penalize to require stronger non-market factors for conviction.
            scores.standard -= 8;
            signals.push(`Index ETF penalty (self-referential confluence)`);
            signals.push(`Market: VIX ${vix.toFixed(1)}`);
        }
        else if (direction === 'pinned') {
            signals.push(`Market: SPY ${spyTrend}, VIX ${vix.toFixed(1)}`);
        }
        // Dip buy: 22.2% WR at 4h (n=9), 75% at 24h (n=4). Promising at 24h but sample too small.
        // Annotation only until n=20+ at 24h confirms.
        else if (direction === 'bullish' && spyTrend === 'bearish') {
            signals.push(`ℹ️ Dip buy setup (SPY ${spyTrend})`);
        }
        // Chasing: 0 signals in DB (penalty prevented logging). Annotation only until proven.
        else if (direction === 'bullish' && spyTrend === 'bullish') {
            signals.push(`ℹ️ Chasing (aligned SPY ${spyTrend})`);
        }
        else if (direction !== 'neutral' && spyTrend && direction !== spyTrend) {
            // No penalty — counter-trend signals have 54.7% WR vs 46.7% with-trend.
            // System is a mean-reversion detector; penalizing counter-trend hurts performance.
            signals.push(`Counter-trend (against SPY ${spyTrend})`);
        }

        // --- HIGH-EDGE FACTOR: VIX ELEVATED/FEAR (66.7% win rate) ---
        if (vix >= SETTINGS.VIX_FEAR) {
            scores.highEdge += 15;
            signals.push(`🔥 VIX fear (${vix.toFixed(1)}) - quality entries`);
        } else if (vix >= SETTINGS.VIX_ELEVATED) {
            scores.highEdge += 10;
            signals.push(`VIX elevated (${vix.toFixed(1)})`);
        }

        // --- ANNOTATION: Multi-timeframe alignment (no score — unproven, Feb 2026 factor analysis) ---
        if (marketContext.intradayBias && marketContext.swingBias) {
            const swingBias = marketContext.swingBias.toLowerCase();
            const intradayBias = marketContext.intradayBias.toLowerCase();

            const setupAligned = (direction === 'bullish' && swingBias === 'bullish') ||
                                 (direction === 'bearish' && swingBias === 'bearish');
            const tfAligned = swingBias === intradayBias;

            if (setupAligned && tfAligned) {
                signals.push(`ℹ️ TF aligned: both ${marketContext.swingBias}`);
            } else if (setupAligned && !tfAligned) {
                signals.push(`ℹ️ Swing ${marketContext.swingBias}, intraday ${marketContext.intradayBias}`);
            }
        }
    }

    // --- ANNOTATION: Sector Relative Strength (no score — unproven, Feb 2026 factor analysis) ---
    let symbolRsData = null;
    if (rsContext) {
        symbolRsData = getSymbolRsPercentile(symbol, rsContext);
        if (symbolRsData) {
            const pct = symbolRsData.percentile;
            if (pct >= 75) {
                signals.push(`ℹ️ Strong sector RS (${symbolRsData.sectorEtf} top quartile, ${pct.toFixed(0)}th pctl)`);
            } else if (pct >= 50) {
                signals.push(`ℹ️ Above-avg sector RS (${symbolRsData.sectorEtf}, ${pct.toFixed(0)}th pctl)`);
            } else if (pct >= 25) {
                signals.push(`ℹ️ Weak sector RS (${symbolRsData.sectorEtf}, ${pct.toFixed(0)}th pctl)`);
            } else {
                signals.push(`ℹ️ Sector headwind (${symbolRsData.sectorEtf} bottom quartile, ${pct.toFixed(0)}th pctl)`);
            }
        }
    }

    // --- WARNING: Flow + sector headwind (audit Feb 2026: +3.4pp delta, annotation only) ---
    // QCOM lesson: bullish flow in bottom-quartile sector underperforms.
    // Delta too small for scoring change (3.4pp < 10pp threshold), but worth flagging.
    if (oppFlow && symbolRsData && symbolRsData.percentile < 25) {
        signals.push(`⚠️ Flow + sector headwind (${symbolRsData.sectorEtf} bottom quartile) — reduced conviction`);
    }

    // --- ANNOTATION: MA Structure Alignment (no score — pending backtest validation) ---
    const sma20 = technicals.sma_20;
    const sma50 = technicals.sma_50;

    if (sma20 != null && sma50 != null && sma50 > 0) {
        const maStructure = sma20 > sma50 ? 'bullish' : 'bearish';
        const maSeparation = ((sma20 - sma50) / sma50 * 100).toFixed(1);

        if (direction === 'bullish' || direction === 'bearish') {
            if (maStructure === direction) {
                signals.push(`MA trend confirmed (SMA20 ${maStructure === 'bullish' ? '>' : '<'} SMA50, ${maSeparation}%)`);
            } else {
                signals.push(`⚠️ MA opposes signal (SMA20 ${sma20 > sma50 ? '>' : '<'} SMA50, ${maSeparation}%)`);
            }
        }
    }

    // --- ANNOTATION: Price near SMA 50 (no score — pending backtest validation) ---
    if (sma50 != null && sma50 > 0) {
        const distToSma50 = ((price - sma50) / sma50 * 100);

        if (Math.abs(distToSma50) <= 1.0) {
            const label = direction === 'bearish' ? 'resistance' : 'support';
            signals.push(`Near SMA 50 ${label} ($${sma50.toFixed(2)}, ${distToSma50 >= 0 ? '+' : ''}${distToSma50.toFixed(1)}%)`);
        }
    }

    // --- STANDARD FACTOR: MA Bounce Detection (backtest-validated, +8 to +12 pts) ---
    // MAs computed from daily history (correct — daily MAs need daily candles).
    // Bounce condition checked against LIVE quote data (real-time intraday high/low).
    let bounceResult = null;
    const candles = bounceHistoryCache?.get(symbol);
    if (candles) {
        // Fetch today's intraday high/low from quote API (only for bounce-configured symbols)
        await new Promise(r => setTimeout(r, 100));
        const quote = await fetchJSON(`${APIS.options}/api/quotes/${symbol}`, 15000);
        const q = quote?.quote || {};
        const liveData = {
            price,                                     // Real-time from levels/technicals API
            high: q.highPrice || technicals.recent_high || 0,   // Today's intraday high
            low: q.lowPrice || technicals.recent_low || 0       // Today's intraday low
        };
        bounceResult = maBounce.detectBounce(symbol, candles, rsi, liveData);
    } else if (maBounce.MA_BOUNCE_CONFIG[symbol]) {
        // Validated symbol but no cached history (shouldn't happen, but handle gracefully)
        bounceResult = { detected: false, symbol, validated: true, reason: 'no_cache' };
    }
    // else: unvalidated symbol — no bounce check needed

    if (bounceResult?.detected) {
        const dirAligns = (bounceResult.direction === 'bullish' && (direction === 'bullish' || direction === 'neutral')) ||
                          (bounceResult.direction === 'bearish' && (direction === 'bearish' || direction === 'neutral'));

        if (bounceResult.scorePoints > 0 && dirAligns) {
            scores.standard += bounceResult.scorePoints;
            signals.push(`✅ ${bounceResult.annotation}`);
        } else {
            // Annotation only: unvalidated, bearish, or direction misaligned
            signals.push(bounceResult.annotation);
        }
    }

    // --- STANDARD FACTOR: Divergence + BB Detection (backtest-validated, +8 to +14 pts) ---
    let divBbResult = null;
    const divBbCandles = divBbHistoryCache?.get(symbol);
    if (divBbCandles) {
        divBbResult = divergenceBb.detectDivergenceBB(symbol, divBbCandles, rsi);
    }

    if (divBbResult?.detected) {
        const dirAligns = (divBbResult.direction === 'bullish' && direction !== 'bearish') ||
                          (divBbResult.direction === 'bearish' && direction !== 'bullish');

        if (divBbResult.scorePoints > 0 && dirAligns) {
            scores.standard += divBbResult.scorePoints;
            signals.push(`✅ ${divBbResult.annotation}`);
        } else {
            signals.push(divBbResult.annotation);
        }
    }

    // --- HISTORY STATUS (audit: STREAK no 5d data; NEW no 5d data; DAY_2 and RETURNED = bad) ---
    if (historyStatus?.label === 'STREAK') {
        // No score — no 5d data in audit. Annotation only.
        signals.push(`📈 Streak (${historyStatus.consecutive_days} consecutive days)`);
    } else if (historyStatus?.label === 'NEW') {
        scores.standard += 3;
        signals.push(`🆕 New discovery`);
    } else if (historyStatus?.label === 'DAY_2') {
        scores.standard -= 5;
        signals.push(`⚠️ Day 2 setup — historically weak (23% WR)`);
    } else if (historyStatus?.label === 'RETURNED') {
        scores.standard -= 3;
        signals.push(`⚠️ Returned setup — historically weak (31% WR)`);
    }

    // --- MARKET INTERNALS / BREADTH CONFIRMATION ---
    // Strategy 10: Breadth Extreme Trading — tiered thresholds from $TICK/$ADD framework
    // No score — internals unproven. Annotation only (Feb 2026 factor analysis).
    if (latestInternals && direction !== 'neutral' && direction !== 'pinned') {
        const tick = latestInternals.tick;
        const adSpread = latestInternals.ad_spread;
        const volRatio = latestInternals.vol_ratio;

        // Tiered breadth classification (TICK: ±600/±800/±1000, A/D: ±1000/±1500/±2000)
        let tickSignal = 'neutral';
        if (tick > 1000) tickSignal = 'extreme_bull';
        else if (tick > 600) tickSignal = 'bull';
        else if (tick < -1000) tickSignal = 'extreme_bear';
        else if (tick < -600) tickSignal = 'bear';

        let adSignal = 'neutral';
        if (adSpread > 2000) adSignal = 'extreme_bull';
        else if (adSpread > 1000) adSignal = 'bull';
        else if (adSpread < -2000) adSignal = 'extreme_bear';
        else if (adSpread < -1000) adSignal = 'bear';

        const volBullish = volRatio > 1.5;
        const volBearish = volRatio < 0.67;

        // Dual extreme = strongest signal (Strategy 10C)
        const dualExtremeBull = tickSignal === 'extreme_bull' && (adSignal === 'extreme_bull' || adSignal === 'bull');
        const dualExtremeBear = tickSignal === 'extreme_bear' && (adSignal === 'extreme_bear' || adSignal === 'bear');

        // Count bullish/bearish signals across all three internals
        let bullishCount = 0;
        let bearishCount = 0;
        if (tickSignal.includes('bull')) bullishCount++;
        if (tickSignal.includes('bear')) bearishCount++;
        if (adSignal.includes('bull')) bullishCount++;
        if (adSignal.includes('bear')) bearishCount++;
        if (volBullish) bullishCount++;
        if (volBearish) bearishCount++;

        const tickStr = `TICK ${tick > 0 ? '+' : ''}${tick}`;
        const adStr = `A/D ${adSpread > 0 ? '+' : ''}${adSpread}`;

        if (dualExtremeBull) {
            signals.push(`⚡ Breadth dual extreme bullish (${tickStr}, ${adStr}) — exhaustion risk`);
        } else if (dualExtremeBear) {
            signals.push(`⚡ Breadth dual extreme bearish (${tickStr}, ${adStr}) — capitulation zone`);
        } else if (direction === 'bullish' && bullishCount >= 2) {
            const strength = tickSignal === 'extreme_bull' || adSignal === 'extreme_bull' ? '📊 Breadth strong' : 'ℹ️ Breadth';
            signals.push(`${strength} confirms bullish (${tickStr}, ${adStr})`);
        } else if (direction === 'bearish' && bearishCount >= 2) {
            const strength = tickSignal === 'extreme_bear' || adSignal === 'extreme_bear' ? '📊 Breadth strong' : 'ℹ️ Breadth';
            signals.push(`${strength} confirms bearish (${tickStr}, ${adStr})`);
        } else if (direction === 'bullish' && bearishCount >= 2) {
            signals.push(`ℹ️ Breadth opposes bullish (${tickStr}, ${adStr})`);
        } else if (direction === 'bearish' && bullishCount >= 2) {
            signals.push(`ℹ️ Breadth opposes bearish (${tickStr}, ${adStr})`);
        }
    }

    // ============================================
    // FINAL SCORE (0-100 scale, combo-first architecture)
    // Updated Feb 2026 audit (517 obs, R²=0.009 on old formula)
    //
    // Base: AT_WALL(+15) + EXTENDED_RSI combo (+20/+35) = 0-50
    // HighEdge: VIX(+10/+15) + smart flow combo(+12) = 0-27
    // Standard: Upper BB(+5), combos(+8/+10), penalties, history = ±25
    //
    // REMOVED from scoring (audit-invalidated):
    //   - VOLUME_SPIKE (+20→0): 12.0% 5d WR (n=25)
    //   - WALL_ENGAGED (+8→0): 34.5% WR (n=29)
    //   - PINNED (+15→0): 20.8% WR (n=24), survivorship bias
    //   - LOWER_BB (+5→0): 33.9% WR (n=59), at baseline
    //   - RSI_OVERSOLD standalone (+15→0): 26.3% WR (n=38)
    //   - STREAK (+5→0): no 5d data
    //   - WALL_DORMANT penalty (-3→0): appears in winning combos
    //
    // ADDED (audit-validated combos):
    //   - AT_PUT_WALL + HEAVY_PUTS (+10): 89% 3d, 80% 5d
    //   - UPPER_BB + WALL_DORMANT (+8): 89% 3d
    //   - RSI_OVERBOUGHT + WALL_DORMANT (+8): 83% 3d
    //   - AT_PUT_WALL + ELEVATED_VOLUME (+8): 80% 3d
    //   - CONFLUENCE_ZONE + UPPER_BB (+8): 70% 5d
    //
    // PENALIZED (anti-signals):
    //   - UNUSUAL_CALL (-5): 27.9% WR (n=61)
    //   - HEAVY_CALLS (-3): 31.4% WR (n=51)
    //   - Afternoon signals (2-4PM ET): capped at WATCH
    //   - Pinned direction: capped at WATCH (20% WR)
    //
    // KEPT: RSI_OVERBOUGHT (+15, 85.7% WR), Upper BB (+5, 56.3% WR),
    //   VIX (+10/+15), Wall ACTIVE (-8), Smart Flow (+12, 100% WR)
    // ============================================

    // Raw score uncapped — preserves differentiation at the top.
    // Components can sum to ~115, so capping at 100 lost signal quality.
    // Display score is capped at 100 for UI, but raw score used for tier ranking.
    const rawScore = Math.max(0, scores.base + scores.highEdge + scores.standard);
    const totalScore = Math.min(100, rawScore);

    if (totalScore >= 70) {
        signals.push(`🎯 HIGH CONFLUENCE (${totalScore}/100)`);
    }

    // Track if this is a "prime setup" for tier determination
    const isPrimeSetup = atWallCondition && extendedRsiCondition;
    const hasProvenCombo = isPrimeSetup || comboFired;

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
        if (atCallWall) {
            zone = 'SELL_ZONE';
            action = 'SELL';
        }
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

    // Extended high = reversal watch (excluded from tradeable tiers via badZones)
    if (zone === 'EXTENDED_HIGH' && direction === 'bullish') {
        signals.push(`📍 Extended high - reversal watch`);
        // Note: direction stays 'bullish' — badZones excludes EXTENDED_HIGH from tradeable tiers
        // Previously this set direction='pinned' which polluted pinned stats (0% WR, 29 signals)
    }

    // ============================================
    // DATA-DRIVEN TIER ASSIGNMENT
    // Based on 223 signal backtest (Jan 20 - Feb 13, 2026):
    // - BUY_ZONE + bullish: 75.3% WR (core setup)
    // - Score 60+: 63.1% WR | Score 50-59: 28.6% WR → threshold raised to 60
    // - Elevated VIX: 92.9% WR | Normal VIX: 57.6% WR
    // - Bearish SPY (dip buy): 100% WR | Bullish SPY (chase): 42.9% WR
    // - Pinned/bearish/neutral direction: 0% WR → capped at WATCH
    // - RETURNED signals: 11.1% WR → capped at WATCH
    // ============================================

    // Exclude historically bad zones from tradeable tiers
    const badZones = ['EXTENDED_HIGH', 'HIGH_MOMENTUM'];
    const notBadZone = !badZones.includes(zone);

    // HIGH_CONVICTION: Prime setup (AT_WALL + EXTENDED_RSI) with strong score
    // Data: prime signals 40-54 have 33% WR → threshold raised to 55
    if (isPrimeSetup && totalScore >= 55 && notBadZone) {
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
    // WATCH: Pinned with good score (audit: PINNED 20.8% 5d WR — watch only, not tradeable)
    else if (zone === 'PINNED' && totalScore >= SETTINGS.TIER_TRADEABLE) {
        tier = 'WATCH';
        action = 'WATCH_BREAKOUT';
    }

    // ============================================
    // DATA-DRIVEN TIER ADJUSTMENTS (223 signals)
    // ============================================

    // VIX REGIME BOOST: REMOVED (Feb 2026 factor analysis)
    // Original claim: 92.9% WR. Fresh analysis: 16.7% WR (n=6).
    // The signals that needed the boost to reach HC lacked natural confluence.
    // VIX elevated/fear SCORING still applies (+10/+15 highEdge) — only tier promotion removed.

    // TIER CAPS (data-driven)
    // RETURNED: 31% WR → capped at WATCH
    if (historyStatus?.label === 'RETURNED' && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
        tier = 'WATCH';
        tradeable = false;
    }
    // DAY_2: 30% WR, avg -6.5% drawdown → capped at WATCH
    if (historyStatus?.label === 'DAY_2' && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
        tier = 'WATCH';
        tradeable = false;
    }
    // Pinned direction: capped at WATCH (audit: 20.0% 5d WR n=40)
    if (direction === 'pinned' && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
        tier = 'WATCH';
        tradeable = false;
    }
    // SPY/QQQ: capped at WATCH (Feb 2026 factor analysis)
    // SPY 17% WR, QQQ 29% WR — self-referential confluence (already has -8 penalty, but needs tier cap too)
    if ((symbol === 'SPY' || symbol === 'QQQ') && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
        tier = 'WATCH';
        tradeable = false;
        signals.push(`Index ETF capped at WATCH (${symbol} ${symbol === 'SPY' ? '17' : '29'}% HC WR)`);
    }
    // Bearish/neutral direction: capped at WATCH (Feb 2026 factor analysis)
    // Bearish: 0% WR (n=4), Neutral: 0% WR (n=1) — insufficient evidence for tradeable tiers.
    // Note: counter-trend BULLISH signals during bearish SPY are different (dip buy = high WR).
    // This cap only affects signals where the SIGNAL ITSELF is bearish/neutral direction.
    // Exception: proven combos (isPrimeSetup || comboFired) have 80-89% WR (n=9-15), overrides cap.
    if ((direction === 'bearish' || direction === 'neutral') && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE') && !hasProvenCombo) {
        tier = 'WATCH';
        tradeable = false;
        signals.push(`⚠️ ${direction} direction capped at WATCH (0% HC WR)`);
    }
    if ((direction === 'bearish' || direction === 'neutral') && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE') && hasProvenCombo) {
        signals.push(`ℹ️ ${direction} direction — proven combo overrides cap`);
    }
    // Afternoon dead zone: 21.2% 5d WR (n=52) — cap at WATCH (2-4 PM ET)
    const now = new Date();
    const etHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    if (etHour >= 14 && etHour < 16 && (tier === 'HIGH_CONVICTION' || tier === 'TRADEABLE')) {
        tier = 'WATCH';
        tradeable = false;
        signals.push(`⚠️ Afternoon window (${etHour}:xx ET) — capped at WATCH (21% WR)`);
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

    // AUDIT WARNING: Call flow + oversold + put wall = TRAP (0-20% 5d WR)
    // "Smart Money Dip Buy" was invalidated — unusual call flow at support predicts further downside.
    const hasRsiOversold = signals.some(s => s.includes('RSI oversold'));
    const hasUnusualCall = signals.some(s => s.includes('Unusual CALL'));
    const hasAtPutWall = signals.some(s => s.includes('put wall support'));

    if (hasRsiOversold && hasUnusualCall && hasAtPutWall) {
        signals.unshift('⚠️ TRAP PATTERN: Call flow at oversold support (20% WR — dip keeps dipping)');
    }

    return {
        symbol,
        price,
        direction,
        totalScore,
        rawScore,  // Uncapped score for ranking/differentiation
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
            volumeSignal: technicals.volume_signal,
            sma20: sma20 || null,
            sma50: sma50 || null
        },
        fibonacci: null,  // Removed — underperformed (38.9% vs 51.5% WR), can re-implement later
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
        sectorRs: symbolRsData,
        // History status (pre-computed for tier caps and display)
        history_status: historyStatus,
        // MA bounce detection
        maBounce: bounceResult,
        // Divergence + BB detection
        divergenceBb: divBbResult
    };
}

// ============================================
// ALERT GENERATION
// ============================================

function shouldAlert(analysis) {
    if (!analysis) return false;
    if (analysis.totalScore < SETTINGS.minConfluenceScore) return false;

    const existing = setupTracker.get(analysis.symbol);
    if (!existing) return true; // New symbol, always alert

    // Setup changed (zone or direction shifted) = genuinely new signal
    if (existing.zone !== analysis.zone || existing.direction !== analysis.direction) {
        return true;
    }

    // Score jumped significantly (new confluence factor appeared)
    if (analysis.totalScore - existing.score >= DEDUP.scoreJumpThreshold) {
        return true;
    }

    // Same setup — enforce extended cooldown
    if (Date.now() - existing.lastAlerted < DEDUP.sameSetupCooldownMs) {
        return false;
    }

    // Same setup but 4h passed — allow re-alert up to max per day
    if (existing.alertCount >= DEDUP.maxAlertsPerSetup) {
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
 * Collect warning annotations for alerts.
 * Tier caps (RETURNED, pinned) are applied in analyzeSymbol() before this runs.
 * This function adds informational warnings for display in Telegram/dashboard.
 * Returns { tier: string, warnings: string[] }
 */
function getAlertTier(analysis, ctx) {
    let tier = analysis.tier || 'FILTERED';
    if (tier === 'FILTERED') return { tier: 'FILTERED', warnings: [] };

    const warnings = [];

    if (!isTimeframeAligned(analysis, ctx)) {
        const swingDir = (ctx?.swingBias || 'UNKNOWN').toUpperCase();
        warnings.push(`Counter-trend (swing: ${swingDir})`);
    }

    if (analysis.atWall && analysis.wallActivity === 'DORMANT') {
        warnings.push('Dormant wall');
    }

    // Data-driven warnings (tier already capped in analyzeSymbol)
    if (analysis.history_status?.label === 'RETURNED') {
        warnings.push('Returned setup (11% win rate)');
    }
    if (analysis.direction === 'pinned') {
        warnings.push('Pinned direction (0% win rate)');
    }
    if (analysis.direction === 'bearish') {
        warnings.push('Bearish direction (0% historical win rate)');
    }
    if (analysis.direction === 'neutral') {
        warnings.push('Neutral direction (0% historical win rate)');
    }

    return { tier, warnings };
}

function formatAlert(analysis, tierLabel = 'HIGH_CONVICTION') {
    const dirEmoji = analysis.direction === 'bullish' ? '🟢' :
                     analysis.direction === 'bearish' ? '🔴' :
                     analysis.direction === 'pinned' ? '📍' : '⚪';

    const scoreEmoji = tierLabel === 'HIGH_CONVICTION'
        ? (analysis.totalScore >= 60 ? '🔥' : '⭐')
        : '📊';

    const headerLabel = tierLabel === 'HIGH_CONVICTION' ? 'BLOODHOUND' : 'BLOODHOUND TRADEABLE';

    const timeStr = formatTimePST();

    let msg = `${scoreEmoji} <b>${headerLabel}: ${escapeHtml(analysis.symbol)}</b> ${dirEmoji}\n`;
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
    previousVixRegime: null,  // Track for regime change alerts
    // VIX hysteresis: require 3 consecutive readings in new regime before alerting
    // Prevents chatter when VIX oscillates near thresholds (Feb 12: 13 alerts in one day)
    vixRegimeCandidate: null,   // The regime we're seeing but haven't confirmed
    vixRegimeConsecutive: 0,    // How many consecutive scans in candidate regime
    // Breadth extreme detection (Strategy 10: Breadth Extreme Trading)
    previousBreadthState: null,     // 'extreme_bullish' | 'extreme_bearish' | 'strong_bullish' | 'strong_bearish' | 'normal'
    breadthStateCandidate: null,    // Hysteresis candidate
    breadthStateConsecutive: 0,     // Consecutive readings count
    breadthAlertCooldown: null      // Timestamp of last breadth alert (30-min cooldown)
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
            const count = setupTracker.size;
            setupTracker.clear();
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

let _scanInProgress = false;

async function runScan() {
    // Prevent overlapping scans
    if (_scanInProgress) {
        console.log(`[${new Date().toISOString()}] ⏳ Scan already in progress — skipping`);
        return;
    }
    _scanInProgress = true;

    try {
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

        // VIX Regime Change Detection with hysteresis
        // Requires 3 consecutive readings (~15 min) in new regime before alerting.
        // Prevents chatter when VIX oscillates near thresholds.
        // (2026-02-17 audit: Feb 12 had 13 alerts in one day from VIX bouncing 19.77-20.26)
        const currentRegime = marketContext.vixRegime;
        const REGIME_CONFIRM_COUNT = 3;  // Consecutive scans needed to confirm regime change

        if (scannerState.previousVixRegime && currentRegime !== scannerState.previousVixRegime) {
            // Regime differs from confirmed — track as candidate
            if (currentRegime === scannerState.vixRegimeCandidate) {
                scannerState.vixRegimeConsecutive++;
            } else {
                // New candidate — reset counter
                scannerState.vixRegimeCandidate = currentRegime;
                scannerState.vixRegimeConsecutive = 1;
            }

            if (scannerState.vixRegimeConsecutive >= REGIME_CONFIRM_COUNT) {
                // Confirmed regime change — alert
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
                    `<b>VIX:</b> ${marketContext.vix}\n` +
                    `<b>Confirmed:</b> ${REGIME_CONFIRM_COUNT} consecutive readings\n\n` +
                    `<i>${formatTimePST()} PST</i>`;
                await sendTelegram(vixMsg);
                console.log(`[VIX] Regime change confirmed: ${scannerState.previousVixRegime} → ${currentRegime} (${REGIME_CONFIRM_COUNT} readings)`);

                // Log to database
                try {
                    signalDb.insertAlert({
                        type: 'VIX_REGIME',
                        priority: currentRegime === 'fear' || currentRegime === 'capitulation' ? 'HIGH' : 'MEDIUM',
                        message: `VIX regime change: ${scannerState.previousVixRegime} → ${currentRegime}`,
                        details: {
                            from: scannerState.previousVixRegime,
                            to: currentRegime,
                            vix: marketContext.vix,
                            spy_price: marketContext.spyPrice,
                            consecutive_readings: REGIME_CONFIRM_COUNT
                        }
                    });
                } catch (e) {
                    console.error(`[VIX] Failed to log alert to DB:`, e.message);
                }

                // Update confirmed regime and reset candidate
                scannerState.previousVixRegime = currentRegime;
                scannerState.vixRegimeCandidate = null;
                scannerState.vixRegimeConsecutive = 0;
            } else {
                console.log(`[VIX] Regime candidate: ${currentRegime} (${scannerState.vixRegimeConsecutive}/${REGIME_CONFIRM_COUNT} readings)`);
            }
        } else {
            // Current matches confirmed regime — reset any candidate
            scannerState.vixRegimeCandidate = null;
            scannerState.vixRegimeConsecutive = 0;
            if (!scannerState.previousVixRegime) {
                scannerState.previousVixRegime = currentRegime;
            }
        }
    } else {
        console.log('[Context] Could not fetch market context');
    }

    // Signal validation moved to end of scan cycle (with priceCache) — see step 9

    // 1.6. Fetch market internals snapshot for scoring + breadth extreme detection
    latestInternals = signalDb.getLatestInternals();
    if (latestInternals) {
        console.log(`[Internals] TICK: ${latestInternals.tick}, A/D: ${latestInternals.ad_spread}, Vol Ratio: ${latestInternals.vol_ratio?.toFixed(2)}`);

        // Breadth Extreme Detection (Strategy 10: Breadth Extreme Trading)
        // Pattern-matches VIX regime alerts: hysteresis + cooldown to prevent chatter.
        const tick = latestInternals.tick;
        const adSpread = latestInternals.ad_spread;
        const volRatio = latestInternals.vol_ratio;

        // Classify breadth state from TICK + A/D thresholds
        let breadthState = 'normal';
        if (tick < -1000 && adSpread < -1500) breadthState = 'extreme_bearish';
        else if (tick > 1000 && adSpread > 1500) breadthState = 'extreme_bullish';
        else if (tick < -800 || adSpread < -1500) breadthState = 'strong_bearish';
        else if (tick > 800 || adSpread > 1500) breadthState = 'strong_bullish';

        const BREADTH_CONFIRM_COUNT = 1;  // Alert on first reading — extremes can be fleeting
        const BREADTH_COOLDOWN_MS = 0;  // No cooldown — will tune later if too noisy

        if (breadthState !== 'normal' && breadthState !== scannerState.previousBreadthState) {
            // Non-normal state differs from confirmed — track as candidate
            if (breadthState === scannerState.breadthStateCandidate) {
                scannerState.breadthStateConsecutive++;
            } else {
                scannerState.breadthStateCandidate = breadthState;
                scannerState.breadthStateConsecutive = 1;
            }

            if (scannerState.breadthStateConsecutive >= BREADTH_CONFIRM_COUNT) {
                // Confirmed breadth extreme — check cooldown before alerting
                const now = Date.now();
                const canAlert = !scannerState.breadthAlertCooldown ||
                    (now - scannerState.breadthAlertCooldown) > BREADTH_COOLDOWN_MS;

                if (canAlert) {
                    const isBearish = breadthState.includes('bearish');
                    const isExtreme = breadthState.includes('extreme');
                    const emoji = isBearish ? '📉' : '📈';
                    const direction = isBearish ? 'BEARISH' : 'BULLISH';
                    const level = isExtreme ? 'EXTREME' : 'STRONG';
                    const context = isExtreme
                        ? (isBearish
                            ? 'Dual extreme = capitulation zone. Watch for reversal at support.'
                            : 'Dual extreme = potential exhaustion at resistance.')
                        : (isBearish
                            ? 'Strong selling pressure. Monitor for support levels.'
                            : 'Strong buying pressure. Monitor for resistance levels.');

                    const breadthMsg = `${emoji} <b>BREADTH ${level} — ${direction}</b>\n\n` +
                        `<b>TICK:</b> ${tick > 0 ? '+' : ''}${tick}\n` +
                        `<b>A/D Spread:</b> ${adSpread > 0 ? '+' : ''}${adSpread}\n` +
                        `<b>Vol Ratio:</b> ${volRatio?.toFixed(2)}:1\n\n` +
                        `⚡ ${context}\n\n` +
                        `<i>${formatTimePST()} PST</i>`;
                    await sendTelegram(breadthMsg);
                    scannerState.breadthAlertCooldown = now;
                    console.log(`[Breadth] Alert sent: ${level} ${direction} (TICK ${tick}, A/D ${adSpread})`);

                    // Log to alerts database
                    try {
                        signalDb.insertAlert({
                            type: 'BREADTH_EXTREME',
                            priority: isExtreme ? 'HIGH' : 'MEDIUM',
                            message: `Breadth ${level.toLowerCase()} ${direction.toLowerCase()}: TICK ${tick}, A/D ${adSpread}`,
                            details: {
                                state: breadthState,
                                tick,
                                ad_spread: adSpread,
                                vol_ratio: volRatio,
                                vix: marketContext?.vix,
                                spy_price: marketContext?.spyPrice
                            }
                        });
                    } catch (e) {
                        console.error('[Breadth] Failed to log alert:', e.message);
                    }
                } else {
                    console.log(`[Breadth] ${level} ${direction} confirmed but in cooldown (${Math.round((BREADTH_COOLDOWN_MS - (now - scannerState.breadthAlertCooldown)) / 60000)}min remaining)`);
                }

                // Update confirmed state and reset candidate
                scannerState.previousBreadthState = breadthState;
                scannerState.breadthStateCandidate = null;
                scannerState.breadthStateConsecutive = 0;
            } else {
                console.log(`[Breadth] Candidate: ${breadthState} (${scannerState.breadthStateConsecutive}/${BREADTH_CONFIRM_COUNT} readings)`);
            }
        } else if (breadthState === 'normal' && scannerState.previousBreadthState && scannerState.previousBreadthState !== 'normal') {
            // Returned to normal — reset state silently
            scannerState.previousBreadthState = 'normal';
            scannerState.breadthStateCandidate = null;
            scannerState.breadthStateConsecutive = 0;
            console.log('[Breadth] Returned to normal');
        } else {
            // Same state — reset any candidate
            scannerState.breadthStateCandidate = null;
            scannerState.breadthStateConsecutive = 0;
            if (!scannerState.previousBreadthState) {
                scannerState.previousBreadthState = breadthState;
            }
        }
    }

    // 1.7. Fetch relative strength data from divergence scanner
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

    // 1.8. Pre-fetch MA bounce history for validated symbols (cached 24h)
    const bounceHistoryCache = new Map();
    const bounceSymbols = Object.keys(maBounce.MA_BOUNCE_CONFIG);
    const sleep100 = (ms) => new Promise(r => setTimeout(r, ms));
    let bounceFetchCount = 0;
    for (const bSym of bounceSymbols) {
        const history = await maBounce.fetchHistory(bSym);
        if (history?.candles) {
            bounceHistoryCache.set(bSym, history.candles);
            bounceFetchCount++;
        }
        if (bounceFetchCount > 0) await sleep100(200); // API pacing
    }
    console.log(`[MA-Bounce] Pre-fetched history for ${bounceFetchCount}/${bounceSymbols.length} validated symbols`);

    // 1.9. Pre-fetch divergence-BB history for configured symbols (reuses same cache)
    const divBbHistoryCache = new Map();
    const divBbSymbols = Object.keys(divergenceBb.DIVERGENCE_BB_CONFIG);
    let divBbFetchCount = 0;
    for (const sym of divBbSymbols) {
        // Reuse from bounce cache if already fetched
        if (bounceHistoryCache.has(sym)) {
            divBbHistoryCache.set(sym, bounceHistoryCache.get(sym));
            divBbFetchCount++;
        } else {
            const history = await maBounce.fetchHistory(sym);
            if (history?.candles) {
                divBbHistoryCache.set(sym, history.candles);
                divBbFetchCount++;
            }
            await sleep100(200);
        }
    }
    console.log(`[Div-BB] Pre-fetched history for ${divBbFetchCount}/${divBbSymbols.length} configured symbols`);

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

    // Attach cross-scanner flow data to each symbol for analyzeSymbol
    const oppFlowMap = discoveryContext.oppFlowMap || new Map();
    for (const symbolData of symbols) {
        if (oppFlowMap.has(symbolData.symbol)) {
            symbolData.oppFlow = oppFlowMap.get(symbolData.symbol);
        }
    }

    // 3. Analyze each symbol and track velocity
    const analyses = [];
    const velocityAlerts = [];

    // Helper for batched processing with delays
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < symbols.length; i++) {
        const symbolData = symbols[i];

        // Pace requests: adaptive delay based on API response times
        if (i > 0) {
            const paceDelay = backoffState.active ? backoffState.batchDelayMs : 200;
            await sleep(paceDelay);
        }

        let analysis = await analyzeSymbol(symbolData.symbol, symbolData, bounceHistoryCache, divBbHistoryCache);

        // Retry once for static watchlist symbols that failed
        if (!analysis && symbolData.sources?.includes('watchlist')) {
            console.warn(`[Bloodhound] ${symbolData.symbol} failed (watchlist), retrying in 2s...`);
            await sleep(2000);
            analysis = await analyzeSymbol(symbolData.symbol, symbolData, bounceHistoryCache, divBbHistoryCache);
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
            history_status: a.history_status  // Pre-computed in analyzeSymbol()
        };
    });

    const highConviction = tieredAnalyses.filter(a =>
        a.tier === 'HIGH_CONVICTION' && shouldAlert(a)
    );
    const tradeable = tieredAnalyses.filter(a => a.tier === 'TRADEABLE');
    const tradeableAlerts = tradeable.filter(a => shouldAlert(a));
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

    // Helper: build signal log data from analysis
    function buildSignalLogData(analysis) {
        const logData = {
            symbol: analysis.symbol,
            price: analysis.price,
            direction: analysis.direction,
            score: analysis.totalScore,
            zone: analysis.zone,
            tier: analysis.tier,
            signals: analysis.signals,
            source: 'bloodhound',
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

        return logData;
    }

    // Send Telegram alerts for HIGH_CONVICTION
    if (highConviction.length > 0) {
        console.log(`\n[Alerts] Sending ${highConviction.length} HIGH CONVICTION alert(s)...`);
        for (const analysis of highConviction) {
            const message = formatAlert(analysis, 'HIGH_CONVICTION');
            await sendTelegram(message);

            // Track setup fingerprint for deduplication
            const existing = setupTracker.get(analysis.symbol);
            setupTracker.set(analysis.symbol, {
                zone: analysis.zone,
                direction: analysis.direction,
                score: analysis.totalScore,
                firstSeen: existing?.firstSeen || Date.now(),
                lastAlerted: Date.now(),
                alertCount: (existing?.alertCount || 0) + 1
            });

            await signalLogger.logSignal(buildSignalLogData(analysis));
        }
    }

    // Send Telegram alerts for TRADEABLE
    if (tradeableAlerts.length > 0) {
        console.log(`\n[Alerts] Sending ${tradeableAlerts.length} TRADEABLE alert(s)...`);
        for (const analysis of tradeableAlerts) {
            const message = formatAlert(analysis, 'TRADEABLE');
            await sendTelegram(message);

            const existing = setupTracker.get(analysis.symbol);
            setupTracker.set(analysis.symbol, {
                zone: analysis.zone,
                direction: analysis.direction,
                score: analysis.totalScore,
                firstSeen: existing?.firstSeen || Date.now(),
                lastAlerted: Date.now(),
                alertCount: (existing?.alertCount || 0) + 1
            });

            await signalLogger.logSignal(buildSignalLogData(analysis));
        }
    }

    if (highConviction.length === 0 && tradeableAlerts.length === 0) {
        console.log(`\n[Alerts] No alertable opportunities (${tradeable.length} tradeable below cooldown, ${watchList.length} on watch)`);
    }

    // Log non-alerted TRADEABLE signals for DB tracking (validation/calibration)
    const tradeableNonAlerted = tradeable.filter(a => !tradeableAlerts.includes(a));
    if (tradeableNonAlerted.length > 0) {
        console.log(`\n[Signal Logger] Logging ${tradeableNonAlerted.length} TRADEABLE signal(s) for validation...`);
        for (const analysis of tradeableNonAlerted) {
            await signalLogger.logSignal(buildSignalLogData(analysis));
        }
    }

    // Log WATCH signals for baseline analysis (no alerts, no checkpoints — just factor capture)
    if (watchList.length > 0) {
        console.log(`\n[Signal Logger] Logging ${watchList.length} WATCH signal(s) for baseline analysis...`);
        for (const analysis of watchList) {
            await signalLogger.logSignal(buildSignalLogData(analysis));
        }
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
            rotation_regime: rsContext?.regime || null,
            rs_data_available: !!rsContext,
            internals_available: !!latestInternals
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
                reasons.push(`Within ${SETTINGS.WALL_THRESHOLD_PCT}% of put wall ($${a.levels.putWall?.toFixed(2) || 'N/A'})`);
                reasons.push(`RSI ${a.technicals.rsi?.toFixed(1) || 'N/A'} - momentum not extended`);
            }
        } else if (a.zone === 'SELL_ZONE') {
            reasons.push(`Within ${SETTINGS.WALL_THRESHOLD_PCT}% of call wall ($${a.levels.callWall?.toFixed(2) || 'N/A'})`);
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
                volumeSignal: a.technicals.volumeSignal,
                sma20: a.technicals.sma20,
                sma50: a.technicals.sma50
            },
            fibonacci: null,
            sourceInfo: {
                sources: symbols.find(s => s.symbol === a.symbol)?.sources || ['watchlist'],
                score: a.totalScore,
                direction: a.direction,
                signals: a.signals,
                isWatchlist: symbols.find(s => s.symbol === a.symbol)?.sources?.includes('watchlist') || false,
                tier: a.tier
            },
            history_status: a.history_status,  // Pre-computed in analyzeSymbol()
            sectorRsPercentile: a.sectorRs?.percentile ?? null,
            sectorEtf: a.sectorRs?.sectorEtf ?? null,
            maBounceJson: a.maBounce ? JSON.stringify(a.maBounce) : null,
            divergenceBbJson: a.divergenceBb ? JSON.stringify(a.divergenceBb) : null
        }));

        signalDb.insertBloodhoundResults(scanId, resultsForDb);

        // Cleanup old scans (keep 365 days for audit/backtest data)
        signalDb.cleanupOldBloodhoundScans(365);

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

    // Clean stale setup tracker entries (24h expiry)
    for (const [sym, data] of setupTracker.entries()) {
        if (Date.now() - data.firstSeen > DEDUP.setupExpiryMs) {
            setupTracker.delete(sym);
        }
    }

    const backoffStatus = backoffState.active ? ` [BACKOFF ACTIVE: batch ${backoffState.batchSize}, delay ${backoffState.batchDelayMs}ms]` : '';
    const cacheStats = apiCache.stats();
    console.log(`\n[Bloodhound] Scan complete (${scannerState.lastScanDuration}s).${backoffStatus} Next scan in ${SETTINGS.scanIntervalMs / 60000} minutes.`);
    console.log(`[API Cache] ${cacheStats.fresh} fresh / ${cacheStats.total} total entries (${cacheStats.stale} stale)`);

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
    } finally {
        _scanInProgress = false;
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

    // Stagger initial scan to avoid API contention across processes
    const scanOffset = parseInt(process.env.SCAN_OFFSET_MS || '0', 10);
    if (scanOffset > 0) {
        console.log(`[Stagger] Waiting ${scanOffset / 1000}s before first scan...`);
        await new Promise(r => setTimeout(r, scanOffset));
    }

    // Initial scan
    await runScan();

    // Schedule recurring scans
    setInterval(runScan, SETTINGS.scanIntervalMs);

    console.log('\nBloodhound running. Press Ctrl+C to stop.');
    console.log('Commands: node bloodhound-scanner.js [pause|resume|status]');
}

// Global error handlers — log and exit cleanly for PM2 restart
process.on('uncaughtException', (err) => {
    console.error(`[Bloodhound FATAL] Uncaught exception:`, err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error(`[Bloodhound FATAL] Unhandled rejection:`, reason);
    process.exit(1);
});

main().catch(console.error);
