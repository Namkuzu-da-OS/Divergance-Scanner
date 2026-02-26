#!/usr/bin/env node
/**
 * EOD WRAP-UP
 *
 * Persistent process that runs via PM2 and sends a daily Telegram summary
 * after after-hours close (8:15 PM ET). Captures market close, internals,
 * scanner results, positions, gaps, flow, and key levels.
 *
 * Also archives the daily log (absorbs eod.js functionality).
 *
 * Manual run: node monitor/eod-wrapup.js --now
 * PM2 logs:   pm2 logs eod-wrapup
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const signalDb = require('./signal-db');
const opportunityDb = require('./opportunity-db');
const config = require('./config-loader');
const { sendTelegram, escapeHtml } = require('./telegram');
const { fetchJSON } = require('./api-client');

const OPTIONS_API = config.apis.options;
const PORT = 8087;
const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(__dirname, '..', 'archive', 'daily_logs');

// Re-entrancy guard
let _wrapupInProgress = false;
let _lastRunTime = null;
let _lastTelegramStatus = null;

// Global error handlers
process.on('uncaughtException', (err) => {
    log(`UNCAUGHT EXCEPTION: ${err.message}`);
    console.error(err.stack);
    _wrapupInProgress = false;
});
process.on('unhandledRejection', (reason) => {
    log(`UNHANDLED REJECTION: ${reason}`);
    _wrapupInProgress = false;
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
    console.log(`[${timestamp} ET] [EOD Wrapup] ${msg}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// DATA COLLECTION
// ============================================

/**
 * Fetch SPY/QQQ closing quotes via Options API
 */
async function collectMarketClose() {
    log('Collecting market close data...');

    const spy = await fetchJSON(`${OPTIONS_API}/api/quotes/SPY`);
    await sleep(100);
    const qqq = await fetchJSON(`${OPTIONS_API}/api/quotes/QQQ`);

    const result = {};

    if (spy?.quote) {
        const q = spy.quote;
        result.spy_close = q.closePrice ?? q.lastPrice ?? q.mark ?? null;
        result.spy_change_pct = q.netPercentChange ?? null;
    }

    if (qqq?.quote) {
        const q = qqq.quote;
        result.qqq_close = q.closePrice ?? q.lastPrice ?? q.mark ?? null;
        result.qqq_change_pct = q.netPercentChange ?? null;
    }

    log(`  SPY: $${result.spy_close ?? 'N/A'} (${result.spy_change_pct != null ? (result.spy_change_pct >= 0 ? '+' : '') + result.spy_change_pct.toFixed(2) + '%' : 'N/A'})`);
    log(`  QQQ: $${result.qqq_close ?? 'N/A'} (${result.qqq_change_pct != null ? (result.qqq_change_pct >= 0 ? '+' : '') + result.qqq_change_pct.toFixed(2) + '%' : 'N/A'})`);

    return result;
}

/**
 * Get final market internals from today's last reading
 */
function collectFinalInternals() {
    log('Collecting final internals...');

    const internals = signalDb.getLatestInternals();
    if (!internals) {
        log('  No internals data available');
        return {};
    }

    const result = {
        tick_final: internals.tick ?? null,
        trin_final: internals.trin ?? null,
        ad_spread_final: internals.ad_spread ?? null,
        vol_ratio_final: internals.vol_ratio ?? null,
        vix_close: internals.vix ?? null,
        vix_change_pct: internals.vix_change_pct ?? null,
        spx_close: internals.spx ?? null,
        spx_change_pct: internals.spx_change_pct ?? null
    };

    log(`  TICK: ${result.tick_final ?? 'N/A'} | TRIN: ${result.trin_final ?? 'N/A'} | A/D: ${result.ad_spread_final ?? 'N/A'} | Vol: ${result.vol_ratio_final ?? 'N/A'}`);
    log(`  VIX: ${result.vix_close ?? 'N/A'} (${result.vix_change_pct != null ? (result.vix_change_pct >= 0 ? '+' : '') + result.vix_change_pct.toFixed(2) + '%' : 'N/A'})`);

    return result;
}

/**
 * Get Bloodhound scanner summary
 */
