#!/usr/bin/env node
/**
 * DIVERGENCE + BOLLINGER BAND BACKTEST
 *
 * Tests whether bullish RSI divergence at the lower Bollinger Band has
 * predictive value for forward returns, using up to 10 years of daily data.
 *
 * Five variants tested (A-E) to isolate which confluence layer adds edge:
 *   A — Lower BB touch alone (baseline)
 *   B — RSI divergence alone (baseline)
 *   C — Lower BB + oversold RSI
 *   D — Lower BB + RSI divergence (THE KEY TEST)
 *   E — Lower BB + divergence + oversold RSI (most strict)
 *
 * All variants segmented by VIX regime (Normal/Elevated/Fear).
 *
 * Usage:
 *   node scripts/divergence-bb-backtest.js --symbol SPY
 *   node scripts/divergence-bb-backtest.js --symbol ALL
 *   node scripts/divergence-bb-backtest.js --symbol SPY --sweep
 *   node scripts/divergence-bb-backtest.js --symbol ALL --sweep --save
 *   node scripts/divergence-bb-backtest.js --symbol SPY --bearish
 *
 * Options:
 *   --symbol SYM    Symbol or ALL for full watchlist (default: SPY)
 *   --lookback N    Swing low lookback bars (default: 5)
 *   --rsi-thresh N  RSI oversold threshold for variants C/E (default: 35)
 *   --bb-thresh N   percentB threshold for lower BB (default: 0.15)
 *   --min-bars N    Min bars between divergence swings (default: 5)
 *   --max-bars N    Max bars between divergence swings (default: 40)
 *   --sweep         Test all parameter combinations
 *   --years N       Years of data (default: 10, max 10)
 *   --fresh         Force re-fetch from API
 *   --save          Store results in SQLite
 *   --json          JSON output
 *   --bearish       Run bearish divergence (upper BB) instead of bullish
 *   --verify        Print indicator values for manual spot-checking
 *   --timeframe TF  Timeframe: daily (default) or 4h (Yahoo Finance 1h→4h)
 *
 * 4-Hour Timeframe:
 *   node scripts/divergence-bb-backtest.js --symbol SPY --timeframe 4h
 *   node scripts/divergence-bb-backtest.js --symbol ALL --timeframe 4h --sweep --save
 *   Uses Yahoo Finance 1h candles (2yr max), aggregated to 4h RTH bars.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// --- Config ---

const OPTIONS_API = 'http://192.168.10.60:8000';
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');
const DB_PATH = path.join(__dirname, '..', 'data', 'wingman.db');
const HOLD_DAYS = [1, 3, 5, 10, 20];
const WATCHLIST_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'MSFT', 'IBIT'];

// Ensure cache dir
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// --- CLI Parsing ---

const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return defaultVal;
    return args[idx + 1];
}

const SYMBOL_ARG = (getArg('--symbol', 'SPY') || 'SPY').toUpperCase();
const LOOKBACK = parseInt(getArg('--lookback', '5'));
const RSI_THRESH = parseInt(getArg('--rsi-thresh', '35'));
const BB_THRESH = parseFloat(getArg('--bb-thresh', '0.15'));
const MIN_BARS = parseInt(getArg('--min-bars', '5'));
const MAX_BARS = parseInt(getArg('--max-bars', '40'));
const SWEEP = args.includes('--sweep');
const FRESH = args.includes('--fresh');
const SAVE = args.includes('--save');
const JSON_OUT = args.includes('--json');
const BEARISH = args.includes('--bearish');
const VERIFY = args.includes('--verify');
const YEARS = parseInt(getArg('--years', '10'));
const PRICE_TOL = parseFloat(getArg('--price-tol', '0.005')); // 0.5% tolerance for "equal" lows
const TIMEFRAME = getArg('--timeframe', 'daily').toLowerCase();

if (TIMEFRAME !== 'daily' && TIMEFRAME !== '4h') {
    console.error('Error: --timeframe must be "daily" or "4h"');
    process.exit(1);
}

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
DIVERGENCE + BOLLINGER BAND BACKTEST

Usage:
  node scripts/divergence-bb-backtest.js --symbol SPY
  node scripts/divergence-bb-backtest.js --symbol ALL --sweep --save

Options:
  --symbol SYM     Symbol or ALL for full watchlist (default: SPY)
  --lookback N     Swing low lookback bars (default: 5)
  --rsi-thresh N   RSI oversold threshold for variants C/E (default: 35)
  --bb-thresh N    percentB threshold for lower BB (default: 0.15)
  --min-bars N     Min bars between divergence swings (default: 5)
  --max-bars N     Max bars between divergence swings (default: 40)
  --sweep          Test all parameter combinations
  --years N        Years of data (default: 10, max 10)
  --fresh          Force re-fetch from API
  --save           Store results in SQLite
  --json           JSON output
  --bearish        Run bearish divergence (upper BB)
  --price-tol N    Price tolerance for "equal" lows (default: 0.005 = 0.5%)
  --verify         Print indicator values for spot-checking
  --timeframe TF   Timeframe: daily (default) or 4h (Yahoo Finance 1h→4h)
`);
    process.exit(0);
}

// Sweep parameter grid
const SWEEP_PARAMS = {
    lookback: [3, 5, 7],
    rsiThreshold: [25, 30, 35, 40],
    bbThreshold: [0.05, 0.10, 0.15, 0.20, 0.30],
    minSwingBars: [5, 10],
    maxSwingBars: [20, 40, 60, 100],
};

// --- Helpers (reused from ma-backtest.js) ---

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(epochMs) {
    return new Date(epochMs).toISOString().split('T')[0];
}

// Get ET date and hour from epoch ms (handles DST correctly)
function getETDateAndHour(epochMs) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = {};
    for (const p of fmt.formatToParts(new Date(epochMs))) {
        parts[p.type] = p.value;
    }
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        hour: parseInt(parts.hour === '24' ? '0' : parts.hour),
        minute: parseInt(parts.minute),
    };
}

function cacheFile(symbol) {
    return path.join(HISTORY_DIR, `${symbol}_daily.json`);
}

function cacheValid(symbol) {
    if (FRESH) return false;
    const fp = cacheFile(symbol);
    if (!fs.existsSync(fp)) return false;
    const stat = fs.statSync(fp);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    return ageHours < 24;
}

async function fetchHistory(symbol) {
    if (cacheValid(symbol)) {
        const data = JSON.parse(fs.readFileSync(cacheFile(symbol), 'utf8'));
        return data.candles || [];
    }

    const url = `${OPTIONS_API}/api/history/${symbol}?period_type=year&period=${YEARS}&frequency_type=daily&frequency=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data.candles || data.candles.length === 0) {
            throw new Error('No candles returned');
        }

        fs.writeFileSync(cacheFile(symbol), JSON.stringify(data));
        return data.candles;
    } catch (e) {
        clearTimeout(timeout);
        console.error(`  Failed to fetch ${symbol}: ${e.message}`);
        return null;
    }
}

// --- Yahoo Finance 4H Support ---

function cacheFileYahoo(symbol) {
    return path.join(HISTORY_DIR, `${symbol}_1h_yahoo.json`);
}

function cacheValidYahoo(symbol) {
    if (FRESH) return false;
    const fp = cacheFileYahoo(symbol);
    if (!fs.existsSync(fp)) return false;
    const stat = fs.statSync(fp);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    return ageHours < 24;
}

async function fetchYahooHourly(symbol) {
    if (cacheValidYahoo(symbol)) {
        const data = JSON.parse(fs.readFileSync(cacheFileYahoo(symbol), 'utf8'));
        return data;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1h&range=2y`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const result = data?.chart?.result?.[0];
        if (!result || !result.timestamp || result.timestamp.length === 0) {
            throw new Error('No data in Yahoo response');
        }

        const timestamps = result.timestamp;
        const quote = result.indicators.quote[0];
        const candles = [];
        for (let i = 0; i < timestamps.length; i++) {
            // Skip bars with null OHLC data
            if (quote.open[i] == null || quote.close[i] == null) continue;
            candles.push({
                datetime: timestamps[i] * 1000, // Yahoo returns seconds, convert to ms
                open: quote.open[i],
                high: quote.high[i] ?? quote.open[i],
                low: quote.low[i] ?? quote.open[i],
                close: quote.close[i],
                volume: quote.volume[i] ?? 0,
            });
        }

        fs.writeFileSync(cacheFileYahoo(symbol), JSON.stringify(candles));
        return candles;
    } catch (e) {
        clearTimeout(timeout);
        console.error(`  Failed to fetch ${symbol} from Yahoo: ${e.message}`);
        return null;
    }
}

function aggregateTo4H(hourlyCandles) {
    // Group by trading date in ET timezone
    const byDate = {};
    for (const c of hourlyCandles) {
        const et = getETDateAndHour(c.datetime);

        // RTH filter: 9:30 AM - 3:59 PM ET
        if (et.hour < 9 || (et.hour === 9 && et.minute < 30) || et.hour >= 16) continue;

        if (!byDate[et.dateKey]) byDate[et.dateKey] = [];
        byDate[et.dateKey].push({ ...c, etHour: et.hour, etMinute: et.minute });
    }

    // For each trading day, split into 2 windows (~4h each)
    const bars4h = [];
    const dates = Object.keys(byDate).sort();

    for (const date of dates) {
        const dayCandles = byDate[date].sort((a, b) => a.datetime - b.datetime);
        if (dayCandles.length === 0) continue;

        // Window 1: 9:30 - 13:29 ET (first ~4 hours)
        // Window 2: 13:30 - close (remaining ~2.5 hours)
        const window1 = dayCandles.filter(c => c.etHour < 13 || (c.etHour === 13 && c.etMinute < 30));
        const window2 = dayCandles.filter(c => c.etHour > 13 || (c.etHour === 13 && c.etMinute >= 30));

        for (const window of [window1, window2]) {
            if (window.length === 0) continue;
            bars4h.push({
                datetime: window[0].datetime,
                open: window[0].open,
                high: Math.max(...window.map(c => c.high)),
                low: Math.min(...window.map(c => c.low)),
                close: window[window.length - 1].close,
                volume: window.reduce((sum, c) => sum + (c.volume || 0), 0),
            });
        }
    }

    return bars4h;
}

// Pre-compute full RSI series (standard 14-period Wilder smoothing)
const _rsiCache = new Map();
function getRSISeries(closes, period = 14) {
    const key = `${closes.length}_${period}`;
    if (_rsiCache.has(key)) return _rsiCache.get(key);

    const rsi = new Array(closes.length).fill(null);
    if (closes.length < period + 1) { _rsiCache.set(key, rsi); return rsi; }

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }

    _rsiCache.set(key, rsi);
    return rsi;
}

function computeSMA(closes, period, endIndex) {
    if (endIndex < period - 1) return null;
    let sum = 0;
    for (let i = endIndex - period + 1; i <= endIndex; i++) {
        sum += closes[i];
    }
    return sum / period;
}

function getForwardReturns(closes, index) {
    const returns = {};
    const entry = closes[index];
    for (const days of HOLD_DAYS) {
        const futureIdx = index + days;
        if (futureIdx < closes.length) {
            returns[days] = ((closes[futureIdx] - entry) / entry) * 100;
        } else {
            returns[days] = null;
        }
    }
    return returns;
}

// Timestamp-based forward returns for 4h bars.
// Counts N unique trading days forward and uses the LAST bar of that day
// (comparable to daily close N trading days later).
function getForwardReturnsByTime(sorted, index) {
    const returns = {};
    const entry = sorted[index].close;
    const entryDate = dateStr(sorted[index].datetime);

    for (const days of HOLD_DAYS) {
        let tradingDaysCount = 0;
        let lastDate = entryDate;
        let lastBarOfTargetDay = null;

        for (let j = index + 1; j < sorted.length; j++) {
            const d = dateStr(sorted[j].datetime);
            if (d !== lastDate) {
                tradingDaysCount++;
                lastDate = d;
            }
            if (tradingDaysCount === days) {
                lastBarOfTargetDay = j; // Keep updating to get last bar of target day
            }
            if (tradingDaysCount > days) break;
        }

        if (lastBarOfTargetDay !== null) {
            returns[days] = ((sorted[lastBarOfTargetDay].close - entry) / entry) * 100;
        } else {
            returns[days] = null;
        }
    }
    return returns;
}

function calcGroupStats(group) {
    const stats = {};
    for (const days of HOLD_DAYS) {
        const returns = group.map(s => s.returns[days]).filter(r => r != null);
        if (returns.length === 0) {
            stats[`${days}d`] = { count: 0, winRate: 'N/A', avgReturn: 'N/A', median: 'N/A' };
            continue;
        }
        const wins = returns.filter(r => r > 0).length;
        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
        const sorted = [...returns].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        stats[`${days}d`] = {
            count: returns.length,
            winRate: ((wins / returns.length) * 100).toFixed(1) + '%',
            avgReturn: avg.toFixed(3) + '%',
            median: median.toFixed(3) + '%',
        };
    }
    return stats;
}

// VIX regime buckets
const VIX_REGIMES = [
    { label: 'Complacent', test: vix => vix < 12 },
    { label: 'Normal', test: vix => vix >= 12 && vix < 20 },
    { label: 'Elevated', test: vix => vix >= 20 && vix < 30 },
    { label: 'Fear', test: vix => vix >= 30 && vix < 40 },
    { label: 'Capitulation', test: vix => vix >= 40 },
];

let _vixByDate = null;

function buildVIXLookup(vixCandles) {
    _vixByDate = {};
    for (const c of vixCandles) {
        const d = new Date(c.datetime).toISOString().split('T')[0];
        _vixByDate[d] = c.close;
    }
}

function getVIXForDate(dateString) {
    if (!_vixByDate) return null;
    return _vixByDate[dateString] || null;
}

function buildVIXRegimeStats(signals) {
    const withVIX = signals.filter(c => c.vix != null);
    if (withVIX.length === 0) return null;
    const result = {};
    for (const v of VIX_REGIMES) {
        const filtered = withVIX.filter(c => v.test(c.vix));
        if (filtered.length < 2) continue;
        result[v.label] = { count: filtered.length, ...calcGroupStats(filtered) };
    }
    return Object.keys(result).length > 0 ? result : null;
}

// --- NEW: Bollinger Bands ---

function computeBB(closes, period = 20, stdDevMult = 2) {
    const middle = new Array(closes.length).fill(null);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    const percentB = new Array(closes.length).fill(null);

    for (let i = period - 1; i < closes.length; i++) {
        // SMA for middle band
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += closes[j];
        }
        const sma = sum / period;

        // Population standard deviation
        let sumSqDiff = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sumSqDiff += (closes[j] - sma) * (closes[j] - sma);
        }
        const stdDev = Math.sqrt(sumSqDiff / period);

        middle[i] = sma;
        upper[i] = sma + stdDevMult * stdDev;
        lower[i] = sma - stdDevMult * stdDev;

        const range = upper[i] - lower[i];
        percentB[i] = range > 0 ? (closes[i] - lower[i]) / range : 0.5;
    }

    return { middle, upper, lower, percentB };
}

// --- NEW: Swing Detection ---

function findSwingLows(lows, lookback = 5) {
    const results = [];
    for (let i = lookback; i < lows.length - lookback; i++) {
        let isLow = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && lows[j] < lows[i]) {
                isLow = false;
                break;
            }
        }
        if (isLow) {
            results.push({ index: i, price: lows[i] });
        }
    }
    return results;
}

function findSwingHighs(highs, lookback = 5) {
    const results = [];
    for (let i = lookback; i < highs.length - lookback; i++) {
        let isHigh = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j !== i && highs[j] > highs[i]) {
                isHigh = false;
                break;
            }
        }
        if (isHigh) {
            results.push({ index: i, price: highs[i] });
        }
    }
    return results;
}

// --- NEW: Divergence Detection ---

function detectBullishDivergences(lows, rsiSeries, swingLows, minBars = 5, maxBars = 40, priceTol = 0) {
    const divergences = [];
    const usedCurrIndices = new Set(); // avoid duplicate signals at same swing low

    for (let i = 1; i < swingLows.length; i++) {
        const curr = swingLows[i];
        if (rsiSeries[curr.index] == null) continue;
        if (usedCurrIndices.has(curr.index)) continue;

        // Compare to ALL previous swing lows within window (not just consecutive)
        // Find the best divergence (strongest RSI spread) for this swing low
        let bestDiv = null;

        for (let j = i - 1; j >= 0; j--) {
            const prev = swingLows[j];
            const barsBetween = curr.index - prev.index;
            if (barsBetween < minBars) continue;
            if (barsBetween > maxBars) break; // sorted by index, so earlier ones are further away

            if (rsiSeries[prev.index] == null) continue;

            // Price lower or equal low (within tolerance) + RSI higher low = bullish divergence
            const priceLowerOrEqual = curr.price <= prev.price * (1 + priceTol);
            const rsiHigherLow = rsiSeries[curr.index] > rsiSeries[prev.index];

            if (priceLowerOrEqual && rsiHigherLow) {
                const rsiSpread = rsiSeries[curr.index] - rsiSeries[prev.index];
                if (!bestDiv || rsiSpread > bestDiv.rsiSpread) {
                    bestDiv = {
                        prevIndex: prev.index,
                        currIndex: curr.index,
                        prevPrice: prev.price,
                        currPrice: curr.price,
                        prevRSI: rsiSeries[prev.index],
                        currRSI: rsiSeries[curr.index],
                        barsBetween,
                        rsiSpread,
                    };
                }
            }
        }

        if (bestDiv) {
            divergences.push(bestDiv);
            usedCurrIndices.add(curr.index);
        }
    }

    return divergences;
}

function detectBearishDivergences(highs, rsiSeries, swingHighs, minBars = 5, maxBars = 40, priceTol = 0) {
    const divergences = [];
    const usedCurrIndices = new Set();

    for (let i = 1; i < swingHighs.length; i++) {
        const curr = swingHighs[i];
        if (rsiSeries[curr.index] == null) continue;
        if (usedCurrIndices.has(curr.index)) continue;

        let bestDiv = null;

        for (let j = i - 1; j >= 0; j--) {
            const prev = swingHighs[j];
            const barsBetween = curr.index - prev.index;
            if (barsBetween < minBars) continue;
            if (barsBetween > maxBars) break;

            if (rsiSeries[prev.index] == null) continue;

            // Price higher or equal high (within tolerance) + RSI lower high = bearish divergence
            const priceHigherOrEqual = curr.price >= prev.price * (1 - priceTol);
            const rsiLowerHigh = rsiSeries[curr.index] < rsiSeries[prev.index];

            if (priceHigherOrEqual && rsiLowerHigh) {
                const rsiSpread = rsiSeries[prev.index] - rsiSeries[curr.index];
                if (!bestDiv || rsiSpread > bestDiv.rsiSpread) {
                    bestDiv = {
                        prevIndex: prev.index,
                        currIndex: curr.index,
                        prevPrice: prev.price,
                        currPrice: curr.price,
                        prevRSI: rsiSeries[prev.index],
                        currRSI: rsiSeries[curr.index],
                        barsBetween,
                        rsiSpread,
                    };
                }
            }
        }

        if (bestDiv) {
            divergences.push(bestDiv);
            usedCurrIndices.add(curr.index);
        }
    }

    return divergences;
}

// --- Core Backtest Runner ---

function runBullishBacktest(candles, params) {
    const { lookback, rsiThreshold, bbThreshold, minSwingBars, maxSwingBars, priceTol = 0 } = params;

    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const lows = sorted.map(c => c.low);

    // Compute indicators
    const rsiSeries = getRSISeries(closes, 14);
    const bb = computeBB(closes, 20, 2);
    const swingLows = findSwingLows(lows, lookback);
    const divergences = detectBullishDivergences(lows, rsiSeries, swingLows, minSwingBars, maxSwingBars, priceTol);

    // Forward returns: timestamp-based for 4h (trading-day counting), index-based for daily
    const fwdReturns = (idx) => params.timeframe === '4h'
        ? getForwardReturnsByTime(sorted, idx)
        : getForwardReturns(closes, idx);

    // Build divergence lookup: confirmation bar index -> divergence info
    // Signal fires at currIndex + lookback (confirmation), not at the swing low itself
    const divByConfirmation = {};
    for (const div of divergences) {
        const confirmIdx = div.currIndex + lookback;
        if (confirmIdx < closes.length) {
            // If multiple divergences confirm on the same bar, keep the one with the strongest RSI divergence
            if (!divByConfirmation[confirmIdx] ||
                (div.currRSI - div.prevRSI) > (divByConfirmation[confirmIdx].currRSI - divByConfirmation[confirmIdx].prevRSI)) {
                divByConfirmation[confirmIdx] = div;
            }
        }
    }

    const warmup = 20 + 14 + lookback; // BB period + RSI period + lookback

    // VARIANT A: Lower BB touch (percentB <= bbThreshold)
    const variantA = [];
    let lastAIdx = -lookback; // cooldown
    for (let i = warmup; i < closes.length; i++) {
        if (bb.percentB[i] != null && bb.percentB[i] <= bbThreshold && (i - lastAIdx) >= lookback) {
            const signalDate = dateStr(sorted[i].datetime);
            variantA.push({
                date: signalDate,
                price: closes[i],
                rsi: rsiSeries[i],
                percentB: bb.percentB[i],
                returns: fwdReturns(i),
                vix: getVIXForDate(signalDate),
            });
            lastAIdx = i;
        }
    }

    // VARIANT B: RSI divergence alone (at confirmation bar)
    const variantB = [];
    for (const [confIdxStr, div] of Object.entries(divByConfirmation)) {
        const confIdx = parseInt(confIdxStr);
        if (confIdx < warmup || confIdx >= closes.length) continue;
        const signalDate = dateStr(sorted[confIdx].datetime);
        variantB.push({
            date: signalDate,
            price: closes[confIdx],
            rsi: rsiSeries[confIdx],
            percentB: bb.percentB[confIdx],
            divergence: div,
            swingRSI: div.currRSI,
            swingPercentB: bb.percentB[div.currIndex],
            returns: fwdReturns(confIdx),
            vix: getVIXForDate(signalDate),
        });
    }

    // VARIANT C: Lower BB + oversold RSI (at the bar itself)
    const variantC = variantA.filter(s => s.rsi != null && s.rsi < rsiThreshold);

    // VARIANT D: Lower BB at swing low + RSI divergence (THE KEY TEST)
    // Signal at confirmation bar where the swing low touched lower BB
    const variantD = [];
    for (const [confIdxStr, div] of Object.entries(divByConfirmation)) {
        const confIdx = parseInt(confIdxStr);
        if (confIdx < warmup || confIdx >= closes.length) continue;

        const swingIdx = div.currIndex;
        if (bb.percentB[swingIdx] != null && bb.percentB[swingIdx] <= bbThreshold) {
            const signalDate = dateStr(sorted[confIdx].datetime);
            variantD.push({
                date: signalDate,
                price: closes[confIdx],
                rsi: rsiSeries[confIdx],
                percentB: bb.percentB[confIdx],
                divergence: div,
                swingRSI: div.currRSI,
                swingPercentB: bb.percentB[swingIdx],
                returns: fwdReturns(confIdx),
                vix: getVIXForDate(signalDate),
            });
        }
    }

    // VARIANT E: Lower BB + divergence + oversold RSI at swing low
    const variantE = variantD.filter(s => s.swingRSI < rsiThreshold);

    return {
        variants: { A: variantA, B: variantB, C: variantC, D: variantD, E: variantE },
        meta: {
            dataStart: dateStr(sorted[0].datetime),
            dataEnd: dateStr(sorted[sorted.length - 1].datetime),
            totalBars: sorted.length,
            params,
            swingLowCount: swingLows.length,
            divergenceCount: divergences.length,
        },
    };
}

function runBearishBacktest(candles, params) {
    const { lookback, rsiThreshold, bbThreshold, minSwingBars, maxSwingBars, priceTol = 0 } = params;

    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const highs = sorted.map(c => c.high);

    const rsiSeries = getRSISeries(closes, 14);
    const bb = computeBB(closes, 20, 2);
    const swingHighs = findSwingHighs(highs, lookback);
    const divergences = detectBearishDivergences(highs, rsiSeries, swingHighs, minSwingBars, maxSwingBars, priceTol);

    // Forward returns: timestamp-based for 4h, index-based for daily
    const fwdReturns = (idx) => params.timeframe === '4h'
        ? getForwardReturnsByTime(sorted, idx)
        : getForwardReturns(closes, idx);

    const divByConfirmation = {};
    for (const div of divergences) {
        const confirmIdx = div.currIndex + lookback;
        if (confirmIdx < closes.length) {
            if (!divByConfirmation[confirmIdx] ||
                (div.prevRSI - div.currRSI) > (divByConfirmation[confirmIdx].prevRSI - divByConfirmation[confirmIdx].currRSI)) {
                divByConfirmation[confirmIdx] = div;
            }
        }
    }

    const warmup = 20 + 14 + lookback;
    const overboughtThresh = 100 - rsiThreshold; // Mirror: if RSI thresh is 35, overbought is 65
    const upperBBThresh = 1 - bbThreshold; // Mirror: if BB thresh is 0.15, upper is 0.85

    // A: Upper BB touch
    const variantA = [];
    let lastAIdx = -lookback;
    for (let i = warmup; i < closes.length; i++) {
        if (bb.percentB[i] != null && bb.percentB[i] >= upperBBThresh && (i - lastAIdx) >= lookback) {
            const signalDate = dateStr(sorted[i].datetime);
            variantA.push({
                date: signalDate,
                price: closes[i],
                rsi: rsiSeries[i],
                percentB: bb.percentB[i],
                // Invert returns for short signal
                returns: Object.fromEntries(
                    Object.entries(fwdReturns(i)).map(([k, v]) => [k, v != null ? -v : null])
                ),
                vix: getVIXForDate(signalDate),
            });
            lastAIdx = i;
        }
    }

    // B: Bearish RSI divergence alone
    const variantB = [];
    for (const [confIdxStr, div] of Object.entries(divByConfirmation)) {
        const confIdx = parseInt(confIdxStr);
        if (confIdx < warmup || confIdx >= closes.length) continue;
        const signalDate = dateStr(sorted[confIdx].datetime);
        variantB.push({
            date: signalDate,
            price: closes[confIdx],
            rsi: rsiSeries[confIdx],
            percentB: bb.percentB[confIdx],
            divergence: div,
            swingRSI: div.currRSI,
            swingPercentB: bb.percentB[div.currIndex],
            returns: Object.fromEntries(
                Object.entries(fwdReturns(confIdx)).map(([k, v]) => [k, v != null ? -v : null])
            ),
            vix: getVIXForDate(signalDate),
        });
    }

    // C: Upper BB + overbought RSI
    const variantC = variantA.filter(s => s.rsi != null && s.rsi > overboughtThresh);

    // D: Upper BB at swing high + bearish divergence
    const variantD = [];
    for (const [confIdxStr, div] of Object.entries(divByConfirmation)) {
        const confIdx = parseInt(confIdxStr);
        if (confIdx < warmup || confIdx >= closes.length) continue;

        const swingIdx = div.currIndex;
        if (bb.percentB[swingIdx] != null && bb.percentB[swingIdx] >= upperBBThresh) {
            const signalDate = dateStr(sorted[confIdx].datetime);
            variantD.push({
                date: signalDate,
                price: closes[confIdx],
                rsi: rsiSeries[confIdx],
                percentB: bb.percentB[confIdx],
                divergence: div,
                swingRSI: div.currRSI,
                swingPercentB: bb.percentB[swingIdx],
                returns: Object.fromEntries(
                    Object.entries(fwdReturns(confIdx)).map(([k, v]) => [k, v != null ? -v : null])
                ),
                vix: getVIXForDate(signalDate),
            });
        }
    }

    // E: Upper BB + divergence + overbought RSI
    const variantE = variantD.filter(s => s.swingRSI > overboughtThresh);

    return {
        variants: { A: variantA, B: variantB, C: variantC, D: variantD, E: variantE },
        meta: {
            dataStart: dateStr(sorted[0].datetime),
            dataEnd: dateStr(sorted[sorted.length - 1].datetime),
            totalBars: sorted.length,
            params,
            swingHighCount: swingHighs.length,
            divergenceCount: divergences.length,
        },
    };
}

// --- Print Functions ---

function variantLabel(key, bearish) {
    const labels = bearish ? {
        A: 'A: Upper BB Touch',
        B: 'B: Bearish RSI Divergence',
        C: 'C: Upper BB + Overbought RSI',
        D: 'D: Upper BB + Bearish Divergence',
        E: 'E: Upper BB + Div + Overbought',
    } : {
        A: 'A: Lower BB Touch',
        B: 'B: Bullish RSI Divergence',
        C: 'C: Lower BB + Oversold RSI',
        D: 'D: Lower BB + Bullish Divergence',
        E: 'E: Lower BB + Div + Oversold',
    };
    return labels[key] || key;
}

function printVariantStats(key, signals, bearish) {
    const label = variantLabel(key, bearish);
    const count = signals.length;
    const flag = count < 10 ? ' *' : '';

    console.log(`\n${label}${flag}`);
    console.log(`Signal count: ${count}`);

    if (count === 0) {
        console.log('  No signals detected.');
        return;
    }

    const stats = calcGroupStats(signals);
    const rows = [];
    for (const days of HOLD_DAYS) {
        const s = stats[`${days}d`];
        rows.push({
            Hold: `${days}d`,
            Count: s.count,
            'Win Rate': s.winRate,
            'Avg Return': s.avgReturn,
            Median: s.median,
        });
    }
    console.table(rows);
}

function printComparisonTable(result, bearish) {
    const { variants } = result;

    console.log('\nCOMPARISON TABLE');
    const header = `${'Variant'.padEnd(38)} ${'Count'.padStart(6)} ${'1d WR'.padStart(8)} ${'3d WR'.padStart(8)} ${'5d WR'.padStart(8)} ${'10d WR'.padStart(8)} ${'20d WR'.padStart(8)}`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const key of ['A', 'B', 'C', 'D', 'E']) {
        const signals = variants[key];
        const label = variantLabel(key, bearish);
        const count = signals.length;
        const flag = count < 10 ? ' *' : '';

        if (count === 0) {
            console.log(`${(label + flag).padEnd(38)} ${String(count).padStart(6)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)}`);
            continue;
        }

        const stats = calcGroupStats(signals);
        console.log(
            `${(label + flag).padEnd(38)} ${String(count).padStart(6)} ${stats['1d'].winRate.padStart(8)} ${stats['3d'].winRate.padStart(8)} ${stats['5d'].winRate.padStart(8)} ${stats['10d'].winRate.padStart(8)} ${stats['20d'].winRate.padStart(8)}`
        );
    }

    // Edge analysis
    const dSignals = variants.D;
    const aSignals = variants.A;
    const bSignals = variants.B;
    const eSignals = variants.E;

    if (dSignals.length >= 5 && aSignals.length >= 5) {
        console.log('\nEDGE ANALYSIS (5d Win Rate):');
        const dStats = calcGroupStats(dSignals);
        const aStats = calcGroupStats(aSignals);
        const bStats = calcGroupStats(bSignals);

        const dWR = parseFloat(dStats['5d'].winRate);
        const aWR = parseFloat(aStats['5d'].winRate);

        const dVsA = (dWR - aWR).toFixed(1);
        console.log(`  D vs A (${bearish ? 'upper' : 'lower'} BB alone):  ${dWR >= aWR ? '+' : ''}${dVsA}% WR spread  <- Does divergence add to BB?`);

        if (bSignals.length >= 5) {
            const bWR = parseFloat(bStats['5d'].winRate);
            const dVsB = (dWR - bWR).toFixed(1);
            console.log(`  D vs B (div alone):    ${dWR >= bWR ? '+' : ''}${dVsB}% WR spread  <- Does BB add to divergence?`);
        }

        if (eSignals.length >= 5) {
            const eStats = calcGroupStats(eSignals);
            const eWR = parseFloat(eStats['5d'].winRate);
            const eVsD = (eWR - dWR).toFixed(1);
            console.log(`  E vs D (adding RSI):   ${eWR >= dWR ? '+' : ''}${eVsD}% WR spread  <- Does strict RSI help?`);
        }

        const cSignals = variants.C;
        if (cSignals.length >= 5) {
            const cStats = calcGroupStats(cSignals);
            const cWR = parseFloat(cStats['5d'].winRate);
            const cVsA = (cWR - aWR).toFixed(1);
            console.log(`  C vs A (RSI filter):   ${cWR >= aWR ? '+' : ''}${cVsA}% WR spread  <- Does RSI filter help BB alone?`);
        }
    }
}

function printVIXAnalysis(variants, bearish) {
    for (const key of ['D', 'E']) {
        const signals = variants[key];
        if (signals.length < 5) continue;

        const vixStats = buildVIXRegimeStats(signals);
        if (!vixStats) continue;

        console.log(`\nVIX REGIME ANALYSIS (${variantLabel(key, bearish)}):`);
        for (const [regime, rStats] of Object.entries(vixStats)) {
            const wr5 = rStats['5d'] ? rStats['5d'].winRate : 'N/A';
            const avg5 = rStats['5d'] ? rStats['5d'].avgReturn : 'N/A';
            console.log(`  ${regime.padEnd(14)} -> ${String(rStats.count).padStart(3)} signals, 5d WR: ${wr5}, avg: ${avg5}`);
        }
    }
}

function printRecentSignals(variants, sorted, bearish) {
    for (const key of ['D', 'E']) {
        const signals = variants[key];
        if (signals.length === 0) continue;

        console.log(`\nRecent signals (${variantLabel(key, bearish)}):`);
        const recent = signals.slice(-5);
        for (const s of recent) {
            const r5 = s.returns[5] != null ? `${s.returns[5] >= 0 ? '+' : ''}${s.returns[5].toFixed(2)}%` : 'N/A';
            const r20 = s.returns[20] != null ? `${s.returns[20] >= 0 ? '+' : ''}${s.returns[20].toFixed(2)}%` : 'N/A';
            const rsiStr = s.swingRSI != null ? ` swRSI:${s.swingRSI.toFixed(1)}` : '';
            const bbStr = s.swingPercentB != null ? ` sw%B:${s.swingPercentB.toFixed(2)}` : '';
            const vixStr = s.vix != null ? ` VIX:${s.vix.toFixed(1)}` : '';
            console.log(`  ${s.date}: $${s.price.toFixed(2)} -- 5d: ${r5}, 20d: ${r20}${rsiStr}${bbStr}${vixStr}`);
        }
    }
}

function printResults(symbol, result, bearish) {
    const { variants, meta } = result;
    const direction = bearish ? 'BEARISH' : 'BULLISH';
    const swingLabel = bearish ? `Swing highs: ${meta.swingHighCount}` : `Swing lows: ${meta.swingLowCount}`;
    const divLabel = bearish ? 'Bearish' : 'Bullish';

    const tfLabel = meta.params.timeframe === '4h' ? ' (4H)' : '';
    console.log('\n' + '='.repeat(70));
    console.log(`${direction} DIVERGENCE + BB BACKTEST -- ${symbol}${tfLabel}`);
    console.log(`Params: lookback=${meta.params.lookback}, RSI<${meta.params.rsiThreshold}, BB<=${meta.params.bbThreshold}, bars=${meta.params.minSwingBars}-${meta.params.maxSwingBars}`);
    if (meta.params.timeframe === '4h') {
        console.log(`Data: ${meta.dataStart} to ${meta.dataEnd} | ${meta.totalBars} 4h bars (Yahoo Finance 1h → 4h)`);
    } else {
        console.log(`Data: ${meta.dataStart} to ${meta.dataEnd} | ${meta.totalBars} bars`);
    }
    console.log(`${swingLabel} | ${divLabel} divergences: ${meta.divergenceCount}`);
    console.log('='.repeat(70));

    for (const key of ['A', 'B', 'C', 'D', 'E']) {
        printVariantStats(key, variants[key], bearish);
    }

    printComparisonTable(result, bearish);
    printVIXAnalysis(variants, bearish);
    printRecentSignals(variants, null, bearish);
}

// --- Sweep ---

function printSweepSummary(sweepResults, bearish) {
    console.log('\n' + '='.repeat(90));
    console.log(`SWEEP SUMMARY -- Ranked by Variant D 5d Win Rate`);
    console.log('='.repeat(90));

    const rows = [];
    for (const { symbol, params, result } of sweepResults) {
        const dSignals = result.variants.D;
        const eSignals = result.variants.E;
        if (dSignals.length === 0) continue;

        const dStats = calcGroupStats(dSignals);
        const dWR5 = dStats['5d'].winRate;
        const dAvg5 = dStats['5d'].avgReturn;

        const eWR5 = eSignals.length > 0 ? calcGroupStats(eSignals)['5d'].winRate : 'N/A';

        rows.push({
            Symbol: symbol,
            Params: `lb=${params.lookback} rsi<${params.rsiThreshold} bb<=${params.bbThreshold} bars=${params.minSwingBars}-${params.maxSwingBars}`,
            'D #': dSignals.length,
            'D 5d WR': dWR5,
            'D Avg 5d': dAvg5,
            'E #': eSignals.length,
            'E 5d WR': eWR5,
            _sortKey: parseFloat(dWR5) || 0,
            _lowConf: dSignals.length < 10,
        });
    }

    rows.sort((a, b) => b._sortKey - a._sortKey);

    const header = `${'Symbol'.padEnd(8)} ${'Params'.padEnd(42)} ${'D #'.padStart(4)} ${'D 5d WR'.padStart(9)} ${'D Avg 5d'.padStart(10)} ${'E #'.padStart(4)} ${'E 5d WR'.padStart(9)}`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const r of rows) {
        const flag = r._lowConf ? ' *' : '';
        console.log(
            `${r.Symbol.padEnd(8)} ${r.Params.padEnd(42)} ${String(r['D #']).padStart(4)}${flag.padEnd(2)} ${r['D 5d WR'].padStart(9)} ${r['D Avg 5d'].padStart(10)} ${String(r['E #']).padStart(4)} ${r['E 5d WR'].padStart(9)}`
        );
    }

    const lowConfCount = rows.filter(r => r._lowConf).length;
    if (lowConfCount > 0) {
        console.log(`\n* = low confidence (< 10 signals)`);
    }
    console.log(`Total combos tested: ${sweepResults.length}`);
}

// --- Verify Mode ---

function runVerify(candles, params) {
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const lows = sorted.map(c => c.low);

    const rsiSeries = getRSISeries(closes, 14);
    const bb = computeBB(closes, 20, 2);

    // Verify BB: middle should equal SMA(20)
    const lastIdx = closes.length - 1;
    const sma20 = computeSMA(closes, 20, lastIdx);
    console.log('\n--- BB VERIFICATION ---');
    console.log(`Last bar: close=$${closes[lastIdx].toFixed(2)}`);
    console.log(`  BB middle: $${bb.middle[lastIdx].toFixed(2)} | SMA(20): $${sma20.toFixed(2)} | Match: ${Math.abs(bb.middle[lastIdx] - sma20) < 0.01}`);
    console.log(`  BB upper:  $${bb.upper[lastIdx].toFixed(2)}`);
    console.log(`  BB lower:  $${bb.lower[lastIdx].toFixed(2)}`);
    console.log(`  %B:        ${bb.percentB[lastIdx].toFixed(4)}`);
    console.log(`  RSI:       ${rsiSeries[lastIdx] != null ? rsiSeries[lastIdx].toFixed(1) : 'null'}`);

    // Show last 10 bars
    console.log('\n--- LAST 10 BARS ---');
    console.log('Date          Close     RSI     %B      BB Lower  BB Upper');
    for (let i = closes.length - 10; i < closes.length; i++) {
        const d = dateStr(sorted[i].datetime);
        const rsi = rsiSeries[i] != null ? rsiSeries[i].toFixed(1).padStart(5) : '  N/A';
        const pctB = bb.percentB[i] != null ? bb.percentB[i].toFixed(3).padStart(6) : '   N/A';
        const lo = bb.lower[i] != null ? bb.lower[i].toFixed(2) : 'N/A';
        const hi = bb.upper[i] != null ? bb.upper[i].toFixed(2) : 'N/A';
        console.log(`${d}  $${closes[i].toFixed(2).padStart(8)}  ${rsi}  ${pctB}  $${lo.padStart(8)}  $${hi.padStart(8)}`);
    }

    // Swing lows
    const swingLows = findSwingLows(lows, params.lookback);
    console.log(`\n--- SWING LOWS (lookback=${params.lookback}) ---`);
    console.log(`Total: ${swingLows.length} | Last 10:`);
    const recentLows = swingLows.slice(-10);
    for (const sl of recentLows) {
        const d = dateStr(sorted[sl.index].datetime);
        const rsi = rsiSeries[sl.index] != null ? rsiSeries[sl.index].toFixed(1) : 'N/A';
        const pctB = bb.percentB[sl.index] != null ? bb.percentB[sl.index].toFixed(3) : 'N/A';
        const atBB = bb.percentB[sl.index] != null && bb.percentB[sl.index] <= params.bbThreshold ? ' <-- AT LOWER BB' : '';
        console.log(`  ${d}: Low=$${sl.price.toFixed(2)}, RSI=${rsi}, %B=${pctB}${atBB}`);
    }

    // Divergences
    const divergences = detectBullishDivergences(lows, rsiSeries, swingLows, params.minSwingBars, params.maxSwingBars, params.priceTol || 0);
    console.log(`\n--- BULLISH DIVERGENCES ---`);
    console.log(`Total: ${divergences.length}`);
    const recentDivs = divergences.slice(-5);
    for (const div of recentDivs) {
        const d1 = dateStr(sorted[div.prevIndex].datetime);
        const d2 = dateStr(sorted[div.currIndex].datetime);
        const confirmIdx = div.currIndex + params.lookback;
        const confirmDate = confirmIdx < sorted.length ? dateStr(sorted[confirmIdx].datetime) : 'N/A (future)';
        const atBB = bb.percentB[div.currIndex] != null && bb.percentB[div.currIndex] <= params.bbThreshold;
        console.log(`  ${d1} -> ${d2} (confirm: ${confirmDate}, ${div.barsBetween} bars)`);
        console.log(`    Price: $${div.prevPrice.toFixed(2)} -> $${div.currPrice.toFixed(2)} (lower low)`);
        console.log(`    RSI:   ${div.prevRSI.toFixed(1)} -> ${div.currRSI.toFixed(1)} (higher low)`);
        console.log(`    At lower BB: ${atBB ? 'YES (%B=' + bb.percentB[div.currIndex].toFixed(3) + ')' : 'NO (%B=' + (bb.percentB[div.currIndex] != null ? bb.percentB[div.currIndex].toFixed(3) : 'null') + ')'}`);
    }
}

// --- SQLite Save ---

function ensureBacktestTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ma_backtest_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_type TEXT NOT NULL,
            symbol TEXT NOT NULL,
            fast_period INTEGER NOT NULL,
            slow_period INTEGER NOT NULL,
            data_start TEXT NOT NULL,
            data_end TEXT NOT NULL,
            total_bars INTEGER,
            results_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);

    const cols = db.prepare("PRAGMA table_info(ma_backtest_runs)").all();
    if (!cols.find(c => c.name === 'ma_type')) {
        db.exec("ALTER TABLE ma_backtest_runs ADD COLUMN ma_type TEXT DEFAULT 'SMA'");
    }

    const hasIndex = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_backtest_lookup'"
    ).get();
    if (!hasIndex) {
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_backtest_lookup
            ON ma_backtest_runs (run_type, symbol, fast_period, slow_period, created_at DESC);
        `);
    }
}

function saveRun(db, symbol, params, result, bearish) {
    const is4h = params.timeframe === '4h';
    const runType = bearish
        ? (is4h ? 'divergence_bb_bear_4h' : 'divergence_bb_bear')
        : (is4h ? 'divergence_bb_4h' : 'divergence_bb');

    // Build results summary
    const summary = { params };
    for (const key of ['A', 'B', 'C', 'D', 'E']) {
        const signals = result.variants[key];
        summary[key] = { count: signals.length, ...calcGroupStats(signals) };

        // VIX regime breakdown for D and E
        if ((key === 'D' || key === 'E') && signals.length >= 3) {
            const vixStats = buildVIXRegimeStats(signals);
            if (vixStats) summary[`${key}_vix`] = vixStats;
        }
    }

    summary.meta = {
        swingCount: bearish ? result.meta.swingHighCount : result.meta.swingLowCount,
        divergenceCount: result.meta.divergenceCount,
    };

    ensureBacktestTables(db);
    db.prepare(`
        INSERT INTO ma_backtest_runs (run_type, symbol, fast_period, slow_period, data_start, data_end, total_bars, results_json, ma_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        runType,
        symbol,
        params.lookback,
        0, // slow_period unused for this run type
        result.meta.dataStart,
        result.meta.dataEnd,
        result.meta.totalBars,
        JSON.stringify(summary),
        JSON.stringify(params) // Store full params in ma_type column
    );
}

// --- Main ---

async function main() {
    const symbols = SYMBOL_ARG === 'ALL' ? WATCHLIST_SYMBOLS : [SYMBOL_ARG];
    const direction = BEARISH ? 'BEARISH' : 'BULLISH';

    const defaultParams = {
        lookback: LOOKBACK,
        rsiThreshold: RSI_THRESH,
        bbThreshold: BB_THRESH,
        minSwingBars: MIN_BARS,
        maxSwingBars: MAX_BARS,
        priceTol: PRICE_TOL,
        timeframe: TIMEFRAME,
    };

    const tfLabel = TIMEFRAME === '4h' ? ' (4H)' : '';
    const dataSource = TIMEFRAME === '4h' ? 'Yahoo Finance 1h → 4h aggregated' : `Schwab ${YEARS}yr daily`;
    console.log(`${direction} DIVERGENCE + BB BACKTEST${tfLabel}`);
    console.log(`Symbols: ${symbols.join(', ')}`);
    console.log(`Data: ${dataSource} | Fresh: ${FRESH} | Save: ${SAVE} | Sweep: ${SWEEP}`);
    if (TIMEFRAME === '4h' && YEARS > 2) {
        console.log('Note: Yahoo hourly data limited to ~2 years.');
    }
    if (!SWEEP) {
        const tolStr = defaultParams.priceTol > 0 ? `, priceTol=${(defaultParams.priceTol * 100).toFixed(1)}%` : '';
        console.log(`Params: lookback=${defaultParams.lookback}, RSI<${defaultParams.rsiThreshold}, BB<=${defaultParams.bbThreshold}, bars=${defaultParams.minSwingBars}-${defaultParams.maxSwingBars}${tolStr}`);
    }

    // Fetch history
    console.log('\nFetching history...');
    const historyMap = {};
    if (TIMEFRAME === '4h') {
        // Yahoo Finance 1h candles → aggregate to 4h
        for (const sym of symbols) {
            process.stdout.write(`  ${sym} (Yahoo 1h)...`);
            const hourly = await fetchYahooHourly(sym);
            if (hourly) {
                const candles4h = aggregateTo4H(hourly);
                historyMap[sym] = candles4h;
                console.log(` ${hourly.length} hourly → ${candles4h.length} 4h bars`);
            } else {
                console.log(' FAILED');
            }
            if (symbols.indexOf(sym) < symbols.length - 1) await sleep(200);
        }
    } else {
        // Schwab daily
        for (const sym of symbols) {
            process.stdout.write(`  ${sym}...`);
            const candles = await fetchHistory(sym);
            if (candles) {
                historyMap[sym] = candles;
                console.log(` ${candles.length} candles`);
            } else {
                console.log(' FAILED');
            }
            if (symbols.indexOf(sym) < symbols.length - 1) await sleep(200);
        }
    }

    // Fetch VIX for regime segmentation
    process.stdout.write('  $VIX...');
    const vixCandles = await fetchHistory('$VIX');
    if (vixCandles) {
        buildVIXLookup(vixCandles);
        console.log(` ${vixCandles.length} candles (regime lookup)`);
    } else {
        console.log(' FAILED (VIX regime data unavailable)');
    }

    let db = null;
    if (SAVE) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
    }

    const sweepResults = [];

    // Build parameter grid
    let paramSets;
    if (SWEEP) {
        paramSets = [];
        for (const lookback of SWEEP_PARAMS.lookback) {
            for (const rsiThreshold of SWEEP_PARAMS.rsiThreshold) {
                for (const bbThreshold of SWEEP_PARAMS.bbThreshold) {
                    for (const minSwingBars of SWEEP_PARAMS.minSwingBars) {
                        for (const maxSwingBars of SWEEP_PARAMS.maxSwingBars) {
                            if (minSwingBars >= maxSwingBars) continue;
                            paramSets.push({ lookback, rsiThreshold, bbThreshold, minSwingBars, maxSwingBars, priceTol: PRICE_TOL, timeframe: TIMEFRAME });
                        }
                    }
                }
            }
        }
        console.log(`\nSweep: ${paramSets.length} parameter combos x ${symbols.length} symbols = ${paramSets.length * symbols.length} runs`);
    } else {
        paramSets = [defaultParams];
    }

    // Run
    for (const sym of symbols) {
        const candles = historyMap[sym];
        if (!candles) continue;
        _rsiCache.clear();

        for (const params of paramSets) {
            if (VERIFY && !SWEEP) {
                runVerify(candles, params);
                continue;
            }

            const result = BEARISH
                ? runBearishBacktest(candles, params)
                : runBullishBacktest(candles, params);

            if (!SWEEP && !JSON_OUT) {
                printResults(sym, result, BEARISH);
            }

            if (SAVE && db) saveRun(db, sym, params, result, BEARISH);
            sweepResults.push({ symbol: sym, params, result });
        }
    }

    // Sweep summary
    if (SWEEP && sweepResults.length > 1 && !JSON_OUT) {
        printSweepSummary(sweepResults, BEARISH);
    }

    // JSON output
    if (JSON_OUT) {
        const output = sweepResults.map(({ symbol, params, result }) => {
            const summary = { symbol, params };
            for (const key of ['A', 'B', 'C', 'D', 'E']) {
                summary[key] = { count: result.variants[key].length, stats: calcGroupStats(result.variants[key]) };
            }
            summary.meta = result.meta;
            return summary;
        });
        console.log(JSON.stringify(output, null, 2));
    }

    if (db) {
        const savedType = TIMEFRAME === '4h'
            ? (BEARISH ? 'divergence_bb_bear_4h' : 'divergence_bb_4h')
            : (BEARISH ? 'divergence_bb_bear' : 'divergence_bb');
        console.log(`\nResults saved to ${DB_PATH} (ma_backtest_runs table, run_type='${savedType}')`);
        db.close();
    }

    console.log('\nDone.');
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
