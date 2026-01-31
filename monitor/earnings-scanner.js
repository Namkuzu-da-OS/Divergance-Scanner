/**
 * Earnings Season Scanner
 *
 * Scans for pre-earnings momentum (PREM) candidates.
 *
 * Features:
 * - PREM Scanner: Find pre-earnings momentum candidates 5-10 days out
 * - Earnings Calendar: Track upcoming earnings dates
 * - Telegram Alerts: Notify on high-conviction setups
 *
 * Control API: http://localhost:8082
 * Dashboard:   http://localhost:8080/earnings-scanner.html
 *
 * Usage:
 *   node earnings-scanner.js           # Start system
 *   pm2 start earnings-scanner.js --name earnings
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load config
let CONFIG;
try {
    CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
    console.error('[EarningsScanner] Failed to load config.json:', e.message);
    process.exit(1);
}

// API endpoints
const APIS = {
    intel: CONFIG.apis.intel || 'http://192.168.10.60:3000',
    options: CONFIG.apis.options || 'http://192.168.10.60:8000'
};

// Earnings-specific Telegram config (separate bot)
// If not configured, fall back to main bot
const TELEGRAM = CONFIG.earnings_telegram || CONFIG.telegram;

// Data files
const DATA_DIR = path.join(__dirname, '..', 'data');
const CALENDAR_FILE = path.join(DATA_DIR, 'earnings-calendar.json');
const SCAN_OUTPUT_FILE = path.join(DATA_DIR, 'earnings-scan.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'earnings-signals.json');
const PAUSE_FILE = path.join(DATA_DIR, '.earnings_paused');

// Settings
const SETTINGS = {
    scanIntervalMs: 30 * 60 * 1000,     // 30 minutes (less frequent than Bloodhound)
    minPremScore: 70,                    // Minimum PREM score to alert
    maxSymbols: 50,                      // Max symbols per scan
    alertCooldownMs: 4 * 60 * 60 * 1000, // 4 hour cooldown per symbol (earnings moves slow)
    premWindowDays: { min: 5, max: 10 }, // PREM window: 5-10 days before earnings
    controlPort: 8082,
    ignoreMarketHours: false             // Set true for testing
};

// Scanner state
const scannerState = {
    startedAt: new Date().toISOString(),
    lastScanAt: null,
    lastScanDuration: null,
    nextScanAt: null,
    scanCount: 0,
    isScanning: false
};

// Alert cooldowns
const alertCooldowns = new Map();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// Display timezone (PST)
const DISPLAY_TIMEZONE = 'America/Los_Angeles';

function formatTimePST(date = new Date()) {
    return date.toLocaleString('en-US', {
        timeZone: DISPLAY_TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Sleep for rate limiting - be gentle to Yahoo Finance backend
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Rate limiting settings - SLOW to be gentle
const RATE_LIMIT = {
    betweenSymbols: 2000,    // 2 seconds between each symbol
    betweenApiCalls: 500,    // 500ms between API calls within same symbol
    calendarRefresh: 1500    // 1.5 seconds between calendar fetches
};

/**
 * Safe JSON fetch with timeout and rate limiting
 */
async function fetchJSON(url, timeout = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        clearTimeout(timeoutId);
        return null;
    }
}

/**
 * Escape HTML for Telegram
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Send Telegram message
 */
async function sendTelegram(message) {
    if (!TELEGRAM?.botToken || !TELEGRAM?.chatId) {
        console.log('[Telegram] Not configured, skipping alert');
        return false;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM.botToken}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM.chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        const result = await response.json();
        if (result.ok) {
            console.log(`[Telegram] Alert sent`);
            return true;
        } else {
            console.error(`[Telegram] Failed:`, result.description);
            return false;
        }
    } catch (e) {
        console.error(`[Telegram] Error:`, e.message);
        return false;
    }
}

/**
 * Check if market is open (extended hours for earnings)
 */
function isMarketOpen() {
    if (SETTINGS.ignoreMarketHours) return true;

    const now = new Date();
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    // Extended hours for earnings: 6:00 AM - 8:00 PM ET
    // (captures pre-market moves and after-hours earnings releases)
    if (day >= 1 && day <= 5 && timeInMinutes >= 360 && timeInMinutes <= 1200) {
        return true;
    }
    return false;
}

/**
 * Pause state management
 */
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

/**
 * Check alert cooldown
 */
function canAlert(symbol) {
    const lastAlert = alertCooldowns.get(symbol);
    if (!lastAlert) return true;
    return (Date.now() - lastAlert) >= SETTINGS.alertCooldownMs;
}

