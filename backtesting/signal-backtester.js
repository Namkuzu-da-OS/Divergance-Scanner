/**
 * Signal Backtester
 * Analyzes historical signals to validate strategy effectiveness
 *
 * Usage: node backtesting/signal-backtester.js [--filter=fib|zone|all]
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, '../data/paper_trades.json');
const OPTIONS_API = 'http://192.168.10.60:8000';

// Time windows to analyze (hours after entry)
const TIME_WINDOWS = ['1h', '4h', '24h', '72h'];

// Direction correctness thresholds
const CORRECT_THRESHOLD = 0.5;  // 0.5% move in predicted direction = correct

/**
 * Load historical signals
 */
function loadSignals() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return data.trades || [];
}

/**
 * Check if direction prediction was correct
 * @param {string} direction - bullish, bearish, pinned
 * @param {number} entryPrice
 * @param {number} currentPrice
 * @returns {object} {correct: boolean, pctChange: number}
 */
function checkDirectionCorrect(direction, entryPrice, currentPrice) {
    const pctChange = ((currentPrice - entryPrice) / entryPrice) * 100;

    if (direction === 'bullish') {
        return { correct: pctChange >= CORRECT_THRESHOLD, pctChange };
    } else if (direction === 'bearish') {
        return { correct: pctChange <= -CORRECT_THRESHOLD, pctChange };
    } else if (direction === 'pinned') {
        // Pinned is correct if price stayed within 1% range
        return { correct: Math.abs(pctChange) <= 1.0, pctChange };
    }
    return { correct: null, pctChange };
}

/**
 * Extract Fib signals from signals array
 */
function extractFibSignals(signals) {
    const fibSignals = [];
    for (const s of signals) {
        if (s.includes('Golden Pocket') || s.includes('0.618')) {
            fibSignals.push('GOLDEN_POCKET');
        } else if (s.includes('1.618 extension') || s.includes('1.618')) {
            fibSignals.push('EXT_1618');
        } else if (s.includes('extension')) {
            fibSignals.push('EXTENSION');
        } else if (s.includes('Fib')) {
            fibSignals.push('OTHER_FIB');
        }
    }
    return fibSignals;
}

/**
 * Analyze signals by grouping
 */
function analyzeByGroup(signals, groupFn, groupName) {
    const groups = {};

    for (const signal of signals) {
        const group = groupFn(signal);
        if (!group) continue;

        if (!groups[group]) {
            groups[group] = {
                total: 0,
                correct: 0,
                incorrect: 0,
                unknown: 0,
                avgChange: [],
                avgPeakGain: [],
                avgMaxDrawdown: []
            };
        }

        const g = groups[group];
        g.total++;

        // Check direction at each time window
        const outcome = signal.outcome || {};
        const entryPrice = signal.entry?.price;

        // Use 24h price as primary validation (or latest available)
        const checkPrice = outcome.price_24h || outcome.price_4h || outcome.price_1h || outcome.current_price;

        if (entryPrice && checkPrice) {
            const result = checkDirectionCorrect(signal.direction, entryPrice, checkPrice);
            if (result.correct === true) g.correct++;
            else if (result.correct === false) g.incorrect++;
            else g.unknown++;

            g.avgChange.push(result.pctChange);
        } else {
            g.unknown++;
        }

        if (outcome.peak_gain_pct !== null) g.avgPeakGain.push(outcome.peak_gain_pct);
        if (outcome.max_drawdown_pct !== null) g.avgMaxDrawdown.push(outcome.max_drawdown_pct);
    }

    // Calculate averages
    const results = {};
    for (const [group, g] of Object.entries(groups)) {
        const validated = g.correct + g.incorrect;
        results[group] = {
            total: g.total,
            validated,
            correct: g.correct,
            incorrect: g.incorrect,
            winRate: validated > 0 ? ((g.correct / validated) * 100).toFixed(1) + '%' : 'N/A',
            avgChange: g.avgChange.length > 0
                ? (g.avgChange.reduce((a, b) => a + b, 0) / g.avgChange.length).toFixed(2) + '%'
                : 'N/A',
            avgPeakGain: g.avgPeakGain.length > 0
                ? (g.avgPeakGain.reduce((a, b) => a + b, 0) / g.avgPeakGain.length).toFixed(2) + '%'
                : 'N/A',
            avgMaxDrawdown: g.avgMaxDrawdown.length > 0
                ? (g.avgMaxDrawdown.reduce((a, b) => a + b, 0) / g.avgMaxDrawdown.length).toFixed(2) + '%'
                : 'N/A'
        };
    }

    return results;
}

/**
 * Analyze Fib signals specifically
 */
