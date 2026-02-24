#!/usr/bin/env node
/**
 * Part 2: Robustness analysis and return profiles for divergence+BB.
 */

const Database = require('better-sqlite3');
const db = new Database('/home/bigpic/github/wingman/data/wingman.db', { readonly: true });

const HORIZONS = ['1d', '3d', '5d', '10d', '20d'];
const MIN_COUNT = 10;

const rows = db.prepare(`
  SELECT run_type, symbol, ma_type, results_json
  FROM ma_backtest_runs
  WHERE run_type LIKE 'divergence_bb%'
`).all();

const parsed = rows.map(r => {
  try {
    return {
      runType: r.run_type,
      symbol: r.symbol,
      params: JSON.parse(r.ma_type),
      results: JSON.parse(r.results_json)
    };
  } catch { return null; }
}).filter(Boolean);

// ============================================================
// ROBUSTNESS: For each symbol/runType, what % of param combos
// produce 65%+ WR at each horizon for Cat D and Cat E?
// ============================================================
console.log('='.repeat(80));
console.log('ROBUSTNESS: % of param combos that hit 65%+ WR');
console.log('='.repeat(80));

const robustness = {};

for (const row of parsed) {
  for (const cat of ['D', 'E']) {
    const catData = row.results[cat];
    if (!catData || catData.count < MIN_COUNT) continue;

    for (const h of HORIZONS) {
      const hData = catData[h];
      if (!hData || hData.count < MIN_COUNT) continue;
      const wr = parseFloat(hData.winRate);
      if (isNaN(wr)) continue;

      const key = `${row.symbol}|${row.runType}|${cat}|${h}`;
      if (!robustness[key]) robustness[key] = { total: 0, above65: 0, above60: 0, above55: 0, wrs: [] };
      robustness[key].total++;
      robustness[key].wrs.push(wr);
      if (wr >= 65) robustness[key].above65++;
      if (wr >= 60) robustness[key].above60++;
      if (wr >= 55) robustness[key].above55++;
    }
  }
}

// Show only combos where a meaningful % hit 65%+
console.log('\nSymbol/RunType/Cat/Horizon where >= 30% of param combos hit 65%+ WR:');
console.log('Symbol  | RunType                    | Cat | Horizon | %>=65 | %>=60 | %>=55 | AvgWR | N combos');
console.log('-'.repeat(105));

const robArr = Object.entries(robustness)
  .map(([key, v]) => {
    const [symbol, runType, cat, horizon] = key.split('|');
    return {
      symbol, runType, cat, horizon,
      pct65: (v.above65 / v.total * 100),
      pct60: (v.above60 / v.total * 100),
      pct55: (v.above55 / v.total * 100),
      avgWr: v.wrs.reduce((s, w) => s + w, 0) / v.wrs.length,
      total: v.total
    };
  })
  .filter(r => r.pct65 >= 30)
  .sort((a, b) => b.pct65 - a.pct65);

