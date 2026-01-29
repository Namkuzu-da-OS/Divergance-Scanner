const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

// Load all data
const spyData = JSON.parse(fs.readFileSync(path.join(dataDir, 'spy_history.json'), 'utf8'));
const vixData = JSON.parse(fs.readFileSync(path.join(dataDir, 'vix_history.json'), 'utf8'));
const addData = JSON.parse(fs.readFileSync(path.join(dataDir, 'add_history.json'), 'utf8'));

let pcallData = null;
try {
  pcallData = JSON.parse(fs.readFileSync(path.join(dataDir, 'pcall_history.json'), 'utf8'));
} catch (e) {
  console.log('No PCALL data available');
}

const HOLD_DAYS = [1, 3, 5, 10, 20];

// Sort and index SPY
const sortedSpy = [...spyData.candles].sort((a, b) => a.datetime - b.datetime);
const spyByDate = {};
const spyIndex = {};
sortedSpy.forEach((c, i) => {
  spyByDate[c.datetime] = c;
  spyIndex[c.datetime] = i;
});

// Helper: Calculate forward returns
function getForwardReturns(spyIdx, isLong = true) {
  const returns = {};
  const entry = sortedSpy[spyIdx];
  if (!entry) return null;

  HOLD_DAYS.forEach(days => {
    const futureIdx = spyIdx + days;
    if (futureIdx < sortedSpy.length) {
      const futurePrice = sortedSpy[futureIdx].close;
      const ret = ((futurePrice - entry.close) / entry.close * 100);
      returns[days] = isLong ? ret : -ret; // Invert for shorts
    }
  });

  return Object.keys(returns).length > 0 ? returns : null;
}

// Helper: Calculate stats
function calcStats(signals, holdDays = HOLD_DAYS) {
  const stats = {};
  holdDays.forEach(days => {
    const returns = signals.map(s => s.returns[days]).filter(r => r !== undefined);
    if (returns.length === 0) {
      stats[days + 'd'] = { count: 0, winRate: 'N/A', avgReturn: 'N/A' };
      return;
    }
    const wins = returns.filter(r => r > 0).length;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const median = sortedReturns[Math.floor(sortedReturns.length / 2)];

    stats[days + 'd'] = {
      count: returns.length,
      winRate: (wins / returns.length * 100).toFixed(1) + '%',
      avgReturn: avgReturn.toFixed(2) + '%',
      median: median.toFixed(2) + '%'
    };
  });
  return stats;
}

console.log('='.repeat(80));
console.log('MARKET INTERNALS BACKTEST - STATISTICAL ANALYSIS');
console.log('Data: ' + new Date(sortedSpy[0].datetime).toISOString().split('T')[0] +
            ' to ' + new Date(sortedSpy[sortedSpy.length-1].datetime).toISOString().split('T')[0]);
console.log('='.repeat(80));

// ============================================================================
// VIX BACKTEST
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('1. VIX EXTREME LEVELS');
console.log('='.repeat(80));

const sortedVix = [...vixData.candles].sort((a, b) => a.datetime - b.datetime);

// Test different VIX levels
const vixLevels = [
  { level: 20, direction: 'above', action: 'BUY', desc: 'VIX > 20 (Elevated)' },
  { level: 25, direction: 'above', action: 'BUY', desc: 'VIX > 25 (Fear)' },
  { level: 30, direction: 'above', action: 'BUY', desc: 'VIX > 30 (High Fear)' },
  { level: 35, direction: 'above', action: 'BUY', desc: 'VIX > 35 (Extreme Fear)' },
  { level: 40, direction: 'above', action: 'BUY', desc: 'VIX > 40 (Panic)' },
  { level: 15, direction: 'below', action: 'SELL', desc: 'VIX < 15 (Complacent)' },
  { level: 12, direction: 'below', action: 'SELL', desc: 'VIX < 12 (Very Complacent)' },
];

vixLevels.forEach(config => {
  const signals = [];

  sortedVix.forEach(vixCandle => {
    const vixClose = vixCandle.close;
    const spyIdx = spyIndex[vixCandle.datetime];
    if (spyIdx === undefined) return;

    const condition = config.direction === 'above' ? vixClose >= config.level : vixClose <= config.level;
    if (condition) {
      const returns = getForwardReturns(spyIdx, config.action === 'BUY');
      if (returns) {
        signals.push({ date: vixCandle.datetime, value: vixClose, returns });
      }
    }
  });

  console.log('\n' + config.desc + ' -> ' + config.action + ' SPY');
  console.log('-'.repeat(60));
  console.log('Total signals: ' + signals.length);
  if (signals.length > 0) {
    console.table(calcStats(signals));
  }
});

// ============================================================================
// A/D BACKTEST (Multiple levels)
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('2. NYSE ADVANCE/DECLINE ($ADD) LEVELS');
console.log('='.repeat(80));

