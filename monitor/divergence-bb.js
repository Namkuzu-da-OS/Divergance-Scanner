/**
 * DIVERGENCE + BOLLINGER BAND DETECTION MODULE
 *
 * Detects RSI divergence at Bollinger Band extremes using per-ticker configs
 * from backtest data (17,289 parameter sweeps across 9 symbols, 10yr daily).
 *
 * Exports:
 *   DIVERGENCE_BB_CONFIG — per-ticker, per-direction config (scoring, params)
 *   detectDivergenceBB() — real-time detection for a single symbol
 */

// ============================================
// PER-TICKER CONFIG (from backtest results)
// ============================================

/**
 * Each entry: { bull: {...}, bear: {...} }
 *
 * score: true = backtest-validated, earns score points
 * points: base score contribution (8 for 70-80% WR, 10 for 80%+ WR)
 * lb: lookback for swing detection (bars on each side)
 * bb: %B threshold (bullish: price must be ≤ bb, bearish: ≥ 1-bb)
 * swing: [minBars, maxBars] between divergence swing points
 */
const DIVERGENCE_BB_CONFIG = {
    SPY:  { bull: { score: true,  points: 8,  lb: 3, bb: 0.2,  swing: [5, 20]  }, bear: { score: false } },
    QQQ:  { bull: { score: true,  points: 10, lb: 3, bb: 0.2,  swing: [5, 60]  }, bear: { score: false } },
    NVDA: { bull: { score: true,  points: 10, lb: 7, bb: 0.3,  swing: [5, 100] }, bear: { score: false } },
    TSLA: { bull: { score: true,  points: 8,  lb: 3, bb: 0.05, swing: [5, 100] }, bear: { score: true, points: 8, lb: 5, bb: 0.1, swing: [10, 60] } },
    AMD:  { bull: { score: true,  points: 8,  lb: 3, bb: 0.15, swing: [5, 40]  }, bear: { score: true, points: 8, lb: 5, bb: 0.1, swing: [5, 40]  } },
    AAPL: { bull: { score: true,  points: 8,  lb: 3, bb: 0.1,  swing: [5, 60]  }, bear: { score: true, points: 8, lb: 3, bb: 0.05, swing: [10, 40] } },
    META: { bull: { score: true,  points: 8,  lb: 3, bb: 0.2,  swing: [5, 20]  }, bear: { score: false } },
    MSFT: { bull: { score: true,  points: 10, lb: 3, bb: 0.1,  swing: [5, 40]  }, bear: { score: false } },
    IBIT: { bull: { score: true,  points: 8,  lb: 7, bb: 0.3,  swing: [5, 100] }, bear: { score: true, points: 8, lb: 3, bb: 0.2, swing: [5, 100] } },
};

// Variant E RSI thresholds (triple confluence bonus: divergence + BB + extreme RSI)
const VARIANT_E_BULL_RSI = 30;  // RSI ≤ 30 for bullish variant E
const VARIANT_E_BEAR_RSI = 70;  // RSI ≥ 70 for bearish variant E
const VARIANT_E_BONUS = 4;      // +4 points for variant E

// Active window: divergence signal must have fired within last N trading days
const ACTIVE_WINDOW_DAYS = 5;

// ============================================
// RSI COMPUTATION (from divergence-bb-backtest.js)
// ============================================

function getRSISeries(closes, period = 14) {
    const rsi = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return rsi;

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

    return rsi;
}

// ============================================
// BOLLINGER BANDS (from divergence-bb-backtest.js)
// ============================================