function collectBloodhoundSummary() {
    log('Collecting Bloodhound summary...');

    const scan = signalDb.getLatestBloodhoundScan();
    if (!scan) {
        log('  No Bloodhound scan data available');
        return {};
    }

    const topResults = (scan.results || [])
        .sort((a, b) => (b.sourceInfo?.score || 0) - (a.sourceInfo?.score || 0))
        .slice(0, 5)
        .map(r => ({
            symbol: r.symbol,
            score: r.sourceInfo?.score || 0,
            zone: r.zone,
            tier: r.sourceInfo?.tier || 'FILTERED',
            action: r.action || null
        }));

    const mc = scan.marketContext || {};
    let rotRegime = mc.rotationRegime;

    // Rotation regime is intermittent (divergence scanner sometimes slow).
    // If latest scan has null, check recent scans for the last known regime.
    if (!rotRegime) {
        try {
            const db = signalDb.getDb();
            const recentScans = db.prepare(
                'SELECT spy_levels_json FROM bloodhound_scans ORDER BY id DESC LIMIT 10'
            ).all();
            for (const row of recentScans) {
                const levels = JSON.parse(row.spy_levels_json || '{}');
                if (levels.rotationRegime && levels.rotationRegime.phase) {
                    rotRegime = levels.rotationRegime;
                    break;
                }
            }
        } catch (e) {
            // Ignore — rotation is best-effort
        }
    }

    const result = {
        scan_count: scan.scanCount || 0,
        tradeable_count: scan.tradeableCount || 0,
        top_tickers_json: topResults,
        // Market regime context
        vix_regime: mc.vixRegime || null,
        spy_trend: mc.spyTrend || null,
        rotation_phase: rotRegime?.phase || null,
        rotation_leading: rotRegime?.leading || null,
        rotation_lagging: rotRegime?.lagging || null,
        // Extract key levels from market context
        spy_call_wall: mc.spyLevels?.callWall ?? null,
        spy_put_wall: mc.spyLevels?.putWall ?? null,
        spy_gamma_flip: mc.spyLevels?.gammaFlip ?? null,
        qqq_call_wall: mc.qqqLevels?.callWall ?? null,
        qqq_put_wall: mc.qqqLevels?.putWall ?? null,
        qqq_gamma_flip: mc.qqqLevels?.gammaFlip ?? null
    };

    log(`  Scanned: ${result.scan_count} | Tradeable: ${result.tradeable_count}`);
    log(`  Regime: VIX ${result.vix_regime || 'N/A'} | SPY ${result.spy_trend || 'N/A'} | Rotation ${result.rotation_phase || 'N/A'}`);
    if (topResults.length > 0) {
        log(`  Top: ${topResults.map(t => `${t.symbol}(${t.score})`).join(', ')}`);
    }

    return result;
}

/**
 * Get open positions summary
 */
function collectPositions() {
    log('Collecting positions...');

    const posData = signalDb.getOpenPositions();
    const result = {
        positions_count: posData.summary.total_open,
        total_exposure: posData.summary.total_exposure,
        unrealized_pnl: posData.summary.total_unrealized_pnl
    };

    log(`  Open: ${result.positions_count} | Exposure: $${result.total_exposure.toFixed(0)}`);

    return result;
}

/**
 * Get today's gap fill data
 */
function collectGapFills() {
    log('Collecting gap fills...');

    const stats = signalDb.getGapFillRates({ days: 1 });

    const result = {
        gaps_today: stats.overall?.total || 0,
        gaps_filled: stats.overall?.filled || 0,
        fill_rate: stats.overall?.fill_rate || 0
    };

    log(`  Gaps: ${result.gaps_today} | Filled: ${result.gaps_filled} (${result.fill_rate}%)`);

    return result;
}

/**
 * Get top flow highlights from Opportunity Scanner
 */
function collectFlowHighlights() {
    log('Collecting flow highlights...');

    const scan = opportunityDb.getLatestOpportunityScan();
    if (!scan || !scan.results || scan.results.length === 0) {
        log('  No opportunity scan data available');
        return { top_flow_json: [] };
    }

    const topFlow = scan.results
        .filter(r => r.unusual?.volOiRatio > 1)
        .sort((a, b) => (b.unusual?.volOiRatio || 0) - (a.unusual?.volOiRatio || 0))
        .slice(0, 3)
        .map(r => ({
            symbol: r.symbol,
            direction: r.direction,
            vol_oi_ratio: r.unusual?.volOiRatio || 0,
            net_premium: r.unusual?.netPremium || 0,
            score: r.score
        }));

    if (topFlow.length > 0) {
        log(`  Top flow: ${topFlow.map(f => `${f.symbol} ${f.direction === 'bullish' ? '🟢' : '🔴'} ${f.vol_oi_ratio.toFixed(0)}x`).join(', ')}`);
    } else {
        log('  No significant flow activity');
    }

    return { top_flow_json: topFlow };
}

