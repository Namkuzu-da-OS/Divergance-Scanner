/**
 * MA BOUNCE DETECTION MODULE
 *
 * Detects price bouncing off moving averages using per-ticker best combos
 * from backtest data (3,045 runs across 11 symbols, 10 years daily).
 *
 * Exports:
 *   MA_BOUNCE_CONFIG  — per-ticker config (MA type, periods, score eligibility)
 *   detectBounce()    — real-time bounce detection for a single symbol
 *   fetchHistory()    — daily OHLCV with 24h file cache
 */

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');
const OPTIONS_API = 'http://192.168.10.60:8000';

// Ensure history cache dir exists
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// Touch zone: max distance from fast MA to count as "approach" (%)
const BOUNCE_TOUCH_PCT = 1.0;

/**
 * Per-ticker MA bounce config — derived from backtest sweep data.
 *
 * Rule: 65%+ 5-day win rate = score points (+8).
 *       Below 65% = annotation only.
 *       Unvalidated symbols = SMA 50/200 annotation (no history fetch needed).
 *
 * rsiBoost: if RSI < threshold AND a secondary MA pair also shows bounce, +4 pts.
 *           Only for combos where RSI<50 filter pushes WR to 70%+.
 */
const MA_BOUNCE_CONFIG = {
    SPY:  { fast: 100, slow: 200, type: 'SMA', score: true,  rsiBoost: { threshold: 50, fast: 20, slow: 50, type: 'HMA', points: 4 } },
    QQQ:  { fast: 150, slow: 200, type: 'SMA', score: true  },
    AAPL: { fast: 55,  slow: 144, type: 'HMA', score: true,  rsiBoost: { threshold: 50, fast: 13, slow: 34, type: 'HMA', points: 4 } },
    NVDA: { fast: 150, slow: 200, type: 'EMA', score: true  },
    META: { fast: 40,  slow: 100, type: 'EMA', score: true,  rsiBoost: { threshold: 50, fast: 40, slow: 100, type: 'EMA', points: 4 } },
    MSFT: { fast: 100, slow: 200, type: 'EMA', score: false },
    TSLA: { fast: 55,  slow: 89,  type: 'HMA', score: false },
    AMD:  { fast: 10,  slow: 30,  type: 'SMA', score: false }
};

// ============================================
// MA COMPUTATION (extracted from ma-backtest.js)
// ============================================

function computeSMA(closes, period, endIndex) {
    if (endIndex < period - 1) return null;
    let sum = 0;
    for (let i = endIndex - period + 1; i <= endIndex; i++) {
        sum += closes[i];
    }
    return sum / period;
}

function getEMASeries(closes, period) {
    const ema = new Array(closes.length).fill(null);
    if (closes.length < period) return ema;

    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    ema[period - 1] = sum / period;

    const k = 2 / (period + 1);
    for (let i = period; i < closes.length; i++) {
        ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
}

function computeWMA(values, period, endIndex) {
    if (endIndex < period - 1) return null;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < period; i++) {
        const weight = i + 1;
        weightedSum += values[endIndex - period + 1 + i] * weight;
        weightTotal += weight;
    }
    return weightedSum / weightTotal;
}

function getHMASeries(closes, period) {
    const halfPeriod = Math.round(period / 2);
    const sqrtPeriod = Math.round(Math.sqrt(period));
    const hma = new Array(closes.length).fill(null);

    // Step 1-2: Build the "raw hull" series = 2*WMA(n/2) - WMA(n)
    const rawHull = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        const wmaHalf = computeWMA(closes, halfPeriod, i);
        const wmaFull = computeWMA(closes, period, i);
        if (wmaHalf !== null && wmaFull !== null) {
            rawHull[i] = 2 * wmaHalf - wmaFull;
        }
    }

    // Step 3: WMA of rawHull with period sqrt(n)
    for (let i = 0; i < closes.length; i++) {
        const val = computeWMA(rawHull, sqrtPeriod, i);
        if (val !== null) hma[i] = val;
    }

    return hma;
}

/**
 * Compute MA value at a specific index for a given type/period.
 */
function computeMAAtIndex(closes, type, period, endIndex) {
    if (type === 'EMA') {
        const series = getEMASeries(closes, period);
        return series[endIndex];
    }
    if (type === 'HMA') {
        const series = getHMASeries(closes, period);
        return series[endIndex];
    }
    return computeSMA(closes, period, endIndex);
}

// ============================================
// HISTORY FETCHING (pattern from enrich-signals-ma.js)
// ============================================

function cacheFile(symbol) {
    return path.join(HISTORY_DIR, `${symbol}_daily.json`);
}

function cacheValid(symbol) {
    const fp = cacheFile(symbol);
    if (!fs.existsSync(fp)) return false;
    const stat = fs.statSync(fp);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    return ageHours < 24;
}

/**
 * Fetch daily OHLCV history for a symbol.
 * Uses 24h file cache at data/history/{SYMBOL}_daily.json.
 * Returns { candles: [...] } or null on failure.
 */
async function fetchHistory(symbol) {
    if (cacheValid(symbol)) {
        try {
            return JSON.parse(fs.readFileSync(cacheFile(symbol), 'utf8'));
        } catch (e) {
            // Cache file corrupt — fall through to fetch
        }
    }

    const url = `${OPTIONS_API}/api/history/${symbol}?period_type=year&period=2&frequency_type=daily&frequency=1`;
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
        return data;
    } catch (e) {
        clearTimeout(timeout);
        console.error(`[MA-Bounce] Failed to fetch history for ${symbol}: ${e.message}`);
        return null;
    }
}

// ============================================
// BOUNCE DETECTION
// ============================================

