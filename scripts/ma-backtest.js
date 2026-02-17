#!/usr/bin/env node
/**
 * MA BACKTEST — Moving Average Alignment & Crossover Backtester
 *
 * Tests whether MA alignment or crossover signals have predictive value
 * for forward returns, using 10 years of daily Schwab data.
 *
 * Two modes:
 *   alignment  — classify each bar's MA state, measure forward returns
 *   crossover  — detect golden/death crosses, track round-trip trades
 *
 * Usage:
 *   node scripts/ma-backtest.js alignment --symbol SPY --fast 20 --slow 50
 *   node scripts/ma-backtest.js alignment --symbol ALL --fast 20 --slow 50
 *   node scripts/ma-backtest.js alignment --sweep --symbol NVDA
 *   node scripts/ma-backtest.js alignment --sweep --symbol ALL
 *   node scripts/ma-backtest.js crossover --symbol AAPL --fast 20 --slow 50
 *
 * Options:
 *   --fresh       Force re-fetch (ignore cache)
 *   --years N     Limit to N years of data (default: 10)
 *   --save        Persist results to SQLite
 *   --json        JSON output instead of tables
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// --- Config ---

const OPTIONS_API = 'http://192.168.10.60:8000';
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');
const DB_PATH = path.join(__dirname, '..', 'data', 'wingman.db');
const HOLD_DAYS = [1, 3, 5, 10, 20];

const MA_COMBOS = [
    { fast: 5, slow: 20 },
    { fast: 8, slow: 21 },
    { fast: 9, slow: 21 },
    { fast: 10, slow: 20 },
    { fast: 10, slow: 30 },
    { fast: 10, slow: 50 },
    { fast: 12, slow: 26 },
    { fast: 15, slow: 50 },
    { fast: 20, slow: 50 },
    { fast: 25, slow: 75 },
    { fast: 20, slow: 100 },
    { fast: 20, slow: 200 },
    { fast: 40, slow: 200 },
    { fast: 50, slow: 100 },
    { fast: 50, slow: 200 },
];

const CROSSOVER_COMBOS = (() => {
    const combos = [
        // Fast Fibonacci pairs
        { fast: 3, slow: 8 },
        { fast: 3, slow: 13 },
        { fast: 5, slow: 8 },
        { fast: 5, slow: 13 },
        { fast: 5, slow: 34 },
        { fast: 5, slow: 50 },
        { fast: 8, slow: 13 },
        { fast: 8, slow: 21 },
        { fast: 8, slow: 34 },
        { fast: 8, slow: 50 },
        // Mid-range Fibonacci
        { fast: 13, slow: 21 },
        { fast: 13, slow: 34 },
        { fast: 13, slow: 55 },
        { fast: 21, slow: 55 },
        // Slow Fibonacci
        { fast: 34, slow: 55 },
        { fast: 34, slow: 89 },
        { fast: 55, slow: 89 },
        { fast: 55, slow: 144 },
        // MACD-derived
        { fast: 12, slow: 26 },
        { fast: 12, slow: 50 },
        // Ichimoku-derived (Tenkan/Kijun, Kijun/Senkou)
        { fast: 9, slow: 26 },
        { fast: 26, slow: 52 },
        // Short-term scalping
        { fast: 4, slow: 9 },
        { fast: 7, slow: 21 },
        // Round-number institutional
        { fast: 9, slow: 21 },
        { fast: 9, slow: 30 },
        { fast: 10, slow: 20 },
        { fast: 15, slow: 30 },
        { fast: 15, slow: 50 },
        { fast: 25, slow: 50 },
        { fast: 25, slow: 75 },
        { fast: 30, slow: 100 },
        { fast: 40, slow: 100 },
        { fast: 40, slow: 200 },
        // Long-term
        { fast: 50, slow: 100 },
        { fast: 75, slow: 200 },
        { fast: 100, slow: 200 },
        { fast: 150, slow: 200 },
    ];
    const seen = new Set(combos.map(c => `${c.fast}/${c.slow}`));
    for (const c of MA_COMBOS) {
        const key = `${c.fast}/${c.slow}`;
        if (!seen.has(key)) { combos.push(c); seen.add(key); }
    }
    return combos;
})();

const WATCHLIST_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'MSFT', 'IBIT'];

// Ensure cache dir
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// --- CLI Parsing ---

const args = process.argv.slice(2);
const mode = args[0]; // 'alignment' or 'crossover'

function getArg(flag, defaultVal) {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return defaultVal;
    return args[idx + 1];
}

const SYMBOL_ARG = (getArg('--symbol', 'SPY') || 'SPY').toUpperCase();
const FAST = parseInt(getArg('--fast', '20'));
const SLOW = parseInt(getArg('--slow', '50'));
const SWEEP = args.includes('--sweep');
const FRESH = args.includes('--fresh');
const SAVE = args.includes('--save');
const JSON_OUT = args.includes('--json');
const USE_EMA = args.includes('--ema');
const USE_HMA = args.includes('--hma');
const MA_TYPE = USE_HMA ? 'HMA' : USE_EMA ? 'EMA' : 'SMA';
const YEARS = parseInt(getArg('--years', '10'));

if (!mode || !['alignment', 'crossover'].includes(mode)) {
    console.log(`
MA BACKTEST — Moving Average Alignment & Crossover Backtester

Usage:
  node scripts/ma-backtest.js alignment --symbol SPY --fast 20 --slow 50
  node scripts/ma-backtest.js alignment --sweep --symbol ALL
  node scripts/ma-backtest.js crossover --symbol AAPL --fast 20 --slow 50

Modes:
  alignment   Classify each bar by MA alignment, measure forward returns
  crossover   Detect golden/death crosses, track round-trip performance

Options:
  --symbol SYM   Symbol or ALL for full watchlist (default: SPY)
  --fast N       Fast MA period (default: 20)
  --slow N       Slow MA period (default: 50)
  --sweep        Test all combos for alignment and crossover
  --ema          Use EMA instead of SMA (default: SMA)
  --hma          Use Hull Moving Average instead of SMA
  --years N      Years of data (default: 10, max 10)
  --fresh        Force re-fetch from API
  --save         Store results in SQLite
  --json         JSON output
`);
    process.exit(0);
}

// --- Helpers ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function computeSMA(closes, period, endIndex) {
    if (endIndex < period - 1) return null;
    let sum = 0;
    for (let i = endIndex - period + 1; i <= endIndex; i++) {
        sum += closes[i];
    }
    return sum / period;
}

// Pre-compute full EMA series for a given period (called once per combo, not per bar)
const _emaCache = new Map();
function getEMASeries(closes, period) {
    const key = `${closes.length}_${period}`;
    if (_emaCache.has(key)) return _emaCache.get(key);

    const ema = new Array(closes.length).fill(null);
    // Seed with SMA of first `period` bars
    if (closes.length < period) { _emaCache.set(key, ema); return ema; }
    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    ema[period - 1] = sum / period;

    const k = 2 / (period + 1);
    for (let i = period; i < closes.length; i++) {
        ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
    }
    _emaCache.set(key, ema);
    return ema;
}

// Weighted Moving Average — linearly weighted (most recent bar gets highest weight)
function computeWMA(values, period, endIndex) {
    if (endIndex < period - 1) return null;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < period; i++) {
        const weight = i + 1; // 1, 2, 3, ... period
        weightedSum += values[endIndex - period + 1 + i] * weight;
        weightTotal += weight;
    }
    return weightedSum / weightTotal;
}

// Pre-compute full HMA series for a given period
// HMA(n) = WMA( 2*WMA(n/2) - WMA(n), sqrt(n) )
const _hmaCache = new Map();
function getHMASeries(closes, period) {
    const key = `${closes.length}_${period}`;
    if (_hmaCache.has(key)) return _hmaCache.get(key);

    const halfPeriod = Math.round(period / 2);
    const sqrtPeriod = Math.round(Math.sqrt(period));
    const hma = new Array(closes.length).fill(null);

    // Step 1-2: Build the "raw hull" series = 2*WMA(n/2) - WMA(n)
    const rawHull = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        const wmaHalf = computeWMA(closes, halfPeriod, i);
        const wmaFull = computeWMA(closes, period, i);
        if (wmaHalf !== null && wmaFull !== null) {
            rawHull[i] = 2 * wmaHalf - wmaFull;
        }
    }

    // Step 3: WMA of rawHull with period sqrt(n)
    for (let i = 0; i < closes.length; i++) {
        const val = computeWMA(rawHull, sqrtPeriod, i);
        if (val !== null) hma[i] = val;
    }

    _hmaCache.set(key, hma);
    return hma;
}

function computeMA(closes, period, endIndex) {
    if (USE_HMA) {
        const series = getHMASeries(closes, period);
        return series[endIndex];
    }
    if (USE_EMA) {
        const series = getEMASeries(closes, period);
        return series[endIndex];
    }
    return computeSMA(closes, period, endIndex);
}

function classifyAlignment(price, fastMA, slowMA) {
    if (fastMA == null || slowMA == null) return null;
    if (price > fastMA && fastMA > slowMA) return 'full_bull';
    if (fastMA > slowMA && price <= fastMA) return 'bull_structure';
    if (fastMA < slowMA && price >= fastMA) return 'bear_structure';
    if (price < fastMA && fastMA < slowMA) return 'full_bear';
    return 'mixed';
}

function dateStr(epochMs) {
    return new Date(epochMs).toISOString().split('T')[0];
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
        const data = JSON.parse(fs.readFileSync(cacheFile(symbol), 'utf8'));
        return data.candles || [];
    }

    const url = `${OPTIONS_API}/api/history/${symbol}?period_type=year&period=${YEARS}&frequency_type=daily&frequency=1`;
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

        fs.writeFileSync(cacheFile(symbol), JSON.stringify(data));
        return data.candles;
    } catch (e) {
        clearTimeout(timeout);
        console.error(`  Failed to fetch ${symbol}: ${e.message}`);
        return null;
    }
}

function getForwardReturns(closes, index) {
    const returns = {};
    const entry = closes[index];
    for (const days of HOLD_DAYS) {
        const futureIdx = index + days;
        if (futureIdx < closes.length) {
            returns[days] = ((closes[futureIdx] - entry) / entry) * 100;
        } else {
            returns[days] = null;
        }
    }
    return returns;
}

function calcGroupStats(group) {
    const stats = {};
    for (const days of HOLD_DAYS) {
        const returns = group.map(s => s.returns[days]).filter(r => r != null);
        if (returns.length === 0) {
            stats[`${days}d`] = { count: 0, winRate: 'N/A', avgReturn: 'N/A', median: 'N/A' };
            continue;
        }
        const wins = returns.filter(r => r > 0).length;
        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
        const sorted = [...returns].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        stats[`${days}d`] = {
            count: returns.length,
            winRate: ((wins / returns.length) * 100).toFixed(1) + '%',
            avgReturn: avg.toFixed(3) + '%',
            median: median.toFixed(3) + '%',
        };
    }
    return stats;
}

// --- Alignment Mode ---

function runAlignment(candles, fastPeriod, slowPeriod) {
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const warmup = slowPeriod; // Need at least slowPeriod bars for valid SMA

    const groups = {};
    let total = 0;

    for (let i = warmup; i < sorted.length; i++) {
        const price = closes[i];
        const fastMA = computeMA(closes, fastPeriod, i);
        const slowMA = computeMA(closes, slowPeriod, i);
        const alignment = classifyAlignment(price, fastMA, slowMA);

        if (!alignment) continue;
        if (!groups[alignment]) groups[alignment] = [];

        const returns = getForwardReturns(closes, i);
        groups[alignment].push({
            date: dateStr(sorted[i].datetime),
            price,
            fastMA,
            slowMA,
            alignment,
            returns,
        });
        total++;
    }

    return { groups, total, warmup, dataStart: dateStr(sorted[0].datetime), dataEnd: dateStr(sorted[sorted.length - 1].datetime), totalBars: sorted.length };
}

function printAlignmentResults(symbol, fastPeriod, slowPeriod, result) {
    const { groups, total, warmup, dataStart, dataEnd, totalBars } = result;

    console.log('\n' + '='.repeat(70));
    console.log(`MA ALIGNMENT BACKTEST — ${symbol} (${MA_TYPE} ${fastPeriod}/${slowPeriod})`);
    console.log(`Data: ${dataStart} to ${dataEnd} | ${totalBars} bars total, ${total} after warmup (${warmup})`);
    console.log('='.repeat(70));

    if (total < 100) {
        console.log(`⚠️  Only ${total} testable bars — results may not be reliable.`);
    }

    // Build table rows
    const ORDER = ['full_bull', 'bull_structure', 'mixed', 'bear_structure', 'full_bear'];
    const allSignals = [];
    const rows = [];

    for (const alignment of ORDER) {
        const group = groups[alignment] || [];
        if (group.length === 0) {
            rows.push({ Alignment: alignment, Count: 0, '5d WR': 'N/A', '10d WR': 'N/A', '20d WR': 'N/A', 'Avg 5d': 'N/A', 'Med 5d': 'N/A' });
            continue;
        }
        allSignals.push(...group);
        const stats = calcGroupStats(group);
        rows.push({
            Alignment: alignment,
            Count: group.length,
            '5d WR': stats['5d'].winRate,
            '10d WR': stats['10d'].winRate,
            '20d WR': stats['20d'].winRate,
            'Avg 5d': stats['5d'].avgReturn,
            'Med 5d': stats['5d'].median,
        });
    }

    // Baseline
    const baselineStats = calcGroupStats(allSignals);
    rows.push({
        Alignment: '--- BASELINE ---',
        Count: allSignals.length,
        '5d WR': baselineStats['5d'].winRate,
        '10d WR': baselineStats['10d'].winRate,
        '20d WR': baselineStats['20d'].winRate,
        'Avg 5d': baselineStats['5d'].avgReturn,
        'Med 5d': baselineStats['5d'].median,
    });

    console.log('\nFORWARD RETURNS BY ALIGNMENT');
    console.table(rows);

    // Edge calculation
    const bullGroup = groups['full_bull'] || [];
    const bearGroup = groups['full_bear'] || [];
    if (bullGroup.length > 0 && bearGroup.length > 0) {
        const bullStats = calcGroupStats(bullGroup);
        const bearStats = calcGroupStats(bearGroup);

        const bullWR5 = parseFloat(bullStats['5d'].winRate);
        const bearWR5 = parseFloat(bearStats['5d'].winRate);
        const baseWR5 = parseFloat(baselineStats['5d'].winRate);
        const bullAvg5 = parseFloat(bullStats['5d'].avgReturn);
        const bearAvg5 = parseFloat(bearStats['5d'].avgReturn);
        const baseAvg5 = parseFloat(baselineStats['5d'].avgReturn);

        console.log('EDGE ANALYSIS:');
        console.log(`  full_bull vs baseline: ${(bullWR5 - baseWR5) >= 0 ? '+' : ''}${(bullWR5 - baseWR5).toFixed(1)}% WR (5d), ${(bullAvg5 - baseAvg5) >= 0 ? '+' : ''}${(bullAvg5 - baseAvg5).toFixed(3)}% avg return`);
        console.log(`  full_bear vs baseline: ${(bearWR5 - baseWR5) >= 0 ? '+' : ''}${(bearWR5 - baseWR5).toFixed(1)}% WR (5d), ${(bearAvg5 - baseAvg5) >= 0 ? '+' : ''}${(bearAvg5 - baseAvg5).toFixed(3)}% avg return`);
        console.log(`  full_bull vs full_bear: ${(bullWR5 - bearWR5) >= 0 ? '+' : ''}${(bullWR5 - bearWR5).toFixed(1)}% WR spread (5d)`);
    }

    return result;
}

// --- Crossover Mode ---

function runCrossover(candles, fastPeriod, slowPeriod) {
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const warmup = slowPeriod;

    const crosses = [];
    let prevFastAbove = null;

    for (let i = warmup; i < sorted.length; i++) {
        const fastMA = computeMA(closes, fastPeriod, i);
        const slowMA = computeMA(closes, slowPeriod, i);
        if (fastMA == null || slowMA == null) continue;

        const fastAbove = fastMA > slowMA;

        if (prevFastAbove !== null && fastAbove !== prevFastAbove) {
            const type = fastAbove ? 'golden_cross' : 'death_cross';
            const returns = getForwardReturns(closes, i);

            crosses.push({
                date: dateStr(sorted[i].datetime),
                price: closes[i],
                fastMA,
                slowMA,
                type,
                returns,
            });
        }

        prevFastAbove = fastAbove;
    }

    return {
        crosses,
        dataStart: dateStr(sorted[0].datetime),
        dataEnd: dateStr(sorted[sorted.length - 1].datetime),
        totalBars: sorted.length,
    };
}

function printCrossoverResults(symbol, fastPeriod, slowPeriod, result) {
    const { crosses, dataStart, dataEnd, totalBars } = result;

    console.log('\n' + '='.repeat(70));
    console.log(`MA CROSSOVER BACKTEST — ${symbol} (${MA_TYPE} ${fastPeriod}/${slowPeriod})`);
    console.log(`Data: ${dataStart} to ${dataEnd} | ${totalBars} bars`);
    console.log('='.repeat(70));

    const golden = crosses.filter(c => c.type === 'golden_cross');
    const death = crosses.filter(c => c.type === 'death_cross');

    console.log(`\nTotal crosses: ${crosses.length} (${golden.length} golden, ${death.length} death)`);

    if (golden.length > 0) {
        console.log('\nGOLDEN CROSSES (fast crosses above slow) → BUY signal');
        const stats = calcGroupStats(golden);
        console.table(stats);

        console.log('Recent golden crosses:');
        golden.slice(-5).forEach(c => {
            const r5 = c.returns[5] != null ? `${c.returns[5] >= 0 ? '+' : ''}${c.returns[5].toFixed(2)}%` : 'N/A';
            const r20 = c.returns[20] != null ? `${c.returns[20] >= 0 ? '+' : ''}${c.returns[20].toFixed(2)}%` : 'N/A';
            console.log(`  ${c.date}: $${c.price.toFixed(2)} — 5d: ${r5}, 20d: ${r20}`);
        });
    }

    if (death.length > 0) {
        console.log('\nDEATH CROSSES (fast crosses below slow) → SELL signal');
        // For death crosses, invert returns (short signal)
        const invertedDeath = death.map(c => ({
            ...c,
            returns: Object.fromEntries(
                Object.entries(c.returns).map(([k, v]) => [k, v != null ? -v : null])
            ),
        }));
        const stats = calcGroupStats(invertedDeath);
        console.table(stats);

        console.log('Recent death crosses:');
        death.slice(-5).forEach(c => {
            const r5 = c.returns[5] != null ? `${c.returns[5] >= 0 ? '+' : ''}${c.returns[5].toFixed(2)}%` : 'N/A';
            const r20 = c.returns[20] != null ? `${c.returns[20] >= 0 ? '+' : ''}${c.returns[20].toFixed(2)}%` : 'N/A';
            console.log(`  ${c.date}: $${c.price.toFixed(2)} — 5d: ${r5}, 20d: ${r20}`);
        });
    }

    return result;
}

// --- SQLite Save ---

function ensureBacktestTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ma_backtest_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_type TEXT NOT NULL,
            symbol TEXT NOT NULL,
            fast_period INTEGER NOT NULL,
            slow_period INTEGER NOT NULL,
            data_start TEXT NOT NULL,
            data_end TEXT NOT NULL,
            total_bars INTEGER,
            results_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);

    // Add ma_type column if missing (migration for existing tables)
    const cols = db.prepare("PRAGMA table_info(ma_backtest_runs)").all();
    if (!cols.find(c => c.name === 'ma_type')) {
        db.exec("ALTER TABLE ma_backtest_runs ADD COLUMN ma_type TEXT DEFAULT 'SMA'");
    }

    // Composite index for fast lookups — not unique, preserves run history
    const hasIndex = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_backtest_lookup'"
    ).get();
    if (!hasIndex) {
        // Drop old unique index if present (from earlier migration)
        const hasOldIndex = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_backtest_unique'"
        ).get();
        if (hasOldIndex) {
            db.exec('DROP INDEX idx_backtest_unique');
        }
        db.exec(`
            CREATE INDEX idx_backtest_lookup
            ON ma_backtest_runs (run_type, symbol, fast_period, slow_period, created_at DESC);
        `);
    }
}

function saveAlignmentRun(db, symbol, fast, slow, result) {
    const { groups, total, dataStart, dataEnd, totalBars } = result;

    // Build summary JSON
    const summary = {};
    for (const [alignment, signals] of Object.entries(groups)) {
        const stats = calcGroupStats(signals);
        summary[alignment] = { count: signals.length, ...stats };
    }

    ensureBacktestTables(db);
    db.prepare(`
        INSERT INTO ma_backtest_runs (run_type, symbol, fast_period, slow_period, data_start, data_end, total_bars, results_json, ma_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('alignment', symbol, fast, slow, dataStart, dataEnd, totalBars, JSON.stringify(summary), MA_TYPE);
}

function saveCrossoverRun(db, symbol, fast, slow, result) {
    const { crosses, dataStart, dataEnd, totalBars } = result;

    const golden = crosses.filter(c => c.type === 'golden_cross');
    const death = crosses.filter(c => c.type === 'death_cross');

    const summary = {
        golden_cross: { count: golden.length, ...calcGroupStats(golden) },
        death_cross: { count: death.length, ...calcGroupStats(death) },
    };

    ensureBacktestTables(db);
    db.prepare(`
        INSERT INTO ma_backtest_runs (run_type, symbol, fast_period, slow_period, data_start, data_end, total_bars, results_json, ma_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('crossover', symbol, fast, slow, dataStart, dataEnd, totalBars, JSON.stringify(summary), MA_TYPE);
}

// --- Sweep Summary ---

function printSweepSummary(sweepResults) {
    console.log('\n' + '='.repeat(70));
    console.log('SWEEP SUMMARY — BEST COMBOS BY 5d WIN RATE EDGE OVER BASELINE');
    console.log('='.repeat(70));

    const rows = [];
    for (const { symbol, fast, slow, result } of sweepResults) {
        const { groups } = result;
        const allSignals = Object.values(groups).flat();
        const baselineStats = calcGroupStats(allSignals);
        const baseWR = parseFloat(baselineStats['5d'].winRate);

        const bullGroup = groups['full_bull'] || [];
        if (bullGroup.length === 0) continue;
        const bullStats = calcGroupStats(bullGroup);
        const bullWR = parseFloat(bullStats['5d'].winRate);

        rows.push({
            Symbol: symbol,
            Combo: `${fast}/${slow}`,
            'Bull Count': bullGroup.length,
            'Bull 5d WR': bullStats['5d'].winRate,
            'Base 5d WR': baselineStats['5d'].winRate,
            'Edge': (bullWR - baseWR >= 0 ? '+' : '') + (bullWR - baseWR).toFixed(1) + '%',
            'Bull Avg 5d': bullStats['5d'].avgReturn,
        });
    }

    rows.sort((a, b) => parseFloat(b.Edge) - parseFloat(a.Edge));
    console.table(rows);
}

function printCrossoverSweepSummary(sweepResults) {
    console.log('\n' + '═'.repeat(80));
    console.log('CROSSOVER SWEEP SUMMARY — Ranked by Golden Cross 5d Win Rate');
    console.log('═'.repeat(80));

    const rows = [];
    for (const { symbol, fast, slow, result } of sweepResults) {
        const { crosses } = result;
        const golden = crosses.filter(c => c.type === 'golden_cross');
        const death = crosses.filter(c => c.type === 'death_cross');

        const goldenStats = golden.length > 0 ? calcGroupStats(golden) : null;
        // Invert death cross returns (short signal)
        const invertedDeath = death.map(c => ({
            ...c,
            returns: Object.fromEntries(
                Object.entries(c.returns).map(([k, v]) => [k, v != null ? -v : null])
            ),
        }));
        const deathStats = invertedDeath.length > 0 ? calcGroupStats(invertedDeath) : null;

        const goldWR = goldenStats ? goldenStats['5d'].winRate : 'N/A';
        const goldAvg = goldenStats ? goldenStats['5d'].avgReturn : 'N/A';
        const deathWR = deathStats ? deathStats['5d'].winRate : 'N/A';

        const lowConf = golden.length < 15 ? ' *' : '';

        rows.push({
            Symbol: symbol,
            Combo: `${fast}/${slow}`,
            'Gold #': golden.length,
            'Gold 5d WR': goldWR + lowConf,
            'Gold Avg 5d': goldAvg,
            'Death #': death.length,
            'Death 5d WR': deathWR + (death.length < 15 ? ' *' : ''),
            _sortKey: goldenStats ? parseFloat(goldenStats['5d'].winRate) : 0,
        });
    }

    rows.sort((a, b) => b._sortKey - a._sortKey);

    // Print formatted table
    console.log(`${'Symbol'.padEnd(8)} ${'Combo'.padEnd(7)} ${'Gold#'.padStart(6)} ${'Gold 5d WR'.padStart(12)} ${'Gold Avg 5d'.padStart(13)} ${'Death#'.padStart(7)} ${'Death 5d WR'.padStart(13)}`);
    console.log('-'.repeat(80));
    for (const r of rows) {
        console.log(
            `${r.Symbol.padEnd(8)} ${r.Combo.padEnd(7)} ${String(r['Gold #']).padStart(6)} ${r['Gold 5d WR'].padStart(12)} ${r['Gold Avg 5d'].padStart(13)} ${String(r['Death #']).padStart(7)} ${r['Death 5d WR'].padStart(13)}`
        );
    }

    const lowConfCount = rows.filter(r => r['Gold #'] < 15).length;
    if (lowConfCount > 0) {
        console.log(`\n* = low confidence (< 15 signals)`);
    }
    console.log(`\nTotal combos tested: ${rows.length}`);
}

// --- Main ---

async function main() {
    const symbols = SYMBOL_ARG === 'ALL' ? WATCHLIST_SYMBOLS : [SYMBOL_ARG];
    const combos = SWEEP
        ? (mode === 'crossover' ? CROSSOVER_COMBOS : MA_COMBOS)
        : [{ fast: FAST, slow: SLOW }];

    const log = JSON_OUT ? (...a) => process.stderr.write(a.join(' ') + '\n') : console.log.bind(console);
    log(`Mode: ${mode}`);
    log(`Symbols: ${symbols.join(', ')}`);
    log(`MA combos: ${combos.map(c => `${c.fast}/${c.slow}`).join(', ')}`);
    log(`MA type: ${MA_TYPE} | Years: ${YEARS} | Fresh: ${FRESH} | Save: ${SAVE}`);

    // Fetch all needed history
    log('\nFetching history...');
    const historyMap = {};
    for (const sym of symbols) {
        if (!JSON_OUT) process.stdout.write(`  ${sym}...`);
        const candles = await fetchHistory(sym);
        if (candles) {
            historyMap[sym] = candles;
            log(`  ${sym}... ${candles.length} candles`);
        } else {
            log(`  ${sym}... FAILED`);
        }
        if (symbols.indexOf(sym) < symbols.length - 1) await sleep(200);
    }

    let db = null;
    if (SAVE) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
    }

    const sweepResults = [];

    // Run analysis
    for (const sym of symbols) {
        const candles = historyMap[sym];
        if (!candles) continue;
        _emaCache.clear();  // Clear EMA series cache between symbols
        _hmaCache.clear();  // Clear HMA series cache between symbols

        for (const combo of combos) {
            if (mode === 'alignment') {
                const result = runAlignment(candles, combo.fast, combo.slow);
                if (!JSON_OUT) {
                    printAlignmentResults(sym, combo.fast, combo.slow, result);
                }
                if (SAVE && db) saveAlignmentRun(db, sym, combo.fast, combo.slow, result);
                sweepResults.push({ symbol: sym, fast: combo.fast, slow: combo.slow, result });
            } else if (mode === 'crossover') {
                const result = runCrossover(candles, combo.fast, combo.slow);
                if (!JSON_OUT) {
                    printCrossoverResults(sym, combo.fast, combo.slow, result);
                }
                if (SAVE && db) saveCrossoverRun(db, sym, combo.fast, combo.slow, result);
                sweepResults.push({ symbol: sym, fast: combo.fast, slow: combo.slow, result });
            }
        }
    }

    // Sweep summary
    if (SWEEP && sweepResults.length > 1 && !JSON_OUT) {
        if (mode === 'alignment') printSweepSummary(sweepResults);
        if (mode === 'crossover') printCrossoverSweepSummary(sweepResults);
    }

    // JSON output
    if (JSON_OUT) {
        const output = sweepResults.map(({ symbol, fast, slow, result }) => {
            if (mode === 'alignment') {
                const summary = {};
                for (const [alignment, signals] of Object.entries(result.groups)) {
                    summary[alignment] = { count: signals.length, stats: calcGroupStats(signals) };
                }
                return { symbol, fast, slow, dataStart: result.dataStart, dataEnd: result.dataEnd, totalBars: result.totalBars, alignments: summary };
            } else {
                return { symbol, fast, slow, dataStart: result.dataStart, dataEnd: result.dataEnd, crosses: result.crosses.length };
            }
        });
        console.log(JSON.stringify(output, null, 2));
    }

    if (db) {
        log(`\nResults saved to ${DB_PATH} (ma_backtest_runs table)`);
        db.close();
    }

    if (!JSON_OUT) console.log('\nDone.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
