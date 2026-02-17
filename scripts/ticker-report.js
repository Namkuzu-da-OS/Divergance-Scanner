#!/usr/bin/env node
/**
 * TICKER REPORT — Per-symbol MA backtest analysis
 *
 * Compiles all crossover, bounce, and alignment backtest data for a single
 * symbol into a formatted terminal report.
 *
 * Usage:
 *   node scripts/ticker-report.js NVDA           # Show report from saved data
 *   node scripts/ticker-report.js NVDA --run     # Run all sweeps first, then report
 *   node scripts/ticker-report.js NVDA --json    # JSON output
 */

const path = require('path');
const { execSync } = require('child_process');

const signalDb = require(path.join(__dirname, '..', 'monitor', 'signal-db'));

// --- ANSI color helpers ---
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
};

function wrColor(wr) {
    if (wr === null || wr === undefined) return C.dim;
    if (wr >= 65) return C.green;
    if (wr >= 55) return C.yellow;
    return C.dim;
}

function fmtWR(wr, count) {
    if (wr === null || wr === undefined) return `${C.dim}N/A${C.reset}`;
    const color = wrColor(wr);
    const low = count !== undefined && count < 15 ? `${C.dim}*` : '';
    return `${color}${wr.toFixed(1)}%${low}${C.reset}`;
}

function fmtFilter(f) {
    if (!f) return `${C.dim}--${C.reset}`;
    return `${C.cyan}${f.filter}${C.reset} ${fmtWR(f.wr, f.count)} ${C.dim}(+${f.boost.toFixed(1)}%, n=${f.count})${C.reset}`;
}

function padR(s, len) {
    // Strip ANSI for length calculation
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, len - stripped.length);
    return s + ' '.repeat(pad);
}

function padL(s, len) {
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, len - stripped.length);
    return ' '.repeat(pad) + s;
}

// --- Argument parsing ---
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')).map(a => a.toLowerCase()));
const symbol = args.find(a => !a.startsWith('--'));

if (!symbol) {
    console.log(`${C.bold}Usage:${C.reset} node scripts/ticker-report.js <SYMBOL> [--run] [--json]`);
    console.log('');
    console.log('  --run   Run all MA sweep modes first (crossover, alignment, bounce × SMA, EMA, HMA)');
    console.log('  --json  Output raw JSON instead of formatted report');
    process.exit(1);
}

// --- Run sweeps if requested ---
if (flags.has('--run')) {
    const modes = ['crossover', 'alignment', 'bounce'];
    const maTypes = ['SMA', 'EMA', 'HMA'];
    const scriptPath = path.join(__dirname, 'ma-backtest.js');

    console.log(`${C.bold}${C.cyan}Running all sweeps for ${symbol.toUpperCase()}...${C.reset}\n`);

    for (const mode of modes) {
        for (const maType of maTypes) {
            const cmd = `node "${scriptPath}" ${mode} --sweep --symbol ${symbol.toUpperCase()} --ma ${maType} --save`;
            console.log(`${C.dim}  → ${mode} ${maType}...${C.reset}`);
            try {
                execSync(cmd, { stdio: 'pipe', timeout: 300000 });
            } catch (e) {
                console.error(`${C.red}  ✗ Failed: ${mode} ${maType}: ${e.message}${C.reset}`);
            }
        }
    }
    console.log('');
}

// --- Compile report ---
const report = signalDb.compileTickerReport(symbol);

if (!report) {
    console.log(`${C.red}No backtest data found for ${symbol.toUpperCase()}.${C.reset}`);
    console.log(`Run sweeps first with: ${C.cyan}node scripts/ticker-report.js ${symbol.toUpperCase()} --run${C.reset}`);
    process.exit(1);
}