/**
 * Get count of active (tracked) signals
 */
function collectActiveSignals() {
    log('Collecting active signals...');

    const active = signalDb.getActiveSignals();
    const hcCount = active.filter(s => s.tier === 'HIGH_CONVICTION').length;
    const tradeableCount = active.filter(s => s.tier === 'TRADEABLE').length;

    log(`  Active signals: ${active.length} (${hcCount} HC, ${tradeableCount} tradeable)`);

    return {
        active_signals: active.length,
        active_hc_signals: hcCount,
        active_tradeable_signals: tradeableCount
    };
}

/**
 * Get tomorrow's earnings from calendar
 */
function collectTomorrowEarnings() {
    log('Collecting tomorrow earnings...');

    const cal = signalDb.getEarningsCalendar();
    if (!cal || !cal.earnings || cal.earnings.length === 0) {
        log('  No earnings calendar data');
        return { tomorrow_earnings: [] };
    }

    // Calculate tomorrow's date in ET
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const tomorrowEarnings = cal.earnings
        .filter(e => e.earnings_date === tomorrowStr)
        .map(e => ({
            symbol: e.symbol,
            time: e.earnings_time || 'unknown'
        }));

    if (tomorrowEarnings.length > 0) {
        log(`  Tomorrow (${tomorrowStr}): ${tomorrowEarnings.map(e => `${e.symbol} (${e.time})`).join(', ')}`);
    } else {
        log(`  No earnings tomorrow (${tomorrowStr})`);
    }

    return { tomorrow_earnings: tomorrowEarnings };
}

// ============================================
// DAILY LOG ARCHIVING
// ============================================

/**
 * Archive today's daily log and create a fresh template
 * Absorbs functionality from eod.js
 */
