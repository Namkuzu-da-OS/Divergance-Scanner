const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const CONFIG = {
  DATA_FILE: path.join(__dirname, '../data/paper_trades.json'),
  STOP_LOSS_PCT: -5.0,
  TAKE_PROFIT_PCT: 5.0,
  TIME_STOP_HOURS: 72,
  WIN_THRESHOLD_PCT: 2.0,
  LOSS_THRESHOLD_PCT: -2.0,
  OPTIONS_API: 'http://192.168.10.239:8000'
};

// Time windows for price tracking (in minutes)
const TIME_WINDOWS = {
  '1h': 60,
  '4h': 240,
  '24h': 1440,
  '72h': 4320
};

/**
 * Load paper trades from file
 */
function loadPaperTrades() {
  try {
    if (!fs.existsSync(CONFIG.DATA_FILE)) {
      return {
        meta: {
          last_updated: new Date().toISOString(),
          total_trades: 0,
          open_positions: 0,
          closed_positions: 0
        },
        trades: []
      };
    }
    return JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('[Paper Trade] Failed to load:', e.message);
    return {
      meta: {
        last_updated: new Date().toISOString(),
        total_trades: 0,
        open_positions: 0,
        closed_positions: 0
      },
      trades: []
    };
  }
}

/**
 * Save paper trades to file
 */
function savePaperTrades(data) {
  try {
    data.meta.last_updated = new Date().toISOString();
    data.meta.total_trades = data.trades.length;
    data.meta.open_positions = data.trades.filter(t => t.status === 'open').length;
    data.meta.closed_positions = data.trades.filter(t => t.status === 'closed').length;

    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Paper Trade] Failed to save:', e.message);
  }
}

/**
 * Generate unique trade ID with collision prevention
 */
function generateTradeId(symbol, signalType) {
  const data = loadPaperTrades();
  const typeCode = signalType.substring(0, 2).toUpperCase();

  let id, counter = 0;
  do {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 15);
    id = counter === 0 ? `${symbol}_${typeCode}_${timestamp}` : `${symbol}_${typeCode}_${timestamp}_${counter}`;
    counter++;
  } while (data.trades.some(t => t.id === id));

  return id;
}

/**
 * Create a new paper trade
 * @param {string} signalType - HIGH_CONVICTION, WALL_PROXIMITY, etc.
 * @param {string} symbol - Ticker symbol
 * @param {number} price - Entry price
 * @param {string} direction - bullish, bearish, pinned
 * @param {object} context - Additional context (score, zone, vix, signals)
 * @returns {string} Trade ID
 */
function createPaperTrade(signalType, symbol, price, direction, context = {}) {
  const data = loadPaperTrades();
  const timestamp = new Date().toISOString();

  const trade = {
    id: generateTradeId(symbol, signalType),
    symbol,
    signal_type: signalType,
    direction,
    status: 'open',

    entry: {
      timestamp,
      price,
      score: context.score || null,
      zone: context.zone || null,
      signals: context.signals || [],
      // VIX context
      vix: context.vix || null,
      vix_regime: context.vix_regime || null,
      // Market context
      spy_trend: context.spy_trend || null,
      intraday_bias: context.intraday_bias || null,
      swing_bias: context.swing_bias || null
    },

    exit: null,

    outcome: {
      pnl_pct: null,
      result: null,
      price_1h: null,
      price_4h: null,
      price_24h: null,
      price_72h: null,
      peak_gain_pct: null,
      max_drawdown_pct: null
    }
  };

  data.trades.push(trade);
  savePaperTrades(data);

  console.log(`[Paper Trade] Created ${trade.id} @ $${price} (${signalType}, ${direction})`);
  return trade.id;
}

/**
 * Fetch current price for symbol
 */
