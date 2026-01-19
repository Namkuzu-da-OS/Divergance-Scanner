/**
 * Signal Logger & Validator
 * Tracks HIGH_CONVICTION alerts and validates their accuracy after 4 hours
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CONFIG = {
  SIGNAL_LOG: path.join(__dirname, '../data/signal_log.json'),
  OPTIONS_API: 'http://192.168.10.239:8000',
  VALIDATION_WINDOW_HOURS: 4,
  WIN_THRESHOLD_PCT: 0.5  // 0.5% move in predicted direction = correct
};

/**
 * Load signal log from file
 */
function loadSignals() {
  try {
    if (!fs.existsSync(CONFIG.SIGNAL_LOG)) {
      return {
        meta: {
          total_signals: 0,
          validated: 0,
          pending: 0,
          last_updated: new Date().toISOString()
        },
        signals: []
      };
    }
    return JSON.parse(fs.readFileSync(CONFIG.SIGNAL_LOG, 'utf8'));
  } catch (e) {
    console.error('[Signal Logger] Failed to load:', e.message);
    return {
      meta: {
        total_signals: 0,
        validated: 0,
        pending: 0,
        last_updated: new Date().toISOString()
      },
      signals: []
    };
  }
}

/**
 * Save signal log to file
 */
function saveSignals(data) {
  try {
    data.meta.last_updated = new Date().toISOString();
    data.meta.total_signals = data.signals.length;
    data.meta.validated = data.signals.filter(s => s.validated).length;
    data.meta.pending = data.signals.filter(s => !s.validated).length;

    fs.writeFileSync(CONFIG.SIGNAL_LOG, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Signal Logger] Failed to save:', e.message);
  }
}

/**
 * Log a new signal when alert fires
 * @param {object} alertData - Alert data from Bloodhound
 * @returns {string} Signal ID
 */
function logSignal(alertData) {
  const data = loadSignals();
  const timestamp = new Date().toISOString();
  const id = `${alertData.symbol}_${Date.now()}`;

  const signal = {
    id,
    timestamp,
    symbol: alertData.symbol,
    entry_price: alertData.price,
    direction: alertData.direction,  // bullish, bearish, pinned
    score: alertData.score,
    zone: alertData.zone,
    signals: alertData.signals || [],

    // Market context at entry
    context: {
      vix: alertData.vix,
      vix_regime: alertData.vix_regime,
      spy_trend: alertData.spy_trend,
      gamma_regime: alertData.gamma_regime
    },

    // Validation data (filled later)
    validated: false,
    validated_at: null,
    current_price: null,
    pct_change: null,
    correct: null
  };

  data.signals.push(signal);
  saveSignals(data);

  console.log(`[Signal Logger] Logged ${id} @ $${alertData.price} (${alertData.direction}, score ${alertData.score})`);
  return id;
}

/**
 * Fetch current price for symbol
 */
async function getCurrentPrice(symbol) {
  try {
    const response = await axios.get(`${CONFIG.OPTIONS_API}/api/technicals/${symbol}`, {
      timeout: 5000
    });
    return response.data?.current || null;
  } catch (e) {
    console.error(`[Signal Logger] Failed to fetch price for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Check if signal direction was correct
 */
function isDirectionCorrect(direction, entryPrice, currentPrice) {
  const pctChange = ((currentPrice - entryPrice) / entryPrice) * 100;

  if (direction === 'bullish') {
    return pctChange >= CONFIG.WIN_THRESHOLD_PCT;
  } else if (direction === 'bearish') {
    return pctChange <= -CONFIG.WIN_THRESHOLD_PCT;
  } else if (direction === 'pinned') {
    // Pinned is correct if price stayed within 1% range
    return Math.abs(pctChange) <= 1.0;
  }

  return null;
}

/**
 * Validate signals older than X hours
 * Called every scan cycle
 */
async function validateOldSignals() {
  const data = loadSignals();
  const cutoffTime = Date.now() - (CONFIG.VALIDATION_WINDOW_HOURS * 60 * 60 * 1000);

  const pendingSignals = data.signals.filter(s => {
    if (s.validated) return false;  // Already validated
    const signalTime = new Date(s.timestamp).getTime();
    return signalTime <= cutoffTime;  // Old enough to validate
  });

  if (pendingSignals.length === 0) {
    return;  // Nothing to validate
  }

  console.log(`[Signal Logger] Validating ${pendingSignals.length} signal(s)...`);

  let validatedCount = 0;
  for (const signal of pendingSignals) {
    try {
      const currentPrice = await getCurrentPrice(signal.symbol);
      if (!currentPrice) {
        console.log(`[Signal Logger] Skipping ${signal.id} - price fetch failed`);
        continue;
      }

      const pctChange = ((currentPrice - signal.entry_price) / signal.entry_price) * 100;
      const correct = isDirectionCorrect(signal.direction, signal.entry_price, currentPrice);

      signal.validated = true;
      signal.validated_at = new Date().toISOString();
      signal.current_price = currentPrice;
      signal.pct_change = parseFloat(pctChange.toFixed(2));
      signal.correct = correct;

      const result = correct ? '✅ CORRECT' : '❌ WRONG';
      console.log(`[Signal Logger] ${signal.id}: ${result} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`);

      validatedCount++;
    } catch (e) {
      console.error(`[Signal Logger] Error validating ${signal.id}:`, e.message);
    }
  }

  if (validatedCount > 0) {
    saveSignals(data);
    console.log(`[Signal Logger] Validated ${validatedCount} signal(s). ${data.meta.pending} pending.`);
  }
}

/**
 * Calculate win rate statistics
 * @returns {object} Stats
 */
function calculateStats() {
  const data = loadSignals();
  const validated = data.signals.filter(s => s.validated);

  if (validated.length === 0) {
    return {
      total_signals: data.signals.length,
      validated: 0,
      pending: data.signals.length,
      win_rate: 0,
      correct: 0,
      incorrect: 0,
      avg_gain_when_correct: 0,
      avg_loss_when_wrong: 0
    };
  }

  const correct = validated.filter(s => s.correct === true);
  const incorrect = validated.filter(s => s.correct === false);

  const avgGain = correct.length > 0
    ? correct.reduce((sum, s) => sum + Math.abs(s.pct_change), 0) / correct.length
    : 0;

  const avgLoss = incorrect.length > 0
    ? incorrect.reduce((sum, s) => sum + Math.abs(s.pct_change), 0) / incorrect.length
    : 0;

  const winRate = (correct.length / validated.length) * 100;

  return {
    total_signals: data.signals.length,
    validated: validated.length,
    pending: data.meta.pending,
    win_rate: parseFloat(winRate.toFixed(1)),
    correct: correct.length,
    incorrect: incorrect.length,
    avg_gain_when_correct: parseFloat(avgGain.toFixed(2)),
    avg_loss_when_wrong: parseFloat(avgLoss.toFixed(2))
  };
}

/**
 * Get recent signals for display
 * @param {number} limit - Max signals to return
 * @returns {Array} Recent signals
 */
function getRecentSignals(limit = 50) {
  const data = loadSignals();
  return data.signals
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

module.exports = {
  logSignal,
  validateOldSignals,
  calculateStats,
  getRecentSignals,
  loadSignals
};
