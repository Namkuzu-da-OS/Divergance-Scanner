#!/usr/bin/env node

/**
 * AUDIT: Factor Win Rate Analysis
 *
 * Parses signals_json from ALL bloodhound_results (not just 106 signals),
 * joins with audit_returns for forward returns, computes win rates for
 * every factor, combo, zone, time bucket, and score band.
 *
 * Prerequisites: Run audit-build-returns.js first.
 *
 * Usage:
 *   node scripts/audit-factor-analysis.js              # Full report
 *   node scripts/audit-factor-analysis.js --section 1  # Specific section only
 *   node scripts/audit-factor-analysis.js --symbol TSLA # Single symbol deep dive
 */

const {
    getDb, extractFactors, getActiveFactors, calcWinRate, pearsonR2,
    COLORS, fmtWR, fmtPct, printHeader, printRow, hasFlag, getArg
} = require('./lib/audit-utils');

const args = process.argv.slice(2);
const SECTION = getArg(args, '--section', null);
const SYMBOL_FILTER = getArg(args, '--symbol', null);
const MIN_SAMPLE = 5; // minimum observations for a factor to be reported

// ─── Data Loading ────────────────────────────────────────────────────────────

function loadObservations(db) {
    const params = SYMBOL_FILTER ? { sym: SYMBOL_FILTER } : {};
    const symWhere = SYMBOL_FILTER ? 'WHERE r.symbol = @sym' : '';
    const symWhereAnd = SYMBOL_FILTER ? 'AND symbol = @sym' : '';

    // Source 1: bloodhound_results (most complete — has RSI, BB, sector RS, etc.)
    const bhRows = db.prepare(`
        SELECT r.symbol, date(s.timestamp) as scan_date,
               r.price, r.zone, r.score, r.direction, r.tier,
               r.signals_json, r.rsi, r.bb_position, r.trend,
               s.spy_trend, s.vix,
               r.sector_rs_percentile, r.sector_etf,
               CAST(strftime('%H', s.timestamp) AS INTEGER) as scan_hour_utc,
               1 as source_priority
        FROM bloodhound_results r
        JOIN bloodhound_scans s ON r.scan_id = s.id
        ${symWhere}
    `).all(params);

    // Source 2: signals table (HC/TRADEABLE with full signals_json, Jan 20+)
    const sigRows = db.prepare(`
        SELECT symbol, date(timestamp) as scan_date,
               entry_price as price, zone, score, direction, tier,
               signals_json, NULL as rsi, NULL as bb_position, NULL as trend,
               spy_trend, vix,
               NULL as sector_rs_percentile, NULL as sector_etf,
               CAST(strftime('%H', timestamp) AS INTEGER) as scan_hour_utc,
               2 as source_priority
        FROM signals
        ${SYMBOL_FILTER ? 'WHERE symbol = @sym' : ''}
    `).all(params);

    // Source 3: scanner_history WITH signals_json (Feb 3+)
    const shSignals = db.prepare(`
        SELECT symbol, date as scan_date,
               CASE WHEN close_price > 10 THEN close_price ELSE NULL END as price,
               peak_zone as zone, peak_score as score,
               peak_direction as direction, NULL as tier,
               peak_signals_json as signals_json, rsi_eod as rsi,
               NULL as bb_position, trend,
               spy_trend, vix,
               NULL as sector_rs_percentile, NULL as sector_etf,
               CAST(strftime('%H', COALESCE(first_seen, date || 'T12:00:00Z')) AS INTEGER) as scan_hour_utc,
               3 as source_priority
        FROM scanner_history
        WHERE peak_signals_json IS NOT NULL AND peak_signals_json != ''
        ${symWhereAnd}
    `).all(params);

    // Source 4: scanner_history WITHOUT signals_json (Jan 12 - Feb 2, score/zone/RSI only)
    const shNoSignals = db.prepare(`
        SELECT symbol, date as scan_date,
               CASE WHEN close_price > 10 THEN close_price ELSE NULL END as price,
               peak_zone as zone, peak_score as score,
               peak_direction as direction, NULL as tier,
               NULL as signals_json, rsi_eod as rsi,
               NULL as bb_position, trend,
               spy_trend, vix,
               NULL as sector_rs_percentile, NULL as sector_etf,
               CAST(strftime('%H', COALESCE(first_seen, date || 'T12:00:00Z')) AS INTEGER) as scan_hour_utc,
               4 as source_priority
        FROM scanner_history
        WHERE (peak_signals_json IS NULL OR peak_signals_json = '')
        ${symWhereAnd}
    `).all(params);

    // Merge all sources
    const allRows = [...bhRows, ...sigRows, ...shSignals, ...shNoSignals];

    // Dedup: one row per symbol-day, prefer most complete source then highest score
    const bySymbolDate = new Map();
    for (const row of allRows) {
        const key = `${row.symbol}:${row.scan_date}`;
        const existing = bySymbolDate.get(key);
        if (!existing ||
            row.source_priority < existing.source_priority ||
            (row.source_priority === existing.source_priority && row.score > existing.score)) {
            bySymbolDate.set(key, row);
        }
    }

    // Join with audit_returns
    const getReturns = db.prepare(`
        SELECT return_1d, return_3d, return_5d, max_gain_5d, max_drawdown_5d
        FROM audit_returns WHERE symbol = ? AND date = ?
    `);

    const obs = [];
    const sourceCounts = { bloodhound: 0, signals: 0, scanner_signals: 0, scanner_basic: 0 };
    const sourceNames = { 1: 'bloodhound', 2: 'signals', 3: 'scanner_signals', 4: 'scanner_basic' };

    for (const row of bySymbolDate.values()) {
        const returns = getReturns.get(row.symbol, row.scan_date);
        if (!returns || returns.return_1d === null) continue;

        sourceCounts[sourceNames[row.source_priority]]++;
        obs.push({
            ...row,
            ...returns,
            factors: extractFactors(row.signals_json),
            scan_hour_et: (row.scan_hour_utc - 5 + 24) % 24,
            has_signals: row.signals_json !== null && row.signals_json !== '',
        });
    }

    // Report source breakdown
    console.log(`  Sources: bloodhound=${sourceCounts.bloodhound}, signals=${sourceCounts.signals}, scanner(signals)=${sourceCounts.scanner_signals}, scanner(basic)=${sourceCounts.scanner_basic}`);

    return obs;
}

