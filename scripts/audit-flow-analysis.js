#!/usr/bin/env node

/**
 * AUDIT: Options Flow Effectiveness Analysis
 *
 * Cross-references 57K+ opportunities with bloodhound_results and audit_returns.
 * Answers: does unusual options flow at specific technical levels predict direction?
 *
 * Prerequisites: Run audit-build-returns.js first.
 *
 * Usage:
 *   node scripts/audit-flow-analysis.js              # Full report
 *   node scripts/audit-flow-analysis.js --section 1  # Specific section
 *   node scripts/audit-flow-analysis.js --symbol TSLA # Single symbol
 */

const {
    getDb, extractFactors, calcWinRate, pearsonR2,
    COLORS, fmtWR, fmtPct, printHeader, printRow, hasFlag, getArg
} = require('./lib/audit-utils');

const args = process.argv.slice(2);
const SECTION = getArg(args, '--section', null);
const SYMBOL_FILTER = getArg(args, '--symbol', null);
const MIN_SAMPLE = 5;

// ─── Data Loading ────────────────────────────────────────────────────────────

/**
 * Classify flow type from opportunities data.
 * Returns: 'call_heavy', 'put_heavy', 'balanced', 'unknown'
 */
function classifyFlow(row) {
    // Use call_put_ratio if available
    if (row.call_put_ratio !== null && row.call_put_ratio > 0) {
        if (row.call_put_ratio >= 2.0) return 'call_heavy';
        if (row.call_put_ratio <= 0.5) return 'put_heavy';
        return 'balanced';
    }

    // Fall back to direction
    if (row.direction === 'bullish') return 'call_heavy';
    if (row.direction === 'bearish') return 'put_heavy';
    return 'balanced';
}

/**
 * Check if flow has unusual activity (high vol/OI).
 */
function hasUnusualFlow(row) {
    return row.vol_oi_ratio !== null && row.vol_oi_ratio >= 5.0;
}

/**
 * Classify vol/OI tier.
 */
function volOiTier(ratio) {
    if (ratio === null || ratio === 0) return 'none';
    if (ratio < 2) return '0-2x';
    if (ratio < 5) return '2-5x';
    if (ratio < 10) return '5-10x';
    return '10x+';
}

/**
 * Classify premium tier.
 */
function premiumTier(netPremium) {
    if (netPremium === null) return 'unknown';
    const abs = Math.abs(netPremium);
    if (abs < 1000000) return '<$1M';
    if (abs < 5000000) return '$1-5M';
    if (abs < 10000000) return '$5-10M';
    return '$10M+';
}

function loadFlowObservations(db) {
    // Deduplicate opportunities: one row per symbol-day, peak opportunity_score
    const rows = db.prepare(`
        WITH opp_deduped AS (
            SELECT o.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY o.symbol, date(o.timestamp)
                       ORDER BY o.opportunity_score DESC, COALESCE(o.vol_oi_ratio, 0) DESC, o.id ASC
                   ) as rn
            FROM opportunities o
            ${SYMBOL_FILTER ? 'WHERE o.symbol = ?' : ''}
        )
        SELECT od.symbol, date(od.timestamp) as scan_date,
               od.price, od.vol_oi_ratio, od.unusual_activity,
               od.direction, od.call_put_ratio, od.net_premium,
               od.iv_percentile, od.rsi, od.signals as opp_signals,
               od.opportunity_score, od.tier as opp_tier,
               od.call_volume, od.put_volume,
               a.return_1d, a.return_3d, a.return_5d,
               a.max_gain_5d, a.max_drawdown_5d
        FROM opp_deduped od
        LEFT JOIN audit_returns a ON od.symbol = a.symbol AND date(od.timestamp) = a.date
        WHERE od.rn = 1 AND a.return_1d IS NOT NULL
    `).all(SYMBOL_FILTER ? [SYMBOL_FILTER] : []);

    return rows.map(r => ({
        ...r,
        flow_type: classifyFlow(r),
        unusual: hasUnusualFlow(r),
        vol_oi_tier: volOiTier(r.vol_oi_ratio),
        premium_tier: premiumTier(r.net_premium),
    }));
}

