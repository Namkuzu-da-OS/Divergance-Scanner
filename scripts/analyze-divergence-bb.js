#!/usr/bin/env node
/**
 * Comprehensive analysis of divergence_bb backtest data.
 * Extracts results_json from ma_backtest_runs, parses categories A-E + VIX,
 * and finds the best confluences.
 */

const Database = require('better-sqlite3');
const db = new Database('/home/bigpic/github/wingman/data/wingman.db', { readonly: true });

const RUN_TYPES = ['divergence_bb', 'divergence_bb_4h', 'divergence_bb_bear', 'divergence_bb_bear_4h'];
const CATEGORIES = ['A', 'B', 'C', 'D', 'E'];
const VIX_CATEGORIES = ['D_vix', 'E_vix'];
const HORIZONS = ['1d', '3d', '5d', '10d', '20d'];
const MIN_COUNT = 10; // Minimum sample size for meaningful stats

// Fetch all data
const rows = db.prepare(`
  SELECT run_type, symbol, ma_type, results_json
  FROM ma_backtest_runs
  WHERE run_type LIKE 'divergence_bb%'
`).all();

console.log(`Total rows: ${rows.length}\n`);

// Parse all results
const parsed = rows.map(r => {
  let results;
  try {
    results = JSON.parse(r.results_json);
  } catch(e) {
    return null;
  }
  let params;
  try {
    params = JSON.parse(r.ma_type);
  } catch(e) {
    params = r.ma_type;
  }
  return {
    runType: r.run_type,
    symbol: r.symbol,
    params,
    results
  };
}).filter(Boolean);

console.log(`Parsed: ${parsed.length} rows\n`);

// ============================================================
// ANALYSIS 1: Category E (triple confluence) — best WRs
// ============================================================
console.log('='.repeat(80));
console.log('ANALYSIS 1: CATEGORY E (BB + Divergence + Extreme RSI) — TRIPLE CONFLUENCE');
console.log('='.repeat(80));

const catE_results = [];

for (const row of parsed) {
  const catE = row.results.E;
  if (!catE || catE.count < MIN_COUNT) continue;

  for (const h of HORIZONS) {
    const hData = catE[h];
    if (!hData || hData.count < MIN_COUNT) continue;
    const wr = parseFloat(hData.winRate);
    if (isNaN(wr)) continue;

    catE_results.push({
      runType: row.runType,
      symbol: row.symbol,
      horizon: h,
      winRate: wr,
      count: hData.count,
      avgReturn: parseFloat(hData.avgReturn) || 0,
      median: parseFloat(hData.median) || 0,
      params: row.params,
      totalE: catE.count
    });
  }
}

// Sort by win rate descending
catE_results.sort((a, b) => b.winRate - a.winRate);

console.log(`\nTop 40 Category E results (N >= ${MIN_COUNT}):\n`);
console.log('WinRate | N    | Horizon | Symbol | RunType                    | Params (rsi/bb/swing)');
console.log('-'.repeat(110));