function analyzeFibSignals(signals) {
    // Filter signals that have Fib-related entries
    const fibSignals = signals.filter(s => {
        const signalList = s.entry?.signals || [];
        return signalList.some(sig =>
            sig.includes('Fib') ||
            sig.includes('Golden Pocket') ||
            sig.includes('extension')
        );
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log('FIBONACCI SIGNAL ANALYSIS');
    console.log(`${'='.repeat(60)}`);
    console.log(`Total signals with Fib levels: ${fibSignals.length}`);

    // Group by Fib type
    const byFibType = analyzeByGroup(fibSignals, (s) => {
        const signalList = s.entry?.signals || [];
        for (const sig of signalList) {
            if (sig.includes('Golden Pocket')) return 'GOLDEN_POCKET';
            if (sig.includes('1.618 extension')) return 'EXT_1618';
            if (sig.includes('extension')) return 'OTHER_EXTENSION';
            if (sig.includes('Fib')) return 'OTHER_FIB';
        }
        return null;
    }, 'Fib Type');

    console.log('\n--- By Fib Type ---');
    printTable(byFibType);

    return byFibType;
}

/**
 * Print results as table
 */
function printTable(results) {
    const headers = ['Group', 'Total', 'Validated', 'Correct', 'Incorrect', 'Win Rate', 'Avg Change', 'Peak Gain', 'Max DD'];
    const colWidths = [20, 8, 10, 8, 10, 10, 12, 12, 12];

    // Header
    let header = '';
    headers.forEach((h, i) => header += h.padEnd(colWidths[i]));
    console.log(header);
    console.log('-'.repeat(header.length));

    // Rows
    for (const [group, data] of Object.entries(results)) {
        let row = '';
        row += group.substring(0, 18).padEnd(colWidths[0]);
        row += String(data.total).padEnd(colWidths[1]);
        row += String(data.validated).padEnd(colWidths[2]);
        row += String(data.correct).padEnd(colWidths[3]);
        row += String(data.incorrect).padEnd(colWidths[4]);
        row += data.winRate.padEnd(colWidths[5]);
        row += data.avgChange.padEnd(colWidths[6]);
        row += data.avgPeakGain.padEnd(colWidths[7]);
        row += data.avgMaxDrawdown.padEnd(colWidths[8]);
        console.log(row);
    }
}

/**
 * Main backtest runner
 */
async function runBacktest(filter = 'all') {
    console.log('\n' + '='.repeat(60));
    console.log('SIGNAL BACKTESTER');
    console.log('='.repeat(60));

    const signals = loadSignals();
    console.log(`\nLoaded ${signals.length} historical signals`);

    // Date range
    const dates = signals.map(s => new Date(s.entry?.timestamp)).filter(d => !isNaN(d));
    if (dates.length > 0) {
        const oldest = new Date(Math.min(...dates));
        const newest = new Date(Math.max(...dates));
        console.log(`Date range: ${oldest.toLocaleDateString()} - ${newest.toLocaleDateString()}`);
    }

    // === BY DIRECTION ===
    console.log(`\n${'='.repeat(60)}`);
    console.log('BY DIRECTION');
    console.log(`${'='.repeat(60)}`);
    const byDirection = analyzeByGroup(signals, s => s.direction, 'Direction');
    printTable(byDirection);

    // === BY ZONE ===
    console.log(`\n${'='.repeat(60)}`);
    console.log('BY ZONE');
    console.log(`${'='.repeat(60)}`);
    const byZone = analyzeByGroup(signals, s => s.entry?.zone, 'Zone');
    printTable(byZone);

    // === BY SCORE RANGE ===
    console.log(`\n${'='.repeat(60)}`);
    console.log('BY SCORE RANGE');
    console.log(`${'='.repeat(60)}`);
    const byScore = analyzeByGroup(signals, s => {
        const score = s.entry?.score;
        if (!score) return null;
        if (score >= 90) return '90-100';
        if (score >= 80) return '80-89';
        if (score >= 70) return '70-79';
        if (score >= 60) return '60-69';
        return '< 60';
    }, 'Score Range');
    printTable(byScore);

    // === BY VIX REGIME ===
    console.log(`\n${'='.repeat(60)}`);
    console.log('BY VIX REGIME');
    console.log(`${'='.repeat(60)}`);
    const byVix = analyzeByGroup(signals, s => s.entry?.vix_regime, 'VIX Regime');
    printTable(byVix);

    // === BY SIGNAL TYPE ===
    console.log(`\n${'='.repeat(60)}`);
    console.log('BY SIGNAL TYPE');
    console.log(`${'='.repeat(60)}`);
    const byType = analyzeByGroup(signals, s => s.signal_type, 'Signal Type');
    printTable(byType);

    // === FIB ANALYSIS ===
    if (filter === 'fib' || filter === 'all') {
        analyzeFibSignals(signals);
    }

    // === KEY INSIGHTS ===
    console.log(`\n${'='.repeat(60)}`);
    console.log('KEY INSIGHTS');
    console.log(`${'='.repeat(60)}`);

    // Find best performing groups
    const insights = [];

    // Best zone
    let bestZone = null, bestZoneRate = 0;
    for (const [zone, data] of Object.entries(byZone)) {
        const rate = parseFloat(data.winRate);
        if (!isNaN(rate) && rate > bestZoneRate && data.validated >= 10) {
            bestZoneRate = rate;
            bestZone = zone;
        }
    }
    if (bestZone) {
        insights.push(`Best Zone: ${bestZone} (${bestZoneRate}% win rate)`);
    }

    // Best direction
    let bestDir = null, bestDirRate = 0;
    for (const [dir, data] of Object.entries(byDirection)) {
        const rate = parseFloat(data.winRate);
        if (!isNaN(rate) && rate > bestDirRate && data.validated >= 10) {
            bestDirRate = rate;
            bestDir = dir;
        }
    }
    if (bestDir) {
        insights.push(`Best Direction: ${bestDir} (${bestDirRate}% win rate)`);
    }

    // Best score range
    let bestScore = null, bestScoreRate = 0;
    for (const [score, data] of Object.entries(byScore)) {
        const rate = parseFloat(data.winRate);
        if (!isNaN(rate) && rate > bestScoreRate && data.validated >= 10) {
            bestScoreRate = rate;
            bestScore = score;
        }
    }
    if (bestScore) {
        insights.push(`Best Score Range: ${bestScore} (${bestScoreRate}% win rate)`);
    }

    insights.forEach(i => console.log(`  - ${i}`));

    console.log('\n' + '='.repeat(60));
    console.log('Backtest complete');
    console.log('='.repeat(60) + '\n');
}

// CLI
const args = process.argv.slice(2);
let filter = 'all';
for (const arg of args) {
    if (arg.startsWith('--filter=')) {
        filter = arg.split('=')[1];
    }
}

runBacktest(filter).catch(console.error);
