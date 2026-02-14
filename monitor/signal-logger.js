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

const appConfig = require('./config-loader');
const CONFIG = {
  OPTIONS_API: appConfig.apis.options,
  WIN_THRESHOLD_PCT: 0.5  // 0.5% move in predicted direction = correct
};

// Sleep helper for retry backoff
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Tier hierarchy for promotion checks (higher index = higher tier)
const TIER_RANK = { FILTERED: 0, WATCH: 1, TRADEABLE: 2, HIGH_CONVICTION: 3 };

/**
 * Check if newTier outranks existingTier — if so, promote in DB
 */
function maybePromoteTier(signalId, symbol, existingTier, newTier, newScore) {
  const existingRank = TIER_RANK[existingTier] ?? -1;
  const newRank = TIER_RANK[newTier] ?? -1;
  if (newRank > existingRank) {
    signalDb.updateSignalTier(signalId, newTier, newScore);
    console.log(`[Signal Logger] ${symbol} tier promoted: ${existingTier} → ${newTier} (score: ${newScore})`);
  }
}

/**
 * Log a new signal when alert fires
 * Deduplicates: only one active signal per symbol allowed
 * Logs condition changes when they occur on existing signals
 * If an unusual option is flagged, also fetches its current mark price
 * @param {object} alertData - Alert data from Bloodhound
 * @returns {string} Signal ID (existing or new)
 */
async function logSignal(alertData) {
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

    // Promote tier if new alert outranks existing (e.g. TRADEABLE → HC)
    maybePromoteTier(existingSignal.signal_id, alertData.symbol, existingSignal.tier, alertData.tier, alertData.score);

    // Return existing signal ID - price tracking continues via updateActiveSignalPrices()
    return existingSignal.signal_id;
  }

  // Check if ANY signal (including closed) exists today for this symbol
  // This catches the re-logging-after-auto-close bug
  const todaySignal = signalDb.hasSignalToday(alertData.symbol);
  if (todaySignal) {
    // Promote tier if new alert outranks existing (e.g. TRADEABLE → HC)
    maybePromoteTier(todaySignal.signal_id, alertData.symbol, todaySignal.tier, alertData.tier, alertData.score);

    console.log(`[Signal Logger] ${alertData.symbol} already has signal today (${todaySignal.signal_id}, status: ${todaySignal.status}) — skipping`);
    return todaySignal.signal_id;
  }

  // No existing active signal for this symbol - create new one
  const timestamp = new Date().toISOString();
  const id = `${alertData.symbol}_${Date.now()}`;

  // If there's an unusual option, try to fetch its current mark price as entry premium
  let optionEntryPrice = null;
  if (alertData.option_contract && alertData.option_strike) {
    try {
      const optPrice = await fetchOptionPrice(
        alertData.symbol,
        alertData.option_strike,
        alertData.option_expiration,
        alertData.option_type
      );
      if (optPrice && optPrice.mark > 0) {
        optionEntryPrice = optPrice;
        console.log(`[Signal Logger] Option entry: ${alertData.option_contract} mark=$${optPrice.mark.toFixed(2)} delta=${optPrice.delta || '?'}`);
      }
    } catch (e) {
      console.error(`[Signal Logger] Failed to fetch option entry price for ${alertData.option_contract}:`, e.message);
    }
  }

  // Capture market internals snapshot at entry time
  const internals = signalDb.getLatestInternals();

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
    consecutive_days: alertData.consecutive_days,
    // Market internals at entry
    tick_at_entry: internals?.tick ?? null,
    trin_at_entry: internals?.trin ?? null,
    ad_spread_at_entry: internals?.ad_spread ?? null,
    vol_ratio_at_entry: internals?.vol_ratio ?? null,
    // Option tracking fields
    option_contract: alertData.option_contract || null,
    option_type: alertData.option_type || null,
    option_strike: alertData.option_strike || null,
    option_expiration: alertData.option_expiration || null,
    option_dte: alertData.option_dte != null ? alertData.option_dte : null,
    option_vol_oi: alertData.option_vol_oi || null,
    option_premium_flow: alertData.option_premium_flow || null,
    option_premium_entry: optionEntryPrice?.mark || null,
    option_delta_entry: optionEntryPrice?.delta || null,
    option_iv_entry: optionEntryPrice?.iv || null
  });

  if (success) {
    const optInfo = alertData.option_contract
      ? ` | Option: ${alertData.option_contract} ${optionEntryPrice ? '$' + optionEntryPrice.mark.toFixed(2) : '(price pending)'}`
      : '';
    console.log(`[Signal Logger] Logged ${id} @ $${alertData.price} (${alertData.direction}, score ${alertData.score})${optInfo}`);

    // Auto-add to watchlist so this symbol stays in the scan universe
    // while the signal is active. This ensures price tracking always uses
    // the scan cache instead of making separate API calls that can timeout.
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72h = signal time stop
    signalDb.addToWatchlist(alertData.symbol, {
      source: 'signal_tracking',
      notes: `Active signal ${id}`,
      scoreAtAdd: alertData.score,
      tierAtAdd: alertData.tier || 'HIGH_CONVICTION',
      expiresAt
    });
  }

  return id;
}

/**
 * Fetch current price for symbol
 * @param {string} symbol - Stock symbol
 * @param {Map} priceCache - Optional cache of prices from recent scan
 */