function loadTechnicalContext(db) {
    const lookup = new Map();

    // Source 3 (lowest priority): scanner_history with signals_json
    const shRows = db.prepare(`
        SELECT symbol, date as scan_date,
               peak_zone as zone, peak_score as score,
               peak_direction as bh_direction, NULL as bh_tier,
               rsi_eod as bh_rsi, NULL as bb_position, trend,
               peak_signals_json as signals_json,
               NULL as ma_bounce_json, NULL as divergence_bb_json
        FROM scanner_history
        WHERE peak_signals_json IS NOT NULL AND peak_signals_json != ''
    `).all();
    for (const r of shRows) {
        lookup.set(`${r.symbol}:${r.scan_date}`, {
            ...r, factors: extractFactors(r.signals_json),
        });
    }

    // Source 2 (overrides scanner_history): signals table
    const sigRows = db.prepare(`
        SELECT symbol, date(timestamp) as scan_date,
               zone, score, direction as bh_direction, tier as bh_tier,
               NULL as bh_rsi, NULL as bb_position, NULL as trend,
               signals_json, NULL as ma_bounce_json, NULL as divergence_bb_json
        FROM signals
    `).all();
    for (const r of sigRows) {
        lookup.set(`${r.symbol}:${r.scan_date}`, {
            ...r, factors: extractFactors(r.signals_json),
        });
    }

    // Source 1 (highest priority): bloodhound_results — most complete data
    const bhRows = db.prepare(`
        WITH deduped AS (
            SELECT r.*, s.timestamp as scan_timestamp,
                   ROW_NUMBER() OVER (
                       PARTITION BY r.symbol, date(s.timestamp)
                       ORDER BY r.score DESC, r.id ASC
                   ) as rn
            FROM bloodhound_results r
            JOIN bloodhound_scans s ON r.scan_id = s.id
        )
        SELECT d.symbol, date(d.scan_timestamp) as scan_date,
               d.zone, d.score, d.direction as bh_direction, d.tier as bh_tier,
               d.rsi as bh_rsi, d.bb_position, d.trend,
               d.signals_json, d.ma_bounce_json, d.divergence_bb_json
        FROM deduped d
        WHERE d.rn = 1
    `).all();
    for (const r of bhRows) {
        lookup.set(`${r.symbol}:${r.scan_date}`, {
            ...r, factors: extractFactors(r.signals_json),
        });
    }

    return lookup;
}

// ─── Section 1: Flow Type Win Rates ──────────────────────────────────────────

