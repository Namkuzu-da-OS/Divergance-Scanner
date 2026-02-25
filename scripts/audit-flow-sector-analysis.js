#!/usr/bin/env node

/**
 * AUDIT: Flow Confirmation × Sector RS Alignment
 *
 * Tests the hypothesis: "Does flow confirmation (from Opportunity Scanner)
 * perform differently depending on sector relative strength?"
 *
 * The QCOM Lesson: Bullish flow in a bottom-quartile sector (XLK during
 * late-cycle rotation) failed to overcome sector headwind. This script
 * quantifies whether that pattern is systematic.
 *
 * Two data strategies:
 *   A) bloodhound_results (has both flow signals + sector_rs_percentile)
 *      joined with audit_returns. Limited to post-Feb-20 data.
 *   B) opportunities table cross-referenced with divergence scanner
 *      rs_snapshots + audit_returns. Broader coverage (Feb 9+).
 *
 * Prerequisites: Run audit-build-returns.js --fresh first.
 *
 * Usage:
 *   node scripts/audit-flow-sector-analysis.js              # Full report
 *   node scripts/audit-flow-sector-analysis.js --section 1  # Specific section
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const {
    getDb, extractFactors, calcWinRate,
    COLORS, fmtWR, fmtPct, printHeader, printRow, hasFlag, getArg
} = require('./lib/audit-utils');

const args = process.argv.slice(2);
const SECTION = getArg(args, '--section', null);
const MIN_SAMPLE = 5;

// ─── SECTOR_MAP (duplicated from bloodhound-scanner.js) ─────────────────────

const SECTOR_MAP = {
    // Technology (XLK)
    AAPL: 'XLK', MSFT: 'XLK', NVDA: 'XLK', AMD: 'XLK', QCOM: 'XLK',
    AVGO: 'XLK', CRM: 'XLK', ADBE: 'XLK', INTC: 'XLK', TXN: 'XLK',
    MU: 'XLK', AMAT: 'XLK', LRCX: 'XLK', KLAC: 'XLK', MRVL: 'XLK',
    NOW: 'XLK', PANW: 'XLK', SNPS: 'XLK', CDNS: 'XLK', FTNT: 'XLK',
    // Consumer Discretionary (XLY)
    AMZN: 'XLY', TSLA: 'XLY', HD: 'XLY', MCD: 'XLY', NKE: 'XLY',
    LOW: 'XLY', SBUX: 'XLY', TJX: 'XLY', CMG: 'XLY', ORLY: 'XLY',
    BKNG: 'XLY', ABNB: 'XLY', ROST: 'XLY', DHI: 'XLY', LEN: 'XLY',
    // Communications (XLC)
    META: 'XLC', GOOGL: 'XLC', GOOG: 'XLC', NFLX: 'XLC', DIS: 'XLC',
    CMCSA: 'XLC', VZ: 'XLC', T: 'XLC', TMUS: 'XLC', EA: 'XLC',
    TTWO: 'XLC', DDOG: 'XLC', SNAP: 'XLC', PINS: 'XLC',
    // Financials (XLF)
    JPM: 'XLF', BAC: 'XLF', WFC: 'XLF', GS: 'XLF', MS: 'XLF',
    C: 'XLF', AXP: 'XLF', BLK: 'XLF', SCHW: 'XLF', COF: 'XLF',
    PYPL: 'XLF', V: 'XLF', MA: 'XLF', FISV: 'XLF', SQ: 'XLF',
    // Healthcare (XLV)
    UNH: 'XLV', JNJ: 'XLV', LLY: 'XLV', PFE: 'XLV', ABBV: 'XLV',
    MRK: 'XLV', TMO: 'XLV', ABT: 'XLV', DHR: 'XLV', BSX: 'XLV',
    ISRG: 'XLV', AMGN: 'XLV', GILD: 'XLV', VRTX: 'XLV', REGN: 'XLV',
    // Energy (XLE)
    XOM: 'XLE', CVX: 'XLE', COP: 'XLE', SLB: 'XLE', EOG: 'XLE',
    MPC: 'XLE', OXY: 'XLE', PSX: 'XLE', VLO: 'XLE', PXD: 'XLE',
    // Industrials (XLI)
    CAT: 'XLI', DE: 'XLI', UNP: 'XLI', HON: 'XLI', RTX: 'XLI',
    BA: 'XLI', LMT: 'XLI', GE: 'XLI', MMM: 'XLI', UBER: 'XLI',
    FDX: 'XLI', UPS: 'XLI', WM: 'XLI',
    // Consumer Staples (XLP)
    PG: 'XLP', KO: 'XLP', PEP: 'XLP', COST: 'XLP', WMT: 'XLP',
    PM: 'XLP', MO: 'XLP', CL: 'XLP', KHC: 'XLP', MDLZ: 'XLP',
    // Utilities (XLU)
    NEE: 'XLU', SO: 'XLU', DUK: 'XLU', AEP: 'XLU', D: 'XLU',
    // Real Estate (XLRE)
    AMT: 'XLRE', PLD: 'XLRE', CCI: 'XLRE', EQIX: 'XLRE', SPG: 'XLRE',
    // Materials (XLB)
    LIN: 'XLB', APD: 'XLB', SHW: 'XLB', FCX: 'XLB', NEM: 'XLB',
    // Crypto-related
    IBIT: 'IBIT', MSTR: 'IBIT', MARA: 'IBIT', IREN: 'IBIT', COIN: 'IBIT',
    RIOT: 'IBIT', ETHA: 'IBIT',
};

// ─── RS Quartile Classification ─────────────────────────────────────────────

function rsQuartile(percentile) {
    if (percentile === null || percentile === undefined) return null;
    if (percentile >= 75) return 'top';
    if (percentile >= 50) return 'above_median';
    if (percentile >= 25) return 'below_median';
    return 'bottom';
}

function rsHalf(percentile) {
    if (percentile === null || percentile === undefined) return null;
    return percentile >= 50 ? 'top_half' : 'bottom_half';
}

// ─── Data Loading: Strategy A (Bloodhound Results) ──────────────────────────

function loadStrategyA(db) {
    // bloodhound_results with sector_rs_percentile + signals_json (has flow signals)
    // joined with audit_returns for forward returns
    const rows = db.prepare(`
        WITH bh_deduped AS (
            SELECT r.*, s.timestamp as scan_timestamp,
                   ROW_NUMBER() OVER (
                       PARTITION BY r.symbol, date(s.timestamp)
                       ORDER BY r.score DESC, r.id ASC
                   ) as rn
            FROM bloodhound_results r
            JOIN bloodhound_scans s ON r.scan_id = s.id
            WHERE r.sector_rs_percentile IS NOT NULL
        )
        SELECT d.symbol, date(d.scan_timestamp) as scan_date,
               d.score, d.tier, d.direction, d.zone,
               d.rsi, d.bb_position, d.trend,
               d.signals_json,
               d.sector_rs_percentile, d.sector_etf,
               a.return_1d, a.return_3d, a.return_5d,
               a.max_gain_5d, a.max_drawdown_5d
        FROM bh_deduped d
        LEFT JOIN audit_returns a ON d.symbol = a.symbol AND date(d.scan_timestamp) = a.date
        WHERE d.rn = 1 AND a.return_1d IS NOT NULL
    `).all();

    return rows.map(r => {
        const factors = extractFactors(r.signals_json);
        const hasFlowHC = factors.has('OPP_FLOW_HC');
        const hasFlowT = factors.has('OPP_FLOW_T');
        return {
            ...r,
            factors,
            has_flow: hasFlowHC || hasFlowT,
            flow_tier: hasFlowHC ? 'HC' : (hasFlowT ? 'TRADEABLE' : 'none'),
            rs_quartile: rsQuartile(r.sector_rs_percentile),
            rs_half: rsHalf(r.sector_rs_percentile),
        };
    });
}

// ─── Data Loading: Strategy B (Opportunities + Divergence Scanner) ──────────

function loadStrategyB(db) {
    const DIVERGENCE_DB_PATH = path.join(__dirname, '..', '..', 'divergence-scanner', 'data', 'divergence_scanner.db');

    if (!fs.existsSync(DIVERGENCE_DB_PATH)) {
        console.log(`  ${COLORS.yellow}WARNING: Divergence scanner DB not found at ${DIVERGENCE_DB_PATH}${COLORS.reset}`);
        console.log(`  Strategy B will be skipped.\n`);
        return [];
    }

    // Load RS snapshots from divergence scanner DB
    const rsDb = new Database(DIVERGENCE_DB_PATH, { readonly: true, fileMustExist: true });

    // Get all RS snapshots, deduplicated to one per sector-day (latest snapshot)
    const rsRows = rsDb.prepare(`
        SELECT symbol as sector_etf, date(snapshot_at) as snap_date,
               rs_rank, rs_score,
               ROW_NUMBER() OVER (
                   PARTITION BY symbol, date(snapshot_at)
                   ORDER BY snapshot_at DESC
               ) as rn
        FROM rs_snapshots
    `).all();

    rsDb.close();

    // Build lookup: sector_etf:date -> { rs_rank, rs_score, total_on_day }
    const rsLookup = new Map();
    const dayTotals = new Map(); // date -> max rank (= total assets that day)

    for (const r of rsRows) {
        if (r.rn !== 1) continue;
        rsLookup.set(`${r.sector_etf}:${r.snap_date}`, { rank: r.rs_rank, score: r.rs_score });

        // Track total assets per day for percentile calculation
        const existing = dayTotals.get(r.snap_date) || 0;
        dayTotals.set(r.snap_date, Math.max(existing, r.rs_rank));
    }

    // Load opportunities with returns
    const oppRows = db.prepare(`
        WITH opp_deduped AS (
            SELECT o.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY o.symbol, date(o.timestamp)
                       ORDER BY o.opportunity_score DESC, COALESCE(o.vol_oi_ratio, 0) DESC, o.id ASC
                   ) as rn
            FROM opportunities o
            WHERE o.tier IN ('HIGH_CONVICTION', 'TRADEABLE')
        )
        SELECT od.symbol, date(od.timestamp) as scan_date,
               od.opportunity_score, od.tier as opp_tier,
               od.direction, od.vol_oi_ratio, od.net_premium,
               od.call_put_ratio,
               a.return_1d, a.return_3d, a.return_5d,
               a.max_gain_5d, a.max_drawdown_5d
        FROM opp_deduped od
        LEFT JOIN audit_returns a ON od.symbol = a.symbol AND date(od.timestamp) = a.date
        WHERE od.rn = 1 AND a.return_1d IS NOT NULL
    `).all();

    // Enrich with sector RS
    const enriched = [];
    for (const row of oppRows) {
        const sectorEtf = SECTOR_MAP[row.symbol];
        if (!sectorEtf) continue; // can't map to sector

        const rsData = rsLookup.get(`${sectorEtf}:${row.scan_date}`);
        if (!rsData) continue; // no RS data for this day

        const totalAssets = dayTotals.get(row.scan_date) || 28;
        const percentile = ((totalAssets - rsData.rank + 1) / totalAssets) * 100;

        enriched.push({
            ...row,
            sector_etf: sectorEtf,
            sector_rs_percentile: percentile,
            rs_quartile: rsQuartile(percentile),
            rs_half: rsHalf(percentile),
            has_flow: true, // all Strategy B rows are HC/TRADEABLE flow
            flow_tier: row.opp_tier === 'HIGH_CONVICTION' ? 'HC' : 'TRADEABLE',
        });
    }

    return enriched;
}

// ─── Section 1: Flow WR by Sector RS Quartile ──────────────────────────────

function section1(obsA, obsB) {
    printHeader('Section 1: Flow Confirmation WR by Sector RS Quartile');

    // Use both strategies
    for (const [label, obs] of [['Strategy A (Bloodhound signals)', obsA.filter(o => o.has_flow)], ['Strategy B (Opportunities + RS)', obsB]]) {
        console.log(`\n  ${COLORS.bold}${label}: ${obs.length} observations${COLORS.reset}\n`);

        if (obs.length < 10) {
            console.log(`  Insufficient data (need 10+). Skipping.\n`);
            continue;
        }

        const quartiles = ['top', 'above_median', 'below_median', 'bottom'];
        const labels = { top: 'Top (>=75th)', above_median: 'Above Med', below_median: 'Below Med', bottom: 'Bottom (<25th)' };

        const widths = [18, 6, 14, 14, 14, 10];
        printRow(['RS Quartile', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
        printRow(['────────────────', '────', '────────────', '────────────', '────────────', '────────'], widths);

        for (const q of quartiles) {
            const matching = obs.filter(o => o.rs_quartile === q);
            if (matching.length < 3) {
                printRow([labels[q], matching.length, '—', '—', '—', '—'], widths);
                continue;
            }

            const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
            const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
            const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

            printRow([
                labels[q], matching.length,
                fmtWR(wr1d.wr, wr1d.count),
                fmtWR(wr3d.wr, wr3d.count),
                fmtWR(wr5d.wr, wr5d.count),
                fmtPct(wr5d.avg),
            ], widths);
        }
    }
}

// ─── Section 2: Top-Half vs Bottom-Half RS ──────────────────────────────────

function section2(obsA, obsB) {
    printHeader('Section 2: Flow + Strong Sector vs Flow + Weak Sector');

    for (const [label, obs] of [['Strategy A', obsA.filter(o => o.has_flow)], ['Strategy B', obsB]]) {
        console.log(`\n  ${COLORS.bold}${label}: ${obs.length} flow observations${COLORS.reset}\n`);

        if (obs.length < 10) {
            console.log(`  Insufficient data. Skipping.\n`);
            continue;
        }

        const topHalf = obs.filter(o => o.rs_half === 'top_half');
        const bottomHalf = obs.filter(o => o.rs_half === 'bottom_half');

        const widths = [22, 6, 14, 14, 14, 10];
        printRow(['Sector Alignment', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
        printRow(['────────────────────', '────', '────────────', '────────────', '────────────', '────────'], widths);

        for (const [lbl, group] of [['Flow + Strong Sector', topHalf], ['Flow + Weak Sector', bottomHalf]]) {
            if (group.length < 3) {
                printRow([lbl, group.length, '—', '—', '—', '—'], widths);
                continue;
            }

            const wr1d = calcWinRate(group.map(o => o.return_1d).filter(r => r !== null));
            const wr3d = calcWinRate(group.map(o => o.return_3d).filter(r => r !== null));
            const wr5d = calcWinRate(group.map(o => o.return_5d).filter(r => r !== null));

            printRow([
                lbl, group.length,
                fmtWR(wr1d.wr, wr1d.count),
                fmtWR(wr3d.wr, wr3d.count),
                fmtWR(wr5d.wr, wr5d.count),
                fmtPct(wr5d.avg),
            ], widths);
        }

        // Delta
        if (topHalf.length >= MIN_SAMPLE && bottomHalf.length >= MIN_SAMPLE) {
            const topWR = calcWinRate(topHalf.map(o => o.return_5d).filter(r => r !== null));
            const botWR = calcWinRate(bottomHalf.map(o => o.return_5d).filter(r => r !== null));
            const delta = topWR.wr - botWR.wr;
            const deltaColor = delta > 10 ? COLORS.green : (delta > 0 ? COLORS.yellow : COLORS.red);
            console.log(`\n  ${COLORS.bold}Delta (strong - weak):${COLORS.reset} ${deltaColor}${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp${COLORS.reset} 5d WR`);

            if (delta > 10) {
                console.log(`  ${COLORS.green}SIGNIFICANT: Sector alignment improves flow WR by ${delta.toFixed(1)}pp${COLORS.reset}`);
            } else if (delta > 0) {
                console.log(`  ${COLORS.yellow}MODERATE: Some improvement but < 10pp threshold${COLORS.reset}`);
            } else {
                console.log(`  ${COLORS.red}NO EFFECT: Sector alignment does not improve flow WR${COLORS.reset}`);
            }
        }
    }
}

// ─── Section 3: Full Interaction Matrix ─────────────────────────────────────

function section3(obsA, obsB) {
    printHeader('Section 3: Full Interaction Matrix (Flow Tier × RS Quartile)');

    for (const [label, obs] of [['Strategy A', obsA], ['Strategy B', obsB]]) {
        console.log(`\n  ${COLORS.bold}${label}:${COLORS.reset}\n`);

        if (obs.length < 10) {
            console.log(`  Insufficient data. Skipping.\n`);
            continue;
        }

        const flowTiers = label === 'Strategy A' ? ['HC', 'TRADEABLE', 'none'] : ['HC', 'TRADEABLE'];
        const quartiles = ['top', 'above_median', 'below_median', 'bottom'];
        const qLabels = { top: 'Top', above_median: 'AbvMed', below_median: 'BlwMed', bottom: 'Bottom' };

        const widths = [14, 10, 6, 14, 14, 10];
        printRow(['Flow Tier', 'RS Quartile', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
        printRow(['────────────', '────────', '────', '────────────', '────────────', '────────'], widths);

        for (const ft of flowTiers) {
            for (const q of quartiles) {
                const matching = obs.filter(o => o.flow_tier === ft && o.rs_quartile === q);
                if (matching.length === 0) continue;

                const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
                const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

                printRow([
                    ft, qLabels[q], matching.length,
                    matching.length >= 3 ? fmtWR(wr3d.wr, wr3d.count) : '—',
                    matching.length >= 3 ? fmtWR(wr5d.wr, wr5d.count) : '—',
                    matching.length >= 3 ? fmtPct(wr5d.avg) : '—',
                ], widths);
            }
            console.log(''); // spacer between flow tiers
        }
    }
}

// ─── Section 4: Case Studies — Worst Drawdowns ─────────────────────────────

function section4(obsA, obsB) {
    printHeader('Section 4: Case Studies — Flow + Bottom-Quartile Sector');

    // Combine both strategies for case studies
    const bottomFlowA = obsA.filter(o => o.has_flow && o.rs_quartile === 'bottom');
    const bottomFlowB = obsB.filter(o => o.rs_quartile === 'bottom');

    console.log(`  Strategy A (bottom quartile + flow): ${bottomFlowA.length} observations`);
    console.log(`  Strategy B (bottom quartile + flow): ${bottomFlowB.length} observations\n`);

    // Show all bottom-quartile flow observations with details
    for (const [label, obs] of [['Strategy A', bottomFlowA], ['Strategy B', bottomFlowB]]) {
        if (obs.length === 0) continue;

        console.log(`  ${COLORS.bold}${label} — Individual Observations:${COLORS.reset}`);

        // Sort by return_5d ascending (worst first)
        const sorted = [...obs].sort((a, b) => (a.return_5d || 0) - (b.return_5d || 0));

        for (const o of sorted) {
            const ret1 = o.return_1d !== null ? `${o.return_1d >= 0 ? '+' : ''}${o.return_1d.toFixed(2)}%` : '—';
            const ret3 = o.return_3d !== null ? `${o.return_3d >= 0 ? '+' : ''}${o.return_3d.toFixed(2)}%` : '—';
            const ret5 = o.return_5d !== null ? `${o.return_5d >= 0 ? '+' : ''}${o.return_5d.toFixed(2)}%` : '—';
            const dd = o.max_drawdown_5d !== null ? `${o.max_drawdown_5d.toFixed(2)}%` : '—';
            const sectorEtf = o.sector_etf || SECTOR_MAP[o.symbol] || '?';
            const rsPct = o.sector_rs_percentile !== undefined ? `${o.sector_rs_percentile.toFixed(0)}th` : '?';
            const flow = o.flow_tier || '?';
            const score = o.score || o.opportunity_score || '?';

            console.log(`    ${o.scan_date} ${o.symbol.padEnd(6)} score:${String(score).padStart(3)} flow:${flow.padEnd(3)} ${sectorEtf}(${rsPct.padStart(4)})  1d:${ret1.padStart(8)} 3d:${ret3.padStart(8)} 5d:${ret5.padStart(8)} dd:${dd.padStart(8)}`);
        }

        // Summary stats
        if (obs.length >= 3) {
            const wr5d = calcWinRate(obs.map(o => o.return_5d).filter(r => r !== null));
            const avgDD = obs.filter(o => o.max_drawdown_5d !== null).reduce((s, o) => s + o.max_drawdown_5d, 0) / obs.filter(o => o.max_drawdown_5d !== null).length;
            console.log(`\n    ${COLORS.bold}Summary: 5d WR ${fmtWR(wr5d.wr, wr5d.count)}, avg 5d ${fmtPct(wr5d.avg)}, avg max DD ${avgDD.toFixed(2)}%${COLORS.reset}\n`);
        }
        console.log('');
    }
}

// ─── Section 5: Standalone Sector RS WR ─────────────────────────────────────

function section5(obsA) {
    printHeader('Section 5: Standalone Sector RS WR (Reference — All Signals)');

    // Use all Strategy A observations (not just flow), to test sector RS alone
    console.log(`  All Bloodhound signals with sector RS: ${obsA.length}\n`);

    if (obsA.length < 20) {
        console.log('  Insufficient data. Need more signals with sector_rs_percentile.\n');
        return;
    }

    const quartiles = ['top', 'above_median', 'below_median', 'bottom'];
    const labels = { top: 'Top (>=75th)', above_median: 'Above Med', below_median: 'Below Med', bottom: 'Bottom (<25th)' };

    const widths = [18, 6, 14, 14, 14, 10];
    printRow(['RS Quartile', 'N', '1d WR', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────', '────', '────────────', '────────────', '────────────', '────────'], widths);

    for (const q of quartiles) {
        const matching = obsA.filter(o => o.rs_quartile === q);
        if (matching.length < 3) {
            printRow([labels[q], matching.length, '—', '—', '—', '—'], widths);
            continue;
        }

        const wr1d = calcWinRate(matching.map(o => o.return_1d).filter(r => r !== null));
        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            labels[q], matching.length,
            fmtWR(wr1d.wr, wr1d.count),
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // Also show by direction
    console.log(`\n  ${COLORS.bold}By Direction:${COLORS.reset}\n`);
    for (const dir of ['bullish', 'bearish']) {
        console.log(`  ${dir.toUpperCase()}:`);
        for (const q of quartiles) {
            const matching = obsA.filter(o => o.rs_quartile === q && o.direction === dir);
            if (matching.length < 3) continue;

            const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null), dir);
            console.log(`    ${labels[q].padEnd(18)} n=${String(matching.length).padStart(4)}  5d WR: ${fmtWR(wr5d.wr, wr5d.count)}  avg: ${fmtPct(wr5d.avg)}`);
        }
        console.log('');
    }
}

// ─── Section 6: Delta — Flow + Aligned Sector vs Flow Alone ────────────────

function section6(obsA) {
    printHeader('Section 6: Edge Delta — Flow Aligned vs Flow Alone');

    const withFlow = obsA.filter(o => o.has_flow);
    const withoutFlow = obsA.filter(o => !o.has_flow);

    console.log(`  With flow confirmation: ${withFlow.length}`);
    console.log(`  Without flow confirmation: ${withoutFlow.length}\n`);

    if (withFlow.length < MIN_SAMPLE) {
        console.log('  Insufficient flow observations. Skipping.\n');
        return;
    }

    // Compare: flow+aligned, flow+headwind, no flow+aligned, no flow+headwind
    const combos = [
        { label: 'Flow + Strong Sector', filter: o => o.has_flow && o.rs_half === 'top_half' },
        { label: 'Flow + Weak Sector', filter: o => o.has_flow && o.rs_half === 'bottom_half' },
        { label: 'No Flow + Strong Sector', filter: o => !o.has_flow && o.rs_half === 'top_half' },
        { label: 'No Flow + Weak Sector', filter: o => !o.has_flow && o.rs_half === 'bottom_half' },
    ];

    const widths = [26, 6, 14, 14, 10];
    printRow(['Combo', 'N', '3d WR', '5d WR', 'Avg 5d'], widths);
    printRow(['────────────────────────', '────', '────────────', '────────────', '────────'], widths);

    for (const combo of combos) {
        const matching = obsA.filter(combo.filter);
        if (matching.length < 3) {
            printRow([combo.label, matching.length, '—', '—', '—'], widths);
            continue;
        }

        const wr3d = calcWinRate(matching.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(matching.map(o => o.return_5d).filter(r => r !== null));

        printRow([
            combo.label, matching.length,
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
        ], widths);
    }

    // Sector-specific breakdown
    console.log(`\n  ${COLORS.bold}By Sector ETF (flow observations only):${COLORS.reset}\n`);

    const sectorCounts = {};
    for (const o of withFlow) {
        const etf = o.sector_etf || SECTOR_MAP[o.symbol] || 'UNKNOWN';
        if (!sectorCounts[etf]) sectorCounts[etf] = [];
        sectorCounts[etf].push(o);
    }

    const sWidths = [10, 6, 14, 14, 10, 10];
    printRow(['Sector', 'N', '3d WR', '5d WR', 'Avg 5d', 'Avg RS%'], sWidths);
    printRow(['────────', '────', '────────────', '────────────', '────────', '────────'], sWidths);

    for (const [etf, group] of Object.entries(sectorCounts).sort((a, b) => b[1].length - a[1].length)) {
        if (group.length < 3) continue;

        const wr3d = calcWinRate(group.map(o => o.return_3d).filter(r => r !== null));
        const wr5d = calcWinRate(group.map(o => o.return_5d).filter(r => r !== null));
        const avgRs = group.reduce((s, o) => s + (o.sector_rs_percentile || 0), 0) / group.length;

        printRow([
            etf, group.length,
            fmtWR(wr3d.wr, wr3d.count),
            fmtWR(wr5d.wr, wr5d.count),
            fmtPct(wr5d.avg),
            `${avgRs.toFixed(0)}%`,
        ], sWidths);
    }
}

// ─── Decision Summary ───────────────────────────────────────────────────────

function decisionSummary(obsA, obsB) {
    printHeader('DECISION SUMMARY — Scoring Recommendation');

    // Calculate key metrics
    const flowObs = obsA.filter(o => o.has_flow);
    const topHalfFlow = flowObs.filter(o => o.rs_half === 'top_half');
    const botHalfFlow = flowObs.filter(o => o.rs_half === 'bottom_half');

    const topHalfB = obsB.filter(o => o.rs_half === 'top_half');
    const botHalfB = obsB.filter(o => o.rs_half === 'bottom_half');

    console.log(`  ${COLORS.bold}Key Metrics:${COLORS.reset}\n`);

    // Strategy A
    if (topHalfFlow.length >= MIN_SAMPLE && botHalfFlow.length >= MIN_SAMPLE) {
        const topWR = calcWinRate(topHalfFlow.map(o => o.return_5d).filter(r => r !== null));
        const botWR = calcWinRate(botHalfFlow.map(o => o.return_5d).filter(r => r !== null));
        const delta = topWR.wr - botWR.wr;

        console.log(`  Strategy A (Bloodhound signals):`);
        console.log(`    Flow + Strong Sector:  ${fmtWR(topWR.wr, topWR.count)}`);
        console.log(`    Flow + Weak Sector:    ${fmtWR(botWR.wr, botWR.count)}`);
        console.log(`    Delta:                 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp\n`);
    } else {
        console.log(`  Strategy A: Insufficient data (flow+top: ${topHalfFlow.length}, flow+bot: ${botHalfFlow.length})\n`);
    }

    // Strategy B
    if (topHalfB.length >= MIN_SAMPLE && botHalfB.length >= MIN_SAMPLE) {
        const topWR = calcWinRate(topHalfB.map(o => o.return_5d).filter(r => r !== null));
        const botWR = calcWinRate(botHalfB.map(o => o.return_5d).filter(r => r !== null));
        const delta = topWR.wr - botWR.wr;

        console.log(`  Strategy B (Opportunities + RS):`);
        console.log(`    Flow + Strong Sector:  ${fmtWR(topWR.wr, topWR.count)}`);
        console.log(`    Flow + Weak Sector:    ${fmtWR(botWR.wr, botWR.count)}`);
        console.log(`    Delta:                 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp\n`);
    } else {
        console.log(`  Strategy B: Insufficient data (flow+top: ${topHalfB.length}, flow+bot: ${botHalfB.length})\n`);
    }

    // Decision
    console.log(`  ${COLORS.bold}Decision Criteria:${COLORS.reset}`);
    console.log(`  - Delta >= 10pp AND strong >= 65% AND weak < 50%  → ${COLORS.green}IMPLEMENT scoring interaction${COLORS.reset}`);
    console.log(`  - Delta < 10pp                                     → ${COLORS.yellow}ANNOTATION warning only${COLORS.reset}`);
    console.log(`  - Any group n < ${MIN_SAMPLE}                              → ${COLORS.dim}INSUFFICIENT DATA, wait${COLORS.reset}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const db = getDb();

    // Check prerequisite
    const auditCount = db.prepare('SELECT COUNT(*) as cnt FROM audit_returns').get().cnt;
    if (auditCount === 0) {
        console.error('ERROR: audit_returns table is empty. Run audit-build-returns.js first.');
        process.exit(1);
    }

    printHeader('FLOW × SECTOR RS ANALYSIS — The QCOM Lesson');
    console.log(`  ${COLORS.dim}Hypothesis: Flow confirmation in lagging sectors underperforms${COLORS.reset}`);
    console.log(`  ${COLORS.dim}Decision: 65%+ WR for scoring, 10pp+ delta for interaction${COLORS.reset}\n`);

    // Load both strategies
    console.log(`  Loading Strategy A (Bloodhound results + sector RS)...`);
    const obsA = loadStrategyA(db);
    const flowCountA = obsA.filter(o => o.has_flow).length;
    console.log(`    Total: ${obsA.length} observations, ${flowCountA} with flow confirmation`);
    console.log(`    Date range: ${obsA.length > 0 ? obsA[0].scan_date : '—'} to ${obsA.length > 0 ? obsA[obsA.length - 1].scan_date : '—'}`);

    console.log(`  Loading Strategy B (Opportunities + divergence scanner)...`);
    const obsB = loadStrategyB(db);
    console.log(`    Total: ${obsB.length} observations (HC/TRADEABLE flow with sector RS)\n`);

    // Unique symbols
    const symbolsA = new Set(obsA.map(o => o.symbol));
    const symbolsB = new Set(obsB.map(o => o.symbol));
    console.log(`  Symbols: ${symbolsA.size} (A), ${symbolsB.size} (B)`);

    // RS coverage
    const rsDistA = { top: 0, above_median: 0, below_median: 0, bottom: 0 };
    for (const o of obsA) { if (o.rs_quartile) rsDistA[o.rs_quartile]++; }
    console.log(`  RS Distribution (A): top=${rsDistA.top}, above=${rsDistA.above_median}, below=${rsDistA.below_median}, bottom=${rsDistA.bottom}`);

    const rsDistB = { top: 0, above_median: 0, below_median: 0, bottom: 0 };
    for (const o of obsB) { if (o.rs_quartile) rsDistB[o.rs_quartile]++; }
    console.log(`  RS Distribution (B): top=${rsDistB.top}, above=${rsDistB.above_median}, below=${rsDistB.below_median}, bottom=${rsDistB.bottom}\n`);

    const sections = [
        { id: '1', fn: () => section1(obsA, obsB) },
        { id: '2', fn: () => section2(obsA, obsB) },
        { id: '3', fn: () => section3(obsA, obsB) },
        { id: '4', fn: () => section4(obsA, obsB) },
        { id: '5', fn: () => section5(obsA) },
        { id: '6', fn: () => section6(obsA) },
    ];

    for (const section of sections) {
        if (SECTION && section.id !== SECTION) continue;
        section.fn();
    }

    // Decision summary (always show)
    if (!SECTION) {
        decisionSummary(obsA, obsB);
    }

    console.log(`${COLORS.dim}  Analysis complete.${COLORS.reset}\n`);
}

main();