function archiveDailyLog() {
    const logPath = path.join(DATA_DIR, 'daily_log.md');

    if (!fs.existsSync(logPath)) {
        log('No daily_log.md to archive');
        return;
    }

    const content = fs.readFileSync(logPath, 'utf8');
    if (!content.trim()) {
        log('daily_log.md is empty, skipping archive');
        return;
    }

    // Ensure archive directory exists
    if (!fs.existsSync(ARCHIVE_DIR)) {
        fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }

    // Archive with today's date
    const today = signalDb.getETDate();
    const archivePath = path.join(ARCHIVE_DIR, `daily_log_${today}.md`);

    // Don't overwrite if already archived today
    if (fs.existsSync(archivePath)) {
        log(`Archive already exists for ${today}, skipping`);
        return;
    }

    fs.copyFileSync(logPath, archivePath);
    log(`Archived daily log to ${archivePath}`);

    // Create fresh template for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const dayName = tomorrow.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const template = `# Trading Log - ${dayName}

**Session Status:** PENDING
**Account Balance:** --
**Risk Available:** $500.00 (daily max loss)

---

## MARKET SNAPSHOT (Session Open)

| Metric | Value |
|--------|-------|
| SPY | -- |
| VIX | -- |
| Sentiment | -- |

---

## TRADES

_No trades yet._

---

## NOTES

`;

    fs.writeFileSync(logPath, template);
    log(`Created fresh daily_log.md for ${tomorrowStr}`);
}

// ============================================
// TELEGRAM MESSAGE
// ============================================

/**
 * Build and send the EOD Telegram summary
 */
async function sendEodTelegram(summary) {
    const dayName = new Date().toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });

    let msg = `📊 <b>EOD WRAP-UP — ${escapeHtml(dayName)}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Market close
    const spyStr = summary.spy_close != null ? `$${summary.spy_close.toFixed(2)}` : 'N/A';
    const spyPctStr = summary.spy_change_pct != null ? `(${summary.spy_change_pct >= 0 ? '+' : ''}${summary.spy_change_pct.toFixed(2)}%)` : '';
    const qqqStr = summary.qqq_close != null ? `$${summary.qqq_close.toFixed(2)}` : 'N/A';
    const qqqPctStr = summary.qqq_change_pct != null ? `(${summary.qqq_change_pct >= 0 ? '+' : ''}${summary.qqq_change_pct.toFixed(2)}%)` : '';
    const vixStr = summary.vix_close != null ? summary.vix_close.toFixed(2) : 'N/A';
    const vixPctStr = summary.vix_change_pct != null ? `(${summary.vix_change_pct >= 0 ? '+' : ''}${summary.vix_change_pct.toFixed(2)}%)` : '';
    const spxStr = summary.spx_close != null ? summary.spx_close.toLocaleString() : 'N/A';

    msg += `SPY ${spyStr} ${spyPctStr} | QQQ ${qqqStr} ${qqqPctStr}\n`;
    msg += `VIX ${vixStr} ${vixPctStr} | SPX ${spxStr}\n`;

    // Regime context
    const regimeParts = [];
    if (summary.vix_regime) regimeParts.push(`VIX: ${summary.vix_regime.toUpperCase()}`);
    if (summary.spy_trend) regimeParts.push(`SPY: ${summary.spy_trend}`);
    if (summary.rotation_phase) regimeParts.push(`Rotation: ${summary.rotation_phase}`);
    if (regimeParts.length > 0) {
        msg += `🏷️ ${regimeParts.join(' | ')}\n`;
    }
    if (summary.rotation_leading || summary.rotation_lagging) {
        const parts = [];
        if (summary.rotation_leading) parts.push(`Leading: ${Array.isArray(summary.rotation_leading) ? summary.rotation_leading.join(', ') : summary.rotation_leading}`);
        if (summary.rotation_lagging) parts.push(`Lagging: ${Array.isArray(summary.rotation_lagging) ? summary.rotation_lagging.join(', ') : summary.rotation_lagging}`);
        msg += `🔄 ${parts.join(' | ')}\n`;
    }
    msg += `\n`;

    // Internals
    const tickStr = summary.tick_final != null ? (summary.tick_final >= 0 ? '+' : '') + Math.round(summary.tick_final) : 'N/A';
    const trinStr = summary.trin_final != null ? summary.trin_final.toFixed(2) : 'N/A';
    const adStr = summary.ad_spread_final != null ? (summary.ad_spread_final >= 0 ? '+' : '') + Math.round(summary.ad_spread_final) : 'N/A';
    const volStr = summary.vol_ratio_final != null ? summary.vol_ratio_final.toFixed(2) + ':1' : 'N/A';
    msg += `📈 <b>Internals:</b> TICK ${tickStr} | TRIN ${trinStr} | A/D ${adStr} | Vol ${volStr}\n\n`;

    // Scanner
    msg += `🔍 <b>Scanner:</b> ${summary.scan_count ?? 0} scanned, ${summary.tradeable_count ?? 0} tradeable\n`;
    if (summary.top_tickers_json && summary.top_tickers_json.length > 0) {
        const topStr = summary.top_tickers_json.map(t => `${escapeHtml(t.symbol)} (${t.score})`).join(', ');
        msg += `Top: ${topStr}\n`;
    }
    msg += `\n`;

    // Active signals
    if (summary.active_signals > 0) {
        msg += `📡 <b>Signals:</b> ${summary.active_signals} active (${summary.active_hc_signals} HC, ${summary.active_tradeable_signals} tradeable)\n\n`;
    }

    // Positions
    msg += `💼 <b>Positions:</b> ${summary.positions_count ?? 0} open | $${(summary.total_exposure ?? 0).toFixed(0)} exposure\n\n`;

    // Gaps
    if (summary.gaps_today > 0) {
        msg += `📉 <b>Gaps:</b> ${summary.gaps_today} today, ${summary.gaps_filled} filled (${summary.fill_rate}%)\n\n`;
    }

    // Flow
    if (summary.top_flow_json && summary.top_flow_json.length > 0) {
        const flowStr = summary.top_flow_json.map(f => {
            const dir = f.direction === 'bullish' ? '🟢' : '🔴';
            return `${escapeHtml(f.symbol)} ${dir} ${f.vol_oi_ratio.toFixed(0)}x`;
        }).join(', ');
        msg += `🌊 <b>Flow:</b> ${flowStr}\n\n`;
    }

    // Key levels
    if (summary.spy_call_wall || summary.spy_put_wall) {
        msg += `🎯 <b>Levels:</b>\n`;
        const spyCW = summary.spy_call_wall ? `CW $${summary.spy_call_wall}` : '';
        const spyPW = summary.spy_put_wall ? `PW $${summary.spy_put_wall}` : '';
        const spyGF = summary.spy_gamma_flip ? `GF $${summary.spy_gamma_flip}` : '';
        msg += `SPY: ${[spyCW, spyPW, spyGF].filter(Boolean).join(' | ')}\n`;

        if (summary.qqq_call_wall || summary.qqq_put_wall) {
            const qqqCW = summary.qqq_call_wall ? `CW $${summary.qqq_call_wall}` : '';
            const qqqPW = summary.qqq_put_wall ? `PW $${summary.qqq_put_wall}` : '';
            const qqqGF = summary.qqq_gamma_flip ? `GF $${summary.qqq_gamma_flip}` : '';
            msg += `QQQ: ${[qqqCW, qqqPW, qqqGF].filter(Boolean).join(' | ')}\n`;
        }
    }

    // Tomorrow's earnings
    if (summary.tomorrow_earnings && summary.tomorrow_earnings.length > 0) {
        const bmo = summary.tomorrow_earnings.filter(e => e.time === 'before_open' || e.time === 'bmo');
        const amc = summary.tomorrow_earnings.filter(e => e.time === 'after_close' || e.time === 'amc');
        const other = summary.tomorrow_earnings.filter(e => !['before_open', 'bmo', 'after_close', 'amc'].includes(e.time));

        msg += `\n📅 <b>Earnings Tomorrow:</b>\n`;
        if (bmo.length > 0) msg += `  Pre: ${bmo.map(e => escapeHtml(e.symbol)).join(', ')}\n`;
        if (amc.length > 0) msg += `  Post: ${amc.map(e => escapeHtml(e.symbol)).join(', ')}\n`;
        if (other.length > 0) msg += `  TBD: ${other.map(e => escapeHtml(e.symbol)).join(', ')}\n`;
    }

    const result = await sendTelegram(msg);
    return result;
}

