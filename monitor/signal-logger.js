/**
 * Signal Logger & Validator
 *
 * Now backed by SQLite database (signal-db.js) instead of JSON files.
 * Supports multi-checkpoint validation: 4h, 24h, 7d
 *
 * Backward compatible - same exports, same interfaces.
 */

const axios = require('axios');
const signalDb = require('./signal-db');

const CONFIG = {
  OPTIONS_API: 'http://192.168.10.60:8000',
  WIN_THRESHOLD_PCT: 0.5  // 0.5% move in predicted direction = correct
};

/**
 * Log a new signal when alert fires
 * Deduplicates: only one active signal per symbol allowed
 * Logs condition changes when they occur on existing signals
 * @param {object} alertData - Alert data from Bloodhound
 * @returns {string} Signal ID (existing or new)
 */
function logSignal(alertData) {
  // Check if symbol already has an active signal
  const activeSignals = signalDb.getActiveSignals();
  const existingSignal = activeSignals.find(s => s.symbol === alertData.symbol);

  if (existingSignal) {
    // Log if conditions changed significantly
    const scoreChange = alertData.score - existingSignal.score;
    const zoneChanged = alertData.zone !== existingSignal.zone;
    const directionChanged = alertData.direction !== existingSignal.direction;

    if (Math.abs(scoreChange) >= 10 || zoneChanged || directionChanged) {
      console.log(`[Signal Logger] ${alertData.symbol} conditions changed on existing signal:`);
      if (scoreChange !== 0) {
        console.log(`  Score: ${existingSignal.score} → ${alertData.score} (${scoreChange >= 0 ? '+' : ''}${scoreChange})`);
      }
      if (zoneChanged) {
        console.log(`  Zone: ${existingSignal.zone} → ${alertData.zone}`);
      }
      if (directionChanged) {
        console.log(`  Direction: ${existingSignal.direction} → ${alertData.direction}`);
      }
    }

    // Return existing signal ID - price tracking continues via updateActiveSignalPrices()
    return existingSignal.signal_id;
  }

  // No existing active signal for this symbol - create new one
  const timestamp = new Date().toISOString();
  const id = `${alertData.symbol}_${Date.now()}`;

  const success = signalDb.insertSignal({
    id,
    timestamp,
    symbol: alertData.symbol,
    direction: alertData.direction,
    entry_price: alertData.price,
    score: alertData.score,
    zone: alertData.zone,
    tier: alertData.tier || 'HIGH_CONVICTION',
    signals: alertData.signals || [],
    vix: alertData.vix,
    vix_regime: alertData.vix_regime,
    spy_trend: alertData.spy_trend,
    spy_price: alertData.spy_price,
    gamma_regime: alertData.gamma_regime,
    intraday_bias: alertData.intraday_bias,
    signal_type: alertData.signal_type,
    history_status: alertData.history_status,
    consecutive_days: alertData.consecutive_days
  });

  if (success) {
    console.log(`[Signal Logger] Logged ${id} @ $${alertData.price} (${alertData.direction}, score ${alertData.score})`);
  }

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
 * Update prices for all active signals
 * Call this every scan cycle to track peak/trough
 * Optimized: fetches price ONCE per unique symbol to avoid API hammering
 */
async function updateActiveSignalPrices() {
  const activeSignals = signalDb.getActiveSignals();

  if (activeSignals.length === 0) {
    return;
  }

  // Group signals by symbol to avoid duplicate API calls
  const symbolGroups = {};
  for (const signal of activeSignals) {
    if (!symbolGroups[signal.symbol]) {
      symbolGroups[signal.symbol] = [];
    }
    symbolGroups[signal.symbol].push(signal);
  }

  let updated = 0;
  const uniqueSymbols = Object.keys(symbolGroups).length;

  // Fetch price ONCE per unique symbol
  for (const [symbol, signals] of Object.entries(symbolGroups)) {
    try {
      const currentPrice = await getCurrentPrice(symbol);
      if (currentPrice) {
        // Update ALL signals for this symbol with same price
        for (const signal of signals) {
          signalDb.updatePriceTracking(signal.signal_id, currentPrice);
          updated++;
        }
      }
    } catch (e) {
      console.error(`[Signal Logger] Error updating ${symbol}:`, e.message);
    }
  }

  if (updated > 0) {
    console.log(`[Signal Logger] Updated prices for ${updated} signal(s) (${uniqueSymbols} API call(s))`);
  }
}

/**
 * Validate signals at checkpoint intervals (4h, 24h, 7d)
 * Call this every scan cycle - it handles timing internally
 */
async function validateOldSignals() {
  // Process all checkpoint types
  const checkpointTypes = ['4h', '24h', '7d'];

  for (const checkpointType of checkpointTypes) {
    const pendingSignals = signalDb.getSignalsForCheckpoint(checkpointType);

    if (pendingSignals.length === 0) {
      continue;
    }

    console.log(`[Signal Logger] Validating ${pendingSignals.length} signal(s) for ${checkpointType} checkpoint...`);

    for (const signal of pendingSignals) {
      try {
        const currentPrice = await getCurrentPrice(signal.symbol);
        if (!currentPrice) {
          console.log(`[Signal Logger] Skipping ${signal.signal_id} - price fetch failed`);
          continue;
        }

        const result = signalDb.recordCheckpoint(signal.signal_id, checkpointType, currentPrice);

        if (result) {
          const emoji = result.directionCorrect ? '✅' : '❌';
          console.log(`[Signal Logger] ${checkpointType} | ${signal.signal_id}: ${emoji} ${result.pctChange >= 0 ? '+' : ''}${result.pctChange.toFixed(2)}%`);
        }
      } catch (e) {
        console.error(`[Signal Logger] Error validating ${signal.signal_id}:`, e.message);
      }
    }
  }

  // Close stale signals (72h time stop)
  const closedCount = signalDb.closeStaleSignals();
  if (closedCount > 0) {
    console.log(`[Signal Logger] Closed ${closedCount} stale signal(s) (72h time stop)`);
  }
}

/**
 * Calculate win rate statistics
 * @returns {object} Stats
 */
function calculateStats() {
  const dbStats = signalDb.getDatabaseStats();
  const stats4h = signalDb.getStats({ checkpointType: '4h', days: 30 });

  // Also get pending count (active signals not yet validated at 4h)
  const activeSignals = signalDb.getActiveSignals();
  const pending = activeSignals.filter(s => !s.checkpoint_4h_done).length;

  return {
    total_signals: dbStats.total_signals,
    validated: stats4h.total_validated,
    pending: pending,
    win_rate: stats4h.win_rate,
    correct: stats4h.correct,
    incorrect: stats4h.total_validated - stats4h.correct,
    avg_gain_when_correct: stats4h.avg_peak_gain,
    avg_loss_when_wrong: Math.abs(stats4h.avg_drawdown),
    // Additional stats from DB
    active_signals: dbStats.active_signals,
    oldest_signal: dbStats.oldest_signal,
    newest_signal: dbStats.newest_signal
  };
}

/**
 * Get detailed stats by dimension
 */
function getDetailedStats(options = {}) {
  return {
    byTier: signalDb.getStatsByTier(options.checkpointType || '4h', options.days || 30),
    byVixRegime: signalDb.getStatsByVixRegime(options.checkpointType || '4h', options.days || 30),
    byDirection: signalDb.getStatsByDirection(options.checkpointType || '4h', options.days || 30),
    byCheckpoint: signalDb.compareCheckpoints(options.days || 30)
  };
}

/**
 * Get recent signals for display
 * @param {number} limit - Max signals to return
 * @returns {Array} Recent signals with checkpoint data
 */
function getRecentSignals(limit = 50) {
  const signals = signalDb.getRecentSignals(limit);

  // Transform to match old format for backward compatibility
  return signals.map(s => ({
    id: s.signal_id,
    timestamp: s.timestamp,
    symbol: s.symbol,
    entry_price: s.entry_price,
    direction: s.direction,
    score: s.score,
    zone: s.zone,
    signals: JSON.parse(s.signals_json || '[]'),
    context: {
      vix: s.vix,
      vix_regime: s.vix_regime,
      spy_trend: s.spy_trend,
      gamma_regime: s.gamma_regime
    },
    validated: !!s.validated,
    validated_at: s.validated_at,
    current_price: s.current_price,
    pct_change: s.change_4h || ((s.current_price - s.entry_price) / s.entry_price) * 100,
    correct: s.correct === 1,
    // Additional DB fields
    peak_gain_pct: s.peak_gain_pct,
    max_drawdown_pct: s.max_drawdown_pct,
    status: s.status,
    change_4h: s.change_4h,
    change_24h: s.change_24h,
    change_7d: s.change_7d
  }));
}

/**
 * Load signals in the old format (for backward compatibility)
 * @returns {object} Data in old JSON format
 */
function loadSignals() {
  const signals = getRecentSignals(500);  // Get last 500 signals
  const stats = calculateStats();

  return {
    meta: {
      total_signals: stats.total_signals,
      validated: stats.validated,
      pending: stats.pending,
      last_updated: new Date().toISOString()
    },
    signals: signals
  };
}

/**
 * Get signal by ID
 */
function getSignalById(signalId) {
  const db = signalDb.getDb();
  return db.prepare('SELECT * FROM signals WHERE signal_id = ?').get(signalId);
}

/**
 * Get all checkpoints for a signal
 */
function getSignalCheckpoints(signalId) {
  const db = signalDb.getDb();
  return db.prepare(
    'SELECT * FROM checkpoints WHERE signal_id = ? ORDER BY checkpoint_type'
  ).all(signalId);
}

/**
 * Get price history for a signal
 */
function getSignalPriceHistory(signalId) {
  const db = signalDb.getDb();
  return db.prepare(
    'SELECT * FROM price_snapshots WHERE signal_id = ? ORDER BY timestamp'
  ).all(signalId);
}

module.exports = {
  // Original exports (backward compatible)
  logSignal,
  validateOldSignals,
  calculateStats,
  getRecentSignals,
  loadSignals,
  // New exports
  updateActiveSignalPrices,
  getDetailedStats,
  getSignalById,
  getSignalCheckpoints,
  getSignalPriceHistory,
  getCurrentPrice
};