for (const r of robArr.slice(0, 40)) {
  console.log(
    `${r.symbol.padEnd(8)}` +
    `| ${r.runType.padEnd(27)}` +
    `| ${r.cat.padEnd(4)}` +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.pct65.toFixed(0)}%`.padEnd(7) +
    `| ${r.pct60.toFixed(0)}%`.padEnd(7) +
    `| ${r.pct55.toFixed(0)}%`.padEnd(7) +
    `| ${r.avgWr.toFixed(1)}%`.padEnd(7) +
    `| ${r.total}`
  );
}

// ============================================================
// AVERAGE RETURNS: For Cat D and E, what are the avg returns?
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('AVERAGE RETURNS BY CATEGORY (across all param combos, N>=10)');
console.log('='.repeat(80));

// Aggregate by symbol/runType/cat/horizon
const returnData = {};

for (const row of parsed) {
  for (const cat of ['A', 'B', 'C', 'D', 'E']) {
    const catData = row.results[cat];
    if (!catData || catData.count < MIN_COUNT) continue;

    for (const h of HORIZONS) {
      const hData = catData[h];
      if (!hData || hData.count < MIN_COUNT) continue;
      const avgRet = parseFloat(hData.avgReturn);
      const med = parseFloat(hData.median);
      const wr = parseFloat(hData.winRate);
      if (isNaN(avgRet) || isNaN(wr)) continue;

      const key = `${row.symbol}|${cat}|${h}`;
      if (!returnData[key]) returnData[key] = { returns: [], medians: [], wrs: [], counts: [], symbol: row.symbol, cat, horizon: h };
      returnData[key].returns.push(avgRet);
      returnData[key].medians.push(isNaN(med) ? 0 : med);
      returnData[key].wrs.push(wr);
      returnData[key].counts.push(hData.count);
    }
  }
}

// Show bullish daily only (divergence_bb) for cleaner comparison
console.log('\nBullish signals — Avg Return by Category at 5d horizon:');
console.log('Symbol  | Cat A Return | Cat D Return | Cat E Return | D vs A   | E vs A');
console.log('-'.repeat(80));

for (const symbol of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'MSFT', 'IBIT']) {
  const getStats = (cat) => {
    const key = `${symbol}|${cat}|5d`;
    const d = returnData[key];
    if (!d) return { avgRet: NaN, avgWr: NaN };
    return {
      avgRet: d.returns.reduce((s, v) => s + v, 0) / d.returns.length,
      avgWr: d.wrs.reduce((s, v) => s + v, 0) / d.wrs.length
    };
  };

  const a = getStats('A');
  const d = getStats('D');
  const e = getStats('E');

  const dLift = (!isNaN(d.avgRet) && !isNaN(a.avgRet)) ? d.avgRet - a.avgRet : NaN;
  const eLift = (!isNaN(e.avgRet) && !isNaN(a.avgRet)) ? e.avgRet - a.avgRet : NaN;

  console.log(
    `${symbol.padEnd(8)}` +
    `| ${isNaN(a.avgRet) ? 'N/A' : a.avgRet.toFixed(3) + '%'}`.padEnd(14) +
    `| ${isNaN(d.avgRet) ? 'N/A' : d.avgRet.toFixed(3) + '%'}`.padEnd(14) +
    `| ${isNaN(e.avgRet) ? 'N/A' : e.avgRet.toFixed(3) + '%'}`.padEnd(14) +
    `| ${isNaN(dLift) ? 'N/A' : (dLift > 0 ? '+' : '') + dLift.toFixed(3) + '%'}`.padEnd(10) +
    `| ${isNaN(eLift) ? 'N/A' : (eLift > 0 ? '+' : '') + eLift.toFixed(3) + '%'}`
  );
}

// ============================================================
// BULLISH vs BEARISH: Which direction has better divergence edge?
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('BULLISH vs BEARISH DIRECTION COMPARISON');
console.log('='.repeat(80));

const dirComparison = {};

for (const row of parsed) {
  const direction = row.runType.includes('bear') ? 'bearish' : 'bullish';
  const timeframe = row.runType.includes('4h') ? '4h' : 'daily';

  for (const cat of ['D', 'E']) {
    const catData = row.results[cat];
    if (!catData || catData.count < MIN_COUNT) continue;

    for (const h of HORIZONS) {
      const hData = catData[h];
      if (!hData || hData.count < MIN_COUNT) continue;
      const wr = parseFloat(hData.winRate);
      if (isNaN(wr)) continue;

      const key = `${row.symbol}|${direction}|${timeframe}|${cat}|${h}`;
      if (!dirComparison[key]) dirComparison[key] = [];
      dirComparison[key].push(wr);
    }
  }
}

console.log('\nAvg WR by direction (daily timeframe, Cat D at 5d):');
console.log('Symbol  | Bullish WR | Bearish WR | Bull N | Bear N');
console.log('-'.repeat(60));

for (const symbol of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'MSFT', 'IBIT']) {
  const bullKey = `${symbol}|bullish|daily|D|5d`;
  const bearKey = `${symbol}|bearish|daily|D|5d`;
  const bull = dirComparison[bullKey] || [];
  const bear = dirComparison[bearKey] || [];

  const bullAvg = bull.length ? (bull.reduce((s, w) => s + w, 0) / bull.length) : NaN;
  const bearAvg = bear.length ? (bear.reduce((s, w) => s + w, 0) / bear.length) : NaN;

  console.log(
    `${symbol.padEnd(8)}` +
    `| ${isNaN(bullAvg) ? 'N/A' : bullAvg.toFixed(1) + '%'}`.padEnd(12) +
    `| ${isNaN(bearAvg) ? 'N/A' : bearAvg.toFixed(1) + '%'}`.padEnd(12) +
    `| ${bull.length}`.padEnd(9) +
    `| ${bear.length}`
  );
}

// ============================================================
// BEST OVERALL COMBOS: top 30 by WR with N >= 15 (more robust)
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('TOP COMBOS WITH N >= 15 (higher confidence)');
console.log('='.repeat(80));

const highN = [];
for (const row of parsed) {
  const catE = row.results.E;
  if (!catE || catE.count < 15) continue;

  for (const h of HORIZONS) {
    const hData = catE[h];
    if (!hData || hData.count < 15) continue;
    const wr = parseFloat(hData.winRate);
    if (isNaN(wr)) continue;

    highN.push({
      symbol: row.symbol,
      runType: row.runType,
      horizon: h,
      winRate: wr,
      count: hData.count,
      avgReturn: parseFloat(hData.avgReturn) || 0,
      params: row.params
    });
  }
}

highN.sort((a, b) => b.winRate - a.winRate);
console.log('\nCat E with N >= 15:');
console.log('WinRate | N    | AvgRet | Horizon | Symbol | RunType                    | Params');
console.log('-'.repeat(110));
for (const r of highN.slice(0, 30)) {
  const p = r.params;
  console.log(
    `${r.winRate.toFixed(1)}%`.padEnd(8) +
    `| ${String(r.count).padEnd(5)}` +
    `| ${(r.avgReturn >= 0 ? '+' : '') + r.avgReturn.toFixed(2)}%`.padEnd(8) +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.symbol.padEnd(7)}` +
    `| ${r.runType.padEnd(27)}` +
    `| rsi=${p.rsiThreshold} bb=${p.bbThreshold} swing=${p.minSwingBars}-${p.maxSwingBars}`
  );
}