async function getCurrentPrice(symbol) {
  try {
    const response = await axios.get(`${CONFIG.OPTIONS_API}/api/technicals/${symbol}`, {
      timeout: 5000
    });
    // Extract price from technicals response (current is the latest price)
    return response.data?.current || null;
  } catch (e) {
    console.error(`[Paper Trade] Failed to fetch price for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Calculate time elapsed in minutes
 */
function getMinutesElapsed(timestamp) {
  const now = new Date();
  const entry = new Date(timestamp);
  return Math.floor((now - entry) / (1000 * 60));
}

/**
 * Determine which time window price to update
 * Captures first price AFTER crossing threshold, not within 5-min window
 */
function getTimeWindowField(minutesElapsed, outcome) {
  if (minutesElapsed >= TIME_WINDOWS['1h'] && outcome.price_1h === null) return 'price_1h';
  if (minutesElapsed >= TIME_WINDOWS['4h'] && outcome.price_4h === null) return 'price_4h';
  if (minutesElapsed >= TIME_WINDOWS['24h'] && outcome.price_24h === null) return 'price_24h';
  if (minutesElapsed >= TIME_WINDOWS['72h'] && outcome.price_72h === null) return 'price_72h';
  return null;
}

/**
 * Calculate outcome classification (WIN/LOSS/BREAKEVEN)
 */
function calculateOutcome(pnlPct) {
  if (pnlPct >= CONFIG.WIN_THRESHOLD_PCT) return 'WIN';
  if (pnlPct <= CONFIG.LOSS_THRESHOLD_PCT) return 'LOSS';
  return 'BREAKEVEN';
}

/**
 * Close a paper trade
 */
function closeTrade(trade, currentPrice, reason) {
  const timestamp = new Date().toISOString();
  const entryTime = new Date(trade.entry.timestamp);
  const exitTime = new Date(timestamp);
  const durationHours = ((exitTime - entryTime) / (1000 * 60 * 60)).toFixed(2);

  // Calculate PnL - flip calculation for bearish trades
  let pnlPct;
  if (trade.direction === 'bearish') {
    pnlPct = ((trade.entry.price - currentPrice) / trade.entry.price) * 100;
  } else {
    pnlPct = ((currentPrice - trade.entry.price) / trade.entry.price) * 100;
  }

  trade.exit = {
    timestamp,
    price: currentPrice,
    reason,
    duration_hours: parseFloat(durationHours)
  };

  trade.outcome.pnl_pct = parseFloat(pnlPct.toFixed(2));
  trade.outcome.result = calculateOutcome(pnlPct);
  trade.status = 'closed';

  console.log(`[Paper Trade] Closed ${trade.id} @ $${currentPrice} | ${trade.outcome.result} (${pnlPct.toFixed(2)}%) | Reason: ${reason}`);
}

/**
 * Update all open paper trades
 * Called every scan cycle to track price movement and close trades
 */
async function updatePaperTrades() {
  const data = loadPaperTrades();
  const openTrades = data.trades.filter(t => t.status === 'open');

  if (openTrades.length === 0) {
    return; // No open trades to update
  }

  console.log(`[Paper Trade] Updating ${openTrades.length} open position(s)...`);

  for (const trade of openTrades) {
    try {
      const currentPrice = await getCurrentPrice(trade.symbol);
      if (!currentPrice) {
        continue; // Skip if price fetch failed
      }

      const minutesElapsed = getMinutesElapsed(trade.entry.timestamp);
      const hoursElapsed = minutesElapsed / 60;

      // Calculate PnL - flip calculation for bearish trades
      let pnlPct;
      if (trade.direction === 'bearish') {
        pnlPct = ((trade.entry.price - currentPrice) / trade.entry.price) * 100;
      } else {
        pnlPct = ((currentPrice - trade.entry.price) / trade.entry.price) * 100;
      }

      // Update peak gain and max drawdown
      if (trade.outcome.peak_gain_pct === null || pnlPct > trade.outcome.peak_gain_pct) {
        trade.outcome.peak_gain_pct = parseFloat(pnlPct.toFixed(2));
      }
      if (trade.outcome.max_drawdown_pct === null || pnlPct < trade.outcome.max_drawdown_pct) {
        trade.outcome.max_drawdown_pct = parseFloat(pnlPct.toFixed(2));
      }

      // Update time window prices
      const windowField = getTimeWindowField(minutesElapsed, trade.outcome);
      if (windowField) {
        trade.outcome[windowField] = currentPrice;
        console.log(`[Paper Trade] ${trade.id} ${windowField}: $${currentPrice} (${pnlPct.toFixed(2)}%)`);
      }

      // Check exit conditions (check all independently)
      let closeReasons = [];

      if (pnlPct <= CONFIG.STOP_LOSS_PCT) {
        closeReasons.push('stop_hit');
      }
      if (pnlPct >= CONFIG.TAKE_PROFIT_PCT) {
        closeReasons.push('target_hit');
      }
      if (hoursElapsed >= CONFIG.TIME_STOP_HOURS) {
        closeReasons.push('time_stop_72h');
      }

      if (closeReasons.length > 0) {
        const closeReason = closeReasons.join('+');
        closeTrade(trade, currentPrice, closeReason);
      }

    } catch (e) {
      console.error(`[Paper Trade] Error updating ${trade.id}:`, e.message);
    }
  }

  savePaperTrades(data);

  const stillOpen = data.trades.filter(t => t.status === 'open').length;
  const justClosed = openTrades.length - stillOpen;
  if (justClosed > 0) {
    console.log(`[Paper Trade] Closed ${justClosed} position(s). ${stillOpen} remain open.`);
  }
}

/**
 * Calculate statistics by signal type
 * @returns {object} Stats grouped by signal type
 */
function calculateSignalStats() {
  const data = loadPaperTrades();
  const closedTrades = data.trades.filter(t => t.status === 'closed');

  if (closedTrades.length === 0) {
    return {};
  }

  const statsBySignal = {};

  for (const trade of closedTrades) {
    const signalType = trade.signal_type;

    if (!statsBySignal[signalType]) {
      statsBySignal[signalType] = {
        total_trades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        total_pnl_pct: 0,
        win_pnl_pct: 0,
        loss_pnl_pct: 0,
        avg_duration_hours: 0
      };
    }

    const stats = statsBySignal[signalType];
    stats.total_trades++;
    stats.total_pnl_pct += trade.outcome.pnl_pct;

    if (trade.outcome.result === 'WIN') {
      stats.wins++;
      stats.win_pnl_pct += trade.outcome.pnl_pct;
    } else if (trade.outcome.result === 'LOSS') {
      stats.losses++;
      stats.loss_pnl_pct += trade.outcome.pnl_pct;
    } else {
      stats.breakevens++;
    }

    if (trade.exit && trade.exit.duration_hours) {
      stats.avg_duration_hours += trade.exit.duration_hours;
    }
  }

  // Calculate final metrics
  for (const signalType in statsBySignal) {
    const stats = statsBySignal[signalType];

    stats.win_rate = stats.total_trades > 0
      ? ((stats.wins / stats.total_trades) * 100).toFixed(1)
      : '0.0';

    stats.avg_win = stats.wins > 0
      ? (stats.win_pnl_pct / stats.wins).toFixed(2)
      : '0.00';

    stats.avg_loss = stats.losses > 0
      ? (stats.loss_pnl_pct / stats.losses).toFixed(2)
      : '0.00';

    stats.profit_factor = stats.losses > 0 && stats.loss_pnl_pct < 0
      ? (stats.win_pnl_pct / Math.abs(stats.loss_pnl_pct)).toFixed(2)
      : stats.wins > 0 ? '999.00' : '0.00';

    stats.avg_duration_hours = stats.total_trades > 0
      ? (stats.avg_duration_hours / stats.total_trades).toFixed(1)
      : '0.0';
  }

  return statsBySignal;
}

module.exports = {
  createPaperTrade,
  updatePaperTrades,
  calculateSignalStats,
  loadPaperTrades
};
