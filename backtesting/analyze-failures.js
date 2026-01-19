/**
 * Analyze failed signals to understand patterns
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/paper_trades.json');

function loadSignals() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return data.trades || [];
}

function checkDirectionCorrect(direction, entryPrice, currentPrice) {
    const pctChange = ((currentPrice - entryPrice) / entryPrice) * 100;
    if (direction === 'bullish') return { correct: pctChange >= 0.5, pctChange };
    if (direction === 'bearish') return { correct: pctChange <= -0.5, pctChange };
    if (direction === 'pinned') return { correct: Math.abs(pctChange) <= 1.0, pctChange };
    return { correct: null, pctChange };
}

const signals = loadSignals();

// Analyze BEARISH failures
console.log('\n' + '='.repeat(70));
console.log('BEARISH SIGNAL FAILURES (16.4% win rate)');
console.log('='.repeat(70));

const bearishSignals = signals.filter(s => s.direction === 'bearish');
const bearishFailed = bearishSignals.filter(s => {
    const price = s.outcome?.price_24h || s.outcome?.price_4h || s.outcome?.price_1h;
    if (!price || !s.entry?.price) return false;
    const result = checkDirectionCorrect('bearish', s.entry.price, price);
    return result.correct === false;
});

console.log(`\nTotal bearish: ${bearishSignals.length}, Failed: ${bearishFailed.length}`);
console.log('\nFailed bearish signal patterns:');

// Group by zone
const bearishByZone = {};
bearishFailed.forEach(s => {
    const zone = s.entry?.zone || 'UNKNOWN';
    bearishByZone[zone] = (bearishByZone[zone] || 0) + 1;
});
console.log('\nBy Zone:');
Object.entries(bearishByZone).sort((a,b) => b[1] - a[1]).forEach(([zone, count]) => {
    console.log(`  ${zone}: ${count}`);
});

// Look at signals that triggered bearish
console.log('\nCommon signals in failed bearish:');
const bearishSignalCounts = {};
bearishFailed.forEach(s => {
    (s.entry?.signals || []).forEach(sig => {
        bearishSignalCounts[sig] = (bearishSignalCounts[sig] || 0) + 1;
    });
});
Object.entries(bearishSignalCounts).sort((a,b) => b[1] - a[1]).slice(0, 15).forEach(([sig, count]) => {
    console.log(`  [${count}x] ${sig}`);
});

// Sample of actual failed bearish trades
console.log('\n--- Sample Failed Bearish Trades ---');
bearishFailed.slice(0, 5).forEach(s => {
    const price24h = s.outcome?.price_24h || s.outcome?.price_4h || 'N/A';
    const pctChange = price24h !== 'N/A' ? (((price24h - s.entry.price) / s.entry.price) * 100).toFixed(2) : 'N/A';
    console.log(`\n${s.symbol} @ $${s.entry.price} → $${price24h} (${pctChange}%)`);
    console.log(`  Zone: ${s.entry.zone}, Score: ${s.entry.score}`);
    console.log(`  Signals: ${(s.entry.signals || []).slice(0, 5).join(', ')}`);
});

// Analyze HIGH_CONVICTION failures
console.log('\n\n' + '='.repeat(70));
console.log('HIGH_CONVICTION vs WATCH ANALYSIS');
console.log('='.repeat(70));

const highConv = signals.filter(s => s.signal_type === 'HIGH_CONVICTION');
const watch = signals.filter(s => s.signal_type === 'WATCH');

console.log(`\nHIGH_CONVICTION: ${highConv.length} signals`);
console.log(`WATCH: ${watch.length} signals`);

// What makes HIGH_CONVICTION different?
console.log('\n--- HIGH_CONVICTION breakdown by direction ---');
const hcByDir = {};
highConv.forEach(s => {
    hcByDir[s.direction] = (hcByDir[s.direction] || 0) + 1;
});
Object.entries(hcByDir).forEach(([dir, count]) => console.log(`  ${dir}: ${count}`));

console.log('\n--- WATCH breakdown by direction ---');
const watchByDir = {};
watch.forEach(s => {
    watchByDir[s.direction] = (watchByDir[s.direction] || 0) + 1;
});
Object.entries(watchByDir).forEach(([dir, count]) => console.log(`  ${dir}: ${count}`));

// HIGH_CONVICTION by zone
console.log('\n--- HIGH_CONVICTION by zone ---');
const hcByZone = {};
highConv.forEach(s => {
    hcByZone[s.entry?.zone] = (hcByZone[s.entry?.zone] || 0) + 1;
});
Object.entries(hcByZone).sort((a,b) => b[1] - a[1]).forEach(([zone, count]) => console.log(`  ${zone}: ${count}`));

// WATCH by zone
console.log('\n--- WATCH by zone ---');
const watchByZone = {};
watch.forEach(s => {
    watchByZone[s.entry?.zone] = (watchByZone[s.entry?.zone] || 0) + 1;
});
Object.entries(watchByZone).sort((a,b) => b[1] - a[1]).forEach(([zone, count]) => console.log(`  ${zone}: ${count}`));

// EXTENDED_HIGH analysis
console.log('\n\n' + '='.repeat(70));
console.log('EXTENDED_HIGH ANALYSIS (4.5% win rate)');
console.log('='.repeat(70));

const extHigh = signals.filter(s => s.entry?.zone === 'EXTENDED_HIGH');
console.log(`\nTotal EXTENDED_HIGH signals: ${extHigh.length}`);

console.log('\n--- Signals in EXTENDED_HIGH ---');
const extHighSignals = {};
extHigh.forEach(s => {
    (s.entry?.signals || []).forEach(sig => {
        extHighSignals[sig] = (extHighSignals[sig] || 0) + 1;
    });
});
Object.entries(extHighSignals).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([sig, count]) => {
    console.log(`  [${count}x] ${sig}`);
});

console.log('\n--- EXTENDED_HIGH by direction ---');
const extHighByDir = {};
extHigh.forEach(s => {
    extHighByDir[s.direction] = (extHighByDir[s.direction] || 0) + 1;
});
Object.entries(extHighByDir).forEach(([dir, count]) => console.log(`  ${dir}: ${count}`));

// SELL_ZONE analysis
console.log('\n\n' + '='.repeat(70));
console.log('SELL_ZONE ANALYSIS (31% win rate)');
console.log('='.repeat(70));

const sellZone = signals.filter(s => s.entry?.zone === 'SELL_ZONE');
console.log(`\nTotal SELL_ZONE signals: ${sellZone.length}`);

console.log('\n--- SELL_ZONE by direction ---');
const sellByDir = {};
sellZone.forEach(s => {
    sellByDir[s.direction] = (sellByDir[s.direction] || 0) + 1;
});
Object.entries(sellByDir).forEach(([dir, count]) => console.log(`  ${dir}: ${count}`));

const sellFailed = sellZone.filter(s => {
    const price = s.outcome?.price_24h || s.outcome?.price_4h || s.outcome?.price_1h;
    if (!price || !s.entry?.price) return false;
    const result = checkDirectionCorrect(s.direction, s.entry.price, price);
    return result.correct === false;
});

console.log('\n--- Failed SELL_ZONE signals ---');
const sellFailedSignals = {};
sellFailed.forEach(s => {
    (s.entry?.signals || []).forEach(sig => {
        sellFailedSignals[sig] = (sellFailedSignals[sig] || 0) + 1;
    });
});
Object.entries(sellFailedSignals).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([sig, count]) => {
    console.log(`  [${count}x] ${sig}`);
});

console.log('\n\nDone.');
