#!/usr/bin/env node
/**
 * ENRICH SIGNALS WITH MA DATA
 *
 * Retroactively adds moving average alignment data to closed Bloodhound signals.
 * Fetches daily OHLCV from Schwab API, computes SMA 20/50/200 at each signal's
 * entry date, classifies alignment, and prints win rate by MA state.
 *
 * Usage:
 *   node scripts/enrich-signals-ma.js             # Dry run — print table only
 *   node scripts/enrich-signals-ma.js --save       # Update signals in DB
 *   node scripts/enrich-signals-ma.js --fresh      # Force re-fetch cached data
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'wingman.db');
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');
const OPTIONS_API = 'http://192.168.10.60:8000';

const SAVE_MODE = process.argv.includes('--save');
const FRESH = process.argv.includes('--fresh');

// Ensure history cache dir exists
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// --- Helpers ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeSMA(candles, period, endIndex) {
    if (endIndex < period - 1) return null;
    let sum = 0;
    for (let i = endIndex - period + 1; i <= endIndex; i++) {
        sum += candles[i].close;
    }
    return sum / period;
}

function classifyAlignment(price, fastMA, slowMA) {
    if (fastMA == null || slowMA == null) return 'insufficient_data';
    if (price > fastMA && fastMA > slowMA) return 'full_bull';
    if (fastMA > slowMA && price <= fastMA) return 'bull_structure';
    if (fastMA < slowMA && price >= fastMA) return 'bear_structure';
    if (price < fastMA && fastMA < slowMA) return 'full_bear';
    return 'mixed';
}

function dateFromTimestamp(ts) {
    // ts can be ISO string or epoch ms
    const d = new Date(ts);
    return d.toISOString().split('T')[0];
}

function cacheFile(symbol) {
    return path.join(HISTORY_DIR, `${symbol}_daily.json`);
}

function cacheValid(symbol) {
    if (FRESH) return false;
    const fp = cacheFile(symbol);
    if (!fs.existsSync(fp)) return false;
    const stat = fs.statSync(fp);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    return ageHours < 24;
}

async function fetchHistory(symbol) {
    if (cacheValid(symbol)) {
        return JSON.parse(fs.readFileSync(cacheFile(symbol), 'utf8'));
    }

    const url = `${OPTIONS_API}/api/history/${symbol}?period_type=year&period=2&frequency_type=daily&frequency=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data.candles || data.candles.length === 0) {
            throw new Error('No candles returned');
        }

        // Cache it
        fs.writeFileSync(cacheFile(symbol), JSON.stringify(data));
        return data;
    } catch (e) {
        clearTimeout(timeout);
        console.error(`  Failed to fetch ${symbol}: ${e.message}`);
        return null;
    }
}

// --- Main ---

async function main() {
    const db = new Database(DB_PATH, { readonly: !SAVE_MODE });

    // Get closed signals
    const signals = db.prepare(`
        SELECT signal_id, symbol, direction, entry_price, timestamp,
               final_outcome, peak_gain_pct, max_drawdown_pct
        FROM signals WHERE status = 'closed'
        ORDER BY timestamp
    `).all();

    console.log(`\nFound ${signals.length} closed signals`);
    if (signals.length === 0) {
        console.log('No closed signals to enrich.');
        db.close();
        return;
    }

    // Group by symbol
    const bySymbol = {};
    for (const sig of signals) {
        if (!bySymbol[sig.symbol]) bySymbol[sig.symbol] = [];
        bySymbol[sig.symbol].push(sig);
    }
    const symbols = Object.keys(bySymbol).sort();
    console.log(`Unique symbols: ${symbols.length} (${symbols.join(', ')})`);

    // Fetch history for each symbol
    console.log('\nFetching daily history...');
    const historyMap = {};
    for (const sym of symbols) {
        process.stdout.write(`  ${sym}...`);
        historyMap[sym] = await fetchHistory(sym);
        if (historyMap[sym]) {
            console.log(` ${historyMap[sym].candles.length} candles`);
        } else {
            console.log(' FAILED');
        }
        await sleep(200);
    }

    // Process each signal
    const enriched = [];
    let noDataCount = 0;

    for (const sig of signals) {
        const history = historyMap[sig.symbol];
        if (!history) { noDataCount++; continue; }

        const candles = history.candles.sort((a, b) => a.datetime - b.datetime);
        const entryDate = dateFromTimestamp(sig.timestamp);

        // Find the candle on or before entry date
        let barIndex = -1;
        for (let i = candles.length - 1; i >= 0; i--) {
            const candleDate = dateFromTimestamp(candles[i].datetime);
            if (candleDate <= entryDate) {
                barIndex = i;
                break;
            }
        }

        if (barIndex < 0) { noDataCount++; continue; }

        const sma20 = computeSMA(candles, 20, barIndex);
        const sma50 = computeSMA(candles, 50, barIndex);
        const sma200 = computeSMA(candles, 200, barIndex);

        const alignment20_50 = classifyAlignment(sig.entry_price, sma20, sma50);
        const alignment20_200 = classifyAlignment(sig.entry_price, sma20, sma200);
        const alignment50_200 = classifyAlignment(sig.entry_price, sma50, sma200);

        enriched.push({
            signal_id: sig.signal_id,
            symbol: sig.symbol,
            direction: sig.direction,
            entry_price: sig.entry_price,
            date: entryDate,
            outcome: sig.final_outcome,
            peak_gain: sig.peak_gain_pct,
            max_dd: sig.max_drawdown_pct,
            sma20: sma20 ? +sma20.toFixed(2) : null,
            sma50: sma50 ? +sma50.toFixed(2) : null,
            sma200: sma200 ? +sma200.toFixed(2) : null,
            alignment_20_50: alignment20_50,
            alignment_20_200: alignment20_200,
            alignment_50_200: alignment50_200,
        });
    }

    console.log(`\nEnriched: ${enriched.length}/${signals.length} signals (${noDataCount} missing data)`);

    // --- Analysis: Win rates by alignment ---
    console.log('\n' + '='.repeat(70));
    console.log('MA ALIGNMENT VS SIGNAL OUTCOMES — SMA 20/50');
    console.log('='.repeat(70));
    printAlignmentStats(enriched, 'alignment_20_50');

    console.log('\n' + '='.repeat(70));
    console.log('MA ALIGNMENT VS SIGNAL OUTCOMES — SMA 20/200');
    console.log('='.repeat(70));
    printAlignmentStats(enriched, 'alignment_20_200');

    console.log('\n' + '='.repeat(70));
    console.log('MA ALIGNMENT VS SIGNAL OUTCOMES — SMA 50/200');
    console.log('='.repeat(70));
    printAlignmentStats(enriched, 'alignment_50_200');

    // Direction-aware analysis (does alignment WITH direction matter?)
    console.log('\n' + '='.repeat(70));
    console.log('DIRECTION-AWARE ANALYSIS — SMA 20/50');
    console.log('Does MA alignment matching signal direction improve outcomes?');
    console.log('='.repeat(70));
    printDirectionAwareStats(enriched, 'alignment_20_50');

    // Save to DB if requested
    if (SAVE_MODE) {
        console.log('\nSaving to database...');
        // Add columns if they don't exist
        const cols = db.pragma('table_info(signals)').map(c => c.name);
        if (!cols.includes('sma20_at_entry')) {
            db.exec('ALTER TABLE signals ADD COLUMN sma20_at_entry REAL');
        }
        if (!cols.includes('sma50_at_entry')) {
            db.exec('ALTER TABLE signals ADD COLUMN sma50_at_entry REAL');
        }
        if (!cols.includes('sma200_at_entry')) {
            db.exec('ALTER TABLE signals ADD COLUMN sma200_at_entry REAL');
        }
        if (!cols.includes('ma_alignment_at_entry')) {
            db.exec('ALTER TABLE signals ADD COLUMN ma_alignment_at_entry TEXT');
        }

        const update = db.prepare(`
            UPDATE signals SET
                sma20_at_entry = ?,
                sma50_at_entry = ?,
                sma200_at_entry = ?,
                ma_alignment_at_entry = ?
            WHERE signal_id = ?
        `);

        const tx = db.transaction(() => {
            for (const e of enriched) {
                update.run(e.sma20, e.sma50, e.sma200, e.alignment_20_50, e.signal_id);
            }
        });
        tx();
        console.log(`Updated ${enriched.length} signals with MA data.`);
    } else {
        console.log('\nDry run — use --save to persist to database.');
    }

    db.close();
}

function printAlignmentStats(enriched, alignmentField) {
    const groups = {};
    for (const e of enriched) {
        const key = e[alignmentField];
        if (!groups[key]) groups[key] = { total: 0, WIN: 0, LOSS: 0, BREAKEVEN: 0, peakGains: [], maxDDs: [] };
        groups[key].total++;
        groups[key][e.outcome] = (groups[key][e.outcome] || 0) + 1;
        if (e.peak_gain != null) groups[key].peakGains.push(e.peak_gain);
        if (e.max_dd != null) groups[key].maxDDs.push(e.max_dd);
    }

    const rows = [];
    for (const [alignment, g] of Object.entries(groups).sort((a, b) => b[1].total - a[1].total)) {
        const winRate = g.total > 0 ? ((g.WIN / g.total) * 100).toFixed(1) : 'N/A';
        const avgPeak = g.peakGains.length > 0
            ? (g.peakGains.reduce((a, b) => a + b, 0) / g.peakGains.length).toFixed(2)
            : 'N/A';
        const avgDD = g.maxDDs.length > 0
            ? (g.maxDDs.reduce((a, b) => a + b, 0) / g.maxDDs.length).toFixed(2)
            : 'N/A';

        rows.push({
            Alignment: alignment,
            Count: g.total,
            WIN: g.WIN || 0,
            LOSS: g.LOSS || 0,
            BE: g.BREAKEVEN || 0,
            'Win Rate': winRate + '%',
            'Avg Peak': avgPeak + '%',
            'Avg DD': avgDD + '%',
        });
    }

    // Add baseline
    const totalWins = enriched.filter(e => e.outcome === 'WIN').length;
    rows.push({
        Alignment: '--- BASELINE ---',
        Count: enriched.length,
        WIN: totalWins,
        LOSS: enriched.filter(e => e.outcome === 'LOSS').length,
        BE: enriched.filter(e => e.outcome === 'BREAKEVEN').length,
        'Win Rate': ((totalWins / enriched.length) * 100).toFixed(1) + '%',
        'Avg Peak': (enriched.reduce((s, e) => s + (e.peak_gain || 0), 0) / enriched.length).toFixed(2) + '%',
        'Avg DD': (enriched.reduce((s, e) => s + (e.max_dd || 0), 0) / enriched.length).toFixed(2) + '%',
    });

    console.table(rows);
}

function printDirectionAwareStats(enriched, alignmentField) {
    // Group by: alignment matches direction vs opposes
    const aligned = [];
    const opposed = [];
    const neutral = [];

    for (const e of enriched) {
        const align = e[alignmentField];
        if (e.direction === 'bullish') {
            if (align === 'full_bull' || align === 'bull_structure') aligned.push(e);
            else if (align === 'full_bear' || align === 'bear_structure') opposed.push(e);
            else neutral.push(e);
        } else if (e.direction === 'bearish') {
            if (align === 'full_bear' || align === 'bear_structure') aligned.push(e);
            else if (align === 'full_bull' || align === 'bull_structure') opposed.push(e);
            else neutral.push(e);
        } else {
            neutral.push(e);
        }
    }

    function groupStats(label, arr) {
        if (arr.length === 0) return { Label: label, Count: 0, 'Win Rate': 'N/A', 'Avg Peak': 'N/A', 'Avg DD': 'N/A' };
        const wins = arr.filter(e => e.outcome === 'WIN').length;
        return {
            Label: label,
            Count: arr.length,
            'Win Rate': ((wins / arr.length) * 100).toFixed(1) + '%',
            'Avg Peak': (arr.reduce((s, e) => s + (e.peak_gain || 0), 0) / arr.length).toFixed(2) + '%',
            'Avg DD': (arr.reduce((s, e) => s + (e.max_dd || 0), 0) / arr.length).toFixed(2) + '%',
        };
    }

    console.table([
        groupStats('MA aligned with direction', aligned),
        groupStats('MA opposes direction', opposed),
        groupStats('Mixed / neutral', neutral),
        groupStats('ALL SIGNALS', enriched),
    ]);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
