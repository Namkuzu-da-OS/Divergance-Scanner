#!/usr/bin/env node
/**
 * EOD GAP TRACKER
 *
 * Persistent process that runs via PM2 and schedules daily EOD tracking.
 *
 * Runs at 4:15 PM ET (16:15) to:
 * 1. Fetch closing data for today's gaps
 * 2. Calculate if gaps filled
 * 3. Determine outcomes (WIN/LOSS/SCRATCH)
 * 4. Update ticker stats
 *
 * Manual run: node eod-gap-tracker.js --now
 */

const cron = require('node-cron');
const signalDb = require('./signal-db');
const config = require('./config.json');

const OPTIONS_API = config.apis?.options || 'http://192.168.10.60:8000';
const TELEGRAM_BOT_TOKEN = config.telegram?.botToken;
const TELEGRAM_CHAT_ID = config.telegram?.chatId;

// ============================================
// LOGGING
// ============================================

function log(msg) {
    const timestamp = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    console.log(`[${timestamp} ET] [EOD Tracker] ${msg}`);
}

// ============================================
// TELEGRAM
// ============================================

/**
 * Send message to Telegram
 */
async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        log('Telegram not configured, skipping alert');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        if (!response.ok) {
            const error = await response.text();
            log(`Telegram error: ${error}`);
            return false;
        }

        log('Telegram summary sent');
        return true;
    } catch (e) {
        log(`Telegram failed: ${e.message}`);
        return false;
    }
}

/**
 * Format and send EOD summary to Telegram
 */