/**
 * Detect MA bounce for a symbol.
 *
 * MAs are computed from daily history candles (correct — that's what the backtest validated).
 * The bounce condition is checked against LIVE price data when available (real-time detection).
 *
 * @param {string}  symbol     — Ticker symbol
 * @param {Array}   candles    — Daily OHLCV candles (for MA computation)
 * @param {number}  currentRsi — Current RSI from technicals API
 * @param {object}  [liveData] — Real-time price data: { price, high, low } from quote/technicals API
 * @returns {object} { detected, type, direction, scorePoints, annotation, config, ... }
 */
function detectBounce(symbol, candles, currentRsi, liveData) {
    const config = MA_BOUNCE_CONFIG[symbol];

    // Unvalidated symbols: use SMA 50/200 annotation-only with technicals data
    // (caller handles this case — no candles needed)
    if (!config) {
        return { detected: false, symbol, validated: false };
    }

    if (!candles || candles.length < config.slow + 10) {
        return { detected: false, symbol, validated: true, reason: 'insufficient_data' };
    }

    // Sort ascending by datetime
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const lows = sorted.map(c => c.low);
    const highs = sorted.map(c => c.high);

    const lastIdx = closes.length - 1;

    // Compute MAs from daily history (these barely move intraday — correct approach)
    const fastMA = computeMAAtIndex(closes, config.type, config.fast, lastIdx);
    const slowMA = computeMAAtIndex(closes, config.type, config.slow, lastIdx);

    if (fastMA == null || slowMA == null) {
        return { detected: false, symbol, validated: true, reason: 'ma_null' };
    }

    // Use LIVE price data for bounce condition when available, fall back to last daily bar
    const close = (liveData?.price != null) ? liveData.price : closes[lastIdx];
    const low = (liveData?.low != null && liveData.low > 0) ? liveData.low : lows[lastIdx];
    const high = (liveData?.high != null && liveData.high > 0) ? liveData.high : highs[lastIdx];
    const usingLive = liveData?.price != null;

    const result = {
        detected: false,
        symbol,
        validated: true,
        live: usingLive,
        config: { fast: config.fast, slow: config.slow, type: config.type },
        fastMA: Math.round(fastMA * 100) / 100,
        slowMA: Math.round(slowMA * 100) / 100,
        scorePoints: 0,
        rsiBoostPoints: 0,
        annotation: null,
        type: null,
        direction: null
    };

    // --- Bullish bounce: uptrend + price > fastMA + low within touch zone of fastMA ---
    if (fastMA > slowMA && close > fastMA) {
        const touchPct = ((fastMA - low) / fastMA) * 100;
        if (touchPct >= -BOUNCE_TOUCH_PCT) {
            result.detected = true;
            result.type = 'bull_bounce';
            result.direction = 'bullish';
            result.touchPct = Math.round(touchPct * 100) / 100;

            if (config.score) {
                result.scorePoints = 8;
                result.annotation = `MA bounce (${config.type} ${config.fast}/${config.slow}) +${result.scorePoints}pts`;

                // RSI boost check
                if (config.rsiBoost && currentRsi != null && currentRsi < config.rsiBoost.threshold) {
                    // RSI boost uses same live low for consistency
                    const rsiBoostDetected = checkRsiBoostBounce(
                        closes, lows, highs, lastIdx,
                        config.rsiBoost.type, config.rsiBoost.fast, config.rsiBoost.slow,
                        close, low
                    );
                    if (rsiBoostDetected) {
                        result.rsiBoostPoints = config.rsiBoost.points;
                        result.scorePoints += result.rsiBoostPoints;
                        result.annotation = `MA bounce (${config.type} ${config.fast}/${config.slow}) +8pts + RSI<${config.rsiBoost.threshold} boost +${result.rsiBoostPoints}pts`;
                    }
                }
            } else {
                result.annotation = `ℹ️ MA bounce detected (${config.type} ${config.fast}/${config.slow}, <65% WR)`;
            }
        }
    }

    // --- Bearish bounce: downtrend + price < fastMA + high within touch zone of fastMA ---
    // Annotation only — no backtest data for bearish bounces
    if (!result.detected && fastMA < slowMA && close < fastMA) {
        const touchPct = ((high - fastMA) / fastMA) * 100;
        if (touchPct >= -BOUNCE_TOUCH_PCT) {
            result.detected = true;
            result.type = 'bear_bounce';
            result.direction = 'bearish';
            result.touchPct = Math.round(touchPct * 100) / 100;
            result.annotation = `ℹ️ Bearish MA bounce (${config.type} ${config.fast}/${config.slow})`;
            // No score points for bearish — annotation only
        }
    }

    return result;
}

/**
 * Check if the RSI-boost MA pair also shows a bullish bounce.
 * Uses live price/low when available for real-time detection.
 */
function checkRsiBoostBounce(closes, lows, highs, lastIdx, type, fast, slow, liveClose, liveLow) {
    const fastMA = computeMAAtIndex(closes, type, fast, lastIdx);
    const slowMA = computeMAAtIndex(closes, type, slow, lastIdx);

    if (fastMA == null || slowMA == null) return false;

    const close = liveClose != null ? liveClose : closes[lastIdx];
    const low = (liveLow != null && liveLow > 0) ? liveLow : lows[lastIdx];

    // Same bullish bounce criteria
    if (fastMA > slowMA && close > fastMA) {
        const touchPct = ((fastMA - low) / fastMA) * 100;
        return touchPct >= -BOUNCE_TOUCH_PCT;
    }

    return false;
}

module.exports = {
    MA_BOUNCE_CONFIG,
    detectBounce,
    fetchHistory,
    computeSMA,
    getEMASeries,
    getHMASeries,
    BOUNCE_TOUCH_PCT
};