// ─── Section 1: Individual Factor Win Rates ──────────────────────────────────

function section1_factorWR(obs) {
    printHeader('Section 1: Individual Factor Win Rates');

    const factors = getActiveFactors(obs);
    const baseline = calcWinRate(obs.map(o => o.return_5d).filter(r => r !== null));

    console.log(`  Baseline (all ${baseline.count} obs): 5d WR = ${fmtWR(baseline.wr, baseline.count)}, avg = ${fmtPct(baseline.avg)}\n`);

    const widths = [24, 8, 14, 14, 14, 10, 10];
    printRow(['Factor', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d', 'Edge'], widths);
    printRow(['─'.repeat(22), '──────', '────────────', '────────────', '────────────', '────────', '────────'], widths);

    const results = [];
    for (const factor of factors) {
        const matching = obs.filter(o => o.factors.has(factor));
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null), 'bullish');
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null), 'bullish');
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null), 'bullish');

        const edge = wr5d.wr - baseline.wr;
        results.push({ factor, n: matching.length, wr1d, wr3d, wr5d, edge });
    }

    // Sort by 5d WR descending
    results.sort((a, b) => b.wr5d.wr - a.wr5d.wr);

    for (const r of results) {
        printRow([
            r.factor,
            r.n,
            fmtWR(r.wr1d.wr, r.wr1d.count),
            fmtWR(r.wr3d.wr, r.wr3d.count),
            fmtWR(r.wr5d.wr, r.wr5d.count),
            fmtPct(r.wr5d.avg),
            fmtPct(r.edge),
        ], widths);
    }

    // Also show factors with < MIN_SAMPLE (low data)
    const lowData = factors.filter(f => {
        const n = obs.filter(o => o.factors.has(f)).length;
        return n > 0 && n < MIN_SAMPLE;
    });
    if (lowData.length > 0) {
        console.log(`\n  ${COLORS.dim}Low sample (n<${MIN_SAMPLE}): ${lowData.join(', ')}${COLORS.reset}`);
    }

    return results;
}