// ============================================
// MAIN WRAP-UP FLOW
// ============================================

/**
 * Run the full EOD wrap-up process
 */
async function runEODWrapup() {
    if (_wrapupInProgress) {
        log('Wrap-up already in progress — skipping');
        return { skipped: true };
    }
    _wrapupInProgress = true;

    const today = signalDb.getETDate();
    log(`Starting EOD wrap-up for ${today}...`);

    try {
        // Check if already ran today
        const existing = signalDb.getEodSummaryByDate(today);
        if (existing && existing.telegram_sent) {
            log(`EOD summary already sent for ${today} — skipping`);
            _wrapupInProgress = false;
            return { skipped: true, reason: 'already_sent' };
        }

        // Collect all data
        const marketClose = await collectMarketClose();
        const internals = collectFinalInternals();
        const bhSummary = collectBloodhoundSummary();
        const positions = collectPositions();
        const gaps = collectGapFills();
        const flow = collectFlowHighlights();
        const signals = collectActiveSignals();
        const earnings = collectTomorrowEarnings();

        // Merge into single summary
        const summary = {
            date: today,
            ...marketClose,
            // Internals may provide VIX/SPX — market close quotes take priority if available
            vix_close: internals.vix_close ?? null,
            vix_change_pct: internals.vix_change_pct ?? null,
            spx_close: internals.spx_close ?? null,
            spx_change_pct: internals.spx_change_pct ?? null,
            tick_final: internals.tick_final ?? null,
            trin_final: internals.trin_final ?? null,
            ad_spread_final: internals.ad_spread_final ?? null,
            vol_ratio_final: internals.vol_ratio_final ?? null,
            ...bhSummary,
            ...positions,
            ...gaps,
            ...flow,
            ...signals,
            summary_json: {
                vix_regime: bhSummary.vix_regime || null,
                spy_trend: bhSummary.spy_trend || null,
                rotation_phase: bhSummary.rotation_phase || null,
                rotation_leading: bhSummary.rotation_leading || null,
                rotation_lagging: bhSummary.rotation_lagging || null,
                active_signals: signals.active_signals || 0,
                active_hc_signals: signals.active_hc_signals || 0,
                active_tradeable_signals: signals.active_tradeable_signals || 0,
                tomorrow_earnings: earnings.tomorrow_earnings || []
            },
            timestamp: new Date().toISOString()
        };

        // Hoist summary_json fields to top level for Telegram builder
        summary.vix_regime = bhSummary.vix_regime || null;
        summary.spy_trend = bhSummary.spy_trend || null;
        summary.rotation_phase = bhSummary.rotation_phase || null;
        summary.rotation_leading = bhSummary.rotation_leading || null;
        summary.rotation_lagging = bhSummary.rotation_lagging || null;
        summary.tomorrow_earnings = earnings.tomorrow_earnings || [];

        // Save to database
        signalDb.insertEodSummary(summary);
        log('Summary saved to database');

        // Send Telegram
        const telegramResult = await sendEodTelegram(summary);
        if (telegramResult.ok) {
            signalDb.updateEodTelegramStatus(today, telegramResult.messageId);
            log(`Telegram sent (message ID: ${telegramResult.messageId})`);
            _lastTelegramStatus = 'sent';
        } else {
            log(`Telegram failed: ${telegramResult.error}`);
            _lastTelegramStatus = `failed: ${telegramResult.error}`;
        }

        // Archive daily log
        archiveDailyLog();

        _lastRunTime = new Date().toISOString();
        _wrapupInProgress = false;

        log('EOD wrap-up complete');
        return { success: true, date: today };

    } catch (e) {
        log(`Error during wrap-up: ${e.message}`);
        console.error(e.stack);
        _wrapupInProgress = false;
        _lastTelegramStatus = `error: ${e.message}`;
        return { error: e.message };
    }
}