for (const r of catE_results.slice(0, 40)) {
  const p = r.params;
  const paramStr = `rsi=${p.rsiThreshold} bb=${p.bbThreshold} swing=${p.minSwingBars}-${p.maxSwingBars}`;
  console.log(
    `${r.winRate.toFixed(1)}%`.padEnd(8) +
    `| ${String(r.count).padEnd(5)}` +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.symbol.padEnd(7)}` +
    `| ${r.runType.padEnd(27)}` +
    `| ${paramStr}`
  );
}

// Summary: How many cat E combos hit various WR thresholds
console.log('\nCategory E WR distribution:');
for (const thresh of [50, 55, 60, 65, 70, 75, 80]) {
  const matching = catE_results.filter(r => r.winRate >= thresh);
  console.log(`  >= ${thresh}%: ${matching.length} results`);
}

// ============================================================
// ANALYSIS 2: Category D vs A — divergence lift
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 2: CATEGORY D vs A — DIVERGENCE LIFT OVER BB TOUCH ALONE');
console.log('='.repeat(80));

// For each row, compare D vs A at each horizon
const liftData = {}; // keyed by symbol -> horizon -> array of {wrA, wrD, lift}

for (const row of parsed) {
  const catA = row.results.A;
  const catD = row.results.D;
  if (!catA || !catD) continue;

  for (const h of HORIZONS) {
    const hA = catA[h];
    const hD = catD[h];
    if (!hA || !hD) continue;
    if (hA.count < MIN_COUNT || hD.count < MIN_COUNT) continue;

    const wrA = parseFloat(hA.winRate);
    const wrD = parseFloat(hD.winRate);
    if (isNaN(wrA) || isNaN(wrD)) continue;

    const key = `${row.symbol}|${h}|${row.runType}`;
    if (!liftData[key]) liftData[key] = [];
    liftData[key].push({
      wrA, wrD, lift: wrD - wrA,
      countA: hA.count, countD: hD.count,
      params: row.params
    });
  }
}

// Aggregate lift by symbol/horizon/runType (average across all param combos)
console.log('\nAverage D-over-A lift by Symbol/Horizon/RunType (across all param combos):');
console.log('Symbol  | RunType                    | Horizon | Avg A WR | Avg D WR | Avg Lift | N combos');
console.log('-'.repeat(100));

const liftSummary = [];
for (const [key, vals] of Object.entries(liftData)) {
  const [symbol, horizon, runType] = key.split('|');
  const avgWrA = vals.reduce((s, v) => s + v.wrA, 0) / vals.length;
  const avgWrD = vals.reduce((s, v) => s + v.wrD, 0) / vals.length;
  const avgLift = vals.reduce((s, v) => s + v.lift, 0) / vals.length;
  liftSummary.push({ symbol, horizon, runType, avgWrA, avgWrD, avgLift, nCombos: vals.length });
}

liftSummary.sort((a, b) => b.avgLift - a.avgLift);

for (const r of liftSummary.slice(0, 50)) {
  console.log(
    `${r.symbol.padEnd(8)}` +
    `| ${r.runType.padEnd(27)}` +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.avgWrA.toFixed(1)}%`.padEnd(10) +
    `| ${r.avgWrD.toFixed(1)}%`.padEnd(10) +
    `| ${(r.avgLift > 0 ? '+' : '') + r.avgLift.toFixed(1)}%`.padEnd(10) +
    `| ${r.nCombos}`
  );
}

// ============================================================
// ANALYSIS 3: D_vix and E_vix — VIX regime breakdown
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 3: VIX REGIME ENHANCEMENT (D_vix and E_vix)');
console.log('='.repeat(80));

const vixResults = [];

for (const row of parsed) {
  for (const vCat of VIX_CATEGORIES) {
    const vData = row.results[vCat];
    if (!vData) continue;

    // vData is keyed by VIX regime (e.g. "Normal", "Elevated", "Fear")
    for (const [regime, regimeData] of Object.entries(vData)) {
      if (typeof regimeData !== 'object' || !regimeData.count) continue;
      if (regimeData.count < MIN_COUNT) continue;

      for (const h of HORIZONS) {
        const hData = regimeData[h];
        if (!hData || hData.count < MIN_COUNT) continue;
        const wr = parseFloat(hData.winRate);
        if (isNaN(wr)) continue;

        vixResults.push({
          category: vCat,
          regime,
          runType: row.runType,
          symbol: row.symbol,
          horizon: h,
          winRate: wr,
          count: hData.count,
          avgReturn: parseFloat(hData.avgReturn) || 0,
          params: row.params
        });
      }
    }
  }
}

vixResults.sort((a, b) => b.winRate - a.winRate);

console.log(`\nTop 40 VIX-regime-filtered results (N >= ${MIN_COUNT}):\n`);
console.log('WinRate | N    | Cat   | Regime    | Horizon | Symbol | RunType                    | Params');
console.log('-'.repeat(120));