// ─── Section 2: 2-Factor Combos ──────────────────────────────────────────────

function section2_combos(obs) {
    printHeader('Section 2: 2-Factor Combo Win Rates (n >= 5)');

    // Only test factors that appear at least 10 times individually
    const factors = getActiveFactors(obs).filter(f =>
        obs.filter(o => o.factors.has(f)).length >= 10
    );

    const baseline = calcWinRate(obs.map(o => o.return_5d).filter(r => r !== null));
    const results = [];

    for (let i = 0; i < factors.length; i++) {
        for (let j = i + 1; j < factors.length; j++) {
            const a = factors[i], b = factors[j];
            const matching = obs.filter(o => o.factors.has(a) && o.factors.has(b));
            if (matching.length < MIN_SAMPLE) continue;

            const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null), 'bullish');
            const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null), 'bullish');
            results.push({
                combo: `${a} + ${b}`,
                n: matching.length,
                wr3d, wr5d,
                edge: wr5d.wr - baseline.wr
            });
        }
    }

    results.sort((a, b) => b.wr5d.wr - a.wr5d.wr);

    const widths = [46, 8, 14, 14, 10];
    printRow(['Combo', 'N', '3d WR', '5d WR', 'Edge'], widths);
    printRow(['─'.repeat(44), '──────', '────────────', '────────────', '────────'], widths);

    // Show top 25
    for (const r of results.slice(0, 25)) {
        printRow([
            r.combo,
            r.n,
            fmtWR(r.wr3d.wr, r.wr3d.count),
            fmtWR(r.wr5d.wr, r.wr5d.count),
            fmtPct(r.edge),
        ], widths);
    }

    // Show bottom 10 (worst combos)
    if (results.length > 25) {
        console.log(`\n  ${COLORS.bold}Worst combos:${COLORS.reset}`);
        for (const r of results.slice(-10)) {
            printRow([
                r.combo,
                r.n,
                fmtWR(r.wr3d.wr, r.wr3d.count),
                fmtWR(r.wr5d.wr, r.wr5d.count),
                fmtPct(r.edge),
            ], widths);
        }
    }

    return results;
}

// ─── Section 3: 3-Factor Combos ──────────────────────────────────────────────

function section3_triples(obs) {
    printHeader('Section 3: 3-Factor Combo Win Rates (n >= 3)');

    // Only factors with 15+ individual appearances
    const factors = getActiveFactors(obs).filter(f =>
        obs.filter(o => o.factors.has(f)).length >= 15
    );

    const baseline = calcWinRate(obs.map(o => o.return_5d).filter(r => r !== null));
    const results = [];

    for (let i = 0; i < factors.length; i++) {
        for (let j = i + 1; j < factors.length; j++) {
            for (let k = j + 1; k < factors.length; k++) {
                const a = factors[i], b = factors[j], c = factors[k];
                const matching = obs.filter(o =>
                    o.factors.has(a) && o.factors.has(b) && o.factors.has(c)
                );
                if (matching.length < 3) continue;

                const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null), 'bullish');
                results.push({
                    combo: `${a} + ${b} + ${c}`,
                    n: matching.length,
                    wr5d,
                    edge: wr5d.wr - baseline.wr
                });
            }
        }
    }

    results.sort((a, b) => b.wr5d.wr - a.wr5d.wr);

    const widths = [62, 6, 14, 10];
    printRow(['Triple Combo', 'N', '5d WR', 'Edge'], widths);
    printRow(['─'.repeat(60), '────', '────────────', '────────'], widths);

    for (const r of results.slice(0, 15)) {
        printRow([
            r.combo,
            r.n,
            fmtWR(r.wr5d.wr, r.wr5d.count),
            fmtPct(r.edge),
        ], widths);
    }

    return results;
}

// ─── Section 4: Score vs Returns ─────────────────────────────────────────────