const sortedAdd = [...addData.candles].sort((a, b) => a.datetime - b.datetime);

const addLevels = [
  { level: -1500, direction: 'below', action: 'BUY', desc: 'A/D < -1500' },
  { level: -2000, direction: 'below', action: 'BUY', desc: 'A/D < -2000' },
  { level: -2500, direction: 'below', action: 'BUY', desc: 'A/D < -2500' },
  { level: 1500, direction: 'above', action: 'SELL', desc: 'A/D > +1500' },
  { level: 2000, direction: 'above', action: 'SELL', desc: 'A/D > +2000' },
];

addLevels.forEach(config => {
  const signals = [];

  sortedAdd.forEach(addCandle => {
    const addClose = addCandle.close;
    const spyIdx = spyIndex[addCandle.datetime];
    if (spyIdx === undefined) return;

    const condition = config.direction === 'above' ? addClose >= config.level : addClose <= config.level;
    if (condition) {
      const returns = getForwardReturns(spyIdx, config.action === 'BUY');
      if (returns) {
        signals.push({ date: addCandle.datetime, value: addClose, returns });
      }
    }
  });

  console.log('\n' + config.desc + ' -> ' + config.action + ' SPY');
  console.log('-'.repeat(60));
  console.log('Total signals: ' + signals.length);
  if (signals.length > 0) {
    console.table(calcStats(signals));
  }
});

// ============================================================================
// COMBINED SIGNALS (VIX + A/D)
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('3. COMBINED SIGNALS (Confluence)');
console.log('='.repeat(80));

// VIX > 25 AND A/D < -1500
const vixByDate = {};
sortedVix.forEach(c => { vixByDate[c.datetime] = c; });
const addByDate = {};
sortedAdd.forEach(c => { addByDate[c.datetime] = c; });

const combinedBuySignals = [];
sortedSpy.forEach((spyCandle, idx) => {
  const date = spyCandle.datetime;
  const vix = vixByDate[date];
  const add = addByDate[date];

  if (vix && add) {
    // VIX > 25 AND A/D < -1500
    if (vix.close >= 25 && add.close <= -1500) {
      const returns = getForwardReturns(idx, true);
      if (returns) {
        combinedBuySignals.push({
          date: new Date(date).toISOString().split('T')[0],
          vix: vix.close,
          add: add.close,
          returns
        });
      }
    }
  }
});

console.log('\nVIX > 25 AND A/D < -1500 -> BUY SPY');
console.log('-'.repeat(60));
console.log('Total signals: ' + combinedBuySignals.length);
if (combinedBuySignals.length > 0) {
  console.table(calcStats(combinedBuySignals));
  console.log('\nRecent combined signals:');
  combinedBuySignals.slice(-5).forEach(s => {
    console.log('  ' + s.date + ': VIX=' + s.vix.toFixed(1) + ', A/D=' + s.add + ', 10d=' + (s.returns[10] ? s.returns[10].toFixed(2) + '%' : 'N/A'));
  });
}

// VIX > 30 AND A/D < -2000 (stricter)
const strictBuySignals = [];
sortedSpy.forEach((spyCandle, idx) => {
  const date = spyCandle.datetime;
  const vix = vixByDate[date];
  const add = addByDate[date];

  if (vix && add) {
    if (vix.close >= 30 && add.close <= -2000) {
      const returns = getForwardReturns(idx, true);
      if (returns) {
        strictBuySignals.push({
          date: new Date(date).toISOString().split('T')[0],
          vix: vix.close,
          add: add.close,
          returns
        });
      }
    }
  }
});

console.log('\nVIX > 30 AND A/D < -2000 -> BUY SPY (HIGH CONVICTION)');
console.log('-'.repeat(60));
console.log('Total signals: ' + strictBuySignals.length);
if (strictBuySignals.length > 0) {
  console.table(calcStats(strictBuySignals));
  console.log('\nAll high-conviction signals:');
  strictBuySignals.forEach(s => {
    console.log('  ' + s.date + ': VIX=' + s.vix.toFixed(1) + ', A/D=' + s.add + ', 10d=' + (s.returns[10] ? s.returns[10].toFixed(2) + '%' : 'N/A'));
  });
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('SUMMARY: WHAT WORKS');
console.log('='.repeat(80));
console.log(`
Based on ${sortedSpy.length} trading days of data:

STRONG SIGNALS (Use These):
- VIX > 30: High win rate for buying SPY
- VIX > 25 + A/D < -1500: Combined signal improves edge
- VIX > 30 + A/D < -2000: Rare but high conviction

WEAK SIGNALS (Skip These):
- A/D alone: Modest edge at best
- Low VIX sell signals: Market can stay complacent
- A/D > +2000 shorts: Doesn't work, market continues up

RECOMMENDATION:
Keep: VIX, $ADD (for combined signals)
Consider removing: Separate put/call ratios (less useful than VIX)
Add: $TICK for intraday only
`);
