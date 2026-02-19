/**
 * OPPORTUNITY SCANNER
 *
 * Detects unusual options activity and smart money positioning.
 * Primary focus: vol/OI ratio, premium flow, call/put imbalance.
 * Secondary: gaps, volume spikes, IV extremes.
 *
 * Operating Hours: 5am-1pm PST (8am-4pm EST)
 * Control API: Port 8083
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const opportunityDb = require('./opportunity-db');
const { sendTelegram } = require('./telegram');
const apiCache = require('./api-cache');
const apiClient = require('./api-client');

// Load config
const CONFIG = require('./config-loader');

const APIS = {
    intel: CONFIG.apis.intel,
    options: CONFIG.apis.options
};

const SETTINGS = {
    scanIntervalMs: 5 * 60 * 1000,      // 5 minutes
    alertCooldownMs: 30 * 60 * 1000,    // 30 min cooldown per symbol
    controlPort: 8083,
    maxSymbols: 30,                      // Max symbols per scan
    minPrice: 5,                         // Filter penny stocks
    minVolume: 500000,                   // Minimum daily volume
    marketHours: {
        startHour: 8,   // 8 AM EST
        endHour: 16,    // 4 PM EST
        timezone: 'America/New_York'
    },

    // Persistence-based filtering (added based on 30,539 record analysis)
    // Key insight: 5+ scans = 98-100% accuracy vs 50-55% for <5 scans
    MIN_PERSISTENCE_ALERT: 5,           // Minimum scans before alerting (~25 min of signal)
    HIGH_PERSISTENCE: 20,               // Considered "high" persistence (very high conviction)
    TREAT_PUT_HEAVY_AS_BULLISH: true,   // Heavy puts = institutional hedging = bullish

    // Swing trading filter - exclude LEAPs
    MAX_DTE: 60                          // Only show options expiring within 60 days
};

// Display timezone for alerts (user's local time)
const DISPLAY_TIMEZONE = 'America/Los_Angeles';

function formatTimePST(date = new Date()) {
    return date.toLocaleString('en-US', {
        timeZone: DISPLAY_TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

// Format expiration date compactly (e.g., "2025-01-24" -> "1/24")
function formatExpiration(expStr) {
    if (!expStr) return '';
    try {
        const d = new Date(expStr + 'T00:00:00');
        return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch {
        return expStr; // Return as-is if parsing fails
    }
}

// Core symbols - always scan for market context
const CORE_SYMBOLS = ['SPY', 'QQQ', 'IWM'];

// ETF categories not captured by index movers
// Added 2026-01-22: These ETFs have high options activity but aren't in S&P 500/NASDAQ indices
// Updated 2026-01-22: Complete sector list, expanded commodities/crypto, removed leveraged (use core assets)
// To revert: Remove this constant and SOURCE 6 in discoverSymbols()
const ETF_CATEGORIES = {
    crypto: ['IBIT', 'ETHA', 'SOLZ', 'GTAO'], // Bitcoin, Ethereum, Solana, TAO ETFs
    volatility: ['UVXY', 'VXX'],             // VIX ETFs - hedging activity
    sectors: [                               // All 11 SPDR sector ETFs
        'XLB',   // Materials
        'XLC',   // Communication Services
        'XLE',   // Energy
        'XLF',   // Financials
        'XLI',   // Industrials
        'XLK',   // Technology
        'XLP',   // Consumer Staples
        'XLRE',  // Real Estate
        'XLU',   // Utilities
        'XLV',   // Health Care
        'XLY'    // Consumer Discretionary
    ],
    commodities: ['GLD', 'SLV', 'USO', 'UNG'] // Gold, Silver, Oil, Natural Gas
};

// Database for watchlist (single source of truth)
const signalDb = require('./signal-db');

// ============================================
// DYNAMIC SYMBOL DISCOVERY
// ============================================

function loadWatchlist() {
    try {
        return signalDb.getWatchlist();
    } catch (e) {
        console.error('[Opportunity] Watchlist DB read failed:', e.message);
        return [];
    }
}

function addSymbol(map, symbol, score, source) {
    if (!symbol) return;
    // Filter out non-tradeable (VIX index only - VXX/UVXY are tradeable ETFs)
    // Changed 2026-01-22: Removed VXX/UVXY from filter to enable volatility ETF scanning
    if (symbol === 'VIX') return;

    const existing = map.get(symbol) || { score: 0, sources: [] };
    existing.score += score;
    if (!existing.sources.includes(source)) {
        existing.sources.push(source);
    }
    map.set(symbol, existing);
}

async function discoverSymbols() {
    const discovered = new Map();
    const sourceCounts = { core: 0, watchlist: 0, volume: 0, gainers: 0, losers: 0, nasdaq: 0, extremes: 0 };

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
        const volumeMovers = await httpGet(`${APIS.options}/api/movers/$SPX?sort=VOLUME`).catch(() => ({ screeners: [] }));
        const gainers = await httpGet(`${APIS.options}/api/movers/$SPX?sort=PERCENT_CHANGE_UP`).catch(() => ({ screeners: [] }));
        const losers = await httpGet(`${APIS.options}/api/movers/$SPX?sort=PERCENT_CHANGE_DOWN`).catch(() => ({ screeners: [] }));

        // Volume leaders (highest activity)
        (volumeMovers.screeners || []).slice(0, 10).forEach(m => {
            if (m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 40, 'volume_leader');
                sourceCounts.volume++;
            }
        });

        // Big gainers (momentum up)
        (gainers.screeners || []).slice(0, 10).forEach(m => {
            if (Math.abs(m.netPercentChange || 0) >= 0.02 && m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 35, 'gainer');
                sourceCounts.gainers++;
            }
        });

        // Big losers (momentum down / potential reversals)
        (losers.screeners || []).slice(0, 10).forEach(m => {
            if (Math.abs(m.netPercentChange || 0) >= 0.02 && m.lastPrice >= SETTINGS.minPrice) {
                addSymbol(discovered, m.symbol, 35, 'loser');
                sourceCounts.losers++;
            }
        });

        // SOURCE 4: NASDAQ movers (catches tech/growth like SMCI)
        const nasdaqMovers = await httpGet(`${APIS.options}/api/movers/$COMPX?sort=VOLUME`).catch(() => ({ screeners: [] }));
        (nasdaqMovers.screeners || []).slice(0, 10).forEach(m => {
            // Filter for optionable stocks (avoid penny stocks, need decent volume)
            if (m.lastPrice >= SETTINGS.minPrice && (m.volume || 0) >= SETTINGS.minVolume) {
                addSymbol(discovered, m.symbol, 35, 'nasdaq_mover');
                sourceCounts.nasdaq++;
            }
        });

        // SOURCE 5: 52-Week Extremes (breakouts/breakdowns)
        const latest = await httpGet(`${APIS.intel}/api/latest`).catch(() => ({ data: [] }));
        (latest.data || []).forEach(item => {
            const pos = item.fifty_two_week_range_position || 50;
            if (pos > 95 || pos < 5) {
                addSymbol(discovered, item.symbol, 30, '52wk_extreme');
                sourceCounts.extremes++;
            }
        });

    } catch (e) {
        console.error('[Opportunity] Error in discovery:', e.message);
    }

    // SOURCE 6: ETF Categories (crypto, leveraged, volatility, sectors, commodities)
    // Added 2026-01-22: Catches IBIT sweeps and other non-index ETF activity
    Object.entries(ETF_CATEGORIES).forEach(([category, symbols]) => {
        symbols.forEach(symbol => {
            addSymbol(discovered, symbol, 45, `etf_${category}`);
        });
    });
    sourceCounts.etf_categories = Object.values(ETF_CATEGORIES).flat().length;

    // Sort by discovery score and limit
    const sorted = Array.from(discovered.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, SETTINGS.maxSymbols);

    // Log discovery stats
    const uniqueSources = Object.entries(sourceCounts)
        .filter(([_, count]) => count > 0)
        .map(([source, count]) => `${source}:${count}`)
        .join(', ');

    console.log(`[Opportunity] Discovery: ${sorted.length} symbols from [${uniqueSources}]`);

    return sorted.map(([symbol, data]) => ({
        symbol,
        discoveryScore: data.score,
        sources: data.sources
    }));
}

// State
let isPaused = false;
let lastScanTime = null;
let nextScanTime = null;
let scanCount = 0;
const alertCooldowns = new Map();

// ============================================
// PERSISTENCE TRACKING
// Tracks how many consecutive scans a symbol has been HIGH_CONVICTION
// Key insight from 30,539 records: 5+ scans = 98% accuracy vs 50% for <5
// ============================================

const persistenceTracker = new Map(); // key: "SYMBOL:YYYY-MM-DD" -> { count, firstSeen, direction, firstPrice }
const alertedToday = new Set();       // Symbols already alerted today (avoid spam)
let lastResetDate = null;             // Track last reset to prevent multiple clears

function getToday() {
    // Use EST for consistent day boundaries
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function updatePersistence(symbol, tier, direction, price) {
    if (tier !== 'HIGH_CONVICTION') return 0;

    const today = getToday();
    const key = `${symbol}:${today}`;

    if (!persistenceTracker.has(key)) {
        persistenceTracker.set(key, {
            count: 1,
            firstSeen: Date.now(),
            direction,
            firstPrice: price
        });
    } else {
        const data = persistenceTracker.get(key);
        data.count++;
        // Track if direction changed
        if (data.direction !== direction) {
            data.directionChanged = true;
        }
    }

    return persistenceTracker.get(key).count;
}

function getPersistence(symbol) {
    const today = getToday();
    const key = `${symbol}:${today}`;
    return persistenceTracker.get(key) || null;
}

function getPersistenceLevel(count) {
    if (count >= SETTINGS.HIGH_PERSISTENCE) return 'VERY HIGH';
    if (count >= 10) return 'HIGH';
    if (count >= SETTINGS.MIN_PERSISTENCE_ALERT) return 'MODERATE';
    return 'LOW';
}

function clearDailyTracking() {
    const today = getToday();

    // Prevent multiple clears on same day
    if (lastResetDate === today) {
        return false;
    }

    // Clear entries from previous days
    for (const key of persistenceTracker.keys()) {
        if (!key.endsWith(`:${today}`)) {
            persistenceTracker.delete(key);
        }
    }
    alertedToday.clear();
    lastResetDate = today;
    console.log(`[Opportunity] Cleared daily tracking for new day: ${today}`);
    return true;
}

// ============================================
// HTTP HELPERS
// ============================================

async function httpGet(url, timeoutMs = 15000) {
    const data = await apiClient.fetchJSON(url, timeoutMs);
    if (data === null) throw new Error(`Failed to fetch: ${url}`);
    return data;
}

// ============================================
// MARKET HOURS CHECK
// ============================================

function isMarketHours() {
    const now = new Date();

    // Convert to Eastern Time (handles EST/EDT automatically)
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();

    // Skip weekends and market holidays
    if (day === 0 || day === 6 || signalDb.isMarketHoliday()) return false;

    const { startHour, endHour } = SETTINGS.marketHours;
    const etHour = etDate.getHours();

    return etHour >= startHour && etHour < endHour;
}

// ============================================
// DATA FETCHING
// ============================================

async function fetchMarketContext() {
    try {
        const data = await httpGet(`${APIS.options}/api/market/context`);
        return {
            vix: data.vix,
            vixRegime: data.vix_regime,
            spyPrice: data.spy_price,
            spyTrend: data.spy_trend,
            riskAppetite: data.risk_appetite
        };
    } catch (e) {
        console.error('[Opportunity] Failed to fetch market context:', e.message);
        return null;
    }
}

async function fetchOptionsAnalysis(symbol) {
    try {
        // Request wider strike range to catch spread legs
        // Note: ?strike_count=100 makes this a different cache key from Bloodhound's analysis call
        const url = `${APIS.options}/api/options/${symbol}/analysis?strike_count=100`;
        const data = await apiCache.wrap(url, apiCache.TTL.ANALYSIS, () => httpGet(url), 'opportunity');
        if (!data) return null;
        const analysis = data.analysis || data;

        // Filter to swing trading window (exclude LEAPs) — applied post-cache
        const filterByDTE = (strikes) => {
            if (!strikes) return [];
            const now = new Date();
            return strikes.filter(s => {
                if (!s.expiration) return true;
                const dte = Math.ceil((new Date(s.expiration) - now) / (1000 * 60 * 60 * 24));
                return dte <= SETTINGS.MAX_DTE;
            });
        };

        if (analysis.unusual_calls) {
            analysis.unusual_calls = filterByDTE(analysis.unusual_calls);
        }
        if (analysis.unusual_puts) {
            analysis.unusual_puts = filterByDTE(analysis.unusual_puts);
        }

        return analysis;
    } catch (e) {
        return null;
    }
}

async function fetchTechnicals(symbol) {
    try {
        const url = `${APIS.options}/api/technicals/${symbol}`;
        return await apiCache.wrap(url, apiCache.TTL.TECHNICALS, () => httpGet(url), 'opportunity');
    } catch (e) {
        return null;
    }
}

async function fetchQuote(symbol) {
    try {
        const data = await httpGet(`${APIS.options}/api/quotes/${symbol}`);  // Never cached — real-time price
        return data.quote;
    } catch (e) {
        return null;
    }
}

async function fetchIV(symbol) {
    try {
        const url = `${APIS.options}/api/options/${symbol}/iv`;
        return await apiCache.wrap(url, apiCache.TTL.IV, () => httpGet(url), 'opportunity');
    } catch (e) {
        return null;
    }
}

async function fetchEarnings(symbol) {
    try {
        const url = `${APIS.options}/api/calendar/${symbol}`;
        return await apiCache.wrap(url, apiCache.TTL.CALENDAR, () => httpGet(url), 'opportunity');
    } catch (e) {
        return null;
    }
}

// ============================================
// SCORING SYSTEM
// ============================================

function scoreUnusualOptions(analysis) {
    if (!analysis) return { score: 0, signals: [], direction: 'neutral' };

    let score = 0;
    const signals = [];
    let bullishPoints = 0;
    let bearishPoints = 0;

    const {
        call_volume = 0,
        put_volume = 0,
        call_put_ratio = 1,
        net_premium = 0,
        unusual_calls = [],
        unusual_puts = []
    } = analysis;

    // Vol/OI Ratio scoring (from unusual_calls/puts)
    const maxCallVolOI = unusual_calls.length > 0
        ? Math.max(...unusual_calls.map(c => c.vol_oi_ratio || 0))
        : 0;
    const maxPutVolOI = unusual_puts.length > 0
        ? Math.max(...unusual_puts.map(p => p.vol_oi_ratio || 0))
        : 0;
    const maxVolOI = Math.max(maxCallVolOI, maxPutVolOI);

    if (maxVolOI >= 5) {
        score += 30;
        signals.push(`Vol/OI ${maxVolOI.toFixed(1)}x (major positioning)`);
        if (maxCallVolOI > maxPutVolOI) bullishPoints += 30;
        else bearishPoints += 30;
    } else if (maxVolOI >= 3) {
        score += 20;
        signals.push(`Vol/OI ${maxVolOI.toFixed(1)}x (elevated)`);
        if (maxCallVolOI > maxPutVolOI) bullishPoints += 20;
        else bearishPoints += 20;
    } else if (maxVolOI >= 2) {
        score += 10;
        signals.push(`Vol/OI ${maxVolOI.toFixed(1)}x (moderate)`);
    }

    // Premium flow scoring
    const premiumM = Math.abs(net_premium) / 1000000;
    if (premiumM >= 10) {
        score += 25;
        const dir = net_premium > 0 ? 'bullish' : 'bearish';
        signals.push(`Net premium: $${premiumM.toFixed(1)}M ${dir}`);
        if (net_premium > 0) bullishPoints += 25;
        else bearishPoints += 25;
    } else if (premiumM >= 5) {
        score += 15;
        const dir = net_premium > 0 ? 'bullish' : 'bearish';
        signals.push(`Net premium: $${premiumM.toFixed(1)}M ${dir}`);
        if (net_premium > 0) bullishPoints += 15;
        else bearishPoints += 15;
    } else if (premiumM >= 1) {
        score += 5;
        signals.push(`Net premium: $${premiumM.toFixed(1)}M`);
    }

    // Call/Put ratio scoring
    if (call_put_ratio >= 3) {
        score += 15;
        signals.push(`Call/Put ratio: ${call_put_ratio.toFixed(2)} (strong bullish)`);
        bullishPoints += 15;
    } else if (call_put_ratio <= 0.33) {
        score += 15;
        signals.push(`Call/Put ratio: ${call_put_ratio.toFixed(2)} (strong bearish)`);
        bearishPoints += 15;
    }

    // Multiple unusual strikes
    const totalUnusual = unusual_calls.length + unusual_puts.length;
    if (totalUnusual >= 3) {
        score += 10;
        signals.push(`${totalUnusual} unusual strikes (conviction)`);
    }

    // Top unusual strike details (include expiration for verification)
    if (unusual_calls.length > 0) {
        const top = unusual_calls[0];
        const exp = top.expiration ? ` ${formatExpiration(top.expiration)}` : '';
        signals.push(`Top call: ${top.strike}C${exp} vol/OI ${(top.vol_oi_ratio || 0).toFixed(1)}x`);
    }
    if (unusual_puts.length > 0) {
        const top = unusual_puts[0];
        const exp = top.expiration ? ` ${formatExpiration(top.expiration)}` : '';
        signals.push(`Top put: ${top.strike}P${exp} vol/OI ${(top.vol_oi_ratio || 0).toFixed(1)}x`);
    }

    // Determine direction
    let direction = 'neutral';
    if (bullishPoints > bearishPoints + 10) direction = 'bullish';
    else if (bearishPoints > bullishPoints + 10) direction = 'bearish';

    return { score, signals, direction, unusual_calls, unusual_puts };
}

function scoreSecondary(technicals, quote, iv) {
    let score = 0;
    const signals = [];
    const opportunities = [];

    // NOTE: Gap and volume scoring removed - those are handled by the GAPS scanner
    // This scanner now focuses purely on options flow data

    // IV rank scoring (options-related)
    if (iv && iv.iv_percentile !== undefined) {
        if (iv.iv_percentile >= 80) {
            score += 10;
            signals.push(`IV Rank: ${iv.iv_percentile.toFixed(0)}% (high - sell premium)`);
            opportunities.push('iv_high');
        } else if (iv.iv_percentile <= 20) {
            score += 10;
            signals.push(`IV Rank: ${iv.iv_percentile.toFixed(0)}% (low - buy premium)`);
            opportunities.push('iv_low');
        }
    }

    return { score, signals, opportunities };
}

function classifyTier(score) {
    if (score >= 70) return 'HIGH_CONVICTION';
    if (score >= 50) return 'TRADEABLE';
    if (score >= 30) return 'WATCH';
    return 'FILTERED';
}

// ============================================
// MAIN SCAN
// ============================================

async function analyzeSymbol(symbol) {
    const delay = () => new Promise(r => setTimeout(r, 100));

    // Sequential calls to avoid overwhelming the Options API
    const analysis = await fetchOptionsAnalysis(symbol);
    await delay();
    const technicals = await fetchTechnicals(symbol);
    await delay();
    const quote = await fetchQuote(symbol);
    await delay();
    const iv = await fetchIV(symbol);
    await delay();
    const earnings = await fetchEarnings(symbol);

    // Score unusual options (primary)
    const unusualResult = scoreUnusualOptions(analysis);

    // Score secondary factors
    const secondaryResult = scoreSecondary(technicals, quote, iv);

    // Combine scores (cap at 100)
    const totalScore = Math.min(100, unusualResult.score + secondaryResult.score);
    const tier = classifyTier(totalScore);

    // Build opportunities list
    const opportunities = [];
    if (unusualResult.score >= 20) {
        if (unusualResult.direction === 'bullish') opportunities.push('unusual_calls');
        else if (unusualResult.direction === 'bearish') opportunities.push('unusual_puts');
        else opportunities.push('unusual_options');
    }
    opportunities.push(...secondaryResult.opportunities);

    // Calculate gap
    let gap = 0;
    if (quote) {
        gap = ((quote.lastPrice - quote.closePrice) / quote.closePrice) * 100;
    }

    return {
        symbol,
        price: quote?.lastPrice || technicals?.current || 0,
        score: totalScore,
        tier,
        direction: unusualResult.direction,
        opportunities,
        unusual: {
            callVolume: analysis?.call_volume || 0,
            putVolume: analysis?.put_volume || 0,
            callPutRatio: analysis?.call_put_ratio || 1,
            netPremium: analysis?.net_premium || 0,
            topStrikes: [
                ...(unusualResult.unusual_calls || []).slice(0, 2).map(c => ({
                    strike: c.strike,
                    type: 'call',
                    volume: c.volume,
                    openInterest: c.open_interest,
                    volOiRatio: c.vol_oi_ratio,
                    premium: c.premium,
                    expiration: c.expiration
                })),
                ...(unusualResult.unusual_puts || []).slice(0, 2).map(p => ({
                    strike: p.strike,
                    type: 'put',
                    volume: p.volume,
                    openInterest: p.open_interest,
                    volOiRatio: p.vol_oi_ratio,
                    premium: p.premium,
                    expiration: p.expiration
                }))
            ]
        },
        technicals: {
            gap,
            volumeRatio: technicals?.volume_ratio || 0,
            ivRank: iv?.iv_percentile || null,
            rsi: technicals?.rsi || null
        },
        earnings: earnings ? {
            date: earnings.next_earnings,
            daysTo: earnings.days_to_earnings,
            time: earnings.earnings_time,
            warningLevel: earnings.warning_level
        } : null,
        signals: buildSignalsWithEarningsContext(
            [...unusualResult.signals, ...secondaryResult.signals],
            earnings,
            unusualResult.unusual_calls,
            unusualResult.unusual_puts
        ),
        timestamp: new Date().toISOString()
    };
}

// Add earnings context to signals when relevant
function buildSignalsWithEarningsContext(signals, earnings, unusualCalls, unusualPuts) {
    if (!earnings || !earnings.next_earnings || earnings.days_to_earnings > 14) {
        return signals;
    }

    const earningsDate = new Date(earnings.next_earnings);
    const topStrikes = [...(unusualCalls || []).slice(0, 1), ...(unusualPuts || []).slice(0, 1)];

    let preEarnings = 0;
    let postEarnings = 0;

    for (const strike of topStrikes) {
        if (strike.expiration) {
            const expDate = new Date(strike.expiration);
            if (expDate < earningsDate) preEarnings++;
            else postEarnings++;
        }
    }

    // Add context about what the strikes are betting on
    if (preEarnings > 0 && postEarnings === 0) {
        signals.push(`⏰ Strikes expire PRE-earnings (drift bet)`);
    } else if (postEarnings > 0 && preEarnings === 0) {
        signals.push(`🎲 Strikes capture earnings (event bet)`);
    } else if (preEarnings > 0 && postEarnings > 0) {
        signals.push(`📊 Mixed: some pre, some post earnings`);
    }

    return signals;
}

let _scanInProgress = false;

async function runScan() {
    if (_scanInProgress) { console.log('[Opportunity] Scan already in progress — skipping'); return; }
    _scanInProgress = true;
    try {

    if (isPaused) {
        console.log('[Opportunity] Scanner paused, skipping scan');
        return;
    }

    // Check market hours
    if (!isMarketHours()) {
        console.log('[Opportunity] Outside market hours, skipping scan');
        return;
    }

    const scanStart = Date.now();
    console.log(`\n[Opportunity] ===== SCAN #${++scanCount} =====`);
    console.log(`[Opportunity] Time: ${new Date().toISOString()}`);

    lastScanTime = new Date();
    nextScanTime = new Date(Date.now() + SETTINGS.scanIntervalMs);

    // Fetch market context
    const marketContext = await fetchMarketContext();
    if (!marketContext) {
        console.error('[Opportunity] Failed to fetch market context, aborting scan');
        return;
    }
    console.log(`[Opportunity] VIX: ${marketContext.vix} (${marketContext.vixRegime}) | SPY: ${marketContext.spyPrice} (${marketContext.spyTrend})`);

    // DYNAMIC SYMBOL DISCOVERY
    const discoveryStart = Date.now();
    const discoveredSymbols = await discoverSymbols();
    const discoveryElapsed = ((Date.now() - discoveryStart) / 1000).toFixed(1);
    console.log(`[Opportunity] Discovery: ${discoveredSymbols.length} symbols in ${discoveryElapsed}s`);
    console.log(`[Opportunity] Analyzing ${discoveredSymbols.length} symbols (sequential, ~${Math.round(discoveredSymbols.length * 2.2)}s est)...`);

    const results = [];

    for (const { symbol, discoveryScore, sources } of discoveredSymbols) {
        try {
            const result = await analyzeSymbol(symbol);
            result.discovery_score = discoveryScore || 0;
            result.discovery_sources = sources; // Track how we found it
            results.push(result);

            // Log high-scoring results
            if (result.tier !== 'FILTERED') {
                const srcTag = sources.join(',');
                console.log(`[Opportunity] ${symbol}: Score ${result.score} (${result.tier}) - ${result.direction} [${srcTag}]`);
            }
        } catch (e) {
            console.error(`[Opportunity] Error analyzing ${symbol}:`, e.message);
        }

        // Delay between symbols to avoid API overload
        await new Promise(r => setTimeout(r, 200));
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Calculate summary
    const summary = {
        highConviction: results.filter(r => r.tier === 'HIGH_CONVICTION').length,
        tradeable: results.filter(r => r.tier === 'TRADEABLE').length,
        watch: results.filter(r => r.tier === 'WATCH').length,
        filtered: results.filter(r => r.tier === 'FILTERED').length
    };

    console.log(`[Opportunity] Results: ${summary.highConviction} HIGH_CONVICTION, ${summary.tradeable} TRADEABLE, ${summary.watch} WATCH`);

    // Build output
    const output = {
        timestamp: new Date().toISOString(),
        scannerStatus: 'running',
        scannerMode: 'dynamic',
        marketContext,
        symbolsScanned: discoveredSymbols.length,
        discoverySources: ['core', 'watchlist', 'volume_leaders', 'gainers', 'losers', 'nasdaq_movers', '52wk_extremes', 'etf_categories'],
        results: results.filter(r => r.tier !== 'FILTERED'),
        summary
    };

    // Save to SQLite database (single source of truth)
    try {
        opportunityDb.saveScanResults(results, marketContext);
    } catch (e) {
        console.error('[Opportunity] DB save error:', e.message);
    }

    // PERSISTENCE-BASED ALERTING
    // Only alert when a symbol crosses the persistence threshold
    // This reduces alerts from ~300-500/day to ~20-50 high-quality signals
    const highConviction = results.filter(r => r.tier === 'HIGH_CONVICTION');
    let alertsSent = 0;
    let persistenceUpdates = [];

    for (const opp of highConviction) {
        // Update persistence count
        const persistence = updatePersistence(opp.symbol, opp.tier, opp.direction, opp.price);

        persistenceUpdates.push(`${opp.symbol}:${persistence}`);

        // Only alert when crossing the threshold AND not already alerted today
        const shouldAlert = persistence === SETTINGS.MIN_PERSISTENCE_ALERT &&
                           !alertedToday.has(opp.symbol);

        if (shouldAlert) {
            // Apply put_heavy reinterpretation if enabled
            let effectiveDirection = opp.direction;
            let extraSignal = null;

            if (SETTINGS.TREAT_PUT_HEAVY_AS_BULLISH && opp.direction === 'bearish') {
                // Check if this is put_heavy by looking at call/put ratio
                if (opp.unusual.callPutRatio < 0.5) {
                    effectiveDirection = 'bullish';
                    extraSignal = '🛡️ Heavy put hedging (bullish - institutions protecting longs)';
                }
            }

            await sendTelegramAlert(opp, marketContext, persistence, effectiveDirection, extraSignal);
            alertedToday.add(opp.symbol);
            alertsSent++;
        }
    }

    // Log persistence stats
    if (persistenceUpdates.length > 0) {
        console.log(`[Opportunity] Persistence: ${persistenceUpdates.join(', ')}`);
    }
    console.log(`[Opportunity] Alerts sent: ${alertsSent} (${alertedToday.size} unique today)`);

    // Auto-add HIGH_CONVICTION opportunities to Bloodhound watchlist
    let watchlistAdds = 0;
    for (const opp of highConviction) {
        try {
            const topStrike = opp.unusual?.topStrikes?.[0];
            const ratioStr = topStrike?.volOiRatio?.toFixed(1) || '?';
            signalDb.addToWatchlist(opp.symbol, {
                source: 'opportunity',
                notes: `Unusual options: vol/OI ${ratioStr}x - ${new Date().toISOString().split('T')[0]}`,
                expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
            });
            watchlistAdds++;
        } catch (e) {
            console.error(`[Opportunity] Failed to add ${opp.symbol} to watchlist:`, e.message);
        }
    }
    if (watchlistAdds > 0) {
        console.log(`[Opportunity] Added ${watchlistAdds} symbols to Bloodhound watchlist`);
    }

    const scanElapsed = Math.round((Date.now() - scanStart) / 1000);
    console.log(`[Opportunity] Scan complete in ${scanElapsed}s. Next scan at ${nextScanTime.toISOString()}`);

    } finally { _scanInProgress = false; }
}

// ============================================
// TELEGRAM ALERTS
// ============================================

async function sendTelegramAlert(opportunity, marketContext, persistence = null, effectiveDirection = null, extraSignal = null) {
    // Check cooldown (still respected for manual/test alerts)
    const cooldownKey = opportunity.symbol;
    const lastAlert = alertCooldowns.get(cooldownKey);
    if (lastAlert && Date.now() - lastAlert < SETTINGS.alertCooldownMs) {
        console.log(`[Opportunity] Skipping alert for ${opportunity.symbol} (cooldown)`);
        return;
    }

    // Use effective direction if provided (for put_heavy reinterpretation)
    const displayDirection = effectiveDirection || opportunity.direction;

    // Build message
    const directionEmoji = displayDirection === 'bullish' ? '🟢' :
                          displayDirection === 'bearish' ? '🔴' : '⚪';

    const topStrike = opportunity.unusual.topStrikes[0];
    const topStrikeText = topStrike
        ? `${topStrike.strike}${topStrike.type === 'call' ? 'C' : 'P'} vol/OI ${topStrike.volOiRatio?.toFixed(1) || '?'}x`
        : 'N/A';

    const premiumM = Math.abs(opportunity.unusual.netPremium) / 1000000;
    const premiumDir = opportunity.unusual.netPremium > 0 ? 'BULLISH' : 'BEARISH';

    const timeStr = formatTimePST();

    // Build persistence line if available
    let persistenceLine = '';
    if (persistence !== null) {
        const level = getPersistenceLevel(persistence);
        persistenceLine = `\n📊 <b>Persistence: ${persistence} scans (${level})</b>`;
    }

    // Build earnings warning if within 14 days
    let earningsLine = '';
    if (opportunity.earnings && opportunity.earnings.daysTo !== null && opportunity.earnings.daysTo <= 14) {
        const earningsEmoji = opportunity.earnings.daysTo <= 3 ? '🚨' :
                              opportunity.earnings.daysTo <= 7 ? '⚠️' : '📅';
        const timeLabel = opportunity.earnings.time === 'before_open' ? 'BMO' :
                          opportunity.earnings.time === 'after_close' ? 'AMC' : '';
        earningsLine = `\n${earningsEmoji} <b>EARNINGS: ${opportunity.earnings.date} ${timeLabel} (${opportunity.earnings.daysTo}d)</b>`;
    }

    // Build signals list with extra signal if provided
    let signalsList = opportunity.signals.slice(0, 5);
    if (extraSignal) {
        signalsList = [extraSignal, ...signalsList.slice(0, 4)];
    }

    const message = `
${directionEmoji} <b>UNUSUAL OPTIONS: ${opportunity.symbol}</b>
<code>${timeStr} PST</code>
Score: ${opportunity.score}/100 | ${opportunity.tier}${persistenceLine}${earningsLine}

💰 Price: $${opportunity.price.toFixed(2)}
📊 Top Strike: ${topStrikeText}
💵 Net Premium: $${premiumM.toFixed(1)}M ${premiumDir}
📈 Call/Put: ${opportunity.unusual.callPutRatio.toFixed(2)}

🎯 Signals:
${signalsList.map(s => `• ${s}`).join('\n')}

📊 Context: SPY ${marketContext.spyTrend} | VIX ${marketContext.vix} (${marketContext.vixRegime})
`.trim();

    const result = await sendTelegram(message, { disablePreview: false });
    if (result.ok) {
        alertCooldowns.set(cooldownKey, Date.now());
        console.log(`[Opportunity] Sent Telegram alert for ${opportunity.symbol}`);
    } else {
        console.error(`[Opportunity] Failed to send Telegram alert:`, result.error);
    }
}

// ============================================
// CONTROL API (Port 8083)
// ============================================

function startControlServer() {
    const server = http.createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = req.url.split('?')[0];

        // GET /status
        if (url === '/status' && req.method === 'GET') {
            const now = Date.now();
            const nextScanIn = nextScanTime ? Math.max(0, nextScanTime.getTime() - now) : 0;
            const today = getToday();

            // Count symbols at different persistence levels
            let persistentCount = 0;
            let highPersistenceCount = 0;
            for (const [key, data] of persistenceTracker.entries()) {
                if (key.endsWith(`:${today}`)) {
                    if (data.count >= SETTINGS.MIN_PERSISTENCE_ALERT) persistentCount++;
                    if (data.count >= SETTINGS.HIGH_PERSISTENCE) highPersistenceCount++;
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: isPaused ? 'paused' : 'running',
                mode: 'dynamic',
                scanCount,
                lastScanTime: lastScanTime?.toISOString() || null,
                nextScanTime: nextScanTime?.toISOString() || null,
                nextScanIn: Math.round(nextScanIn / 1000),
                maxSymbols: SETTINGS.maxSymbols,
                discoverySources: ['core', 'watchlist', 'volume_leaders', 'gainers', 'losers', 'nasdaq_movers', '52wk_extremes', 'etf_categories'],
                marketHours: isMarketHours(),
                // Persistence stats
                persistence: {
                    trackedToday: persistenceTracker.size,
                    persistent: persistentCount,       // Met alert threshold
                    highPersistence: highPersistenceCount,  // Very high conviction
                    alertedToday: alertedToday.size,
                    minThreshold: SETTINGS.MIN_PERSISTENCE_ALERT,
                    highThreshold: SETTINGS.HIGH_PERSISTENCE
                }
            }));
            return;
        }

        // POST /pause
        if (url === '/pause' && req.method === 'POST') {
            isPaused = true;
            console.log('[Opportunity] Scanner PAUSED');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'paused' }));
            return;
        }

        // POST /resume
        if (url === '/resume' && req.method === 'POST') {
            isPaused = false;
            console.log('[Opportunity] Scanner RESUMED');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'running' }));
            return;
        }

        // POST /scan
        if (url === '/scan' && req.method === 'POST') {
            console.log('[Opportunity] Manual scan triggered');
            runScan().catch(e => console.error('[Opportunity] Scan error:', e));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'scan_triggered' }));
            return;
        }

        // POST /test-alert
        if (url === '/test-alert' && req.method === 'POST') {
            const testOpp = {
                symbol: 'TEST',
                score: 85,
                tier: 'HIGH_CONVICTION',
                direction: 'bullish',
                price: 100.00,
                unusual: {
                    callPutRatio: 2.5,
                    netPremium: 15000000,
                    topStrikes: [{ strike: 105, type: 'call', volOiRatio: 6.5 }]
                },
                signals: ['Test alert', 'Vol/OI 6.5x', 'Net premium $15M bullish']
            };
            sendTelegramAlert(testOpp, { spyTrend: 'bullish', vix: 15, vixRegime: 'normal' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'test_alert_sent' }));
            return;
        }

        // POST /clear-cooldowns
        if (url === '/clear-cooldowns' && req.method === 'POST') {
            alertCooldowns.clear();
            console.log('[Opportunity] Alert cooldowns cleared');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'cooldowns_cleared' }));
            return;
        }

        // GET /persistence - View current persistence tracking
        if (url === '/persistence' && req.method === 'GET') {
            const today = getToday();
            const todayData = [];

            for (const [key, data] of persistenceTracker.entries()) {
                if (key.endsWith(`:${today}`)) {
                    const symbol = key.split(':')[0];
                    todayData.push({
                        symbol,
                        count: data.count,
                        level: getPersistenceLevel(data.count),
                        direction: data.direction,
                        firstPrice: data.firstPrice,
                        firstSeen: new Date(data.firstSeen).toISOString(),
                        alerted: alertedToday.has(symbol)
                    });
                }
            }

            // Sort by count descending
            todayData.sort((a, b) => b.count - a.count);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                date: today,
                minPersistenceAlert: SETTINGS.MIN_PERSISTENCE_ALERT,
                highPersistence: SETTINGS.HIGH_PERSISTENCE,
                treatPutHeavyAsBullish: SETTINGS.TREAT_PUT_HEAVY_AS_BULLISH,
                alertedCount: alertedToday.size,
                trackedSymbols: todayData.length,
                symbols: todayData
            }));
            return;
        }

        // POST /clear-persistence - Clear persistence tracking (for testing)
        if (url === '/clear-persistence' && req.method === 'POST') {
            clearDailyTracking();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'persistence_cleared' }));
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(SETTINGS.controlPort, '0.0.0.0', () => {
        console.log(`[Opportunity] Control API listening on http://0.0.0.0:${SETTINGS.controlPort} (accessible from network)`);
    });
}

// ============================================
// CLI COMMANDS
// ============================================

const args = process.argv.slice(2);
if (args.includes('pause')) {
    console.log('Pausing scanner...');
    http.request(`http://localhost:${SETTINGS.controlPort}/pause`, { method: 'POST' }, (res) => {
        console.log('Scanner paused');
        process.exit(0);
    }).end();
} else if (args.includes('resume')) {
    console.log('Resuming scanner...');
    http.request(`http://localhost:${SETTINGS.controlPort}/resume`, { method: 'POST' }, (res) => {
        console.log('Scanner resumed');
        process.exit(0);
    }).end();
} else if (args.includes('status')) {
    http.get(`http://localhost:${SETTINGS.controlPort}/status`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log(JSON.parse(data));
            process.exit(0);
        });
    });
} else {
    // Start scanner
    console.log('[Opportunity] ========================================');
    console.log('[Opportunity] OPPORTUNITY SCANNER starting...');
    console.log('[Opportunity] Mode: DYNAMIC DISCOVERY + PERSISTENCE FILTERING');
    console.log(`[Opportunity] Sources: movers, gainers/losers, nasdaq, 52wk extremes, watchlist`);
    console.log(`[Opportunity] Max symbols: ${SETTINGS.maxSymbols}`);
    console.log(`[Opportunity] Interval: ${SETTINGS.scanIntervalMs / 1000}s`);
    console.log(`[Opportunity] Market hours: ${SETTINGS.marketHours.startHour}:00-${SETTINGS.marketHours.endHour}:00 EST`);
    console.log('[Opportunity] ----------------------------------------');
    console.log(`[Opportunity] Persistence filtering: MIN=${SETTINGS.MIN_PERSISTENCE_ALERT}, HIGH=${SETTINGS.HIGH_PERSISTENCE}`);
    console.log(`[Opportunity] Put hedging reinterpretation: ${SETTINGS.TREAT_PUT_HEAVY_AS_BULLISH ? 'ENABLED' : 'disabled'}`);
    console.log('[Opportunity] ========================================');

    // Start control server
    startControlServer();

    // Stagger initial scan to avoid API contention across processes
    const scanOffset = parseInt(process.env.SCAN_OFFSET_MS || '0', 10);
    const initialDelay = Math.max(2000, scanOffset);
    if (scanOffset > 0) {
        console.log(`[Opportunity] Stagger offset: ${scanOffset / 1000}s`);
    }

    // Initial scan (after stagger delay)
    setTimeout(() => {
        runScan().catch(e => console.error('[Opportunity] Scan error:', e));
    }, initialDelay);

    // Scheduled scans
    setInterval(() => {
        runScan().catch(e => console.error('[Opportunity] Scan error:', e));
    }, SETTINGS.scanIntervalMs);

    // Daily reset scheduler - clears persistence tracking at midnight EST
    // Using setInterval instead of cron for simplicity
    setInterval(() => {
        const now = new Date();
        const estHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
        const estMinute = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));

        // Clear at midnight EST (00:00-00:05 window to catch it)
        if (estHour === 0 && estMinute < 5) {
            clearDailyTracking();
        }
    }, 60 * 1000); // Check every minute
}

// Global error handlers — log and exit cleanly for PM2 restart
process.on('uncaughtException', (err) => {
    console.error(`[Opportunity FATAL] Uncaught exception:`, err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error(`[Opportunity FATAL] Unhandled rejection:`, reason);
    process.exit(1);
});
