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
let CONFIG;
try {
    CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
    console.error('[Bloodhound] Failed to load config.json:', e.message);
    process.exit(1);
}

const APIS = {
    intel: CONFIG.apis.intel,
    options: CONFIG.apis.options
};

const SETTINGS = {
    scanIntervalMs: 5 * 60 * 1000,  // 5 minutes
    minConfluenceScore: 48,          // Minimum score to alert (0-80, was 60/100)
    maxSymbols: 20,                  // Max symbols to scan per cycle
    alertCooldownMs: 30 * 60 * 1000, // 30 min cooldown per symbol
    ignoreMarketHours: false,        // Set true to bypass market hours check
    // Signal tracking settings
    velocityThreshold: 20,           // Points jump to trigger velocity alert
    autoTrackMinScore: 80,           // Minimum score to auto-track for outcomes
    signalExpirationDays: 5,         // Days before unresolved signal = EXPIRED
    // Display timezone
    displayTimezone: 'America/Los_Angeles', // PST/PDT for user display
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
// SIGNAL TRACKING
// ============================================

const SIGNAL_TRACKING_PATH = path.join(__dirname, '..', 'data', 'signal_tracking.json');

// Load signal tracking data
function loadSignalTracking() {
    try {
        if (fs.existsSync(SIGNAL_TRACKING_PATH)) {
            return JSON.parse(fs.readFileSync(SIGNAL_TRACKING_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('[Bloodhound] Error loading signal tracking:', e.message);
    }
    return { signals: {}, lastUpdated: null };
}

// Save signal tracking data
function saveSignalTracking(data) {
    try {
        data.lastUpdated = new Date().toISOString();
        fs.writeFileSync(SIGNAL_TRACKING_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[Bloodhound] Error saving signal tracking:', e.message);
    }
}

// Update signal history and calculate velocity
function updateSignalHistory(symbol, score, price, direction, analysis) {
    const tracking = loadSignalTracking();
    const now = new Date().toISOString();

    if (!tracking.signals[symbol]) {
        tracking.signals[symbol] = {
            history: [],
            firstSeen: now,
            peakScore: 0,
            activeSignal: null
        };
    }

    const symbolData = tracking.signals[symbol];

    // Get previous score for velocity calculation
    const prevEntry = symbolData.history.length > 0
        ? symbolData.history[symbolData.history.length - 1]
        : null;
    const prevScore = prevEntry?.score || 0;
    const velocity = score - prevScore;

    // Add to history (keep last 50 entries per symbol)
    symbolData.history.push({
        timestamp: now,
        score,
        price,
        direction,
        velocity
    });
    if (symbolData.history.length > 50) {
        symbolData.history = symbolData.history.slice(-50);
    }

    // Update peak score
    if (score > symbolData.peakScore) {
        symbolData.peakScore = score;
    }

    // Check if this should create/update an active tracked signal
    if (score >= SETTINGS.autoTrackMinScore && !symbolData.activeSignal) {
        // Create new active signal to track for outcome
        symbolData.activeSignal = {
            id: `${symbol}_${Date.now()}`,
            entryTime: now,
            entryPrice: price,
            entryScore: score,
            direction: direction,
            target: analysis?.levels?.callWall || null,
            stop: analysis?.levels?.putWall || null,
            signalsAtEntry: analysis?.signals?.slice(0, 5) || [],
            currentPrice: price,
            pnlPct: 0,
            outcome: null,
            resolvedTime: null,
            daysHeld: 0
        };
        console.log(`[Bloodhound] Tracking new signal: ${symbol} @ $${price} (score ${score})`);
    }

    saveSignalTracking(tracking);

    return { prevScore, velocity };
}

// Resolve signal outcomes based on current prices
async function resolveSignalOutcomes() {
    const tracking = loadSignalTracking();
    let resolved = 0;

    for (const [symbol, data] of Object.entries(tracking.signals)) {
        const signal = data.activeSignal;
        if (!signal || signal.outcome) continue; // Skip if no active signal or already resolved

        try {
            // Get current price
            const technicals = await fetchJSON(`${APIS.options}/api/technicals/${symbol}`);
            if (!technicals?.current) continue;

            const currentPrice = technicals.current;
            signal.currentPrice = currentPrice;
            signal.pnlPct = ((currentPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(2);
            signal.daysHeld = Math.floor((Date.now() - new Date(signal.entryTime).getTime()) / (1000 * 60 * 60 * 24));

            // Auto-grade based on direction and price levels
            if (signal.direction === 'bullish' || signal.direction === 'pinned') {
                if (signal.target && currentPrice >= signal.target) {
                    signal.outcome = 'WIN';
                    signal.resolvedTime = new Date().toISOString();
                    console.log(`[Bloodhound] Signal WIN: ${symbol} hit target $${signal.target}`);
                    resolved++;
                } else if (signal.stop && currentPrice <= signal.stop * 0.98) { // 2% buffer below stop
                    signal.outcome = 'LOSS';
                    signal.resolvedTime = new Date().toISOString();
                    console.log(`[Bloodhound] Signal LOSS: ${symbol} hit stop $${signal.stop}`);
                    resolved++;
                } else if (signal.daysHeld >= SETTINGS.signalExpirationDays) {
                    signal.outcome = signal.pnlPct > 0 ? 'EXPIRED_WIN' : 'EXPIRED_LOSS';
                    signal.resolvedTime = new Date().toISOString();
                    console.log(`[Bloodhound] Signal EXPIRED: ${symbol} P&L ${signal.pnlPct}%`);
                    resolved++;
                }
            } else if (signal.direction === 'bearish') {
                if (signal.stop && currentPrice >= signal.stop * 1.02) { // 2% buffer above stop for shorts
                    signal.outcome = 'LOSS';
                    signal.resolvedTime = new Date().toISOString();
                    resolved++;
                } else if (signal.target && currentPrice <= signal.target) {
                    signal.outcome = 'WIN';
                    signal.resolvedTime = new Date().toISOString();
                    resolved++;
                } else if (signal.daysHeld >= SETTINGS.signalExpirationDays) {
                    signal.outcome = signal.pnlPct < 0 ? 'EXPIRED_WIN' : 'EXPIRED_LOSS'; // Inverted for shorts
                    signal.resolvedTime = new Date().toISOString();
                    resolved++;
                }
            }
        } catch (e) {
            console.error(`[Bloodhound] Error resolving ${symbol}:`, e.message);
        }
    }

    if (resolved > 0) {
        saveSignalTracking(tracking);
        console.log(`[Bloodhound] Resolved ${resolved} signal outcome(s)`);
    }

    return resolved;
}

// Get signal tracking stats for display
function getSignalStats() {
    const tracking = loadSignalTracking();
    let active = 0, wins = 0, losses = 0, expired = 0;

    for (const data of Object.values(tracking.signals)) {
        const signal = data.activeSignal;
        if (!signal) continue;

        if (!signal.outcome) active++;
        else if (signal.outcome === 'WIN' || signal.outcome === 'EXPIRED_WIN') wins++;
        else if (signal.outcome === 'LOSS' || signal.outcome === 'EXPIRED_LOSS') losses++;
        else expired++;
    }

    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';

    return { active, wins, losses, expired, winRate };
}

// ============================================
// SCANNER HISTORY TRACKING
// ============================================

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'scanner_history.json');
const HISTORY_RETENTION_DAYS = 14;

function loadScannerHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            return {
                meta: {
                    last_updated: new Date().toISOString(),
                    retention_days: HISTORY_RETENTION_DAYS,
                    total_symbols_tracked: 0
                },
                symbols: {}
            };
        }
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
        console.error('[History] Failed to load scanner_history.json:', e.message);
        return {
            meta: {
                last_updated: new Date().toISOString(),
                retention_days: HISTORY_RETENTION_DAYS,
                total_symbols_tracked: 0
            },
            symbols: {}
        };
    }
}

function saveScannerHistory(history) {
    try {
        history.meta.last_updated = new Date().toISOString();
        history.meta.total_symbols_tracked = Object.keys(history.symbols).length;
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('[History] Failed to save scanner_history.json:', e.message);
    }
}

function updateScannerHistory(analyses, marketContext) {
    const history = loadScannerHistory();
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`\n[History] Updating scanner history for ${analyses.length} symbols...`);

    for (const analysis of analyses) {
        const symbol = analysis.symbol;

        // Initialize symbol if not exists
        if (!history.symbols[symbol]) {
            history.symbols[symbol] = {
                first_seen: now.toISOString(),
                last_seen: now.toISOString(),
                daily_snapshots: []
            };
        }

        // Update last_seen
        history.symbols[symbol].last_seen = now.toISOString();

        // Find or create today's snapshot
        let todaySnapshot = history.symbols[symbol].daily_snapshots.find(s => s.date === today);

        if (!todaySnapshot) {
            // First scan of the day - create new snapshot
            todaySnapshot = {
                date: today,
                first_scan: now.toISOString(),
                scans_today: 1,
                peak_score: analysis.totalScore,

                price_action: {
                    open: analysis.technicals.price,
                    high: analysis.technicals.price,
                    low: analysis.technicals.price,
                    close: analysis.technicals.price,
                    vwap: analysis.levels.vwap || null,
                    range_pct: 0,
                    gap_from_prev_pct: null
                },

                volume: {
                    total: 0,
                    avg_20d: analysis.technicals.volumeAvg || null,
                    ratio: analysis.technicals.volumeRatio || null,
                    vs_yesterday: null,
                    first_hour: 0
                },

                scanner_data: {
                    peak_zone: analysis.zone,
                    peak_direction: analysis.direction,
                    peak_signals: analysis.signals.slice(0, 5),
                    time_in_scanner_mins: 0
                },

                technicals_eod: {
                    rsi: analysis.technicals.rsi,
                    above_20ema: analysis.technicals.above20EMA || false,
                    above_50sma: analysis.technicals.above50SMA || false,
                    bb_position: analysis.technicals.bbPosition || 'MIDDLE'
                }
            };

            // Calculate gap from previous day if available
            const yesterday = history.symbols[symbol].daily_snapshots[history.symbols[symbol].daily_snapshots.length - 1];
            if (yesterday && yesterday.price_action.close) {
                const gap = ((analysis.technicals.price - yesterday.price_action.close) / yesterday.price_action.close) * 100;
                todaySnapshot.price_action.gap_from_prev_pct = parseFloat(gap.toFixed(2));
            }

            history.symbols[symbol].daily_snapshots.push(todaySnapshot);
        } else {
            // Update existing snapshot
            todaySnapshot.scans_today++;

            // Update peak score if higher
            if (analysis.totalScore > todaySnapshot.peak_score) {
                todaySnapshot.peak_score = analysis.totalScore;
                todaySnapshot.scanner_data.peak_zone = analysis.zone;
                todaySnapshot.scanner_data.peak_direction = analysis.direction;
                todaySnapshot.scanner_data.peak_signals = analysis.signals.slice(0, 5);
            }

            // Update price action (track high/low/close)
            if (analysis.technicals.price > todaySnapshot.price_action.high) {
                todaySnapshot.price_action.high = analysis.technicals.price;
            }
            if (analysis.technicals.price < todaySnapshot.price_action.low) {
                todaySnapshot.price_action.low = analysis.technicals.price;
            }
            todaySnapshot.price_action.close = analysis.technicals.price;
            todaySnapshot.price_action.vwap = analysis.levels.vwap || todaySnapshot.price_action.vwap;

            // Calculate range %
            if (todaySnapshot.price_action.high > todaySnapshot.price_action.low) {
                const rangePct = ((todaySnapshot.price_action.high - todaySnapshot.price_action.low) / todaySnapshot.price_action.low) * 100;
                todaySnapshot.price_action.range_pct = parseFloat(rangePct.toFixed(2));
            }

            // Update volume (use latest available)
            todaySnapshot.volume.ratio = analysis.technicals.volumeRatio || todaySnapshot.volume.ratio;
            todaySnapshot.volume.avg_20d = analysis.technicals.volumeAvg || todaySnapshot.volume.avg_20d;

            // Update technicals (EOD = latest)
            todaySnapshot.technicals_eod.rsi = analysis.technicals.rsi;
            todaySnapshot.technicals_eod.above_20ema = analysis.technicals.above20EMA || false;
            todaySnapshot.technicals_eod.above_50sma = analysis.technicals.above50SMA || false;
            todaySnapshot.technicals_eod.bb_position = analysis.technicals.bbPosition || 'MIDDLE';

            // Update time in scanner
            const firstScan = new Date(todaySnapshot.first_scan);
            todaySnapshot.scanner_data.time_in_scanner_mins = Math.floor((now - firstScan) / 60000);
        }

        // Calculate volume vs yesterday if we have yesterday's data
        const yesterday = history.symbols[symbol].daily_snapshots[history.symbols[symbol].daily_snapshots.length - 2];
        if (yesterday && yesterday.volume.total > 0 && todaySnapshot.volume.total > 0) {
            todaySnapshot.volume.vs_yesterday = parseFloat((todaySnapshot.volume.total / yesterday.volume.total).toFixed(2));
        }

        // Also write to database for permanent history
        try {
            signalDb.upsertScannerHistory(symbol, today, {
                first_seen: history.symbols[symbol].first_seen,
                score: todaySnapshot.peak_score,
                zone: todaySnapshot.scanner_data?.peak_zone,
                price: analysis.technicals?.price,
                gap_pct: todaySnapshot.price_action?.gap_from_prev_pct || 0,
                rsi: todaySnapshot.technicals_eod?.rsi
            });
        } catch (e) {
            console.error(`[History] DB write failed for ${symbol}:`, e.message);
        }
    }

    // Prune old data (keep only HISTORY_RETENTION_DAYS)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_RETENTION_DAYS);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    for (const symbol in history.symbols) {
        history.symbols[symbol].daily_snapshots = history.symbols[symbol].daily_snapshots.filter(
            s => s.date >= cutoffDateStr
        );

        // Remove symbol if no snapshots left
        if (history.symbols[symbol].daily_snapshots.length === 0) {
            delete history.symbols[symbol];
        }
    }

    saveScannerHistory(history);
    console.log(`[History] Updated. Tracking ${Object.keys(history.symbols).length} symbols.`);
}

function computeHistoryStatus(symbol) {
    const history = loadScannerHistory();

    if (!history.symbols[symbol]) {
        return null; // No history
    }

    const symbolData = history.symbols[symbol];
    const snapshots = symbolData.daily_snapshots;

    if (snapshots.length === 0) {
        return null;
    }

    // Count consecutive days (no gaps)
    const today = new Date().toISOString().split('T')[0];
    let consecutiveDays = 0;
    let checkDate = new Date(today);

    for (let i = 0; i < 30; i++) { // Check back 30 days max
        const dateStr = checkDate.toISOString().split('T')[0];
        const hasSnapshot = snapshots.some(s => s.date === dateStr);

        if (!hasSnapshot) {
            break; // Gap found
        }

        consecutiveDays++;
        checkDate.setDate(checkDate.getDate() - 1);
    }

    // Calculate days since first seen
    const firstSeen = new Date(symbolData.first_seen);
    const daysSinceFirst = Math.floor((new Date() - firstSeen) / (1000 * 60 * 60 * 24));

    // Find peak score across all history
    const peakScoreEver = Math.max(...snapshots.map(s => s.peak_score));
    const todaySnapshot = snapshots.find(s => s.date === today);
    const currentScore = todaySnapshot ? todaySnapshot.peak_score : 0;

    // Determine trend
    let trend = 'STABLE';
    if (snapshots.length >= 2) {
        const yesterday = snapshots[snapshots.length - 2];
        const scoreDiff = currentScore - yesterday.peak_score;

        if (scoreDiff >= 15) trend = 'RISING';
        else if (scoreDiff <= -15) trend = 'FADING';
    }

    // Determine label
    let label = 'NEW';
    if (consecutiveDays === 2) label = 'DAY_2';
    else if (consecutiveDays >= 3) label = 'STREAK';
    else if (daysSinceFirst > consecutiveDays && consecutiveDays === 1) label = 'RETURNED';

    return {
        label,
        consecutive_days: consecutiveDays,
        days_since_first: daysSinceFirst,
        trend,
        peak_score_ever: peakScoreEver,
        current_vs_peak: currentScore - peakScoreEver
    };
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
// WATCHLIST LOADING
// ============================================

const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');

function loadWatchlist() {
    try {
        const data = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
        return data.symbols
            .filter(s => s.enabled)
            .map(s => s.symbol);
    } catch (e) {
        console.log('[Watchlist] Could not load watchlist.json, using defaults');
        return ['SPY', 'QQQ'];
    }
}

// ============================================
// SYMBOL DISCOVERY
// ============================================

async function discoverSymbols() {
    const symbols = new Map(); // symbol -> { score, sources }

    // Load watchlist - these are ALWAYS included with highest priority
    const watchlistSymbols = loadWatchlist();
    console.log(`[Watchlist] Loaded ${watchlistSymbols.length} symbols: ${watchlistSymbols.join(', ')}`);
    watchlistSymbols.forEach(s => symbols.set(s, { score: 100, sources: ['watchlist'] }));

    // 1. AI Market Outlook - themes and bias only (sentiment removed)
    const outlook = await fetchJSON(`${APIS.intel}/api/market/outlook`);
    if (outlook?.success && outlook.data) {
        // Store themes for context
        symbols._themes = outlook.data.key_themes || [];
        symbols._intraday_bias = outlook.data.intraday_bias;
        symbols._swing_bias = outlook.data.swing_bias;
    }

    // 2. Sector rotation from XL* ETFs (find strongest/weakest sectors)
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

            // Check for interesting conditions
            const pos52wk = item.fifty_two_week_range_position || 50;
            const volRatio = item.todays_volume && item.volume_avg_30_day
                ? item.todays_volume / item.volume_avg_30_day
                : 1;

            // Score boost for extremes
            let boost = 0;
            if (pos52wk > 95) boost += 25; // Near 52-week high - breakout potential
            if (pos52wk < 10) boost += 25; // Near 52-week low - reversal potential
            if (volRatio > 1.5) boost += 20; // High relative volume - something happening
            if (volRatio > 2.0) boost += 10; // Extra boost for volume spike

            if (boost > 0) {
                const ticker = mapSymbol(item.symbol); // Map BTC→IBIT, etc.
                if (!ticker) return;
                const existing = symbols.get(ticker) || { score: 0, sources: [] };
                existing.score += boost;
                existing.sources.push('market_data');
                existing.price = parseFloat(item.current_price);
                existing.pos52wk = pos52wk;
                existing.volRatio = volRatio;
                if (item.symbol !== ticker) existing.mappedFrom = item.symbol;
                symbols.set(ticker, existing);
            }
        });

        // Identify sector rotation - add strongest/weakest sectors
        if (sectorETFs.length > 0) {
            sectorETFs.sort((a, b) => b.pos52wk - a.pos52wk);
            const strongestSector = sectorETFs[0];
            const weakestSector = sectorETFs[sectorETFs.length - 1];

            // Add strongest sector if showing momentum
            if (strongestSector.pos52wk > 90 || strongestSector.volRatio > 1.3) {
                const existing = symbols.get(strongestSector.symbol) || { score: 0, sources: [] };
                existing.score += 30;
                existing.sources.push('sector_leader');
                existing.pos52wk = strongestSector.pos52wk;
                symbols.set(strongestSector.symbol, existing);
            }

            // Add weakest sector if showing reversal potential
            if (weakestSector.pos52wk < 30 && weakestSector.volRatio > 1.2) {
                const existing = symbols.get(weakestSector.symbol) || { score: 0, sources: [] };
                existing.score += 25;
                existing.sources.push('sector_laggard');
                existing.pos52wk = weakestSector.pos52wk;
                symbols.set(weakestSector.symbol, existing);
            }
        }
    }

    // Remove metadata keys before sorting
    const themes = symbols._themes;
    const intradayBias = symbols._intraday_bias;
    const swingBias = symbols._swing_bias;
    symbols.delete('_themes');
    symbols.delete('_intraday_bias');
    symbols.delete('_swing_bias');

    // Filter out non-tradeable symbols (crypto, futures, indices)
    for (const symbol of symbols.keys()) {
        if (NON_TRADEABLE.has(symbol)) {
            symbols.delete(symbol);
        }
    }

    // Sort by score and take top N
    const sorted = Array.from(symbols.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, SETTINGS.maxSymbols);

    const result = sorted.map(([symbol, data]) => ({ symbol, ...data }));

    // Attach context to result
    result._context = { themes, intradayBias, swingBias };

    console.log(`[Discovery] Sources: watchlist, market data, sector rotation`);

    return result;
}