// --- JSON output ---
if (flags.has('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
}

// --- Formatted terminal report ---
const s = report.summary;
const hr = `${C.dim}${'─'.repeat(80)}${C.reset}`;

console.log('');
console.log(`${C.bold}${C.green}═══ TICKER REPORT: ${report.symbol} ═══${C.reset}`);
console.log('');
console.log(`  ${C.dim}Combos tested:${C.reset}  ${s.total_combos_tested}`);
console.log(`  ${C.dim}Modes covered:${C.reset}  ${s.modes_covered.join(', ')}`);
console.log(`  ${C.dim}Data range:${C.reset}     ${s.data_range || 'N/A'}`);
if (s.best_overall) {
    console.log(`  ${C.dim}Best overall:${C.reset}   ${C.bold}${s.best_overall.combo}${C.reset} ${s.best_overall.ma_type} — ${C.green}${s.best_overall.value}${C.reset} (${s.best_overall.metric}, ${s.best_overall.mode})`);
}

// === RECOMMENDATIONS ===
if (report.recommendations.length > 0) {
    console.log('');
    console.log(hr);
    console.log(`${C.bold}  RECOMMENDATIONS${C.reset}`);
    console.log(hr);

    for (const rec of report.recommendations) {
        const badge = rec.actionable ? `${C.bgGreen}${C.bold} ACTION ${C.reset}` : `${C.bgYellow}${C.bold} WATCH ${C.reset}`;
        console.log(`  ${badge} ${C.bold}${rec.combo}${C.reset} ${C.cyan}${rec.ma_type}${C.reset} ${C.dim}(${rec.modes} mode${rec.modes > 1 ? 's' : ''})${C.reset}`);
        for (const reason of rec.reasons) {
            console.log(`    ${C.dim}•${C.reset} ${reason}`);
        }
    }
}

// === CROSSOVER ===
if (report.crossover.all.length > 0) {
    console.log('');
    console.log(hr);
    console.log(`${C.bold}  CROSSOVER — Top Golden Cross Combos (5d WR)${C.reset}`);
    console.log(hr);

    const top = report.crossover.all.slice(0, 10);
    console.log(`  ${C.dim}${padR('Combo', 12)} ${padR('MA', 5)} ${padR('5d WR', 12)} ${padR('Count', 8)} ${padR('Avg Ret', 10)} ${padR('RSI Filter', 30)} VIX Regime${C.reset}`);

    for (const c of top) {
        const combo = padR(`${C.bold}${c.combo}${C.reset}`, 12 + 8); // +8 for ANSI codes
        const ma = padR(c.ma_type, 5);
        const wr = padR(fmtWR(c.golden_5d_wr, c.golden_5d_count), 12 + 10);
        const count = padR(String(c.golden_5d_count), 8);
        const avg = padR(c.golden_5d_avg || '--', 10);
        const rsi = padR(fmtFilter(c.rsi_filter), 30 + 20);
        const vix = fmtFilter(c.vix_regime);
        console.log(`  ${combo} ${ma} ${wr} ${count} ${avg} ${rsi} ${vix}`);
    }

    if (report.crossover.best_golden) {
        const bg = report.crossover.best_golden;
        console.log(`\n  ${C.green}★ Best golden:${C.reset} ${bg.combo} ${bg.ma_type} — ${fmtWR(bg.wr, bg.count)} (n=${bg.count})`);
    }
    if (report.crossover.best_death) {
        const bd = report.crossover.best_death;
        console.log(`  ${C.red}★ Best death:${C.reset}  ${bd.combo} ${bd.ma_type} — ${fmtWR(bd.wr, bd.count)} (n=${bd.count}, avg=${bd.avg_return || 'N/A'})`);
    }
}

// === BOUNCE ===
if (report.bounce.all.length > 0) {
    console.log('');
    console.log(hr);
    console.log(`${C.bold}  BOUNCE — Top Bull Bounce Combos (5d WR)${C.reset}`);
    console.log(hr);

    const top = report.bounce.all.slice(0, 10);
    console.log(`  ${C.dim}${padR('Combo', 12)} ${padR('MA', 5)} ${padR('5d WR', 12)} ${padR('Count', 8)} ${padR('Avg Ret', 10)} ${padR('Touch', 30)} RSI Filter${C.reset}`);

    for (const b of top) {
        const combo = padR(`${C.bold}${b.combo}${C.reset}`, 12 + 8);
        const ma = padR(b.ma_type, 5);
        const wr = padR(fmtWR(b.bull_5d_wr, b.bull_5d_count), 12 + 10);
        const count = padR(String(b.bull_5d_count), 8);
        const avg = padR(b.bull_5d_avg || '--', 10);
        const touch = padR(fmtFilter(b.touch_filter), 30 + 20);
        const rsi = fmtFilter(b.rsi_filter);
        console.log(`  ${combo} ${ma} ${wr} ${count} ${avg} ${touch} ${rsi}`);
    }

    if (report.bounce.best_bull) {
        const bb = report.bounce.best_bull;
        console.log(`\n  ${C.green}★ Best bull:${C.reset} ${bb.combo} ${bb.ma_type} — ${fmtWR(bb.wr, bb.count)} (n=${bb.count})`);
    }
    if (report.bounce.best_bear) {
        const br = report.bounce.best_bear;
        console.log(`  ${C.red}★ Best bear:${C.reset} ${br.combo} ${br.ma_type} — ${fmtWR(br.wr, br.count)} (n=${br.count}, avg=${br.avg_return || 'N/A'})`);
    }
}

// === ALIGNMENT ===
if (report.alignment.all.length > 0) {
    console.log('');
    console.log(hr);
    console.log(`${C.bold}  ALIGNMENT — Top States by Edge vs Baseline (5d WR)${C.reset}`);
    console.log(hr);

    const top = report.alignment.all.slice(0, 10);
    console.log(`  ${C.dim}${padR('Combo', 12)} ${padR('MA', 5)} ${padR('State', 18)} ${padR('5d WR', 12)} ${padR('Edge', 10)} ${padR('Count', 8)} Baseline${C.reset}`);

    for (const a of top) {
        const combo = padR(`${C.bold}${a.combo}${C.reset}`, 12 + 8);
        const ma = padR(a.ma_type, 5);
        const state = padR(a.state.replace(/_/g, ' '), 18);
        const wr = padR(fmtWR(a.wr, a.count), 12 + 10);
        const edgeVal = a.edge;
        const edgeColor = edgeVal >= 5 ? C.green : edgeVal >= 2 ? C.yellow : C.dim;
        const edge = padR(`${edgeColor}${edgeVal >= 0 ? '+' : ''}${edgeVal.toFixed(1)}%${C.reset}`, 10 + 10);
        const count = padR(String(a.count), 8);
        console.log(`  ${combo} ${ma} ${state} ${wr} ${edge} ${count} ${C.dim}${a.baseline}%${C.reset}`);
    }

    if (report.alignment.best_state) {
        const bs = report.alignment.best_state;
        console.log(`\n  ${C.green}★ Best state:${C.reset} ${bs.combo} ${bs.ma_type} ${bs.state.replace(/_/g, ' ')} — ${fmtWR(bs.wr, bs.count)} (+${bs.edge}% edge)`);
    }
}

console.log('');
console.log(`${C.dim}* = low confidence (<15 signals)${C.reset}`);
console.log('');
