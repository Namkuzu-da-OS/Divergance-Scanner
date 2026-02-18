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
const config = require('./config-loader');
const { sendTelegram } = require('./telegram');

const OPTIONS_API = config.apis.options;

// Re-entrancy guard — prevent overlapping scans (4:15 + 4:30 backup)
let _scanInProgress = false;

// Global error handlers — log and stay alive (PM2 will restart if needed)
process.on('uncaughtException', (err) => {
    log(`UNCAUGHT EXCEPTION: ${err.message}`);
    console.error(err.stack);
    _scanInProgress = false;
});
process.on('unhandledRejection', (reason) => {
    log(`UNHANDLED REJECTION: ${reason}`);
    _scanInProgress = false;
});

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

// sendTelegram imported from ./telegram.js

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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(`${OPTIONS_API}/api/quotes/${symbol}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        log(`Failed to fetch quote for ${symbol}: ${e.message}`);
        return null;
    }
}

/**
 * Fetch daily bar (OHLC) from Options API
 * Aggregates 1-minute candles over RTH (9:30 AM - 4:00 PM ET) to get true daily OHLC
 */
async function fetchDailyBar(symbol) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(`${OPTIONS_API}/api/history/${symbol}?range=1d`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) {
            log(`${symbol}: History API returned ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (!data.candles || data.candles.length === 0) {
            log(`${symbol}: No candles returned from history API`);
            return null;
        }

        // Filter to RTH candles only (9:30 AM - 4:00 PM ET)
        const rthCandles = data.candles.filter(c => {
            const etStr = new Date(c.datetime).toLocaleString('en-US', { timeZone: 'America/New_York' });
            const et = new Date(etStr);
            const hour = et.getHours();
            const min = et.getMinutes();
            const totalMin = hour * 60 + min;
            // RTH: 9:30 (570) through 15:59 (959) — candle at 16:00 is after-hours
            return totalMin >= 570 && totalMin < 960;
        });

        if (rthCandles.length === 0) {
            log(`${symbol}: No RTH candles found (total candles: ${data.candles.length})`);
            return null;
        }

        // Aggregate RTH candles into single daily bar
        const rthOpen = rthCandles[0].open;
        const rthClose = rthCandles[rthCandles.length - 1].close;
        let rthHigh = -Infinity;
        let rthLow = Infinity;
        let rthVolume = 0;

        for (const c of rthCandles) {
            if (c.high > rthHigh) rthHigh = c.high;
            if (c.low < rthLow) rthLow = c.low;
            rthVolume += c.volume || 0;
        }

        log(`${symbol}: Aggregated ${rthCandles.length} RTH candles — O:${rthOpen} H:${rthHigh} L:${rthLow} C:${rthClose}`);

        return {
            open: rthOpen,
            high: rthHigh,
            low: rthLow,
            close: rthClose,
            volume: rthVolume,
            rth_open: rthOpen
        };
    } catch (e) {
        log(`Failed to fetch daily bar for ${symbol}: ${e.message}`);
        return null;
    }
}

// ============================================
// CORE TRACKING LOGIC
// ============================================

/**
 * Process all gaps needing EOD data
 */
async function processGaps() {
    if (_scanInProgress) {
        log('Scan already in progress — skipping');
        return { processed: 0, updated: 0, symbols: [], skipped: true };
    }
    _scanInProgress = true;

    log('Starting EOD gap tracking...');

    // Get gaps that need EOD data
    const gaps = signalDb.getGapsNeedingEOD();

    if (gaps.length === 0) {
        log('No gaps to process');
        _scanInProgress = false;
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
            prevClose: gap.prev_close,
            rthOpen: bar.rth_open || null
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
    _scanInProgress = false;

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