function section1_flowTypeWR(obs) {
    printHeader('Section 1: Flow Type Win Rates');

    const baseline = calcWinRate(obs.map(o => o.return_5d).filter(r => r !== null));
    console.log(`  All flow observations: ${obs.length}, 5d baseline: ${fmtWR(baseline.wr, baseline.count)}\n`);

    const types = ['call_heavy', 'put_heavy', 'balanced'];

    const widths = [16, 8, 14, 14, 14, 10];
    printRow(['Flow Type', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['──────────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const type of types) {
        const matching = obs.filter(o => o.flow_type === type);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            type, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // Unusual vs non-unusual
    console.log(`\n  ${COLORS.bold}Unusual Activity (vol/OI >= 5x):${COLORS.reset}`);
    const unusual = obs.filter(o => o.unusual);
    const normal = obs.filter(o => !o.unusual);

    for (const [label, group] of [['Unusual (5x+)', unusual], ['Normal (<5x)', normal]]) {
        const wr5d = calcWinRate(group.map(o => o.return_5d).filter(r => r !== null));
        const wr1d = calcWinRate(group.map(o => o.return_1d).filter(r => r !== null));
        printRow([
            label, group.length,
            fmtWR(wr1d.wr, wr1d.count),
            '', // skip 3d
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }
}

// ─── Section 2: Flow × Technical Level ───────────────────────────────────────

function section2_flowTechCross(obs, techLookup) {
    printHeader('Section 2: Flow × Technical Level (THE KEY QUESTION)');

    // Enrich flow with technical context
    const enriched = obs.map(o => {
        const tech = techLookup.get(`${o.symbol}:${o.scan_date}`);
        return { ...o, tech };
    }).filter(o => o.tech);

    console.log(`  Flow observations with technical context: ${enriched.length}\n`);

    if (enriched.length < 10) {
        console.log('  Insufficient cross-reference data. Skipping.\n');
        return;
    }

    // Define technical conditions
    const techConditions = [
        { label: 'Lower BB', filter: o => o.tech.bb_position !== null && o.tech.bb_position <= 0.15 },
        { label: 'RSI Oversold', filter: o => o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30 },
        { label: 'At Put Wall', filter: o => o.tech.factors.has('AT_PUT_WALL') },
        { label: 'At Call Wall', filter: o => o.tech.factors.has('AT_CALL_WALL') },
        { label: 'RSI Overbought', filter: o => o.tech.bh_rsi !== null && o.tech.bh_rsi >= 70 },
        { label: 'Upper BB', filter: o => o.tech.bb_position !== null && o.tech.bb_position >= 0.85 },
        { label: 'Wall Engaged', filter: o => o.tech.factors.has('WALL_ENGAGED') },
        { label: 'Volume Spike', filter: o => o.tech.factors.has('VOLUME_SPIKE') },
        { label: 'Near SMA 50', filter: o => o.tech.factors.has('NEAR_SMA50') },
        { label: 'MA Bounce', filter: o => o.tech.factors.has('MA_BOUNCE') },
        { label: 'Divergence BB', filter: o => o.tech.factors.has('DIVERGENCE_BB') },
    ];

    const flowTypes = ['call_heavy', 'put_heavy', 'balanced'];

    const widths = [16, 16, 6, 14, 14, 10];
    printRow(['Flow Type', 'Tech Condition', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['──────────────', '──────────────', '────', '────────────', '────────────', '────────'], widths);

    for (const cond of techConditions) {
        for (const flowType of flowTypes) {
            const matching = enriched.filter(o =>
                o.flow_type === flowType && cond.filter(o)
            );
            if (matching.length < 3) continue;

            const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
            const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

            printRow([
                flowType, cond.label, matching.length,
                fmtWR(wr3d.wr, wr3d.count),
                fmtWR(wr5d.wr, wr5d.count),
                fmtPct(wr5d.avg),
            ], widths);
        }
        // blank line between conditions
        console.log('');
    }

    // Multi-factor stacks: flow + 2 technical conditions
    console.log(`  ${COLORS.bold}Triple Confluence: Flow + 2 Technical Conditions${COLORS.reset}\n`);

    const tripleWidths = [16, 36, 6, 14, 10];
    printRow(['Flow Type', 'Technical Stack', 'N', '5d WR', 'Avg 5d'], tripleWidths);
    printRow(['──────────────', '──────────────────────────────────', '────', '────────────', '────────'], tripleWidths);

    for (let i = 0; i < techConditions.length; i++) {
        for (let j = i + 1; j < techConditions.length; j++) {
            for (const flowType of flowTypes) {
                const matching = enriched.filter(o =>
                    o.flow_type === flowType &&
                    techConditions[i].filter(o) &&
                    techConditions[j].filter(o)
                );
                if (matching.length < 3) continue;

                const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

                printRow([
                    flowType,
                    `${techConditions[i].label} + ${techConditions[j].label}`,
                    matching.length,
                    fmtWR(wr5d.wr, wr5d.count),
                    fmtPct(wr5d.avg),
                ], tripleWidths);
            }
        }
    }
}

// ─── Section 3: Vol/OI Ratio Tiers ───────────────────────────────────────────

function section3_volOiTiers(obs) {
    printHeader('Section 3: Vol/OI Ratio Effectiveness');

    const tiers = ['none', '0-2x', '2-5x', '5-10x', '10x+'];

    const widths = [12, 8, 14, 14, 14, 10];
    printRow(['Vol/OI', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['──────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const tier of tiers) {
        const matching = obs.filter(o => o.vol_oi_tier === tier);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            tier, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // Vol/OI × Flow Type
    console.log(`\n  ${COLORS.bold}Vol/OI × Flow Type:${COLORS.reset}`);
    const widths2 = [12, 14, 8, 14, 10];
    printRow(['Vol/OI', 'Flow Type', 'N', '5d WR', 'Avg 5d'], widths2);
    printRow(['──────────', '────────────', '──────', '────────────', '────────'], widths2);

    for (const tier of ['5-10x', '10x+']) {
        for (const ft of ['call_heavy', 'put_heavy', 'balanced']) {
            const matching = obs.filter(o => o.vol_oi_tier === tier && o.flow_type === ft);
            if (matching.length < 3) continue;

            const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
            printRow([tier, ft, matching.length, fmtWR(wr5d.wr, wr5d.count), fmtPct(wr5d.avg)], widths2);
        }
    }
}

// ─── Section 4: Premium Magnitude ────────────────────────────────────────────

function section4_premium(obs) {
    printHeader('Section 4: Net Premium Magnitude');

    const tiers = ['<$1M', '$1-5M', '$5-10M', '$10M+'];

    const widths = [12, 8, 14, 14, 14, 10];
    printRow(['Premium', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['──────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const tier of tiers) {
        const matching = obs.filter(o => o.premium_tier === tier);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            tier, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }
}

// ─── Section 5: IV Percentile ────────────────────────────────────────────────

function section5_iv(obs) {
    printHeader('Section 5: IV Percentile at Entry');

    const buckets = [
        { label: 'Low IV (0-20)', min: 0, max: 20 },
        { label: 'Med-Low (20-50)', min: 20, max: 50 },
        { label: 'Med-High (50-80)', min: 50, max: 80 },
        { label: 'High IV (80+)', min: 80, max: 100 },
    ];

    const widths = [18, 8, 14, 14, 14, 10];
    printRow(['IV Percentile', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const bucket of buckets) {
        const matching = obs.filter(o =>
            o.iv_percentile !== null &&
            o.iv_percentile >= bucket.min && o.iv_percentile < bucket.max
        );
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            bucket.label, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }
}

// ─── Section 6: Call Flow Deep Dive ──────────────────────────────────────────

function section6_callDeepDive(obs) {
    printHeader('Section 6: Call Flow Deep Dive (Contrarian Analysis)');

    const callObs = obs.filter(o => o.flow_type === 'call_heavy');
    const nonCallObs = obs.filter(o => o.flow_type !== 'call_heavy');

    const callWR = calcWinRate(callObs.map(o => o.return_5d).filter(r => r !== null));
    const nonCallWR = calcWinRate(nonCallObs.map(o => o.return_5d).filter(r => r !== null));

    console.log(`  Call-heavy flow: ${fmtWR(callWR.wr, callWR.count)}, avg ${fmtPct(callWR.avg)}`);
    console.log(`  Non-call flow:   ${fmtWR(nonCallWR.wr, nonCallWR.count)}, avg ${fmtPct(nonCallWR.avg)}\n`);

    // By vol/OI threshold
    console.log(`  ${COLORS.bold}Call flow by vol/OI threshold:${COLORS.reset}`);
    const thresholds = [
        { label: 'All calls', filter: o => true },
        { label: 'Vol/OI >= 5x', filter: o => o.vol_oi_ratio >= 5 },
        { label: 'Vol/OI >= 10x', filter: o => o.vol_oi_ratio >= 10 },
        { label: 'Vol/OI >= 20x', filter: o => o.vol_oi_ratio >= 20 },
    ];

    const widths = [18, 8, 14, 14, 10];
    printRow(['Threshold', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────', '──────', '────────────', '────────────', '────────'], widths);

    for (const t of thresholds) {
        const matching = callObs.filter(o => t.filter(o));
        if (matching.length < MIN_SAMPLE) continue;

        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([t.label, matching.length, fmtWR(wr3d.wr, wr3d.count), fmtWR(wr5d.wr, wr5d.count), fmtPct(wr5d.avg)], widths);
    }

    // Call flow by RSI bucket
    console.log(`\n  ${COLORS.bold}Call flow by RSI at entry:${COLORS.reset}`);
    const rsiBuckets = [
        { label: 'Oversold (<30)', filter: o => o.rsi !== null && o.rsi < 30 },
        { label: 'Neutral (30-70)', filter: o => o.rsi !== null && o.rsi >= 30 && o.rsi <= 70 },
        { label: 'Overbought (>70)', filter: o => o.rsi !== null && o.rsi > 70 },
    ];

    printRow(['RSI Bucket', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────', '──────', '────────────', '────────────', '────────'], widths);

    for (const b of rsiBuckets) {
        const matching = callObs.filter(o => b.filter(o));
        if (matching.length < 3) continue;

        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([b.label, matching.length, fmtWR(wr3d.wr, wr3d.count), fmtWR(wr5d.wr, wr5d.count), fmtPct(wr5d.avg)], widths);
    }
}

// ─── Section 7: Pattern Hunt ─────────────────────────────────────────────────

function section7_patternHunt(obs, techLookup) {
    printHeader('Section 7: Specific Pattern Hunt');

    const enriched = obs.map(o => {
        const tech = techLookup.get(`${o.symbol}:${o.scan_date}`);
        return { ...o, tech };
    }).filter(o => o.tech);

    // Pattern: Flow at lower BB + oversold RSI
    const patterns = [
        {
            name: 'Call flow + Lower BB + RSI Oversold',
            filter: o => o.flow_type === 'call_heavy' &&
                         o.tech.bb_position !== null && o.tech.bb_position <= 0.15 &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30
        },
        {
            name: 'Put flow + Lower BB + RSI Oversold',
            filter: o => o.flow_type === 'put_heavy' &&
                         o.tech.bb_position !== null && o.tech.bb_position <= 0.15 &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30
        },
        {
            name: 'Call flow + At Put Wall + RSI Oversold',
            filter: o => o.flow_type === 'call_heavy' &&
                         o.tech.factors.has('AT_PUT_WALL') &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30
        },
        {
            name: 'Put flow + At Put Wall + RSI Oversold',
            filter: o => o.flow_type === 'put_heavy' &&
                         o.tech.factors.has('AT_PUT_WALL') &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30
        },
        {
            name: 'Call flow + Lower BB + Near SMA 50',
            filter: o => o.flow_type === 'call_heavy' &&
                         o.tech.bb_position !== null && o.tech.bb_position <= 0.15 &&
                         o.tech.factors.has('NEAR_SMA50')
        },
        {
            name: 'Call flow + RSI Oversold + MA Bounce',
            filter: o => o.flow_type === 'call_heavy' &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30 &&
                         o.tech.factors.has('MA_BOUNCE')
        },
        {
            name: 'Any flow + Lower BB + RSI Oversold + Wall Engaged',
            filter: o => o.unusual &&
                         o.tech.bb_position !== null && o.tech.bb_position <= 0.15 &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30 &&
                         o.tech.factors.has('WALL_ENGAGED')
        },
        {
            name: 'No unusual flow + Lower BB + RSI Oversold',
            filter: o => !o.unusual &&
                         o.tech.bb_position !== null && o.tech.bb_position <= 0.15 &&
                         o.tech.bh_rsi !== null && o.tech.bh_rsi <= 30
        },
    ];

    for (const pattern of patterns) {
        const matching = enriched.filter(pattern.filter);
        if (matching.length === 0) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        console.log(`\n  ${COLORS.bold}${pattern.name}${COLORS.reset}`);
        console.log(`  N=${matching.length}  1d: ${fmtWR(wr1d.wr, wr1d.count)}  3d: ${fmtWR(wr3d.wr, wr3d.count)}  5d: ${fmtWR(wr5d.wr, wr5d.count)}  avg: ${fmtPct(wr5d.avg)}`);

        // Show individual observations
        if (matching.length <= 15) {
            for (const m of matching) {
                const ret1 = m.return_1d !== null ? `${m.return_1d >= 0 ? '+' : ''}${m.return_1d.toFixed(2)}%` : '—';
                const ret5 = m.return_5d !== null ? `${m.return_5d >= 0 ? '+' : ''}${m.return_5d.toFixed(2)}%` : '—';
                console.log(`    ${m.scan_date} ${m.symbol.padEnd(6)} $${m.price.toFixed(2).padStart(8)} RSI:${(m.tech.bh_rsi||0).toFixed(0)} BB:${(m.tech.bb_position||0).toFixed(2)} vol/OI:${(m.vol_oi_ratio||0).toFixed(1)}x  1d:${ret1.padStart(8)} 5d:${ret5.padStart(8)}`);
            }
        }
    }

    // TSLA-specific hunt
    console.log(`\n\n  ${COLORS.bold}${COLORS.cyan}TSLA-Specific Patterns:${COLORS.reset}`);
    const tslaObs = enriched.filter(o => o.symbol === 'TSLA');
    if (tslaObs.length > 0) {
        console.log(`  Total TSLA observations: ${tslaObs.length}`);

        // TSLA with any flow + technical setup
        const tslaSetups = [
            { name: 'TSLA + call flow + lower BB', filter: o => o.flow_type === 'call_heavy' && o.tech.bb_position <= 0.2 },
            { name: 'TSLA + call flow + RSI < 40', filter: o => o.flow_type === 'call_heavy' && o.tech.bh_rsi <= 40 },
            { name: 'TSLA + put flow + lower BB', filter: o => o.flow_type === 'put_heavy' && o.tech.bb_position <= 0.2 },
            { name: 'TSLA + any unusual flow', filter: o => o.unusual },
        ];

        for (const setup of tslaSetups) {
            const matching = tslaObs.filter(setup.filter);
            if (matching.length === 0) continue;

            const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
            console.log(`  ${setup.name}: n=${matching.length}, 1d WR: ${fmtWR(wr1d.wr, wr1d.count)}`);
            for (const m of matching) {
                const ret1 = m.return_1d !== null ? `${m.return_1d >= 0 ? '+' : ''}${m.return_1d.toFixed(2)}%` : '—';
                console.log(`    ${m.scan_date} $${m.price.toFixed(2)} RSI:${(m.tech.bh_rsi||0).toFixed(0)} BB:${(m.tech.bb_position||0).toFixed(2)} vol/OI:${(m.vol_oi_ratio||0).toFixed(1)}x  → ${ret1}`);
            }
        }
    } else {
        console.log(`  No TSLA observations with both flow + technical data.`);
    }

    // AAPL-specific hunt
    console.log(`\n  ${COLORS.bold}${COLORS.cyan}AAPL-Specific Patterns:${COLORS.reset}`);
    const aaplObs = enriched.filter(o => o.symbol === 'AAPL');
    if (aaplObs.length > 0) {
        console.log(`  Total AAPL observations: ${aaplObs.length}`);
        for (const m of aaplObs.slice(0, 10)) {
            const ret1 = m.return_1d !== null ? `${m.return_1d >= 0 ? '+' : ''}${m.return_1d.toFixed(2)}%` : '—';
            const ret5 = m.return_5d !== null ? `${m.return_5d >= 0 ? '+' : ''}${m.return_5d.toFixed(2)}%` : '—';
            console.log(`    ${m.scan_date} $${m.price.toFixed(2)} RSI:${(m.tech.bh_rsi||0).toFixed(0)} BB:${(m.tech.bb_position||0).toFixed(2)} flow:${m.flow_type} vol/OI:${(m.vol_oi_ratio||0).toFixed(1)}x  1d:${ret1.padStart(8)} 5d:${ret5.padStart(8)}`);
        }
    }
}

// ─── Section 8: Opportunity Tier Performance ─────────────────────────────────

function section8_oppTiers(obs) {
    printHeader('Section 8: Opportunity Scanner Tier Performance');

    const tiers = ['HIGH_CONVICTION', 'TRADEABLE', 'WATCH', 'FILTERED'];

    const widths = [18, 8, 14, 14, 14, 10, 10];
    printRow(['Tier', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d', 'AvgScore'], widths);
    printRow(['────────────────', '──────', '────────────', '────────────', '────────────', '────────', '────────'], widths);

    for (const tier of tiers) {
        const matching = obs.filter(o => o.opp_tier === tier);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
        const avgScore = matching.reduce((s, o) => s + (o.opportunity_score || 0), 0) / matching.length;

        printRow([
            tier, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
            avgScore.toFixed(0),
        ], widths);
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
    const db = getDb();

    // Check prerequisite
    const auditCount = db.prepare('SELECT COUNT(*) as cnt FROM audit_returns').get().cnt;
    if (auditCount === 0) {
        console.error('ERROR: audit_returns table is empty. Run audit-build-returns.js first.');
        process.exit(1);
    }

    printHeader('FLOW ANALYSIS — Options Flow Effectiveness (Full Dataset)');
    if (SYMBOL_FILTER) console.log(`  ${COLORS.bold}Filtered to: ${SYMBOL_FILTER}${COLORS.reset}`);

    const obs = loadFlowObservations(db);
    console.log(`  Flow observations: ${COLORS.bold}${obs.length}${COLORS.reset} (deduplicated symbol-days)`);
    console.log(`  With vol/OI data: ${obs.filter(o => o.vol_oi_ratio !== null).length}`);
    console.log(`  With premium data: ${obs.filter(o => o.net_premium !== null).length}`);
    console.log(`  With IV data: ${obs.filter(o => o.iv_percentile !== null).length}`);

    const techLookup = loadTechnicalContext(db);
    const crossCount = obs.filter(o => techLookup.has(`${o.symbol}:${o.scan_date}`)).length;
    console.log(`  Cross-referenced with technicals: ${crossCount}`);

    // Flow type distribution
    const ftDist = {};
    for (const o of obs) { ftDist[o.flow_type] = (ftDist[o.flow_type] || 0) + 1; }
    console.log(`  Flow distribution: ${Object.entries(ftDist).map(([k, v]) => `${k}=${v}`).join(', ')}`);

    const sections = [
        { id: '1', fn: () => section1_flowTypeWR(obs) },
        { id: '2', fn: () => section2_flowTechCross(obs, techLookup) },
        { id: '3', fn: () => section3_volOiTiers(obs) },
        { id: '4', fn: () => section4_premium(obs) },
        { id: '5', fn: () => section5_iv(obs) },
        { id: '6', fn: () => section6_callDeepDive(obs) },
        { id: '7', fn: () => section7_patternHunt(obs, techLookup) },
        { id: '8', fn: () => section8_oppTiers(obs) },
    ];

    for (const section of sections) {
        if (SECTION && section.id !== SECTION) continue;
        section.fn();
    }

    console.log(`\n${COLORS.dim}  Analysis complete. ${obs.length} flow observations across ${new Set(obs.map(o => o.symbol)).size} symbols.${COLORS.reset}\n`);
}

main();
