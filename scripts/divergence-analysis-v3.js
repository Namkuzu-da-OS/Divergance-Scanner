// Divergence Analysis v3 - Focus on Dec 29 vs Jan 21 (the actual bounce dates)
// And also check Nov lows for longer-term divergence

const https = require('https');

async function fetchYahoo(symbol) {
    const period1 = Math.floor((Date.now() - 180 * 24 * 60 * 60 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;

    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

function calculateRSI(prices, period = 14) {
    const rsiValues = [];
    let avgGain = 0, avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i-1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = 0; i < period; i++) rsiValues.push(null);

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));

    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i-1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiValues.push(100 - (100 / (1 + rs)));
    }
    return rsiValues;
}

async function analyzeSymbol(symbol) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${symbol}`);
    console.log('='.repeat(70));

    try {
        const data = await fetchYahoo(symbol);
        const result = data.chart?.result?.[0];
        if (!result?.timestamp) return null;

        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        const lows = result.indicators.quote[0].low;

        const dailyData = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null) {
                dailyData.push({
                    date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                    close: closes[i],
                    low: lows[i]
                });
            }
        }

        const closesPrices = dailyData.map(d => d.close);
        const rsi = calculateRSI(closesPrices, 14);

        // Find specific dates
        const findDate = (targetDate) => {
            const idx = dailyData.findIndex(d => d.date === targetDate);
            if (idx >= 0) return { ...dailyData[idx], rsi: rsi[idx], idx };
            return null;
        };

        // Find lowest RSI in date range
        const findLowestRSI = (startDate, endDate) => {
            let lowest = { rsi: 100 };
            for (let i = 0; i < dailyData.length; i++) {
                if (dailyData[i].date >= startDate && dailyData[i].date <= endDate) {
                    if (rsi[i] !== null && rsi[i] < lowest.rsi) {
                        lowest = { ...dailyData[i], rsi: rsi[i], idx: i };
                    }
                }
            }
            return lowest.rsi < 100 ? lowest : null;
        };

        // Find lowest price in date range
        const findLowestPrice = (startDate, endDate) => {
            let lowest = { low: Infinity };
            for (let i = 0; i < dailyData.length; i++) {
                if (dailyData[i].date >= startDate && dailyData[i].date <= endDate) {
                    if (dailyData[i].low < lowest.low) {
                        lowest = { ...dailyData[i], rsi: rsi[i], idx: i };
                    }
                }
            }
            return lowest.low < Infinity ? lowest : null;
        };

        // Three potential swing lows
        const novLow = findLowestPrice('2025-11-15', '2025-11-25');
        const decLow = findLowestPrice('2025-12-18', '2025-12-31');
        const janLow = findLowestPrice('2026-01-13', '2026-01-24');

        console.log('\n--- THREE POTENTIAL SWING LOWS ---');
        console.log('Looking for: Price lower low + RSI higher low = Bullish Divergence\n');

        if (novLow) console.log(`Nov Low:  ${novLow.date} | Price: $${novLow.low.toFixed(2)} | RSI: ${novLow.rsi?.toFixed(1) || 'N/A'}`);
        if (decLow) console.log(`Dec Low:  ${decLow.date} | Price: $${decLow.low.toFixed(2)} | RSI: ${decLow.rsi?.toFixed(1) || 'N/A'}`);
        if (janLow) console.log(`Jan Low:  ${janLow.date} | Price: $${janLow.low.toFixed(2)} | RSI: ${janLow.rsi?.toFixed(1) || 'N/A'}`);

        // Check Nov → Jan divergence (longer timeframe)
        let novToJanDivergence = false;
        if (novLow && janLow && novLow.rsi && janLow.rsi) {
            const priceLower = janLow.low < novLow.low;
            const rsiHigher = janLow.rsi > novLow.rsi;
            if (priceLower && rsiHigher) {
                console.log(`\n✅ NOV → JAN BULLISH DIVERGENCE`);
                console.log(`   Price: $${novLow.low.toFixed(2)} → $${janLow.low.toFixed(2)} (${((janLow.low - novLow.low) / novLow.low * 100).toFixed(1)}%)`);
                console.log(`   RSI:   ${novLow.rsi.toFixed(1)} → ${janLow.rsi.toFixed(1)} (+${(janLow.rsi - novLow.rsi).toFixed(1)})`);
                novToJanDivergence = true;
            }
        }

        // Check Dec → Jan divergence (shorter timeframe)
        let decToJanDivergence = false;
        if (decLow && janLow && decLow.rsi && janLow.rsi) {
            const priceLower = janLow.low < decLow.low;
            const rsiHigher = janLow.rsi > decLow.rsi;
            if (priceLower && rsiHigher) {
                console.log(`\n✅ DEC → JAN BULLISH DIVERGENCE`);
                console.log(`   Price: $${decLow.low.toFixed(2)} → $${janLow.low.toFixed(2)} (${((janLow.low - decLow.low) / decLow.low * 100).toFixed(1)}%)`);
                console.log(`   RSI:   ${decLow.rsi.toFixed(1)} → ${janLow.rsi.toFixed(1)} (+${(janLow.rsi - decLow.rsi).toFixed(1)})`);
                decToJanDivergence = true;
            }
        }

        // Check for double bottom
        let doubleBottom = false;
        if (decLow && janLow) {
            const priceSimilar = Math.abs(janLow.low - decLow.low) / decLow.low < 0.03;
            if (priceSimilar) {
                console.log(`\n🔄 DOUBLE BOTTOM (Dec → Jan prices within 3%)`);
                doubleBottom = true;
            }
        }

        if (!novToJanDivergence && !decToJanDivergence && !doubleBottom) {
            console.log(`\n❌ No divergence or double bottom pattern`);
        }

        // What actually triggered the trade?
        console.log('\n--- WHAT TRIGGERED THE TRADE? ---');
        if (janLow && janLow.rsi) {
            if (janLow.rsi < 30) {
                console.log(`🎯 RSI at Jan low: ${janLow.rsi.toFixed(1)} → OVERSOLD TRIGGER (< 30)`);
            } else if (janLow.rsi < 35) {
                console.log(`👀 RSI at Jan low: ${janLow.rsi.toFixed(1)} → Low but not oversold (< 35)`);
            } else {
                console.log(`⚪ RSI at Jan low: ${janLow.rsi.toFixed(1)} → Not oversold`);
            }
        }

        return {
            symbol,
            novLow: novLow ? { date: novLow.date, price: novLow.low, rsi: novLow.rsi } : null,
            decLow: decLow ? { date: decLow.date, price: decLow.low, rsi: decLow.rsi } : null,
            janLow: janLow ? { date: janLow.date, price: janLow.low, rsi: janLow.rsi } : null,
            novToJanDivergence,
            decToJanDivergence,
            doubleBottom,
            janRSI: janLow?.rsi
        };

    } catch (err) {
        console.log(`Error: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('RSI DIVERGENCE - COMPREHENSIVE CHECK');
    console.log('Checking both Nov→Jan and Dec→Jan windows');
    console.log('');

    const symbols = ['MSFT', 'META', 'TSLA', 'AAPL'];
    const results = [];

    for (const symbol of symbols) {
        const result = await analyzeSymbol(symbol);
        if (result) results.push(result);
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n' + '='.repeat(70));
    console.log('FINAL VERDICT');
    console.log('='.repeat(70));

    console.log('\nSymbol | Nov→Jan Div | Dec→Jan Div | Double Bottom | Jan RSI | Entry Signal');
    console.log('-'.repeat(80));

    for (const r of results) {
        const novJan = r.novToJanDivergence ? '✅' : '❌';
        const decJan = r.decToJanDivergence ? '✅' : '❌';
        const db = r.doubleBottom ? '✅' : '❌';
        const rsi = r.janRSI?.toFixed(1) || 'N/A';
        const signal = r.janRSI < 30 ? 'OVERSOLD' : r.janRSI < 35 ? 'Low' : 'Neutral';
        console.log(`${r.symbol.padEnd(6)} | ${novJan.padEnd(11)} | ${decJan.padEnd(11)} | ${db.padEnd(13)} | ${rsi.padStart(7)} | ${signal}`);
    }

    const withAnyPattern = results.filter(r => r.novToJanDivergence || r.decToJanDivergence || r.doubleBottom);
    const withOversold = results.filter(r => r.janRSI && r.janRSI < 35);

    console.log('\n--- CONCLUSION ---');
    console.log(`Stocks with ANY divergence/double bottom pattern: ${withAnyPattern.length}/${results.length}`);
    console.log(`Stocks with RSI < 35 at Jan low: ${withOversold.length}/${results.length}`);

    if (withAnyPattern.length <= 1) {
        console.log('\n📊 DIVERGENCE is NOT a reliable signal for this group');
        console.log('   The winning trades were triggered by RSI < 35 + support + flow');
        console.log('   Divergence adds complexity without adding edge');
    } else {
        console.log('\n📊 DIVERGENCE shows some consistency');
        console.log('   May be worth tracking as confluence factor');
    }
}

main().catch(console.error);