async function getCurrentPrice(symbol, priceCache = null) {
  // 1. Check cache first (prices already fetched during scan)
  if (priceCache && priceCache.has(symbol)) {
    return priceCache.get(symbol);
  }

  // 2. API call with retry logic for cache misses
  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(`${CONFIG.OPTIONS_API}/api/technicals/${symbol}`, {
        timeout: 10000  // Increased from 5000ms
      });
      return response.data?.current || null;
    } catch (e) {
      if (attempt === maxRetries) {
        console.error(`[Signal Logger] Failed to fetch price for ${symbol} after ${maxRetries} attempts:`, e.message);
        return null;
      }
      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`[Signal Logger] Retry ${attempt}/${maxRetries} for ${symbol} in ${delay}ms...`);
      await sleep(delay);
    }
  }
  return null;
}

/**
 * Fetch current price data for a specific option contract from the chain API
 * @param {string} symbol - Stock symbol (e.g., 'AMZN')
 * @param {number} strike - Strike price (e.g., 207.5)
 * @param {string} expiration - Expiration date (e.g., '2026-02-09')
 * @param {string} optionType - 'CALL' or 'PUT'
 * @returns {object|null} { bid, ask, mark, delta, iv, theta } or null
 */
async function fetchOptionPrice(symbol, strike, expiration, optionType) {
  try {
    const response = await axios.get(`${CONFIG.OPTIONS_API}/api/options/${symbol}`, {
      timeout: 15000
    });
    const chain = response.data?.chain;
    if (!chain) return null;

    const dateMap = optionType === 'CALL' ? chain.callExpDateMap : chain.putExpDateMap;
    if (!dateMap) return null;

    // Find the expiration key (format: "YYYY-MM-DD:DTE")
    const expiryKey = Object.keys(dateMap).find(k => k.startsWith(expiration));
    if (!expiryKey) return null;

    const strikes = dateMap[expiryKey];
    if (!strikes) return null;

    // Find the strike (try exact match, then with .0 suffix)
    const strikeStr = String(strike);
    const contracts = strikes[strikeStr] || strikes[strikeStr + '.0'];
    if (!contracts || contracts.length === 0) return null;

    const contract = contracts[0];
    return {
      bid: contract.bid || 0,
      ask: contract.ask || 0,
      mark: contract.mark || 0,
      delta: contract.delta || null,
      iv: contract.volatility || null,
      theta: contract.theta || null
    };
  } catch (e) {
    console.error(`[Signal Logger] Option price fetch failed for ${symbol} $${strike} ${expiration}:`, e.message);
    return null;
  }
}

/**
 * Update prices for all active signals
 * Call this every scan cycle to track peak/trough
 * Optimized: uses price cache from scan, only fetches missing symbols
 * @param {Map} priceCache - Optional cache of prices from recent scan
 */
async function updateActiveSignalPrices(priceCache = null) {
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
  let optionsUpdated = 0;
  let cacheHits = 0;
  let apiCalls = 0;
  const uniqueSymbols = Object.keys(symbolGroups).length;

  // Fetch price ONCE per unique symbol (uses cache if available)
  for (const [symbol, signals] of Object.entries(symbolGroups)) {
    try {
      // Track whether this will be a cache hit
      const fromCache = priceCache && priceCache.has(symbol);
      if (fromCache) cacheHits++;
      else apiCalls++;

      const currentPrice = await getCurrentPrice(symbol, priceCache);
      if (currentPrice) {
        // Check if any signal for this symbol needs option price tracking
        // Fetch chain ONCE per symbol if needed (avoid duplicate chain calls)
        let chainFetched = false;
        let chainData = null;

        for (const signal of signals) {
          let optionPrice = null;

          // Fetch option price if this signal tracks an option contract
          if (signal.option_contract && signal.option_strike && signal.option_expiration) {
            if (!chainFetched) {
              // Fetch chain once for all signals on this symbol
              optionPrice = await fetchOptionPrice(
                symbol,
                signal.option_strike,
                signal.option_expiration,
                signal.option_type
              );
              chainData = optionPrice;
              chainFetched = true;
            } else {
              optionPrice = chainData;
            }

            // Update option price tracking on the signal
            if (optionPrice) {
              const optResult = signalDb.updateOptionPriceTracking(signal.signal_id, optionPrice);
              if (optResult) optionsUpdated++;
            } else {
              // Option not found in chain — may have expired
              const expDate = new Date(signal.option_expiration + 'T16:00:00-05:00');
              if (Date.now() > expDate.getTime()) {
                // Option has expired — close the option signal
                signalDb.closeOptionSignal(signal.signal_id, 0);
                console.log(`[Signal Logger] Option ${signal.option_contract} expired — closed`);
              }
            }

            // Check if stock hit the target wall
            signalDb.checkWallHit(signal.signal_id, currentPrice);
          }

          // Update stock price tracking (includes option data in snapshot if available)
          signalDb.updatePriceTracking(signal.signal_id, currentPrice, optionPrice);
          updated++;
        }
      }
    } catch (e) {
      console.error(`[Signal Logger] Error updating ${symbol}:`, e.message);
    }
  }

  if (updated > 0) {
    const cacheInfo = priceCache ? ` (${cacheHits} cached, ${apiCalls} API)` : ` (${uniqueSymbols} API calls)`;
    const optInfo = optionsUpdated > 0 ? `, ${optionsUpdated} option(s)` : '';
    console.log(`[Signal Logger] Updated prices for ${updated} signal(s)${optInfo}${cacheInfo}`);
  }
}

/**
 * Validate signals at checkpoint intervals (4h, 24h, 7d)
 * Call this every scan cycle - it handles timing internally
 * @param {Map} priceCache - Optional cache of prices from recent scan
 */
async function validateOldSignals(priceCache = null) {
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
        const currentPrice = await getCurrentPrice(signal.symbol, priceCache);
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
  getCurrentPrice,
  // Option signal tracking
  fetchOptionPrice
};