// ============================================
// CONTROL API (Port 8087)
// ============================================

function startControlServer() {
    const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        const urlPath = req.url.split('?')[0];

        if (req.method === 'GET' && urlPath === '/status') {
            res.writeHead(200);
            res.end(JSON.stringify({
                service: 'eod-wrapup',
                status: _wrapupInProgress ? 'running' : 'idle',
                last_run: _lastRunTime,
                last_telegram: _lastTelegramStatus,
                today: signalDb.getETDate()
            }));
            return;
        }

        if (req.method === 'POST' && urlPath === '/run') {
            res.writeHead(200);
            res.end(JSON.stringify({ triggered: true }));
            // Run async after responding
            runEODWrapup().catch(e => log(`Manual run error: ${e.message}`));
            return;
        }

        if (req.method === 'GET' && urlPath === '/latest') {
            try {
                const latest = signalDb.getLatestEodSummary();
                res.writeHead(200);
                res.end(JSON.stringify(latest || { message: 'No summaries yet' }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(PORT, () => {
        log(`Control API listening on port ${PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            log(`Port ${PORT} already in use — control API disabled`);
        } else {
            log(`Control server error: ${err.message}`);
        }
    });

    return server;
}

// ============================================
// SCHEDULING
// ============================================

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

function startScheduler() {
    console.log('='.repeat(60));
    console.log('   EOD WRAP-UP');
    console.log('   Scheduled daily at 8:15 PM ET');
    console.log('='.repeat(60));

    const etInfo = getETTimeInfo();
    console.log(`Current time: ${etInfo.formatted} ET`);
    console.log(`Options API: ${OPTIONS_API}`);
    console.log('='.repeat(60));
    console.log('');
    log('Scheduler started. Waiting for 8:15 PM ET...');
    console.log('');
    console.log('Commands:');
    console.log('  Manual run: node monitor/eod-wrapup.js --now');
    console.log('  PM2 logs:   pm2 logs eod-wrapup');
    console.log('');

    // Primary: 8:15 PM ET
    cron.schedule('15 20 * * 1-5', async () => {
        const today = signalDb.getETDate();
        if (signalDb.isMarketHoliday(today)) {
            log('Market holiday — skipping wrap-up');
            return;
        }
        log('Scheduled run triggered (8:15 PM)');
        await runEODWrapup();
    }, {
        timezone: 'America/New_York'
    });

    // Backup: 8:30 PM ET (only if no summary sent today)
    cron.schedule('30 20 * * 1-5', async () => {
        const today = signalDb.getETDate();
        if (signalDb.isMarketHoliday(today)) return;
        const existing = signalDb.getEodSummaryByDate(today);
        if (!existing || !existing.telegram_sent) {
            log('Backup run triggered (8:30 PM) — no summary sent yet');
            await runEODWrapup();
        }
    }, {
        timezone: 'America/New_York'
    });

    // Start control API
    startControlServer();

    // Graceful shutdown
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
        await runEODWrapup();
        process.exit(0);
    }

    // Scheduler mode (default)
    startScheduler();
}

main();

module.exports = { runEODWrapup };
