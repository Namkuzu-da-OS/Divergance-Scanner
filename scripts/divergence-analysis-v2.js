// Divergence Analysis v2 - Using Yahoo Finance for historical data
// Looking at: Dec 29 low vs Jan 13-17 low - does RSI divergence matter?

const https = require('https');

async function fetchYahoo(symbol) {
    // 6 months of daily data
    const period1 = Math.floor((Date.now() - 180 * 24 * 60 * 60 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;

    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function calculateRSI(prices, period = 14) {
    const rsiValues = [];
    let avgGain = 0, avgLoss = 0;

    // First RSI calculation
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i-1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = 0; i < period; i++) {
        rsiValues.push(null);
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));

    // Subsequent calculations using smoothed method
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
    console.log(`${symbol} - RSI DIVERGENCE ANALYSIS`);
    console.log('='.repeat(70));

    try {
        const data = await fetchYahoo(symbol);
        const result = data.chart?.result?.[0];

        if (!result?.timestamp) {
            console.log('No data available');
            return null;
        }

        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        const lows = result.indicators.quote[0].low;
        const highs = result.indicators.quote[0].high;

        // Build daily data
        const dailyData = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null) {
                dailyData.push({
                    date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                    close: closes[i],
                    low: lows[i],
                    high: highs[i]
                });
            }
        }

        console.log(`Data points: ${dailyData.length}`);
        console.log(`Range: ${dailyData[0].date} to ${dailyData[dailyData.length-1].date}`);

        // Calculate RSI
        const closesPrices = dailyData.map(d => d.close);
        const rsi = calculateRSI(closesPrices, 14);

        // Find key dates
        const keyDates = [
            '2025-11-15', '2025-11-20', '2025-11-25', // November reference
            '2025-12-18', '2025-12-19', '2025-12-20', // December mid
            '2025-12-26', '2025-12-27', '2025-12-30', '2025-12-31', // Dec low area
            '2026-01-02', '2026-01-03',
            '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17', // Jan low area
            '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-24' // Recent
        ];

        console.log('\n--- RSI AT KEY DATES ---');
        console.log('Date       | Close    | Low      | RSI    | Signal');
        console.log('-'.repeat(60));

        let decLow = null, decLowRSI = null, decLowDate = null;
        let janLow = null, janLowRSI = null, janLowDate = null;

        for (const date of keyDates) {
            const idx = dailyData.findIndex(d => d.date === date);
            if (idx >= 0 && rsi[idx] !== null) {
                const d = dailyData[idx];
                const r = rsi[idx];
                let signal = '';
                if (r < 25) signal = '🔴 DEEPLY OVERSOLD';
                else if (r < 30) signal = '⚠️ OVERSOLD';
                else if (r < 40) signal = '👀 Low';
                else if (r > 70) signal = '⚡ Overbought';

                console.log(`${date} | $${d.close.toFixed(2).padStart(7)} | $${d.low.toFixed(2).padStart(7)} | ${r.toFixed(1).padStart(5)} | ${signal}`);

                // Track Dec and Jan lows
                if (date >= '2025-12-26' && date <= '2025-12-31') {
                    if (!decLow || d.low < decLow) {
                        decLow = d.low;
                        decLowRSI = r;
                        decLowDate = date;
                    }
                }
                if (date >= '2026-01-13' && date <= '2026-01-17') {
                    if (!janLow || d.low < janLow) {
                        janLow = d.low;
                        janLowRSI = r;
                        janLowDate = date;
                    }
                }
            }
        }

        // Divergence check
        console.log('\n--- DIVERGENCE CHECK: Dec vs Jan Lows ---');
        if (decLow && janLow) {
            const priceLowerLow = janLow < decLow;
            const rsiHigherLow = janLowRSI > decLowRSI;

            console.log(`December Low (${decLowDate}): $${decLow.toFixed(2)}, RSI: ${decLowRSI.toFixed(1)}`);
            console.log(`January Low  (${janLowDate}): $${janLow.toFixed(2)}, RSI: ${janLowRSI.toFixed(1)}`);
            console.log(`Price made lower low? ${priceLowerLow ? 'YES' : 'NO'} (${((janLow - decLow) / decLow * 100).toFixed(2)}%)`);
            console.log(`RSI made higher low?  ${rsiHigherLow ? 'YES' : 'NO'} (${(janLowRSI - decLowRSI).toFixed(1)} pts)`);

            if (priceLowerLow && rsiHigherLow) {
                console.log('\n>>> ✅ BULLISH DIVERGENCE CONFIRMED <<<');
                console.log('Price made lower low while RSI made higher low = momentum exhaustion');
            } else if (!priceLowerLow && rsiHigherLow) {
                console.log('\n>>> 🔄 DOUBLE BOTTOM PATTERN <<<');
                console.log('Price held similar level while RSI rose = strength confirmed');
            } else if (priceLowerLow && !rsiHigherLow) {
                console.log('\n>>> ⚠️ NO DIVERGENCE - Weakness confirmed');
            } else {
                console.log('\n>>> 📈 Higher lows on both = uptrend continuation');
            }

            return {
                symbol,
                decLow, decLowRSI, decLowDate,
                janLow, janLowRSI, janLowDate,
                hasDivergence: priceLowerLow && rsiHigherLow,
                hasDoubleBottom: !priceLowerLow && Math.abs(janLow - decLow) / decLow < 0.03,
                currentRSI: rsi[rsi.length - 1]
            };
        } else {
            console.log('Insufficient data for comparison');
            return null;
        }

    } catch (err) {
        console.log(`Error: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('RSI DIVERGENCE OBJECTIVE ANALYSIS');
    console.log('Question: Did Dec 29 → Jan 13-17 show bullish divergence?');
    console.log('Method: Compare price lows vs RSI lows at those dates');
    console.log('');

    const symbols = ['MSFT', 'META', 'TSLA', 'AAPL', 'NVDA', 'GOOGL', 'AMZN'];
    const results = [];

    for (const symbol of symbols) {
        const result = await analyzeSymbol(symbol);
        if (result) results.push(result);
        await new Promise(r => setTimeout(r, 500)); // Rate limit
    }

    console.log('\n' + '='.repeat(70));
    console.log('OBJECTIVE SUMMARY');
    console.log('='.repeat(70));

    const withDivergence = results.filter(r => r.hasDivergence);
    const withDoubleBottom = results.filter(r => r.hasDoubleBottom);
    const neither = results.filter(r => !r.hasDivergence && !r.hasDoubleBottom);

    console.log(`\nBullish Divergence (lower price, higher RSI): ${withDivergence.length}/${results.length}`);
    withDivergence.forEach(r => console.log(`  - ${r.symbol}`));

    console.log(`\nDouble Bottom (same price level, higher RSI): ${withDoubleBottom.length}/${results.length}`);
    withDoubleBottom.forEach(r => console.log(`  - ${r.symbol}`));

    console.log(`\nNeither pattern: ${neither.length}/${results.length}`);
    neither.forEach(r => console.log(`  - ${r.symbol}`));

    console.log('\n--- VERDICT ---');
    if (withDivergence.length + withDoubleBottom.length >= 4) {
        console.log('✅ Pattern is SIGNIFICANT - majority of Mag 7 showed divergence/double bottom');
        console.log('   This could be a useful confluence factor');
    } else if (withDivergence.length + withDoubleBottom.length >= 2) {
        console.log('⚠️ Pattern is MIXED - some stocks showed it, some didn\'t');
        console.log('   May be useful per-symbol but not as universal filter');
    } else {
        console.log('❌ Pattern is NOISE - not consistently present');
        console.log('   Stick with simpler RSI < 35 threshold');
    }
}

main().catch(console.error);