// Same for Cat D with N >= 20
console.log('\nCat D with N >= 20:');
const highND = [];
for (const row of parsed) {
  const catD = row.results.D;
  if (!catD || catD.count < 20) continue;

  for (const h of HORIZONS) {
    const hData = catD[h];
    if (!hData || hData.count < 20) continue;
    const wr = parseFloat(hData.winRate);
    if (isNaN(wr)) continue;

    highND.push({
      symbol: row.symbol,
      runType: row.runType,
      horizon: h,
      winRate: wr,
      count: hData.count,
      avgReturn: parseFloat(hData.avgReturn) || 0,
      params: row.params
    });
  }
}

highND.sort((a, b) => b.winRate - a.winRate);
console.log('WinRate | N    | AvgRet | Horizon | Symbol | RunType                    | Params');
console.log('-'.repeat(110));
for (const r of highND.slice(0, 30)) {
  const p = r.params;
  console.log(
    `${r.winRate.toFixed(1)}%`.padEnd(8) +
    `| ${String(r.count).padEnd(5)}` +
    `| ${(r.avgReturn >= 0 ? '+' : '') + r.avgReturn.toFixed(2)}%`.padEnd(8) +
    `| ${r.horizon.padEnd(8)}` +
    `| ${r.symbol.padEnd(7)}` +
    `| ${r.runType.padEnd(27)}` +
    `| rsi=${p.rsiThreshold} bb=${p.bbThreshold} swing=${p.minSwingBars}-${p.maxSwingBars}`
  );
}

// ============================================================
// SWEET SPOT: What's the most common winning param set?
// ============================================================
console.log('\n' + '='.repeat(80));
console.log('PARAMETER SWEET SPOT ANALYSIS');
console.log('='.repeat(80));

// For Cat E results >= 65% WR with N >= 10, tally param values
const sweetSpot = { rsi: {}, bb: {}, minSwing: {}, maxSwing: {} };
const total65 = { count: 0 };

for (const row of parsed) {
  const catE = row.results.E;
  if (!catE || catE.count < 10) continue;

  for (const h of HORIZONS) {
    const hData = catE[h];
    if (!hData || hData.count < 10) continue;
    const wr = parseFloat(hData.winRate);
    if (wr < 65) continue;

    total65.count++;
    const p = row.params;
    sweetSpot.rsi[p.rsiThreshold] = (sweetSpot.rsi[p.rsiThreshold] || 0) + 1;
    sweetSpot.bb[p.bbThreshold] = (sweetSpot.bb[p.bbThreshold] || 0) + 1;
    sweetSpot.minSwing[p.minSwingBars] = (sweetSpot.minSwing[p.minSwingBars] || 0) + 1;
    sweetSpot.maxSwing[p.maxSwingBars] = (sweetSpot.maxSwing[p.maxSwingBars] || 0) + 1;
  }
}

console.log(`\nCat E combos >= 65% WR (N>=10): ${total65.count} total`);
for (const [name, vals] of Object.entries(sweetSpot)) {
  console.log(`\n  ${name}:`);
  const sorted = Object.entries(vals).sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const [val, cnt] of sorted) {
    console.log(`    ${val}: ${cnt} (${(cnt/total65.count*100).toFixed(1)}%)`);
  }
}

// Same for Cat D >= 65%
const sweetSpotD = { rsi: {}, bb: {}, minSwing: {}, maxSwing: {} };
const total65D = { count: 0 };

for (const row of parsed) {
  const catD = row.results.D;
  if (!catD || catD.count < 10) continue;

  for (const h of HORIZONS) {
    const hData = catD[h];
    if (!hData || hData.count < 10) continue;
    const wr = parseFloat(hData.winRate);
    if (wr < 65) continue;

    total65D.count++;
    const p = row.params;
    sweetSpotD.rsi[p.rsiThreshold] = (sweetSpotD.rsi[p.rsiThreshold] || 0) + 1;
    sweetSpotD.bb[p.bbThreshold] = (sweetSpotD.bb[p.bbThreshold] || 0) + 1;
    sweetSpotD.minSwing[p.minSwingBars] = (sweetSpotD.minSwing[p.minSwingBars] || 0) + 1;
    sweetSpotD.maxSwing[p.maxSwingBars] = (sweetSpotD.maxSwing[p.maxSwingBars] || 0) + 1;
  }
}

console.log(`\nCat D combos >= 65% WR (N>=10): ${total65D.count} total`);
for (const [name, vals] of Object.entries(sweetSpotD)) {
  console.log(`\n  ${name}:`);
  const sorted = Object.entries(vals).sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const [val, cnt] of sorted) {
    console.log(`    ${val}: ${cnt} (${(cnt/total65D.count*100).toFixed(1)}%)`);
  }
}

db.close();