function section4_scoreCorrelation(obs) {
    printHeader('Section 4: Score vs Returns Correlation');

    // R² calculation
    const pairs = obs.filter(o => o.return_5d !== null);
    const scores = pairs.map(o => o.score);
    const returns = pairs.map(o => o.return_5d);
    const r2 = pearsonR2(scores, returns);

    console.log(`  R² (score → 5d return): ${COLORS.bold}${r2.toFixed(4)}${COLORS.reset}`);
    console.log(`  Interpretation: ${r2 < 0.01 ? 'No correlation' : r2 < 0.05 ? 'Very weak' : r2 < 0.1 ? 'Weak' : 'Moderate'}\n`);

    // Score bands
    const bands = [
        { label: '0-19', min: 0, max: 19 },
        { label: '20-34', min: 20, max: 34 },
        { label: '35-49', min: 35, max: 49 },
        { label: '50-69', min: 50, max: 69 },
        { label: '70+', min: 70, max: 100 },
    ];

    const widths = [10, 8, 14, 14, 14, 10, 10];
    printRow(['Score', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d', 'MaxGain'], widths);
    printRow(['────────', '──────', '────────────', '────────────', '────────────', '────────', '────────'], widths);

    for (const band of bands) {
        const matching = obs.filter(o => o.score >= band.min && o.score <= band.max);
        if (matching.length === 0) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
        const avgMaxGain = matching.filter(o => o.max_gain_5d !== null).reduce((s, o) => s + o.max_gain_5d, 0) / matching.length;

        printRow([
            band.label,
            matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
            fmtPct(avgMaxGain),
        ], widths);
    }
}

// ─── Section 5: Zone Analysis ────────────────────────────────────────────────

function section5_zones(obs) {
    printHeader('Section 5: Zone Win Rates');

    const zones = [...new Set(obs.map(o => o.zone))].sort();

    const widths = [18, 8, 14, 14, 14, 10];
    printRow(['Zone', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const zone of zones) {
        const matching = obs.filter(o => o.zone === zone);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            zone,
            matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // Zone × Direction cross-tab
    console.log(`\n  ${COLORS.bold}Zone × Direction:${COLORS.reset}`);
    const directions = [...new Set(obs.map(o => o.direction))].sort();
    const widths2 = [18, 10, 8, 14, 10];
    printRow(['Zone', 'Direction', 'N', '5d WR', 'Avg 5d'], widths2);
    printRow(['────────────────', '────────', '──────', '────────────', '────────'], widths2);

    for (const zone of zones) {
        for (const dir of directions) {
            const matching = obs.filter(o => o.zone === zone && o.direction === dir);
            if (matching.length < MIN_SAMPLE) continue;

            // Direction-aware WR
            const rets = matching.map(o => o.return_5d).filter(r => r !== null);
            const wr = calcWinRate(rets, dir);

            printRow([
                zone, dir, matching.length,
                fmtWR(wr.wr, wr.count),
                fmtPct(wr.avg),
            ], widths2);
        }
    }
}

// ─── Section 6: Time of Day ──────────────────────────────────────────────────

function section6_timeOfDay(obs) {
    printHeader('Section 6: Time-of-Day Effect');

    const buckets = [
        { label: 'Pre-open (<9:30)', min: 0, max: 9 },
        { label: 'Morning (9:30-11)', min: 9, max: 11 },
        { label: 'Midday (11-14)', min: 11, max: 14 },
        { label: 'Afternoon (14-16)', min: 14, max: 16 },
        { label: 'After-hours (>16)', min: 16, max: 24 },
    ];

    const widths = [22, 8, 14, 14, 14, 10];
    printRow(['Time Window', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const bucket of buckets) {
        const matching = obs.filter(o => o.scan_hour_et >= bucket.min && o.scan_hour_et < bucket.max);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            bucket.label,
            matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }
}

// ─── Section 7: Internals at Entry ───────────────────────────────────────────

function section7_internals(obs) {
    printHeader('Section 7: Market Internals at Entry');

    const db = getDb();

    // For each observation, find closest internals reading
    const enriched = obs.map(o => {
        const internals = db.prepare(`
            SELECT tick, trin, ad_spread, vol_ratio, vix
            FROM market_internals
            WHERE date = ?
            ORDER BY ABS(julianday(timestamp) - julianday(? || 'T' || printf('%02d', ?) || ':00:00Z'))
            LIMIT 1
        `).get(o.scan_date, o.scan_date, o.scan_hour_utc);

        return { ...o, internals };
    }).filter(o => o.internals);

    if (enriched.length < 10) {
        console.log(`  Only ${enriched.length} observations with internals data (need 10+). Skipping.\n`);
        return;
    }

    console.log(`  Observations with internals: ${enriched.length}\n`);

    // TICK buckets
    console.log(`  ${COLORS.bold}TICK at entry:${COLORS.reset}`);
    const tickBuckets = [
        { label: 'Strong sell (<-400)', filter: o => o.internals.tick < -400 },
        { label: 'Neutral (-400 to +400)', filter: o => o.internals.tick >= -400 && o.internals.tick <= 400 },
        { label: 'Strong buy (>+400)', filter: o => o.internals.tick > 400 },
    ];

    const widths = [26, 8, 14, 14, 10];
    printRow(['TICK Bucket', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────────────', '──────', '────────────', '────────────', '────────'], widths);

    for (const bucket of tickBuckets) {
        const matching = enriched.filter(bucket.filter);
        if (matching.length < 3) continue;
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
        printRow([bucket.label, matching.length, fmtWR(wr3d.wr, wr3d.count), fmtWR(wr5d.wr, wr5d.count), fmtPct(wr5d.avg)], widths);
    }

    // TRIN buckets
    console.log(`\n  ${COLORS.bold}TRIN at entry:${COLORS.reset}`);
    const trinBuckets = [
        { label: 'Bullish (<0.8)', filter: o => o.internals.trin < 0.8 },
        { label: 'Neutral (0.8-1.2)', filter: o => o.internals.trin >= 0.8 && o.internals.trin <= 1.2 },
        { label: 'Bearish (>1.2)', filter: o => o.internals.trin > 1.2 },
    ];

    printRow(['TRIN Bucket', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────────────', '──────', '────────────', '────────────', '────────'], widths);

    for (const bucket of trinBuckets) {
        const matching = enriched.filter(bucket.filter);
        if (matching.length < 3) continue;
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
        printRow([bucket.label, matching.length, fmtWR(wr3d.wr, wr3d.count), fmtWR(wr5d.wr, wr5d.count), fmtPct(wr5d.avg)], widths);
    }

    // VIX regime
    console.log(`\n  ${COLORS.bold}VIX at entry:${COLORS.reset}`);
    const vixBuckets = [
        { label: 'Complacent (<12)', filter: o => o.internals.vix < 12 },
        { label: 'Normal (12-20)', filter: o => o.internals.vix >= 12 && o.internals.vix <= 20 },
        { label: 'Elevated (20-30)', filter: o => o.internals.vix > 20 && o.internals.vix <= 30 },
        { label: 'Fear (>30)', filter: o => o.internals.vix > 30 },
    ];

    printRow(['VIX Bucket', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────────────', '──────', '────────────', '────────────', '────────'], widths);

    for (const bucket of vixBuckets) {
        const matching = enriched.filter(bucket.filter);
        if (matching.length < 3) continue;
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
        printRow([bucket.label, matching.length, fmtWR(wr3d.wr, wr3d.count), fmtWR(wr5d.wr, wr5d.count), fmtPct(wr5d.avg)], widths);
    }
}

// ─── Section 8: Direction Analysis ───────────────────────────────────────────

function section8_direction(obs) {
    printHeader('Section 8: Direction & SPY Trend Analysis');

    // Direction analysis with direction-aware WR
    const directions = [...new Set(obs.map(o => o.direction))].sort();

    const widths = [14, 8, 14, 14, 14, 10];
    printRow(['Direction', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const dir of directions) {
        const matching = obs.filter(o => o.direction === dir);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null), dir);
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null), dir);
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null), dir);

        printRow([
            dir, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // SPY trend alignment
    console.log(`\n  ${COLORS.bold}SPY Trend at Signal:${COLORS.reset}`);
    const spyTrends = [...new Set(obs.map(o => o.spy_trend))].filter(Boolean).sort();

    printRow(['SPY Trend', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────', '──────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const trend of spyTrends) {
        const matching = obs.filter(o => o.spy_trend === trend);
        if (matching.length < MIN_SAMPLE) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            trend, matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // Counter-trend vs with-trend
    console.log(`\n  ${COLORS.bold}Counter-Trend vs With-Trend:${COLORS.reset}`);
    const counterTrend = obs.filter(o => o.factors.has('COUNTER_TREND'));
    const withTrend = obs.filter(o => !o.factors.has('COUNTER_TREND') && o.direction === 'bullish');

    const ctWR = calcWinRate(counterTrend.map(o => o.return_5d).filter(r => r !== null));
    const wtWR = calcWinRate(withTrend.map(o => o.return_5d).filter(r => r !== null));

    console.log(`  Counter-trend: ${fmtWR(ctWR.wr, ctWR.count)}, avg ${fmtPct(ctWR.avg)}`);
    console.log(`  With-trend:    ${fmtWR(wtWR.wr, wtWR.count)}, avg ${fmtPct(wtWR.avg)}`);
}

// ─── Section 9: Tier Analysis ────────────────────────────────────────────────

function section9_tiers(obs) {
    printHeader('Section 9: Tier Performance');

    const tiers = ['HIGH_CONVICTION', 'TRADEABLE', 'WATCH', 'FILTERED'];

    const widths = [18, 8, 14, 14, 14, 10, 10];
    printRow(['Tier', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d', 'AvgScore'], widths);
    printRow(['────────────────', '──────', '────────────', '────────────', '────────────', '────────', '────────'], widths);

    for (const tier of tiers) {
        const matching = obs.filter(o => o.tier === tier);
        if (matching.length === 0) continue;

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));
        const avgScore = matching.reduce((s, o) => s + o.score, 0) / matching.length;

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

    printHeader(`FACTOR ANALYSIS — Bloodhound Results (Full Dataset)`);
    if (SYMBOL_FILTER) console.log(`  ${COLORS.bold}Filtered to: ${SYMBOL_FILTER}${COLORS.reset}`);

    const obs = loadObservations(db);
    console.log(`  Observations loaded: ${COLORS.bold}${obs.length}${COLORS.reset} (deduplicated symbol-days)`);

    // Factor frequency overview
    const factors = getActiveFactors(obs);
    console.log(`  Unique factors found: ${factors.length}`);

    const factorCounts = factors.map(f => ({
        factor: f,
        count: obs.filter(o => o.factors.has(f)).length
    })).sort((a, b) => b.count - a.count);
    console.log(`  Top factors: ${factorCounts.slice(0, 10).map(f => `${f.factor}(${f.count})`).join(', ')}`);

    // Split observations: factor sections need signals_json, other sections use all
    const factorObs = obs.filter(o => o.has_signals);
    console.log(`  With factor data (signals_json): ${factorObs.length}`);
    console.log(`  Without (score/zone/RSI only): ${obs.length - factorObs.length}`);

    // Run sections
    const sections = [
        { id: '1', fn: () => section1_factorWR(factorObs) },
        { id: '2', fn: () => section2_combos(factorObs) },
        { id: '3', fn: () => section3_triples(factorObs) },
        { id: '4', fn: () => section4_scoreCorrelation(obs) },
        { id: '5', fn: () => section5_zones(obs) },
        { id: '6', fn: () => section6_timeOfDay(obs) },
        { id: '7', fn: () => section7_internals(obs) },
        { id: '8', fn: () => section8_direction(obs) },
        { id: '9', fn: () => section9_tiers(obs) },
    ];

    for (const section of sections) {
        if (SECTION && section.id !== SECTION) continue;
        section.fn();
    }

    console.log(`\n${COLORS.dim}  Analysis complete. ${obs.length} observations across ${new Set(obs.map(o => o.symbol)).size} symbols.${COLORS.reset}\n`);
}

main();