// =============================================================================
// CALENDAR MANAGEMENT
// =============================================================================

/**
 * Load earnings calendar from file
 */
function loadCalendar() {
    try {
        if (!fs.existsSync(CALENDAR_FILE)) {
            console.log('[Calendar] No calendar file found. Run earnings-calendar-scraper.js first.');
            return null;
        }
        const data = JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8'));
        return data;
    } catch (e) {
        console.error('[Calendar] Error loading:', e.message);
        return null;
    }
}

/**
 * Get PREM candidates (5-10 days from earnings)
 */
function getPremCandidates(calendar) {
    if (!calendar?.earnings) return [];

    return calendar.earnings.filter(e => {
        // Recalculate days fresh instead of using stale cached value
        const days = calculateDaysToEarnings(e.earnings_date);
        return days >= SETTINGS.premWindowDays.min && days <= SETTINGS.premWindowDays.max;
    }).map(e => ({
        ...e,
        // Update days_to_earnings with fresh calculation
        days_to_earnings: calculateDaysToEarnings(e.earnings_date)
    }));
}

/**
 * Calculate days to earnings from date string
 */
function calculateDaysToEarnings(earningsDateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earnings = new Date(earningsDateStr);
    const diff = earnings - today;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// =============================================================================
// SCORING ALGORITHM (PREM - Pre-Earnings Momentum)
// =============================================================================

/**
 * Calculate PREM score for a symbol
 * Factors: momentum, flow, IV, market alignment, narrative
 */
async function calculatePremScore(symbol, earningsData) {
    let score = 0;
    const signals = [];
    const details = {};

    // Fetch technical data (with rate limiting between API calls)
    const technicals = await fetchJSON(`${APIS.options}/api/technicals/${symbol}`);
    if (!technicals) {
        return { score: 0, signals: ['No technical data'], details: {} };
    }
    await sleep(RATE_LIMIT.betweenApiCalls);

    details.price = technicals.price;
    details.rsi = technicals.rsi;
    details.trend = technicals.trend;

    // 1. MOMENTUM SCORE (0-25 points)
    // RSI in bullish range (40-70) = good momentum
    const rsi = technicals.rsi || 50;
    if (rsi >= 40 && rsi <= 70) {
        score += 15;
        signals.push(`RSI ${rsi.toFixed(0)} (healthy momentum)`);
    } else if (rsi > 70) {
        score += 5; // High momentum, less upside potential
        signals.push(`RSI ${rsi.toFixed(0)} (high momentum)`);
    } else if (rsi < 30) {
        score += 10; // Low momentum, bounce potential
        signals.push(`RSI ${rsi.toFixed(0)} (momentum reset bounce)`);
    }

    // Trend alignment
    if (technicals.trend === 'bullish') {
        score += 10;
        signals.push('Bullish trend');
    } else if (technicals.trend === 'neutral') {
        score += 5;
    }

    // 2. OPTIONS FLOW SCORE (0-20 points)
    const flow = await fetchJSON(`${APIS.options}/api/flow/${symbol}`);
    await sleep(RATE_LIMIT.betweenApiCalls);
    if (flow) {
        details.callPremium = flow.call_premium;
        details.putPremium = flow.put_premium;
        details.netDelta = flow.net_delta;

        // Net bullish flow
        if (flow.net_delta > 0) {
            const deltaScore = Math.min(15, Math.floor(flow.net_delta / 1000000)); // $1M = 1 point
            score += deltaScore;
            if (deltaScore >= 10) {
                signals.push(`Strong bullish flow (+$${(flow.net_delta / 1000000).toFixed(1)}M net delta)`);
            } else if (deltaScore >= 5) {
                signals.push(`Bullish flow (+$${(flow.net_delta / 1000000).toFixed(1)}M net delta)`);
            }
        }

        // Unusual activity
        if (flow.unusual_activity && flow.unusual_calls > 0) {
            score += 5;
            signals.push(`${flow.unusual_calls} unusual call trades`);
        }
    }

    // 3. IV ANALYSIS (0-15 points)
    const iv = await fetchJSON(`${APIS.options}/api/options/${symbol}/iv`);
    await sleep(RATE_LIMIT.betweenApiCalls);
    if (iv) {
        details.ivRank = iv.iv_rank;
        details.ivPercentile = iv.iv_percentile;

        // Low IV = cheap options, room to run
        if (iv.iv_rank < 30) {
            score += 15;
            signals.push(`Low IV Rank (${iv.iv_rank}%) - room to expand`);
        } else if (iv.iv_rank < 50) {
            score += 10;
            signals.push(`Moderate IV Rank (${iv.iv_rank}%)`);
        } else if (iv.iv_rank > 70) {
            score += 5;
            signals.push(`High IV Rank (${iv.iv_rank}%) - expectations elevated`);
        }
    }

    // 4. MARKET ALIGNMENT (0-10 points)
    const context = await fetchJSON(`${APIS.options}/api/market/context`);
    await sleep(RATE_LIMIT.betweenApiCalls);
    if (context) {
        details.spyTrend = context.spy_trend;
        details.vix = context.vix;

        // Aligned with SPY trend
        if (context.spy_trend === 'bullish' && technicals.trend === 'bullish') {
            score += 10;
            signals.push('Aligned with SPY bullish trend');
        } else if (context.spy_trend === 'bullish') {
            score += 5;
        }

        // VIX regime
        if (context.vix < 15) {
            score += 5; // Calm market = less volatility risk
        }
    }

    // 5. EARNINGS-SPECIFIC FACTORS (0-20 points)
    // Days to earnings (sweet spot is 7-8 days)
    const days = earningsData.days_to_earnings;
    if (days >= 6 && days <= 8) {
        score += 10;
        signals.push(`Optimal timing (${days} days to earnings)`);
    } else if (days >= 5 && days <= 10) {
        score += 5;
        signals.push(`In PREM window (${days} days)`);
    }

    // Earnings time preference (after market = more time to react)
    if (earningsData.earnings_time === 'after_market') {
        score += 5;
        signals.push('After-hours report (favorable)');
    }

    // Cap at 100
    score = Math.min(100, score);

    return {
        score,
        signals,
        details,
        direction: score >= 60 ? 'bullish' : 'neutral'
    };
}

// =============================================================================
// MAIN SCAN LOGIC
// =============================================================================

/**
 * Run the earnings scan
 */
async function runScan() {
    // Check pause state
    if (isPaused()) {
        console.log(`\n[${new Date().toISOString()}] 💤 Earnings Scanner PAUSED`);
        scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();
        return;
    }

    // Check market hours
    if (!isMarketOpen()) {
        console.log(`\n[${new Date().toISOString()}] 🌙 Market CLOSED`);
        scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();
        return;
    }

    const scanStartTime = Date.now();
    scannerState.isScanning = true;

    console.log('\n' + '='.repeat(60));
    console.log(`[${new Date().toISOString()}] EARNINGS SCAN`);
    console.log('='.repeat(60));

    try {
        // Load calendar
        const calendar = loadCalendar();
        if (!calendar) {
            console.log('[Scan] No calendar data. Run: node earnings-calendar-scraper.js');
            return;
        }

        // Get PREM candidates
        const premCandidates = getPremCandidates(calendar);
        console.log(`[Scan] Found ${premCandidates.length} PREM candidates (5-10 days out)`);

        if (premCandidates.length === 0) {
            console.log('[Scan] No PREM candidates in window');
            return;
        }

        // Analyze each candidate
        const results = [];
        const alerts = [];

        for (const candidate of premCandidates.slice(0, SETTINGS.maxSymbols)) {
            console.log(`  Analyzing ${candidate.symbol}...`);

            const analysis = await calculatePremScore(candidate.symbol, candidate);

            const result = {
                symbol: candidate.symbol,
                earnings_date: candidate.earnings_date,
                days_to_earnings: candidate.days_to_earnings,
                earnings_time: candidate.earnings_time,
                score: analysis.score,
                direction: analysis.direction,
                signals: analysis.signals,
                details: analysis.details,
                tier: analysis.score >= 80 ? 'HIGH_CONVICTION' :
                      analysis.score >= 70 ? 'TRADEABLE' :
                      analysis.score >= 50 ? 'WATCH' : 'FILTERED',
                timestamp: new Date().toISOString()
            };

            results.push(result);

            // Check for alert
            if (result.score >= SETTINGS.minPremScore && canAlert(candidate.symbol)) {
                alerts.push(result);
            }

            // Rate limit - be gentle to the backend
            await sleep(RATE_LIMIT.betweenSymbols);
        }

        // Sort by score
        results.sort((a, b) => b.score - a.score);

        // Save scan results
        const scanOutput = {
            last_updated: new Date().toISOString(),
            strategy: 'PREM',
            total_scanned: results.length,
            high_conviction: results.filter(r => r.tier === 'HIGH_CONVICTION').length,
            tradeable: results.filter(r => r.tier === 'TRADEABLE').length,
            results: results
        };

        fs.writeFileSync(SCAN_OUTPUT_FILE, JSON.stringify(scanOutput, null, 2));

        // Send alerts
        for (const alert of alerts) {
            const msg = formatPremAlert(alert);
            const sent = await sendTelegram(msg);
            if (sent) {
                alertCooldowns.set(alert.symbol, Date.now());
            }
        }

        // Summary
        console.log('\n' + '-'.repeat(40));
        console.log('SCAN RESULTS:');
        console.log(`  Total analyzed: ${results.length}`);
        console.log(`  HIGH_CONVICTION: ${results.filter(r => r.tier === 'HIGH_CONVICTION').length}`);
        console.log(`  TRADEABLE: ${results.filter(r => r.tier === 'TRADEABLE').length}`);
        console.log(`  Alerts sent: ${alerts.length}`);

        // Show top opportunities
        const top = results.filter(r => r.score >= 50).slice(0, 5);
        if (top.length > 0) {
            console.log('\nTOP OPPORTUNITIES:');
            for (const r of top) {
                console.log(`  ${r.symbol.padEnd(6)} Score: ${r.score.toString().padStart(3)} | ${r.earnings_date} (${r.days_to_earnings}d) | ${r.signals[0] || ''}`);
            }
        }

    } catch (e) {
        console.error('[Scan] Error:', e.message);
    } finally {
        scannerState.isScanning = false;
        scannerState.lastScanAt = new Date().toISOString();
        scannerState.lastScanDuration = Math.round((Date.now() - scanStartTime) / 1000);
        scannerState.scanCount++;
        scannerState.nextScanAt = new Date(Date.now() + SETTINGS.scanIntervalMs).toISOString();

        console.log(`\n[Done] Scan complete (${scannerState.lastScanDuration}s). Next in ${SETTINGS.scanIntervalMs / 60000} min.`);
        console.log('='.repeat(60));
    }
}

/**
 * Format PREM alert for Telegram
 */
function formatPremAlert(result) {
    const tierEmoji = result.tier === 'HIGH_CONVICTION' ? '🔥' : '📈';
    const timeEmoji = result.earnings_time === 'before_market' ? '🌅' :
                      result.earnings_time === 'after_market' ? '🌙' : '📅';
    const timeStr = formatTimePST();

    let msg = `${tierEmoji} <b>PREM SIGNAL: ${escapeHtml(result.symbol)}</b>\n`;
    msg += `<code>${timeStr} PST</code>\n\n`;

    msg += `<b>Confluence Score:</b> ${result.score}/100\n`;
    msg += `<b>Tier:</b> ${result.tier}\n`;
    msg += `<b>Earnings:</b> ${result.earnings_date} ${timeEmoji}\n`;
    msg += `<b>Days Out:</b> ${result.days_to_earnings}\n\n`;

    if (result.details.price) {
        msg += `<b>Price:</b> $${result.details.price.toFixed(2)}\n`;
    }
    if (result.details.rsi) {
        msg += `<b>RSI:</b> ${result.details.rsi.toFixed(0)}\n`;
    }
    if (result.details.ivRank !== undefined) {
        msg += `<b>IV Rank:</b> ${result.details.ivRank}%\n`;
    }

    msg += `\n<b>Signals:</b>\n`;
    for (const signal of result.signals.slice(0, 5)) {
        msg += `• ${escapeHtml(signal)}\n`;
    }

    msg += `\n<i>PREM Strategy: Buy 5-10 days before earnings</i>\n`;
    msg += `<i>Exit: Day before earnings OR hold through</i>`;

    return msg;
}

// =============================================================================
// HTTP CONTROL SERVER
// =============================================================================

function startControlServer() {
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = req.url;

        // GET /status
        if (req.method === 'GET' && url === '/status') {
            const paused = isPaused();
            const uptimeMs = Date.now() - new Date(scannerState.startedAt).getTime();
            const uptimeMin = Math.floor(uptimeMs / 60000);

            res.writeHead(200);
            res.end(JSON.stringify({
                scanner: 'earnings',
                paused,
                status: paused ? 'paused' : (scannerState.isScanning ? 'scanning' : 'running'),
                uptime: `${uptimeMin}m`,
                startedAt: scannerState.startedAt,
                lastScanAt: scannerState.lastScanAt,
                lastScanDuration: scannerState.lastScanDuration,
                scanCount: scannerState.scanCount,
                nextScanAt: scannerState.nextScanAt,
                settings: {
                    scanInterval: `${SETTINGS.scanIntervalMs / 60000}m`,
                    minScore: SETTINGS.minPremScore,
                    premWindow: SETTINGS.premWindowDays
                }
            }));
            return;
        }

        // POST /pause
        if (req.method === 'POST' && url === '/pause') {
            setPaused(true);
            console.log(`[Control] Scanner PAUSED via web interface`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, status: 'paused' }));
            return;
        }

        // POST /resume
        if (req.method === 'POST' && url === '/resume') {
            setPaused(false);
            console.log(`[Control] Scanner RESUMED via web interface`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, status: 'running' }));
            return;
        }

        // POST /scan
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
            runScan().catch(console.error);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Scan started' }));
            return;
        }

        // POST /refresh-calendar
        if (req.method === 'POST' && url === '/refresh-calendar') {
            // Return immediately - refresh runs in background (can take 60+ seconds)
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Calendar refresh started. This takes 60-90 seconds.' }));

            // Run in background
            const { main: refreshCalendar } = require('./earnings-calendar-scraper');
            refreshCalendar()
                .then(result => {
                    console.log(`[Control] Calendar refresh complete: ${result.total_count} earnings fetched`);
                })
                .catch(err => {
                    console.error(`[Control] Calendar refresh failed: ${err.message}`);
                });
            return;
        }

        // POST /test-alert
        if (req.method === 'POST' && url === '/test-alert') {
            const testMsg = `🧪 <b>EARNINGS SCANNER TEST</b>\n\n` +
                `Status: ✅ Working\n` +
                `Time: ${new Date().toISOString()}\n` +
                `Strategy: PREM (Pre-Earnings Momentum)\n\n` +
                `<i>Ready for earnings season!</i>`;

            sendTelegram(testMsg).then((sent) => {
                res.writeHead(sent ? 200 : 500);
                res.end(JSON.stringify({ success: sent, message: sent ? 'Test alert sent' : 'Failed to send' }));
            });
            return;
        }

        // GET /results
        if (req.method === 'GET' && url === '/results') {
            try {
                if (fs.existsSync(SCAN_OUTPUT_FILE)) {
                    const data = fs.readFileSync(SCAN_OUTPUT_FILE, 'utf8');
                    res.writeHead(200);
                    res.end(data);
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'No scan results yet' }));
                }
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // GET /calendar
        if (req.method === 'GET' && url === '/calendar') {
            try {
                if (fs.existsSync(CALENDAR_FILE)) {
                    const data = fs.readFileSync(CALENDAR_FILE, 'utf8');
                    res.writeHead(200);
                    res.end(data);
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'No calendar data. Run refresh first.' }));
                }
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(SETTINGS.controlPort, '0.0.0.0', () => {
        console.log(`[Control] Listening on http://0.0.0.0:${SETTINGS.controlPort} (accessible from network)`);
        console.log('');
        console.log('  Endpoints:');
        console.log(`    GET  /status            - System status`);
        console.log(`    GET  /results           - Latest scan results`);
        console.log(`    GET  /calendar          - Earnings calendar`);
        console.log(`    POST /pause             - Pause scanner`);
        console.log(`    POST /resume            - Resume scanner`);
        console.log(`    POST /scan              - Trigger immediate scan`);
        console.log(`    POST /refresh-calendar  - Refresh earnings calendar`);
        console.log(`    POST /test-alert        - Send test Telegram alert`);
    });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    console.log('='.repeat(60));
    console.log('       EARNINGS SEASON SCANNER');
    console.log('       Strategy: PREM (Pre-Earnings Momentum)');
    console.log('='.repeat(60));
    console.log(`Options API: ${APIS.options}`);
    console.log(`Intel API: ${APIS.intel}`);
    console.log(`Telegram: ${TELEGRAM?.botToken ? 'Configured' : 'NOT CONFIGURED'}`);
    console.log(`Scan Interval: ${SETTINGS.scanIntervalMs / 60000} minutes`);
    console.log(`PREM Window: ${SETTINGS.premWindowDays.min}-${SETTINGS.premWindowDays.max} days`);
    console.log('='.repeat(60));

    // Start HTTP control server
    startControlServer();

    // Check for calendar data
    if (!fs.existsSync(CALENDAR_FILE)) {
        console.log('\n⚠️  No earnings calendar found!');
        console.log('   Run: node earnings-calendar-scraper.js');
        console.log('   Or POST to /refresh-calendar\n');
    }

    // Initial scan
    console.log('\nRunning initial scan...\n');
    await runScan();

    // Schedule recurring scans
    setInterval(runScan, SETTINGS.scanIntervalMs);

    console.log('\nEarnings Scanner running. Press Ctrl+C to stop.');
}

// Export for testing and integration
module.exports = {
    runScan,
    calculatePremScore,
    getPremCandidates,
    loadCalendar,
    sendTelegram,
    SETTINGS
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