async function sendTelegramSummary(processResult) {
    const stats = signalDb.getGapFillRates({ days: 1 });

    if (!stats.overall || stats.overall.total === 0) {
        // No gaps to report
        return;
    }

    // Build the message
    let msg = `📊 <b>EOD GAP SUMMARY</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Overall stats
    msg += `<b>Today's Gaps:</b> ${stats.overall.total}\n`;
    msg += `<b>Filled:</b> ${stats.overall.filled} (${stats.overall.fill_rate}%)\n\n`;

    // By tier
    if (stats.by_tier && stats.by_tier.length > 0) {
        msg += `<b>By Tier:</b>\n`;
        stats.by_tier.forEach(t => {
            const emoji = t.tier === 'HIGH_CONVICTION' ? '🎯' : t.tier === 'TRADEABLE' ? '📈' : '👀';
            msg += `${emoji} ${t.tier}: ${t.filled}/${t.total} (${t.fill_rate}%)\n`;
        });
        msg += `\n`;
    }

    // Notable gaps from today's results
    if (processResult.results && processResult.results.length > 0) {
        // Sort by absolute gap size to show biggest movers
        const notables = processResult.results
            .sort((a, b) => Math.abs(b.gap_pct) - Math.abs(a.gap_pct))
            .slice(0, 5);

        msg += `<b>Notable Gaps:</b>\n`;
        notables.forEach(g => {
            const gapDir = g.gap_pct >= 0 ? '📈' : '📉';
            const gapStr = g.gap_pct >= 0 ? `+${g.gap_pct.toFixed(1)}%` : `${g.gap_pct.toFixed(1)}%`;
            const fillStr = g.filled ? '✓ FILLED' : '✗ RAN';
            const outcomeEmoji = g.outcome === 'WIN' ? '💰' : g.outcome === 'LOSS' ? '❌' : '➖';
            msg += `${gapDir} ${g.symbol} ${gapStr} → ${fillStr} ${outcomeEmoji}\n`;
        });
    }

    await sendTelegram(msg);
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Fetch quote data from Options API
 */
async function fetchQuote(symbol) {
    try {
        const response = await fetch(`${OPTIONS_API}/api/quotes/${symbol}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        log(`Failed to fetch quote for ${symbol}: ${e.message}`);
        return null;
    }
}

/**
 * Fetch daily bar (OHLC) from Options API
 */
async function fetchDailyBar(symbol) {
    try {
        // Try to get today's OHLC from history endpoint
        const response = await fetch(`${OPTIONS_API}/api/history/${symbol}?range=1d`);
        if (!response.ok) {
            // Fallback to quote
            return await fetchQuoteAsDailyBar(symbol);
        }

        const data = await response.json();

        // Get the most recent bar
        if (data.bars && data.bars.length > 0) {
            const bar = data.bars[data.bars.length - 1];
            return {
                open: bar.o || bar.open,
                high: bar.h || bar.high,
                low: bar.l || bar.low,
                close: bar.c || bar.close,
                volume: bar.v || bar.volume
            };
        }

        // Fallback to quote data
        return await fetchQuoteAsDailyBar(symbol);
    } catch (e) {
        log(`Failed to fetch daily bar for ${symbol}: ${e.message}`);
        return null;
    }
}

async function fetchQuoteAsDailyBar(symbol) {
    const quote = await fetchQuote(symbol);
    if (quote) {
        return {
            open: quote.open,
            high: quote.high,
            low: quote.low,
            close: quote.price || quote.last,
            volume: quote.volume
        };
    }
    return null;
}

// ============================================
// CORE TRACKING LOGIC
// ============================================

/**
 * Process all gaps needing EOD data
 */
async function processGaps() {
    log('Starting EOD gap tracking...');

    // Get gaps that need EOD data
    const gaps = signalDb.getGapsNeedingEOD();

    if (gaps.length === 0) {
        log('No gaps to process');
        return { processed: 0, updated: 0, symbols: [] };
    }

    log(`Found ${gaps.length} gaps to process`);

    let updated = 0;
    const symbolsUpdated = new Set();
    const results = [];

    for (const gap of gaps) {
        const bar = await fetchDailyBar(gap.symbol);

        if (!bar || !bar.close) {
            log(`  ${gap.symbol}: No EOD data available`);
            continue;
        }

        const result = signalDb.updateGapEOD(gap.id, {
            close: bar.close,
            high: bar.high,
            low: bar.low,
            prevClose: gap.prev_close
        });

        if (result) {
            const filledStr = result.gapFilled ? 'FILLED' : 'NOT FILLED';
            const changeStr = result.eodChangePct >= 0 ? `+${result.eodChangePct.toFixed(1)}%` : `${result.eodChangePct.toFixed(1)}%`;
            log(`  ${gap.symbol}: ${filledStr} | ${result.outcome} | EOD: ${changeStr}`);
            updated++;
            symbolsUpdated.add(gap.symbol);
            results.push({
                symbol: gap.symbol,
                gap_pct: gap.gap_pct,
                filled: result.gapFilled,
                outcome: result.outcome,
                eod_change: result.eodChangePct
            });
        }

        // Small delay to avoid hammering API
        await new Promise(r => setTimeout(r, 100));
    }

    // Update ticker stats for all affected symbols
    if (symbolsUpdated.size > 0) {
        log(`Updating stats for ${symbolsUpdated.size} tickers...`);
        for (const symbol of symbolsUpdated) {
            signalDb.updateTickerStats(symbol);
        }
    }

    log(`Done. Processed ${gaps.length} gaps, updated ${updated}`);

    return { processed: gaps.length, updated, symbols: Array.from(symbolsUpdated), results };
}

/**
 * Print summary of today's results
 */
function printSummary() {
    const stats = signalDb.getGapFillRates({ days: 1 });

    console.log('\n' + '='.repeat(50));
    console.log('TODAY\'S GAP SUMMARY');
    console.log('='.repeat(50));

    if (!stats.overall || stats.overall.total === 0) {
        console.log('No tracked gaps today');
        return;
    }

    console.log(`\nTotal Gaps: ${stats.overall.total}`);
    console.log(`Filled: ${stats.overall.filled} (${stats.overall.fill_rate}%)`);

    if (stats.by_tier && stats.by_tier.length > 0) {
        console.log('\nBy Tier:');
        stats.by_tier.forEach(t => {
            console.log(`  ${t.tier}: ${t.filled}/${t.total} filled (${t.fill_rate}%)`);
        });
    }

    if (stats.by_direction && stats.by_direction.length > 0) {
        console.log('\nBy Direction:');
        stats.by_direction.forEach(d => {
            console.log(`  ${d.direction}: ${d.filled}/${d.total} filled (${d.fill_rate}%)`);
        });
    }

    console.log('='.repeat(50) + '\n');
}

/**
 * Run the full EOD tracking process
 */
async function runEODTracking() {
    console.log('\n' + '='.repeat(60));
    console.log('   EOD GAP TRACKER - SCHEDULED RUN');
    console.log('='.repeat(60));
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Options API: ${OPTIONS_API}`);
    console.log('='.repeat(60) + '\n');

    try {
        const result = await processGaps();
        printSummary();

        // Send Telegram summary if we processed any gaps
        if (result.updated > 0) {
            await sendTelegramSummary(result);
        }

        return result;
    } catch (e) {
        log(`Error: ${e.message}`);
        console.error(e);
        return { error: e.message };
    }
}

// ============================================
// SCHEDULING
// ============================================

/**
 * Get current ET time info
 */
function getETTimeInfo() {
    const now = new Date();
    const etOptions = { timeZone: 'America/New_York' };

    return {
        hour: parseInt(now.toLocaleString('en-US', { ...etOptions, hour: '2-digit', hour12: false })),
        minute: parseInt(now.toLocaleString('en-US', { ...etOptions, minute: '2-digit' })),
        formatted: now.toLocaleString('en-US', {
            ...etOptions,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        })
    };
}

/**
 * Start the scheduler
 */
function startScheduler() {
    console.log('='.repeat(60));
    console.log('   EOD GAP TRACKER');
    console.log('   Scheduled daily at 4:15 PM ET');
    console.log('='.repeat(60));

    const etInfo = getETTimeInfo();
    console.log(`Current time: ${etInfo.formatted} ET`);
    console.log(`Options API: ${OPTIONS_API}`);
    console.log('='.repeat(60));
    console.log('');
    log('Scheduler started. Waiting for 4:15 PM ET...');
    console.log('');
    console.log('Commands:');
    console.log('  Manual run: node eod-gap-tracker.js --now');
    console.log('  PM2 logs:   pm2 logs eod-tracker');
    console.log('');

    // Schedule for 4:15 PM ET (16:15)
    // Cron format: minute hour * * * (runs every day)
    // Note: node-cron uses server timezone, so we need to specify America/New_York
    cron.schedule('15 16 * * 1-5', async () => {
        log('Scheduled run triggered');
        await runEODTracking();
    }, {
        timezone: 'America/New_York'
    });

    // Also schedule a backup run at 4:30 PM in case 4:15 had issues
    cron.schedule('30 16 * * 1-5', async () => {
        // Check if we have any gaps that still need EOD data
        const gaps = signalDb.getGapsNeedingEOD();
        if (gaps.length > 0) {
            log('Backup run triggered - found gaps still needing EOD data');
            await runEODTracking();
        }
    }, {
        timezone: 'America/New_York'
    });

    // Keep process alive
    process.on('SIGINT', () => {
        log('Received SIGINT. Shutting down...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        log('Received SIGTERM. Shutting down...');
        process.exit(0);
    });
}

// ============================================
// MAIN
// ============================================

async function main() {
    const args = process.argv.slice(2);

    // Manual run mode
    if (args.includes('--now') || args.includes('-n')) {
        await runEODTracking();
        process.exit(0);
    }

    // Scheduler mode (default)
    startScheduler();
}

main();

module.exports = { processGaps, printSummary, runEODTracking };
