// Divergence Analysis - Objective look at RSI patterns for Mag 7
// Dates of interest: Dec 29 low, Jan 13-17 low, and the bounces

const https = require('http');

async function fetch(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
    });
}

function calculateRSI(prices, period = 14) {
    const rsiValues = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < period) {
            rsiValues.push(null);
            continue;
        }

        let gains = 0, losses = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const change = prices[j] - prices[j-1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) {
            rsiValues.push(100);
        } else {
            const rs = avgGain / avgLoss;
            rsiValues.push(100 - (100 / (1 + rs)));
        }
    }
    return rsiValues;
}

function findSwingLows(prices, lookback = 5) {
    const lows = [];
    for (let i = lookback; i < prices.length - lookback; i++) {
        let isLow = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && prices[j] < prices[i]) {
                isLow = false;
                break;
            }
        }
        if (isLow) {
            lows.push({ index: i, price: prices[i] });
        }
    }
    return lows;
}

function detectBullishDivergence(prices, rsi, swingLows) {
    const divergences = [];
    for (let i = 1; i < swingLows.length; i++) {
        const prev = swingLows[i-1];
        const curr = swingLows[i];

        // Price made lower low
        const priceLowerLow = curr.price < prev.price;
        // RSI made higher low (bullish divergence)
        const rsiHigherLow = rsi[curr.index] > rsi[prev.index];

        if (priceLowerLow && rsiHigherLow && rsi[curr.index] !== null && rsi[prev.index] !== null) {
            divergences.push({
                prevIndex: prev.index,
                currIndex: curr.index,
                prevPrice: prev.price,
                currPrice: curr.price,
                prevRSI: rsi[prev.index],
                currRSI: rsi[curr.index],
                priceDrop: ((curr.price - prev.price) / prev.price * 100).toFixed(2),
                rsiRise: (rsi[curr.index] - rsi[prev.index]).toFixed(2)
            });
        }
    }
    return divergences;
}

async function analyzeSymbol(symbol) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ANALYZING ${symbol}`);
    console.log('='.repeat(60));

    try {
        // Get daily data
        const data = await fetch(`http://192.168.10.239:8000/api/history/${symbol}?range=3mo&interval=1d`);

        if (!data.candles || data.candles.length === 0) {
            console.log('No candle data available');
            return null;
        }

        // Extract daily closes
        const dailyData = [];
        const seen = new Set();

        for (const candle of data.candles) {
            const date = new Date(candle.datetime).toISOString().split('T')[0];
            if (!seen.has(date)) {
                seen.add(date);
                dailyData.push({
                    date,
                    close: candle.close,
                    low: candle.low,
                    high: candle.high,
                    volume: candle.volume
                });
            }
        }

        // Sort by date
        dailyData.sort((a, b) => new Date(a.date) - new Date(b.date));

        const closes = dailyData.map(d => d.close);
        const lows = dailyData.map(d => d.low);

        // Calculate RSI on closes
        const rsi = calculateRSI(closes, 14);

        // Find swing lows
        const swingLows = findSwingLows(lows, 3);

        console.log(`\nDaily data points: ${dailyData.length}`);
        console.log(`Date range: ${dailyData[0]?.date} to ${dailyData[dailyData.length-1]?.date}`);

        // Show recent lows with RSI
        console.log('\n--- RECENT SWING LOWS ---');
        const recentLows = swingLows.slice(-5);
        for (const low of recentLows) {
            const d = dailyData[low.index];
            console.log(`${d.date}: Low=$${low.price.toFixed(2)}, RSI=${rsi[low.index]?.toFixed(1) || 'N/A'}`);
        }

        // Detect divergences
        const divergences = detectBullishDivergence(lows, rsi, swingLows);

        console.log('\n--- BULLISH DIVERGENCES DETECTED ---');
        if (divergences.length === 0) {
            console.log('No bullish divergences found in this period');
        } else {
            for (const div of divergences) {
                const prevDate = dailyData[div.prevIndex].date;
                const currDate = dailyData[div.currIndex].date;
                console.log(`\n${prevDate} → ${currDate}:`);
                console.log(`  Price: $${div.prevPrice.toFixed(2)} → $${div.currPrice.toFixed(2)} (${div.priceDrop}%)`);
                console.log(`  RSI:   ${div.prevRSI.toFixed(1)} → ${div.currRSI.toFixed(1)} (+${div.rsiRise})`);
                console.log(`  >>> BULLISH DIVERGENCE: Lower price low, higher RSI low`);
            }
        }

        // Key dates analysis
        console.log('\n--- KEY DATES ANALYSIS ---');
        const keyDates = ['2025-12-27', '2025-12-30', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17', '2026-01-20', '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-24'];
        for (const date of keyDates) {
            const idx = dailyData.findIndex(d => d.date === date);
            if (idx >= 0 && rsi[idx] !== null) {
                const d = dailyData[idx];
                const rsiVal = rsi[idx].toFixed(1);
                const signal = rsi[idx] < 30 ? ' ⚠️ OVERSOLD' : rsi[idx] < 40 ? ' 👀 LOW' : '';
                console.log(`${date}: Close=$${d.close.toFixed(2)}, Low=$${d.low.toFixed(2)}, RSI=${rsiVal}${signal}`);
            }
        }

        // Return summary
        return {
            symbol,
            dataPoints: dailyData.length,
            swingLows: recentLows.map(l => ({
                date: dailyData[l.index].date,
                price: l.price,
                rsi: rsi[l.index]
            })),
            divergences: divergences.length,
            currentRSI: rsi[rsi.length - 1]
        };

    } catch (err) {
        console.log(`Error: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('RSI DIVERGENCE ANALYSIS - Mag 7 Stocks');
    console.log('Looking for: Lower price low + Higher RSI low = Bullish Divergence');
    console.log('Period: Last 3 months (daily)');

    const symbols = ['MSFT', 'META', 'TSLA', 'AAPL', 'NVDA', 'GOOGL', 'AMZN'];
    const results = [];

    for (const symbol of symbols) {
        const result = await analyzeSymbol(symbol);
        if (result) results.push(result);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log('\nSymbol | Divergences | Current RSI | Recent Swing Lows');
    console.log('-'.repeat(60));
    for (const r of results) {
        console.log(`${r.symbol.padEnd(6)} | ${String(r.divergences).padEnd(11)} | ${r.currentRSI?.toFixed(1).padStart(11) || 'N/A'} | ${r.swingLows.length}`);
    }
}

main().catch(console.error);