for (const r of vixResults.slice(0, 40)) {
  const p = r.params;
  const paramStr = `rsi=${p.rsiThreshold} bb=${p.bbThreshold} swing=${p.minSwingBars}-${p.maxSwingBars}`;
  console.log(
    `${r.winRate.toFixed(1)}%`.padEnd(8) +
    `| ${String(r.count).padEnd(5)}` +
    `| ${r.category.padEnd(6)}` +
    `| ${r.regime.padEnd(10)}` +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.symbol.padEnd(7)}` +
    `| ${r.runType.padEnd(27)}` +
    `| ${paramStr}`
  );
}

// VIX regime summary — aggregate across all param combos
console.log('\nVIX Regime Summary (avg WR across all params, symbols where N >= 10):');
const vixAgg = {};
for (const r of vixResults) {
  const key = `${r.category}|${r.regime}|${r.horizon}|${r.runType}`;
  if (!vixAgg[key]) vixAgg[key] = { wrs: [], counts: [], category: r.category, regime: r.regime, horizon: r.horizon, runType: r.runType };
  vixAgg[key].wrs.push(r.winRate);
  vixAgg[key].counts.push(r.count);
}

const vixAggArr = Object.values(vixAgg).map(v => ({
  ...v,
  avgWr: v.wrs.reduce((s, w) => s + w, 0) / v.wrs.length,
  totalN: v.counts.reduce((s, c) => s + c, 0),
  nSymbols: v.wrs.length
})).sort((a, b) => b.avgWr - a.avgWr);

console.log('Avg WR | Total N | nSyms | Cat   | Regime    | Horizon | RunType');
console.log('-'.repeat(100));
for (const r of vixAggArr.slice(0, 30)) {
  console.log(
    `${r.avgWr.toFixed(1)}%`.padEnd(8) +
    `| ${String(r.totalN).padEnd(8)}` +
    `| ${String(r.nSymbols).padEnd(6)}` +
    `| ${r.category.padEnd(6)}` +
    `| ${r.regime.padEnd(10)}` +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.runType}`
  );
}

// ============================================================
// ANALYSIS 4: 4h vs daily timeframes
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 4: 4h vs DAILY TIMEFRAME COMPARISON');
console.log('='.repeat(80));

// Compare bullish daily vs bullish 4h, and bearish daily vs bearish 4h
const tfComparison = {};

for (const row of parsed) {
  const direction = row.runType.includes('bear') ? 'bear' : 'bull';
  const timeframe = row.runType.includes('4h') ? '4h' : 'daily';

  for (const cat of CATEGORIES) {
    const catData = row.results[cat];
    if (!catData || catData.count < MIN_COUNT) continue;

    for (const h of HORIZONS) {
      const hData = catData[h];
      if (!hData || hData.count < MIN_COUNT) continue;
      const wr = parseFloat(hData.winRate);
      if (isNaN(wr)) continue;

      const key = `${direction}|${cat}|${h}|${row.symbol}`;
      if (!tfComparison[key]) tfComparison[key] = {};
      if (!tfComparison[key][timeframe]) tfComparison[key][timeframe] = [];
      tfComparison[key][timeframe].push({ wr, count: hData.count });
    }
  }
}

// Aggregate: avg WR for 4h vs daily where both exist
const tfResults = [];
for (const [key, tfs] of Object.entries(tfComparison)) {
  if (!tfs.daily || !tfs['4h']) continue;
  const [direction, cat, horizon, symbol] = key.split('|');

  const avgDaily = tfs.daily.reduce((s, v) => s + v.wr, 0) / tfs.daily.length;
  const avg4h = tfs['4h'].reduce((s, v) => s + v.wr, 0) / tfs['4h'].length;

  tfResults.push({
    direction, cat, horizon, symbol,
    avgDaily, avg4h,
    diff: avg4h - avgDaily,
    nDaily: tfs.daily.length,
    n4h: tfs['4h'].length
  });
}

