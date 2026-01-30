#!/usr/bin/env node
/**
 * GAP BACKTEST ANALYSIS
 *
 * Analyzes historical gap data to validate patterns and identify edges.
 * Run: node monitor/gap-backtest.js [--days=30]
 *
 * Reports on:
 * - Fill rates by tier (does HIGH_CONVICTION really run more?)
 * - Fill rates by gap size (do bigger gaps run?)
 * - Fill rates by catalyst (do earnings gaps run?)
 * - Fill rates by direction (gap up vs gap down)
 * - Repeat offender analysis
 * - Win rate analysis (continuation vs fade)
 */

const signalDb = require('./signal-db');

// Parse command line args
const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const DAYS = daysArg ? parseInt(daysArg.split('=')[1]) : 30;

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatPercent(value) {
    if (value === null || value === undefined) return 'N/A';
    return `${value.toFixed(1)}%`;
}

function formatBar(value, max = 100, width = 20) {
    const filled = Math.round((value / max) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function divider(title) {
    const line = '═'.repeat(60);
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(line);
}

// ============================================
// ANALYSIS FUNCTIONS
// ============================================

function analyzeOverall() {
    divider('OVERALL STATISTICS');

    const stats = signalDb.getGapFillRates({ days: DAYS });

    if (!stats.overall || stats.overall.total === 0) {
        console.log('\n  No gap data with EOD tracking found.');
        console.log('  EOD tracker runs at 4:15 PM ET daily.');
        console.log('  Check back after market close to see results.\n');
        return false;
    }

    console.log(`\n  Period: Last ${DAYS} days`);
    console.log(`  Total Gaps Tracked: ${stats.overall.total}`);
    console.log(`  Gaps Filled: ${stats.overall.filled} (${formatPercent(stats.overall.fill_rate)})`);
    console.log(`  Gaps Ran: ${stats.overall.total - stats.overall.filled} (${formatPercent(100 - stats.overall.fill_rate)})`);

    return true;
}

function analyzeByTier() {
    divider('FILL RATE BY TIER');

    const stats = signalDb.getGapFillRates({ days: DAYS });

    if (!stats.by_tier || stats.by_tier.length === 0) {
        console.log('\n  No tier data available\n');
        return;
    }

    console.log('\n  Tier             Total   Filled   Fill Rate   Insight');
    console.log('  ' + '-'.repeat(58));

    stats.by_tier.forEach(t => {
        const insight = t.fill_rate < 50 ? 'Tends to RUN ✓' :
                       t.fill_rate > 65 ? 'Tends to FILL (fade)' : 'Mixed';
        console.log(`  ${t.tier.padEnd(16)} ${String(t.total).padStart(5)}   ${String(t.filled).padStart(6)}   ${formatPercent(t.fill_rate).padStart(9)}   ${insight}`);
    });

    console.log('\n  INSIGHT: Lower fill rate = gaps tend to continue (momentum)');
    console.log('           Higher fill rate = gaps tend to fade (mean revert)\n');
}

function analyzeBySize() {
    divider('FILL RATE BY GAP SIZE');

    const stats = signalDb.getGapFillRates({ days: DAYS });

    if (!stats.by_size || stats.by_size.length === 0) {
        console.log('\n  No size data available\n');
        return;
    }

    console.log('\n  Gap Size        Total   Filled   Fill Rate   Interpretation');
    console.log('  ' + '-'.repeat(60));

    stats.by_size.forEach(s => {
        const interp = s.fill_rate < 50 ? 'Strong momentum' :
                      s.fill_rate > 65 ? 'Good fade setup' : 'No edge';
        console.log(`  ${s.size_bucket.padEnd(14)} ${String(s.total).padStart(5)}   ${String(s.filled).padStart(6)}   ${formatPercent(s.fill_rate).padStart(9)}   ${interp}`);
    });

    console.log('\n  THEORY: Larger gaps have more conviction, less likely to fill\n');
}

function analyzeByCatalyst() {
    divider('FILL RATE BY CATALYST');

    const stats = signalDb.getGapFillRates({ days: DAYS });

    if (!stats.by_catalyst || stats.by_catalyst.length === 0) {
        console.log('\n  No catalyst data available\n');
        return;
    }

    console.log('\n  Catalyst          Total   Filled   Fill Rate   Strategy');
    console.log('  ' + '-'.repeat(58));

    stats.by_catalyst.forEach(c => {
        const strategy = c.fill_rate < 45 ? 'Play continuation' :
                        c.fill_rate > 60 ? 'Consider fade' : 'Wait for confirmation';
        console.log(`  ${c.has_catalyst.padEnd(16)} ${String(c.total).padStart(5)}   ${String(c.filled).padStart(6)}   ${formatPercent(c.fill_rate).padStart(9)}   ${strategy}`);
    });

    console.log('\n  THEORY: Earnings/news gaps have follow-through, random gaps fade\n');
}

function analyzeByDirection() {
    divider('FILL RATE BY DIRECTION');

    const stats = signalDb.getGapFillRates({ days: DAYS });

    if (!stats.by_direction || stats.by_direction.length === 0) {
        console.log('\n  No direction data available\n');
        return;
    }

    console.log('\n  Direction       Total   Filled   Fill Rate   Note');
    console.log('  ' + '-'.repeat(55));

    stats.by_direction.forEach(d => {
        const note = d.direction === 'UP' ?
            (d.fill_rate > 50 ? 'Gap ups fade more' : 'Gap ups run') :
            (d.fill_rate > 50 ? 'Gap downs fade more' : 'Gap downs run');
        console.log(`  ${d.direction.padEnd(14)} ${String(d.total).padStart(5)}   ${String(d.filled).padStart(6)}   ${formatPercent(d.fill_rate).padStart(9)}   ${note}`);
    });
}

function analyzeRepeatOffenders() {
    divider('REPEAT OFFENDERS (Frequent Gappers)');

    const offenders = signalDb.getRepeatOffenders(DAYS, 15);

    if (!offenders || offenders.length === 0) {
        console.log('\n  No repeat offenders found\n');
        return;
    }

    console.log('\n  Symbol   Gaps   Fill%   AvgGap   Last Gap      Strategy');
    console.log('  ' + '-'.repeat(58));

    offenders.forEach(o => {
        const fillPct = formatPercent(o.fill_rate * 100);
        const avgGap = o.avg_gap_pct >= 0 ? `+${o.avg_gap_pct.toFixed(1)}%` : `${o.avg_gap_pct.toFixed(1)}%`;
        const strategy = o.fill_rate > 0.65 ? 'FADE candidate' :
                        o.fill_rate < 0.40 ? 'MOMENTUM play' : 'Mixed';
        console.log(`  ${o.symbol.padEnd(7)}  ${String(o.total_gaps).padStart(4)}   ${fillPct.padStart(5)}   ${avgGap.padStart(7)}   ${(o.last_gap_date || 'N/A').substring(0, 10)}   ${strategy}`);
    });

    console.log('\n  INSIGHT: Tickers with consistent patterns have tradeable edges\n');
}

function analyzeWinRate() {
    divider('WIN RATE ANALYSIS (Outcome Tracking)');

    // Query outcome distribution
    const db = signalDb.getDb();

    const outcomes = db.prepare(`
        SELECT
            outcome,
            COUNT(*) as count
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE outcome IS NOT NULL
        AND ps.timestamp >= datetime('now', '-${DAYS} days')
        GROUP BY outcome
    `).all();

    if (!outcomes || outcomes.length === 0) {
        console.log('\n  No outcome data available yet');
        console.log('  Outcomes are recorded by EOD tracker at 4:15 PM ET\n');
        return;
    }

    const total = outcomes.reduce((sum, o) => sum + o.count, 0);

    console.log(`\n  Total tracked: ${total}`);
    console.log('\n  Outcome     Count    Percent');
    console.log('  ' + '-'.repeat(35));

    outcomes.forEach(o => {
        const pct = ((o.count / total) * 100).toFixed(1);
        const emoji = o.outcome === 'WIN' ? '💰' : o.outcome === 'LOSS' ? '❌' : '➖';
        console.log(`  ${emoji} ${(o.outcome || 'UNKNOWN').padEnd(9)} ${String(o.count).padStart(5)}    ${pct.padStart(5)}%`);
    });

    // Breakdown by tier
    const tierOutcomes = db.prepare(`
        SELECT
            tier,
            outcome,
            COUNT(*) as count
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE outcome IS NOT NULL
        AND ps.timestamp >= datetime('now', '-${DAYS} days')
        GROUP BY tier, outcome
        ORDER BY tier, outcome
    `).all();

    if (tierOutcomes.length > 0) {
        console.log('\n  WIN RATE BY TIER:');
        console.log('  ' + '-'.repeat(35));

        // Group by tier
        const tierStats = {};
        tierOutcomes.forEach(t => {
            if (!tierStats[t.tier]) {
                tierStats[t.tier] = { wins: 0, losses: 0, scratch: 0, total: 0 };
            }
            tierStats[t.tier].total += t.count;
            if (t.outcome === 'WIN') tierStats[t.tier].wins = t.count;
            if (t.outcome === 'LOSS') tierStats[t.tier].losses = t.count;
            if (t.outcome === 'SCRATCH') tierStats[t.tier].scratch = t.count;
        });

        Object.entries(tierStats).forEach(([tier, stats]) => {
            const winRate = ((stats.wins / stats.total) * 100).toFixed(1);
            console.log(`  ${tier.padEnd(16)} Win Rate: ${winRate}% (${stats.wins}/${stats.total})`);
        });
    }
}

function generateSummary() {
    divider('EXECUTIVE SUMMARY');

    const stats = signalDb.getGapFillRates({ days: DAYS });

    if (!stats.overall || stats.overall.total === 0) {
        console.log('\n  Insufficient data for summary.\n');
        return;
    }

    console.log('\n  KEY FINDINGS:');
    console.log('  ' + '-'.repeat(50));

    // Find best tier for momentum
    if (stats.by_tier && stats.by_tier.length > 0) {
        const sorted = [...stats.by_tier].sort((a, b) => a.fill_rate - b.fill_rate);
        const momentum = sorted[0];
        const fade = sorted[sorted.length - 1];

        console.log(`\n  • Best for MOMENTUM: ${momentum.tier}`);
        console.log(`    Only ${formatPercent(momentum.fill_rate)} fill rate - gaps tend to run`);

        console.log(`\n  • Best for FADE: ${fade.tier}`);
        console.log(`    ${formatPercent(fade.fill_rate)} fill rate - gaps tend to mean revert`);
    }

    // Catalyst impact
    if (stats.by_catalyst && stats.by_catalyst.length > 0) {
        const withCatalyst = stats.by_catalyst.find(c => c.has_catalyst === 'With Catalyst');
        const noCatalyst = stats.by_catalyst.find(c => c.has_catalyst === 'No Catalyst');

        if (withCatalyst && noCatalyst) {
            const diff = noCatalyst.fill_rate - withCatalyst.fill_rate;
            if (diff > 10) {
                console.log(`\n  • CATALYST EFFECT: Earnings gaps fill ${diff.toFixed(0)}% less often`);
                console.log(`    Don't fade earnings gaps - they have follow-through`);
            }
        }
    }

    // Size impact
    if (stats.by_size && stats.by_size.length > 0) {
        const small = stats.by_size.find(s => s.size_bucket === '2-3%');
        const large = stats.by_size.find(s => s.size_bucket === '5%+');

        if (small && large && small.fill_rate > large.fill_rate) {
            console.log(`\n  • SIZE MATTERS: Small gaps (2-3%) fill ${(small.fill_rate - large.fill_rate).toFixed(0)}% more often`);
            console.log(`    Bigger gaps = more conviction = momentum plays`);
        }
    }

    console.log('\n');
}

// ============================================
// MAIN
// ============================================

function main() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║             GAP BACKTEST ANALYSIS REPORT                 ║');
    console.log('║                                                          ║');
    console.log(`║  Period: Last ${String(DAYS).padEnd(3)} days                                  ║`);
    console.log(`║  Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}               ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    const hasData = analyzeOverall();

    if (hasData) {
        analyzeByTier();
        analyzeBySize();
        analyzeByCatalyst();
        analyzeByDirection();
        analyzeRepeatOffenders();
        analyzeWinRate();
        generateSummary();
    } else {
        console.log('\n  The EOD Gap Tracker runs daily at 4:15 PM ET.');
        console.log('  It captures closing prices and calculates fill rates.');
        console.log('  Run this report again after data accumulates.\n');

        // Show what data we DO have
        const db = signalDb.getDb();
        const totalGaps = db.prepare('SELECT COUNT(*) as count FROM premarket_movers').get();
        const uniqueDays = db.prepare('SELECT COUNT(DISTINCT date(timestamp)) as days FROM premarket_scans').get();

        console.log('  CURRENT DATA STATUS:');
        console.log(`  • ${totalGaps.count} gap records in database`);
        console.log(`  • Spanning ${uniqueDays.days} trading days`);
        console.log(`  • EOD tracking: 0 records (awaiting first EOD run)\n`);
    }
}

main();