function computeBB(closes, period = 20, stdDevMult = 2) {
    const middle = new Array(closes.length).fill(null);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    const percentB = new Array(closes.length).fill(null);

    for (let i = period - 1; i < closes.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += closes[j];
        }
        const sma = sum / period;

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

// ============================================
// SWING DETECTION (from divergence-bb-backtest.js)
// ============================================

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

// ============================================
// DIVERGENCE DETECTION (from divergence-bb-backtest.js)
// ============================================

function detectBullishDivergences(lows, rsiSeries, swingLows, minBars = 5, maxBars = 40) {
    const divergences = [];
    const usedCurrIndices = new Set();

    for (let i = 1; i < swingLows.length; i++) {
        const curr = swingLows[i];
        if (rsiSeries[curr.index] == null) continue;
        if (usedCurrIndices.has(curr.index)) continue;

        let bestDiv = null;

        for (let j = i - 1; j >= 0; j--) {
            const prev = swingLows[j];
            const barsBetween = curr.index - prev.index;
            if (barsBetween < minBars) continue;
            if (barsBetween > maxBars) break;

            if (rsiSeries[prev.index] == null) continue;

            // Price lower or equal low + RSI higher low = bullish divergence
            if (curr.price <= prev.price && rsiSeries[curr.index] > rsiSeries[prev.index]) {
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

function detectBearishDivergences(highs, rsiSeries, swingHighs, minBars = 5, maxBars = 40) {
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

            // Price higher or equal high + RSI lower high = bearish divergence
            if (curr.price >= prev.price && rsiSeries[curr.index] < rsiSeries[prev.index]) {
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

// ============================================
// CORE DETECTION
// ============================================

/**
 * Detect divergence + Bollinger Band confluence for a symbol.
 *
 * @param {string} symbol    — Ticker symbol
 * @param {Array}  candles   — Daily OHLCV candles (from fetchHistory cache)
 * @param {number} currentRsi — Current RSI from technicals API (for variant E check)
 * @returns {object} { detected, direction, scorePoints, annotation, variant, ... }
 */
function detectDivergenceBB(symbol, candles, currentRsi) {
    const config = DIVERGENCE_BB_CONFIG[symbol];
    if (!config) {
        return { detected: false, symbol, configured: false };
    }

    if (!candles || candles.length < 50) {
        return { detected: false, symbol, configured: true, reason: 'insufficient_data' };
    }

    // Sort ascending by datetime
    const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
    const closes = sorted.map(c => c.close);
    const lows = sorted.map(c => c.low);
    const highs = sorted.map(c => c.high);

    // Compute indicators
    const rsiSeries = getRSISeries(closes);
    const bb = computeBB(closes);
    const lastIdx = closes.length - 1;

    // Results for both directions
    let bestResult = null;

    // --- Bullish: divergence at lower BB ---
    if (config.bull) {
        const cfg = config.bull;
        const swingLows = findSwingLows(lows, cfg.lb);
        const divs = detectBullishDivergences(lows, rsiSeries, swingLows, cfg.swing[0], cfg.swing[1]);

        for (const div of divs) {
            // Check BB condition: %B at confirmation bar must be ≤ threshold
            const confirmIdx = div.currIndex + cfg.lb; // swing confirmed after lookback bars
            if (confirmIdx >= closes.length) continue;
            if (bb.percentB[div.currIndex] == null) continue;
            if (bb.percentB[div.currIndex] > cfg.bb) continue;

            // Active window: confirmation must be within last N trading days
            const barsFromEnd = lastIdx - confirmIdx;
            if (barsFromEnd > ACTIVE_WINDOW_DAYS) continue;

            // This divergence-BB signal is active
            let points = cfg.score ? cfg.points : 0;
            let variant = 'D'; // Divergence + BB

            // Variant E: triple confluence (divergence + BB + extreme RSI)
            if (currentRsi != null && currentRsi <= VARIANT_E_BULL_RSI) {
                variant = 'E';
                if (cfg.score) points += VARIANT_E_BONUS;
            }

            const annotation = cfg.score
                ? `Bullish div+BB (lb=${cfg.lb}, %B≤${cfg.bb}, ${div.barsBetween}bars, RSI ${div.prevRSI.toFixed(0)}→${div.currRSI.toFixed(0)}) +${points}pts${variant === 'E' ? ' [Var-E]' : ''}`
                : `ℹ️ Bullish div+BB detected (annotation only)`;

            // Prefer the most recent signal
            if (!bestResult || confirmIdx > bestResult.confirmIdx) {
                bestResult = {
                    detected: true,
                    symbol,
                    configured: true,
                    direction: 'bullish',
                    scorePoints: points,
                    annotation,
                    variant,
                    confirmIdx,
                    barsAgo: barsFromEnd,
                    divergence: div,
                    bbPercentB: Math.round(bb.percentB[div.currIndex] * 1000) / 1000,
                };
            }
        }
    }

    // --- Bearish: divergence at upper BB ---
    if (config.bear && config.bear.score !== undefined) {
        const cfg = config.bear;
        if (cfg.score !== false || true) { // Always detect, scoring controlled by cfg.score
            const swingHighs = findSwingHighs(highs, cfg.lb || 5);
            const divs = detectBearishDivergences(highs, rsiSeries, swingHighs, cfg.swing?.[0] || 5, cfg.swing?.[1] || 40);

            for (const div of divs) {
                const confirmIdx = div.currIndex + (cfg.lb || 5);
                if (confirmIdx >= closes.length) continue;
                if (bb.percentB[div.currIndex] == null) continue;
                if (bb.percentB[div.currIndex] < (1 - (cfg.bb || 0.1))) continue;

                const barsFromEnd = lastIdx - confirmIdx;
                if (barsFromEnd > ACTIVE_WINDOW_DAYS) continue;

                let points = cfg.score ? cfg.points : 0;
                let variant = 'D';

                if (currentRsi != null && currentRsi >= VARIANT_E_BEAR_RSI) {
                    variant = 'E';
                    if (cfg.score) points += VARIANT_E_BONUS;
                }

                const annotation = cfg.score
                    ? `Bearish div+BB (lb=${cfg.lb}, %B≥${(1 - cfg.bb).toFixed(2)}, ${div.barsBetween}bars, RSI ${div.prevRSI.toFixed(0)}→${div.currRSI.toFixed(0)}) +${points}pts${variant === 'E' ? ' [Var-E]' : ''}`
                    : `ℹ️ Bearish div+BB detected (annotation only)`;

                // Prefer bearish only if no bullish found, or if more recent
                if (!bestResult || confirmIdx > bestResult.confirmIdx) {
                    bestResult = {
                        detected: true,
                        symbol,
                        configured: true,
                        direction: 'bearish',
                        scorePoints: points,
                        annotation,
                        variant,
                        confirmIdx,
                        barsAgo: barsFromEnd,
                        divergence: div,
                        bbPercentB: Math.round(bb.percentB[div.currIndex] * 1000) / 1000,
                    };
                }
            }
        }
    }

    if (!bestResult) {
        return { detected: false, symbol, configured: true };
    }

    return bestResult;
}

module.exports = {
    DIVERGENCE_BB_CONFIG,
    detectDivergenceBB,
};