// Summary by category and direction
console.log('\nAverage WR by Timeframe (aggregated across all symbols and param combos):');
const tfSummary = {};
for (const r of tfResults) {
  const key = `${r.direction}|${r.cat}|${r.horizon}`;
  if (!tfSummary[key]) tfSummary[key] = { dailyWrs: [], fourHWrs: [], direction: r.direction, cat: r.cat, horizon: r.horizon };
  tfSummary[key].dailyWrs.push(r.avgDaily);
  tfSummary[key].fourHWrs.push(r.avg4h);
}

const tfSumArr = Object.values(tfSummary).map(v => ({
  ...v,
  avgDaily: v.dailyWrs.reduce((s, w) => s + w, 0) / v.dailyWrs.length,
  avg4h: v.fourHWrs.reduce((s, w) => s + w, 0) / v.fourHWrs.length,
})).map(v => ({ ...v, diff: v.avg4h - v.avgDaily }))
  .sort((a, b) => {
    if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
    if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
    return HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon);
  });

console.log('Dir   | Cat | Horizon | Daily WR | 4h WR    | Diff');
console.log('-'.repeat(70));
for (const r of tfSumArr) {
  console.log(
    `${r.direction.padEnd(6)}` +
    `| ${r.cat.padEnd(4)}` +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.avgDaily.toFixed(1)}%`.padEnd(10) +
    `| ${r.avg4h.toFixed(1)}%`.padEnd(10) +
    `| ${(r.diff > 0 ? '+' : '') + r.diff.toFixed(1)}%`
  );
}

// ============================================================
// ANALYSIS 5: Parameter sensitivity
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 5: PARAMETER SENSITIVITY');
console.log('='.repeat(80));

// For Category E (most selective), aggregate WR by each parameter value
const paramSensitivity = {
  rsiThreshold: {},
  bbThreshold: {},
  minSwingBars: {},
  maxSwingBars: {}
};

for (const row of parsed) {
  const catE = row.results.E;
  if (!catE || catE.count < MIN_COUNT) continue;

  // Use 5d horizon as the benchmark
  const h5 = catE['5d'];
  if (!h5 || h5.count < MIN_COUNT) continue;
  const wr = parseFloat(h5.winRate);
  if (isNaN(wr)) continue;

  for (const pName of Object.keys(paramSensitivity)) {
    const pVal = row.params[pName];
    if (pVal === undefined) continue;
    if (!paramSensitivity[pName][pVal]) paramSensitivity[pName][pVal] = [];
    paramSensitivity[pName][pVal].push({ wr, count: h5.count, symbol: row.symbol, runType: row.runType });
  }
}

for (const [pName, vals] of Object.entries(paramSensitivity)) {
  console.log(`\n${pName}:`);
  const sorted = Object.entries(vals).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [pVal, entries] of sorted) {
    const avgWr = entries.reduce((s, e) => s + e.wr, 0) / entries.length;
    const totalN = entries.reduce((s, e) => s + e.count, 0);
    console.log(`  ${pVal}: avg WR = ${avgWr.toFixed(1)}%, N = ${totalN}, combos = ${entries.length}`);
  }
}

// Also check sensitivity for ALL categories at 5d, just for Cat D
console.log('\nParameter sensitivity for Category D (BB + divergence) at 5d:');
const paramSensD = {
  rsiThreshold: {},
  bbThreshold: {},
  minSwingBars: {},
  maxSwingBars: {}
};

for (const row of parsed) {
  const catD = row.results.D;
  if (!catD || catD.count < MIN_COUNT) continue;
  const h5 = catD['5d'];
  if (!h5 || h5.count < MIN_COUNT) continue;
  const wr = parseFloat(h5.winRate);
  if (isNaN(wr)) continue;

  for (const pName of Object.keys(paramSensD)) {
    const pVal = row.params[pName];
    if (pVal === undefined) continue;
    if (!paramSensD[pName][pVal]) paramSensD[pName][pVal] = [];
    paramSensD[pName][pVal].push({ wr, count: h5.count });
  }
}

for (const [pName, vals] of Object.entries(paramSensD)) {
  console.log(`\n  ${pName}:`);
  const sorted = Object.entries(vals).sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [pVal, entries] of sorted) {
    const avgWr = entries.reduce((s, e) => s + e.wr, 0) / entries.length;
    console.log(`    ${pVal}: avg WR = ${avgWr.toFixed(1)}%, combos = ${entries.length}`);
  }
}

// ============================================================
// ANALYSIS 6: Per-symbol analysis
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS 6: PER-SYMBOL DIVERGENCE+BB EDGE');
console.log('='.repeat(80));

// For each symbol, compute avg WR for categories D and E across all horizons and param combos
const symbolEdge = {};

for (const row of parsed) {
  if (!symbolEdge[row.symbol]) symbolEdge[row.symbol] = { D: {}, E: {}, A: {} };

  for (const cat of ['A', 'D', 'E']) {
    const catData = row.results[cat];
    if (!catData) continue;

    for (const h of HORIZONS) {
      const hData = catData[h];
      if (!hData || hData.count < 5) continue;
      const wr = parseFloat(hData.winRate);
      if (isNaN(wr)) continue;

      if (!symbolEdge[row.symbol][cat][h]) symbolEdge[row.symbol][cat][h] = [];
      symbolEdge[row.symbol][cat][h].push({ wr, count: hData.count, runType: row.runType });
    }
  }
}

console.log('\nPer-symbol average WR at 5d horizon (across all param combos and run types):');
console.log('Symbol  | Cat A WR (N) | Cat D WR (N) | Cat E WR (N) | D Lift | E Lift');
console.log('-'.repeat(85));

for (const symbol of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'MSFT', 'IBIT']) {
  const se = symbolEdge[symbol];
  if (!se) continue;

  const getAvg = (cat, h) => {
    const entries = se[cat][h];
    if (!entries || entries.length === 0) return { wr: NaN, n: 0 };
    return {
      wr: entries.reduce((s, e) => s + e.wr, 0) / entries.length,
      n: entries.reduce((s, e) => s + e.count, 0)
    };
  };

  const a5 = getAvg('A', '5d');
  const d5 = getAvg('D', '5d');
  const e5 = getAvg('E', '5d');

  const dLift = (!isNaN(d5.wr) && !isNaN(a5.wr)) ? d5.wr - a5.wr : NaN;
  const eLift = (!isNaN(e5.wr) && !isNaN(a5.wr)) ? e5.wr - a5.wr : NaN;

  console.log(
    `${symbol.padEnd(8)}` +
    `| ${isNaN(a5.wr) ? 'N/A' : a5.wr.toFixed(1) + '%'}`.padEnd(14) +
    `| ${isNaN(d5.wr) ? 'N/A' : d5.wr.toFixed(1) + '%'}`.padEnd(14) +
    `| ${isNaN(e5.wr) ? 'N/A' : e5.wr.toFixed(1) + '%'}`.padEnd(14) +
    `| ${isNaN(dLift) ? 'N/A' : (dLift > 0 ? '+' : '') + dLift.toFixed(1) + '%'}`.padEnd(9) +
    `| ${isNaN(eLift) ? 'N/A' : (eLift > 0 ? '+' : '') + eLift.toFixed(1) + '%'}`
  );
}

// Per-symbol detail: best single combo (cat E, any horizon)
console.log('\nBest single Category E result per symbol (any horizon, any params):');
const bestPerSymbol = {};
for (const r of catE_results) {
  if (!bestPerSymbol[r.symbol] || r.winRate > bestPerSymbol[r.symbol].winRate) {
    bestPerSymbol[r.symbol] = r;
  }
}

for (const symbol of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'MSFT', 'IBIT']) {
  const best = bestPerSymbol[symbol];
  if (best) {
    const p = best.params;
    console.log(`  ${symbol}: ${best.winRate.toFixed(1)}% WR, N=${best.count}, horizon=${best.horizon}, ` +
      `${best.runType}, rsi=${p.rsiThreshold} bb=${p.bbThreshold} swing=${p.minSwingBars}-${p.maxSwingBars}`);
  } else {
    console.log(`  ${symbol}: No Cat E results with N >= ${MIN_COUNT}`);
  }
}

// ============================================================
// FINAL SUMMARY: Actionable findings for Bloodhound scoring
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('FINAL SUMMARY: ACTIONABLE FINDINGS');
console.log('='.repeat(80));

// Count how many Cat E combos exceed thresholds by horizon
console.log('\nCategory E WR threshold counts by horizon:');
console.log('Horizon | >= 55% | >= 60% | >= 65% | >= 70% | >= 75% | Total');
console.log('-'.repeat(70));
for (const h of HORIZONS) {
  const hResults = catE_results.filter(r => r.horizon === h);
  const row = [h.padEnd(8)];
  for (const thresh of [55, 60, 65, 70, 75]) {
    row.push(`| ${String(hResults.filter(r => r.winRate >= thresh).length).padEnd(7)}`);
  }
  row.push(`| ${hResults.length}`);
  console.log(row.join(''));
}

// Count how many Cat D combos exceed thresholds by horizon
console.log('\nCategory D WR threshold counts by horizon:');
console.log('Horizon | >= 55% | >= 60% | >= 65% | >= 70% | >= 75% | Total');
console.log('-'.repeat(70));

const catD_results = [];
for (const row of parsed) {
  const catD = row.results.D;
  if (!catD || catD.count < MIN_COUNT) continue;
  for (const h of HORIZONS) {
    const hData = catD[h];
    if (!hData || hData.count < MIN_COUNT) continue;
    const wr = parseFloat(hData.winRate);
    if (isNaN(wr)) continue;
    catD_results.push({ horizon: h, winRate: wr, count: hData.count, symbol: row.symbol, runType: row.runType, params: row.params });
  }
}

for (const h of HORIZONS) {
  const hResults = catD_results.filter(r => r.horizon === h);
  const row = [h.padEnd(8)];
  for (const thresh of [55, 60, 65, 70, 75]) {
    row.push(`| ${String(hResults.filter(r => r.winRate >= thresh).length).padEnd(7)}`);
  }
  row.push(`| ${hResults.length}`);
  console.log(row.join(''));
}

// E_vix best combos - compact
console.log('\nE_vix (triple confluence + VIX regime): Top combos above 70% WR:');
const evix70 = vixResults.filter(r => r.category === 'E_vix' && r.winRate >= 70);
evix70.sort((a, b) => b.winRate - a.winRate);
for (const r of evix70.slice(0, 20)) {
  console.log(`  ${r.winRate.toFixed(1)}% | N=${r.count} | ${r.regime} | ${r.symbol} | ${r.horizon} | ${r.runType}`);
}
if (evix70.length === 0) {
  console.log('  (none with N >= 10)');
  // Try N >= 5
  const evix70_5 = [];
  for (const row of parsed) {
    const eVix = row.results.E_vix;
    if (!eVix) continue;
    for (const [regime, regimeData] of Object.entries(eVix)) {
      if (typeof regimeData !== 'object' || !regimeData.count) continue;
      if (regimeData.count < 5) continue;
      for (const h of HORIZONS) {
        const hData = regimeData[h];
        if (!hData || hData.count < 5) continue;
        const wr = parseFloat(hData.winRate);
        if (wr >= 70) {
          evix70_5.push({ winRate: wr, count: hData.count, regime, symbol: row.symbol, horizon: h, runType: row.runType });
        }
      }
    }
  }
  evix70_5.sort((a, b) => b.winRate - a.winRate);
  console.log(`  With N >= 5: ${evix70_5.length} results`);
  for (const r of evix70_5.slice(0, 15)) {
    console.log(`    ${r.winRate.toFixed(1)}% | N=${r.count} | ${r.regime} | ${r.symbol} | ${r.horizon} | ${r.runType}`);
  }
}

db.close();