// ============================================
// MARKET CONTEXT
// ============================================

async function getMarketContext() {
    // Fetch all context data in parallel
    const [context, spyLevels, qqqLevels, outlook, spyIv] = await Promise.all([
        fetchJSON(`${APIS.options}/api/market/context`),
        fetchJSON(`${APIS.options}/api/levels/SPY`),
        fetchJSON(`${APIS.options}/api/levels/QQQ`),
        fetchJSON(`${APIS.intel}/api/market/outlook`),  // Multi-timeframe bias
        fetchJSON(`${APIS.options}/api/options/SPY/iv`)  // IV rank
    ]);

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
        spyLevels: spyLevels?.levels || null,
        qqqLevels: qqqLevels?.levels || null,
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
// SYMBOL ANALYSIS
// ============================================

async function analyzeSymbol(symbol, discoveryData) {
    const [levels, technicals, optionsAnalysis] = await Promise.all([
        fetchJSON(`${APIS.options}/api/levels/${symbol}`),
        fetchJSON(`${APIS.options}/api/technicals/${symbol}`),
        fetchJSON(`${APIS.options}/api/options/${symbol}/analysis`)
    ]);

    if (!levels || !technicals) {
        return null; // Can't analyze without core data
    }

    const price = levels.underlying_price || technicals.current;
    if (!price) return null;

    // ============================================
    // CONFLUENCE SCORING (0-80) - Sentiment removed
    // ============================================

    const scores = {
        technical: 0,  // 0-25
        levels: 0,     // 0-25
        volume: 0,     // 0-15
        context: 0     // 0-15
    };

    const signals = [];
    let direction = 'neutral';

    // --- TECHNICAL SCORE (0-25) ---
    const rsi = technicals.rsi || 50;
    const trend = technicals.trend || 'neutral';
    const bbPosition = technicals.bb_position || 0.5;

    if (rsi <= 30) {
        scores.technical += 15;
        signals.push(`RSI low momentum (${rsi.toFixed(1)})`);
        direction = 'bullish';
    } else if (rsi >= 70) {
        scores.technical += 15;
        signals.push(`RSI high momentum (${rsi.toFixed(1)})`);
        direction = 'bearish';
    } else if (rsi <= 40 && trend === 'uptrend') {
        scores.technical += 10;
        signals.push(`RSI pullback in uptrend (${rsi.toFixed(1)})`);
        direction = 'bullish';
    } else if (rsi >= 60 && trend === 'downtrend') {
        scores.technical += 10;
        signals.push(`RSI bounce in downtrend (${rsi.toFixed(1)})`);
        direction = 'bearish';
    }

    // Bollinger position
    if (bbPosition <= 0.1) {
        scores.technical += 10;
        signals.push('At lower Bollinger Band');
        direction = direction || 'bullish';
    } else if (bbPosition >= 0.9) {
        scores.technical += 10;
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
                scores.technical += 10;
                signals.push(`📐 At Golden Pocket (0.618 @ $${fibSignal.price.toFixed(2)})`);
                if (direction === 'neutral') direction = 'bullish'; // Fib support = bullish bias

                // Check for MA confluence at Golden Pocket
                fibMAConfluence = checkFibMAConfluence(fibSignal.price, technicals, 1.5);
                if (fibMAConfluence) {
                    scores.technical += 5;
                    signals.push(`📐 Golden Pocket + ${fibMAConfluence.ma} confluence`);
                }
            } else if (fibSignal.type === 'retracement' && fibSignal.level === 0.5) {
                // 50% retracement - first entry in Golden Zone (strong trends)
                scores.technical += 8;
                signals.push(`📐 At 50% Fib ($${fibSignal.price.toFixed(2)})`);
                if (direction === 'neutral') direction = 'bullish';

                // Check for MA confluence at 50%
                fibMAConfluence = checkFibMAConfluence(fibSignal.price, technicals, 1.5);
                if (fibMAConfluence) {
                    scores.technical += 5;
                    signals.push(`📐 50% Fib + ${fibMAConfluence.ma} confluence`);
                }
            } else if (fibSignal.type === 'extension' && fibSignal.level === 1.272) {
                // 1.272 extension - first profit target
                scores.technical += 5;
                signals.push(`🎯 At 1.272 extension ($${fibSignal.price.toFixed(2)}) - TP1`);
                if (direction === 'neutral') direction = 'bearish'; // Extension = potential reversal
            } else if (fibSignal.type === 'extension' && fibSignal.level === 1.618) {
                // 1.618 extension - extended profit target
                scores.technical += 5;
                signals.push(`🎯 At 1.618 extension ($${fibSignal.price.toFixed(2)}) - TP2`);
                if (direction === 'neutral') direction = 'bearish'; // Extension = potential reversal
            }
            // Only track: 0.5, 0.618 (Golden Zone entries) + 1.272, 1.618 (profit targets)
        }
    }

    // --- LEVELS SCORE (0-30) ---
    const callWall = levels.levels?.call_wall?.price;
    const putWall = levels.levels?.put_wall?.price;
    const maxPain = levels.levels?.max_pain?.price;
    const gammaFlip = levels.levels?.gamma_flip?.price;
    const vwap = levels.levels?.vwap;

    // Distance calculations
    const distToCallWall = callWall ? ((callWall - price) / price * 100) : null;
    const distToPutWall = putWall ? ((price - putWall) / price * 100) : null;
    const distToVwap = vwap ? ((price - vwap) / price * 100) : null;

    // Check for pinned scenario (both walls within 1% of price)
    const atPutWall = distToPutWall !== null && distToPutWall <= 0.5 && distToPutWall >= -0.5;
    const atCallWall = distToCallWall !== null && distToCallWall <= 0.5 && distToCallWall >= -0.5;
    const isPinned = atPutWall && atCallWall;

    // Check for extended scenarios (breakouts)
    const aboveCallWall = distToCallWall !== null && distToCallWall < -0.3; // Price above call wall
    const belowPutWall = distToPutWall !== null && distToPutWall < -0.3; // Price below put wall

    if (isPinned) {
        // Pinned between walls - high confluence but no clear direction
        scores.levels += 25;
        signals.push(`📍 PINNED between walls ($${putWall}-$${callWall})`);
        direction = 'pinned';
    } else if (aboveCallWall) {
        // Breakout above call wall - bullish momentum
        scores.levels += 20;
        const distAbove = Math.abs(distToCallWall).toFixed(1);
        signals.push(`🚀 BREAKOUT above call wall ($${callWall}) +${distAbove}%`);
        direction = 'bullish';
        // Extra score if gamma flip confirms
        if (gammaFlip && price > gammaFlip) {
            scores.levels += 10;
            signals.push(`Above gamma flip ($${gammaFlip.toFixed(2)})`);
        }
    } else if (belowPutWall) {
        // Breakdown below put wall - bearish momentum
        scores.levels += 20;
        const distBelow = Math.abs(distToPutWall).toFixed(1);
        signals.push(`💥 BREAKDOWN below put wall ($${putWall}) -${distBelow}%`);
        direction = 'bearish';
        // Extra caution if below gamma flip
        if (gammaFlip && price < gammaFlip) {
            scores.levels += 10;
            signals.push(`Below gamma flip ($${gammaFlip.toFixed(2)})`);
        }
    } else {
        // At support (put wall)
        if (atPutWall) {
            scores.levels += 20;
            signals.push(`At put wall support ($${putWall})`);
            if (direction === 'neutral') direction = 'bullish';
        }

        // At resistance (call wall)
        if (atCallWall) {
            scores.levels += 20;
            signals.push(`At call wall resistance ($${callWall})`);
            if (direction === 'neutral') direction = 'bearish';
        }
    }

    // At VWAP (mean reversion opportunity)
    if (distToVwap !== null && Math.abs(distToVwap) <= 0.3) {
        scores.levels += 10;
        signals.push(`At VWAP ($${vwap})`);
    }

    // Fib + Wall Confluence (extensions aligning with gamma walls)
    if (fibLevels && (callWall || putWall)) {
        const fibWallAlignments = checkFibWallConfluence(fibLevels, callWall, putWall, 1.5);
        if (fibWallAlignments) {
            for (const alignment of fibWallAlignments) {
                scores.levels += 5;
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
            scores.levels += 10 * nearbyZone.count;
            signals.push(`Confluence zone (${nearbyZone.count} levels)`);
        }
    }

    // --- WALL ACTIVITY CHECK ---
    // Only penalize DORMANT walls (stale OI). Don't reward ACTIVE since we
    // can't verify if activity is bullish or bearish.
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
                scores.levels -= 5;
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

    // --- VOLUME SCORE (0-15) ---
    const volRatio = discoveryData?.volRatio || technicals.volume_ratio || 1;

    if (volRatio >= 2) {
        scores.volume += 15;
        signals.push(`Volume spike (${volRatio.toFixed(1)}x avg)`);
    } else if (volRatio >= 1.5) {
        scores.volume += 10;
        signals.push(`Elevated volume (${volRatio.toFixed(1)}x avg)`);
    }

    // --- OPTIONS FLOW SCORE (0-25) ---
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
            scores.volume += 15;
            if (maxCallVolOI > maxPutVolOI) {
                const exp = topCall.expiration?.slice(5).replace('-', '/') || '';
                const prem = ((topCall.premium || 0) / 1000000).toFixed(1);
                signals.push(`🔥 Unusual CALL $${topCall.strike} ${exp} (${maxCallVolOI.toFixed(1)}x, $${prem}M)`);
                if (direction === 'neutral') direction = 'bullish';
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
            }
        } else if (maxCallVolOI >= 2 || maxPutVolOI >= 2) {
            scores.volume += 8;
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
            scores.volume += 10;
            const premDir = netPremium > 0 ? 'bullish' : 'bearish';
            signals.push(`$${(Math.abs(netPremium) / 1000000).toFixed(0)}M net ${premDir} premium`);

            // Alignment bonus
            if ((netPremium > 0 && direction === 'bullish') ||
                (netPremium < 0 && direction === 'bearish')) {
                scores.volume += 5;
            }
        }

        // Call/Put ratio extremes
        if (cpRatio >= 2) {
            signals.push(`Heavy call bias (${cpRatio.toFixed(2)} C/P)`);
        } else if (cpRatio <= 0.5) {
            signals.push(`Heavy put bias (${cpRatio.toFixed(2)} C/P)`);
        }
    }

    // --- DISCOVERY SOURCE SCORE (0-15) ---
    if (discoveryData) {
        // Bonus for AI outlook mentions
        if (discoveryData.sources?.includes('ai_outlook')) {
            scores.context += 10;
            signals.push(`📌 AI Outlook highlight`);
        }
        // NOTE: Social/Twitter scoring removed - Bloodhound is now purely technical
    }

    // --- CONTEXT SCORE (0-10) ---
    if (marketContext) {
        const spyTrend = marketContext.spyTrend;

        // Skip SPY trend comparison for index ETFs (SPY can't be counter-trend to itself)
        const isIndexETF = symbol === 'SPY' || symbol === 'QQQ';

        if (isIndexETF) {
            // For SPY/QQQ, just note market context without alignment scoring
            signals.push(`Market: VIX ${marketContext.vix}`);
        }
        // Pinned scenarios are direction-neutral, no context penalty
        else if (direction === 'pinned') {
            signals.push(`Market: SPY ${spyTrend}, VIX ${marketContext.vix}`);
        }
        // Aligned with market
        else if ((direction === 'bullish' && spyTrend === 'bullish') ||
            (direction === 'bearish' && spyTrend === 'bearish')) {
            scores.context += 10;
            signals.push(`Aligned with SPY ${spyTrend}`);
        }
        // Against market (penalty, but still note it)
        else if (direction !== 'neutral' && spyTrend && direction !== spyTrend) {
            scores.context -= 10;
            signals.push(`⚠️ Against SPY ${spyTrend}`);
            // BACKTEST FIX: Don't call bearish in bullish market (16.4% win rate)
            // Override to pinned instead of fighting the trend
            if (direction === 'bearish' && spyTrend === 'bullish') {
                direction = 'pinned';
                signals.push(`📍 Downgraded to PINNED (counter-trend)`);
            }
        }

        // --- MULTI-TIMEFRAME ALIGNMENT ---
        // Check if setup direction aligns with higher timeframe bias
        if (marketContext.intradayBias && marketContext.swingBias) {
            const swingBias = marketContext.swingBias.toLowerCase();
            const intradayBias = marketContext.intradayBias.toLowerCase();

            // Check if setup direction aligns with swing bias
            const setupAligned = (direction === 'bullish' && swingBias === 'bullish') ||
                                 (direction === 'bearish' && swingBias === 'bearish');

            // Check if timeframes agree with each other
            const tfAligned = swingBias === intradayBias;

            if (setupAligned && tfAligned) {
                // Highest probability: setup + both timeframes aligned
                scores.context += 15;
                signals.push(`✅ TF aligned: both ${marketContext.swingBias}`);
            } else if (setupAligned && !tfAligned) {
                // Good swing setup, but intraday differs - still decent
                scores.context += 5;
                signals.push(`Swing ${marketContext.swingBias}, intraday ${marketContext.intradayBias}`);
            } else if (!setupAligned && direction !== 'neutral' && direction !== 'pinned' && swingBias !== 'neutral') {
                // Counter-trend trade - lower probability
                scores.context -= 15;
                signals.push(`⚠️ COUNTER-TREND: ${direction} vs swing ${marketContext.swingBias}`);
            }
        }

        // VIX regime adjustment
        if (marketContext.vixRegime === 'elevated' || marketContext.vixRegime === 'high') {
            signals.push(`⚠️ VIX ${marketContext.vixRegime} (${marketContext.vix})`);
        }
    }

    // ============================================
    // FINAL SCORE (max 80 - sentiment removed)
    // ============================================

    const totalScore = Math.max(0, Math.min(80,
        scores.technical + scores.levels + scores.volume + scores.context
    ));

    // ============================================
    // ZONE CLASSIFICATION (for zone-scanner UI)
    // ============================================

    let zone = 'MID_RANGE';
    let tradeable = false;
    let action = null;
    let tier = 'FILTERED';  // New: tradeable tier

    const rsiHighMomentum = 70;
    const rsiLowMomentum = 30;

    // Dynamic wall threshold based on score
    const getWallThreshold = (score) => {
        if (score >= 80) return 1.5;  // High conviction = looser threshold
        if (score >= 70) return 1.0;  // Moderate
        return 0.5;                    // Strict for lower scores
    };

    const wallThreshold = getWallThreshold(totalScore);

    // Near wall checks (using dynamic threshold)
    const nearPutWall = distToPutWall !== null && Math.abs(distToPutWall) <= wallThreshold;
    const nearCallWall = distToCallWall !== null && Math.abs(distToCallWall) <= wallThreshold;

    // WATCH zone threshold (2% for near-misses)
    const watchThreshold = 2.0;
    const watchNearPutWall = distToPutWall !== null && Math.abs(distToPutWall) <= watchThreshold;
    const watchNearCallWall = distToCallWall !== null && Math.abs(distToCallWall) <= watchThreshold;

    // Trend alignment check
    const isTrendAligned = (actionType, trendDir) => {
        if (actionType === 'BUY') return trendDir !== 'bearish';  // bullish or neutral OK
        if (actionType === 'SELL') return trendDir !== 'bullish'; // bearish or neutral OK
        return true;
    };

    // Step 1: Determine BASE ZONE (same logic as before)
    if (rsi >= rsiHighMomentum) {
        zone = 'HIGH_MOMENTUM';
    } else if (rsi <= rsiLowMomentum) {
        zone = 'LOW_MOMENTUM';
        if (nearPutWall) {
            zone = 'BUY_ZONE';
            action = 'BUY';
        }
    } else if (aboveCallWall) {
        zone = 'EXTENDED_HIGH';
    } else if (belowPutWall) {
        zone = 'EXTENDED_LOW';
    } else if (isPinned) {
        zone = 'PINNED';
    } else if (nearPutWall) {
        zone = 'BUY_ZONE';
        action = 'BUY';
    } else if (nearCallWall) {
        zone = 'SELL_ZONE';
        action = 'SELL';
    }

    // BACKTEST FIX: EXTENDED_HIGH = reversal watch zone, not bullish continuation
    // 21/22 EXTENDED_HIGH signals were bullish, 4.5% win rate
    // Override bullish to pinned - don't chase breakouts
    if (zone === 'EXTENDED_HIGH' && direction === 'bullish') {
        direction = 'pinned';
        signals.push(`📍 Extended high - reversal watch`);
    }

    // Step 2: Apply SCORE-AWARE TRADEABLE TIERS
    if (action) {
        const aligned = isTrendAligned(action, trend);
        // BACKTEST FIX: Exclude bad zones from HIGH_CONVICTION
        // EXTENDED_HIGH = 4.5% win rate, HIGH_MOMENTUM has similar issues
        const badZones = ['EXTENDED_HIGH', 'HIGH_MOMENTUM'];
        const notBadZone = !badZones.includes(zone);

        // HIGH_CONVICTION: Score >= 56 at wall, OR Score >= 64 near wall (scaled from 70/80 of 100 to 80 max)
        // BUT exclude bad zones that historically underperform
        if (totalScore >= 56 && (atPutWall || atCallWall) && notBadZone) {
            tradeable = true;
            tier = 'HIGH_CONVICTION';
        } else if (totalScore >= 64 && (nearPutWall || nearCallWall) && notBadZone) {
            tradeable = true;
            tier = 'HIGH_CONVICTION';
        }
        // TRADEABLE: Score >= 48 at wall + trend aligned (was 60/100)
        else if (totalScore >= 48 && (atPutWall || atCallWall) && aligned) {
            tradeable = true;
            tier = 'TRADEABLE';
        }
        // WATCH: Score >= 48 at wall but counter-trend
        else if (totalScore >= 48 && (atPutWall || atCallWall) && !aligned) {
            tier = 'WATCH';  // Downgraded due to counter-trend
        }
        // WATCH: Score >= 40 near wall (not at) (was 50/100)
        else if (totalScore >= 40 && (watchNearPutWall || watchNearCallWall)) {
            tier = 'WATCH';
        }
    }

    // WATCH: EXTENDED_LOW with low RSI (potential reversal)
    if (zone === 'EXTENDED_LOW' && rsi < 35 && totalScore >= 40) {
        tier = 'WATCH';
        action = 'WATCH_REVERSAL';
    }

    // WATCH: High score but mid-range (waiting for level)
    if (zone === 'MID_RANGE' && totalScore >= 56) {
        tier = 'WATCH';
        action = 'WATCH_LEVEL';
    }

    // WATCH: High-score PINNED setups (trapped between walls, waiting for direction)
    if (zone === 'PINNED' && totalScore >= 56) {
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
        wallVolOiRatio: wallActivity?.volOiRatio || null
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
 * Classify analysis into HIGH_CONVICTION, TRADEABLE, WATCH, or FILTERED tier
 * Uses the analysis.tier from zone classification, with additional alert-level checks
 * HIGH_CONVICTION: Score ≥70 + at wall + TF aligned + wall not dormant
 * TRADEABLE: Score ≥60 + at wall + trend aligned
 * WATCH: Near wall or counter-trend or high score waiting for level
 */
function getAlertTier(analysis, ctx) {
    // Start with the tier calculated during zone classification
    let tier = analysis.tier || 'FILTERED';

    // If already FILTERED, stay filtered
    if (tier === 'FILTERED') {
        return 'FILTERED';
    }

    // Additional checks for alert eligibility
    const tfAligned = isTimeframeAligned(analysis, ctx);
    const wallOk = !analysis.atWall || analysis.wallActivity !== 'DORMANT';

    // Downgrade HIGH_CONVICTION if TF misaligned or dormant wall
    if (tier === 'HIGH_CONVICTION') {
        if (!tfAligned || !wallOk) {
            return 'WATCH';  // Downgrade to WATCH
        }
        return 'HIGH_CONVICTION';
    }

    // TRADEABLE stays as is (alerts but lower priority)
    if (tier === 'TRADEABLE') {
        if (!tfAligned || !wallOk) {
            return 'WATCH';  // Downgrade to WATCH
        }
        return 'TRADEABLE';
    }

    // WATCH stays as WATCH
    return tier;
}

function formatAlert(analysis) {
    const dirEmoji = analysis.direction === 'bullish' ? '🟢' :
                     analysis.direction === 'bearish' ? '🔴' :
                     analysis.direction === 'pinned' ? '📍' : '⚪';

    const scoreEmoji = analysis.totalScore >= 64 ? '🔥' :
                       analysis.totalScore >= 56 ? '⭐' : '📊';

    const timeStr = formatTimePST();

    let msg = `${scoreEmoji} <b>BLOODHOUND: ${escapeHtml(analysis.symbol)}</b> ${dirEmoji}\n`;
    msg += `<code>${timeStr} PST</code>\n\n`;
    msg += `<b>Confluence Score:</b> ${analysis.totalScore}/80\n`;
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

        // GET /watchlist - Get current watchlist
        if (req.method === 'GET' && url === '/watchlist') {
            try {
                const data = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
                res.writeHead(200);
                res.end(JSON.stringify(data));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to load watchlist' }));
            }
            return;
        }

        // POST /watchlist/add - Add symbol to watchlist
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
                    const data = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));

                    // Check if already exists
                    if (data.symbols.some(s => s.symbol === ticker)) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: `${ticker} already in watchlist` }));
                        return;
                    }

                    data.symbols.push({
                        symbol: ticker,
                        enabled: true,
                        notes: notes || ''
                    });
                    fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(data, null, 2));
                    console.log(`[Watchlist] Added ${ticker}`);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, symbol: ticker }));
                } catch (e) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // POST /watchlist/remove - Remove symbol from watchlist
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
                    const data = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
                    const idx = data.symbols.findIndex(s => s.symbol === ticker);

                    if (idx === -1) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: `${ticker} not in watchlist` }));
                        return;
                    }

                    data.symbols.splice(idx, 1);
                    fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(data, null, 2));
                    console.log(`[Watchlist] Removed ${ticker}`);
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
        }
        scannerState.previousVixRegime = currentRegime;
    } else {
        console.log('[Context] Could not fetch market context');
    }

    // 1.5. Validate old signals (4h window)
    await signalLogger.validateOldSignals().catch(e => {
        console.error('[Signal Validation] Error:', e.message);
    });

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

        // Add delay between batches when backoff is active
        if (backoffState.active && i > 0 && i % backoffState.batchSize === 0) {
            console.log(`[Backoff] Batch ${Math.floor(i / backoffState.batchSize)} complete, waiting ${backoffState.batchDelayMs}ms...`);
            await sleep(backoffState.batchDelayMs);
        }

        const analysis = await analyzeSymbol(symbolData.symbol, symbolData);
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

    // Resolve any tracked signal outcomes
    await resolveSignalOutcomes();

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

    const tieredAnalyses = analyses.map(a => ({
        ...a,
        tier: getAlertTier(a, marketContext),
        history_status: computeHistoryStatus(a.symbol)
    }));

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
            console.log(`  🔥 ${a.symbol}: ${a.totalScore}/100 ${dir}`);
        });
    }

    if (tradeable.length > 0) {
        console.log(`[TRADEABLE]`);
        tradeable.forEach(a => {
            const dir = a.direction === 'bullish' ? '🟢' :
                        a.direction === 'bearish' ? '🔴' : '⚪';
            console.log(`  ✅ ${a.symbol}: ${a.totalScore}/100 ${dir} (${a.action})`);
        });
    }

    if (watchList.length > 0) {
        console.log(`[WATCH LIST]`);
        watchList.slice(0, 5).forEach(a => {
            const reason = a.action === 'WATCH_REVERSAL' ? '(reversal watch)' :
                           a.action === 'WATCH_LEVEL' ? '(waiting for level)' :
                           !isTimeframeAligned(a, marketContext) ? '(TF misaligned)' :
                           a.wallActivity === 'DORMANT' ? '(dormant wall)' :
                           a.totalScore < 70 ? `(score ${a.totalScore})` : '';
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
            signalLogger.logSignal({
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
            });
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
            iv_rank: marketContext?.ivRank || 0
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

    fs.writeFileSync(
        path.join(__dirname, '..', 'data', 'scanner.json'),
        JSON.stringify(output, null, 2)
    );

    // 8. Write to dynamic_scan.json (format compatible with zone-scanner.html)
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

    const dynamicOutput = {
        timestamp: new Date().toISOString(),
        scanType: 'bloodhound',
        sources: {
            highConviction: true,
            trending: false,  // X/Twitter trending disabled - purely technical scanner
            authorConsensus: false,  // Author consensus disabled
            aiOutlook: true
        },
        marketContext: {
            vix: marketContext?.vix || 0,
            vixRegime: marketContext?.vixRegime || 'unknown',
            spyTrend: marketContext?.spyTrend || 'unknown',
            spyPrice: marketContext?.spyPrice || 0,
            riskAppetite: marketContext?.riskAppetite || 'unknown',
            regime: marketContext?.regime || 'unknown',
            positionSizeModifier: marketContext?.positionSizeModifier || 1,
            spyLevels: marketContext?.spyLevels || {},
            qqqLevels: marketContext?.qqqLevels || {}
        },
        scanCount: analyses.length,
        tradeableCount: tradeableResults.length,
        results: analyses.map(a => ({
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
                // Key retracement levels
                goldenPocket: a.fibonacci.retracements?.[0.618],
                fib50: a.fibonacci.retracements?.[0.5],
                fib382: a.fibonacci.retracements?.[0.382],
                // Key extension levels
                ext1272: a.fibonacci.extensions?.[1.272],
                ext1618: a.fibonacci.extensions?.[1.618]
            } : null,
            timestamp: new Date().toISOString(),
            sourceInfo: {
                sources: symbols.find(s => s.symbol === a.symbol)?.sources || ['watchlist'],
                score: a.totalScore,
                direction: a.direction,
                signals: a.signals,
                isWatchlist: symbols.find(s => s.symbol === a.symbol)?.sources?.includes('watchlist') || false
            },
            history_status: computeHistoryStatus(a.symbol)
        }))
    };

    fs.writeFileSync(
        path.join(__dirname, '..', 'data', 'dynamic_scan.json'),
        JSON.stringify(dynamicOutput, null, 2)
    );

    // Also write bloodhound.json for backward compatibility
    fs.writeFileSync(
        path.join(__dirname, '..', 'data', 'bloodhound.json'),
        JSON.stringify({
            timestamp: new Date().toISOString(),
            marketContext: dynamicOutput.marketContext,
            symbolsScanned: analyses.length,
            topOpportunities: tieredAnalyses.slice(0, 15).map(a => ({
                symbol: a.symbol,
                score: a.totalScore,
                direction: a.direction,
                tier: a.tier,
                signals: a.signals,
                atWall: a.atWall,
                wallActivity: a.wallActivity
            })),
            alertsSent: highConviction.length,
            watchListCount: watchList.length
        }, null, 2)
    );

    // Update scanner state
    scannerState.isScanning = false;
    scannerState.lastScanAt = new Date().toISOString();
    scannerState.lastScanDuration = Math.round((Date.now() - scanStartTime) / 1000);
    scannerState.scanCount++;
    scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();

    const backoffStatus = backoffState.active ? ` [BACKOFF ACTIVE: batch ${backoffState.batchSize}, delay ${backoffState.batchDelayMs}ms]` : '';
    console.log(`\n[Bloodhound] Scan complete (${scannerState.lastScanDuration}s).${backoffStatus} Next scan in ${SETTINGS.scanIntervalMs / 60000} minutes.`);

    // Signal validation: update prices and check for checkpoint validations
    try {
        await signalLogger.updateActiveSignalPrices();
        await signalLogger.validateOldSignals();
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
    console.log(`Min Confluence Score: ${SETTINGS.minConfluenceScore}/80`);
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
