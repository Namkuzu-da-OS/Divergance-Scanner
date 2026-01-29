const fs = require('fs');

// Load data
const path = require('path');
const dataDir = path.join(__dirname, '..', 'data');
const addData = JSON.parse(fs.readFileSync(path.join(dataDir, 'add_history.json'), 'utf8'));
const spyData = JSON.parse(fs.readFileSync(path.join(dataDir, 'spy_history.json'), 'utf8'));

// Config
const OVERSOLD_LEVEL = -2000;
const OVERBOUGHT_LEVEL = 2000;
const HOLD_DAYS = [1, 3, 5, 10];

// Results
const oversoldSignals = [];
const overboughtSignals = [];

// Sort candles by date
const sortedAdd = [...addData.candles].sort((a, b) => a.datetime - b.datetime);
const sortedSpy = [...spyData.candles].sort((a, b) => a.datetime - b.datetime);

// Create SPY index lookup
const spyIndex = {};
sortedSpy.forEach((c, i) => {
  spyIndex[c.datetime] = i;
});

// Find signals
sortedAdd.forEach((addCandle, i) => {
  const addClose = addCandle.close;
  const date = addCandle.datetime;
  const spyIdx = spyIndex[date];

  if (spyIdx === undefined) return;

  const spyEntry = sortedSpy[spyIdx];
  if (!spyEntry) return;

  // Check oversold (potential buy)
  if (addClose <= OVERSOLD_LEVEL) {
    const signal = {
      date: new Date(date).toISOString().split('T')[0],
      addValue: addClose,
      spyEntry: spyEntry.close,
      returns: {}
    };

    // Calculate forward returns
    HOLD_DAYS.forEach(days => {
      const futureIdx = spyIdx + days;
      if (futureIdx < sortedSpy.length) {
        const futurePrice = sortedSpy[futureIdx].close;
        signal.returns[days] = ((futurePrice - spyEntry.close) / spyEntry.close * 100).toFixed(2);
      }
    });

    if (Object.keys(signal.returns).length > 0) {
      oversoldSignals.push(signal);
    }
  }

  // Check overbought (potential sell)
  if (addClose >= OVERBOUGHT_LEVEL) {
    const signal = {
      date: new Date(date).toISOString().split('T')[0],
      addValue: addClose,
      spyEntry: spyEntry.close,
      returns: {}
    };

    // Calculate forward returns (negative = good for short)
    HOLD_DAYS.forEach(days => {
      const futureIdx = spyIdx + days;
      if (futureIdx < sortedSpy.length) {
        const futurePrice = sortedSpy[futureIdx].close;
        signal.returns[days] = ((futurePrice - spyEntry.close) / spyEntry.close * 100).toFixed(2);
      }
    });

    if (Object.keys(signal.returns).length > 0) {
      overboughtSignals.push(signal);
    }
  }
});

// Calculate stats
function calcStats(signals, isLong) {
  const stats = {};
  HOLD_DAYS.forEach(days => {
    const returns = signals.map(s => parseFloat(s.returns[days])).filter(r => !isNaN(r));
    const wins = returns.filter(r => isLong ? r > 0 : r < 0).length;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const maxWin = isLong ? Math.max(...returns) : Math.min(...returns);
    const maxLoss = isLong ? Math.min(...returns) : Math.max(...returns);

    stats[days + 'd'] = {
      count: returns.length,
      winRate: (wins / returns.length * 100).toFixed(1) + '%',
      avgReturn: avgReturn.toFixed(2) + '%',
      maxWin: maxWin.toFixed(2) + '%',
      maxLoss: maxLoss.toFixed(2) + '%'
    };
  });
  return stats;
}

console.log('======================================================================');
console.log('NYSE ADVANCE-DECLINE EXTREME LEVELS BACKTEST');
console.log('Data range: ' + new Date(sortedAdd[0].datetime).toISOString().split('T')[0] +
            ' to ' + new Date(sortedAdd[sortedAdd.length-1].datetime).toISOString().split('T')[0]);
console.log('======================================================================');

console.log('\nOVERSOLD SIGNALS (A/D <= -2000) - BUY SPY');
console.log('----------------------------------------------------------------------');
console.log('Total signals: ' + oversoldSignals.length);
console.log('\nForward Returns:');
const oversoldStats = calcStats(oversoldSignals, true);
console.table(oversoldStats);

console.log('\nRecent Oversold Signals:');
oversoldSignals.slice(-10).forEach(s => {
  console.log('  ' + s.date + ': A/D=' + s.addValue + ', SPY=' + s.spyEntry.toFixed(2) + ', 5d return=' + s.returns[5] + '%');
});

console.log('\nOVERBOUGHT SIGNALS (A/D >= +2000) - SELL/SHORT SPY');
console.log('----------------------------------------------------------------------');
console.log('Total signals: ' + overboughtSignals.length);
console.log('\nForward Returns (negative = profitable short):');
const overboughtStats = calcStats(overboughtSignals, false);
console.table(overboughtStats);

console.log('\nRecent Overbought Signals:');
overboughtSignals.slice(-10).forEach(s => {
  console.log('  ' + s.date + ': A/D=' + s.addValue + ', SPY=' + s.spyEntry.toFixed(2) + ', 5d return=' + s.returns[5] + '%');
});

// Test different levels
console.log('\n======================================================================');
console.log('LEVEL SENSITIVITY ANALYSIS');
console.log('======================================================================');

[-1500, -1800, -2000, -2200, -2500].forEach(level => {
  const signals = sortedAdd.filter(c => c.close <= level).length;
  console.log('A/D <= ' + level + ': ' + signals + ' signals');
});

console.log('');

[1500, 1800, 2000, 2200, 2500].forEach(level => {
  const signals = sortedAdd.filter(c => c.close >= level).length;
  console.log('A/D >= +' + level + ': ' + signals + ' signals');
});
