/**
 * Wingman Market Monitor
 *
 * Monitors market conditions and sends alerts to Telegram.
 * Run with: node wingman-monitor.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================
// LOAD CONFIG FROM FILE (gitignored)
// ============================================

let externalConfig = {};
try {
  externalConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
  console.warn('[Config] No config.json found, using environment variables or defaults');
}

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Telegram settings
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || externalConfig.telegram?.botToken || 'YOUR_BOT_TOKEN',
    chatId: process.env.TELEGRAM_CHAT_ID || externalConfig.telegram?.chatId || 'YOUR_CHAT_ID'
  },

  // API endpoints
  apis: {
    intel: externalConfig.apis?.intel || 'http://192.168.10.239:3000',
    options: externalConfig.apis?.options || 'http://192.168.10.239:8000'
  },

  // Monitoring settings
  checkIntervalMs: 2 * 60 * 1000,  // 2 minutes
  symbols: ['SPY', 'QQQ'],

  // Alert thresholds
  thresholds: {
    wallProximityPct: 0.15,        // Alert when within 0.15% of wall
    vixLevels: [15, 20, 25, 35],   // VIX threshold levels
    convictionMin: 85,              // Minimum conviction for signal alerts
    sectorRotationPct: 2.0          // Sector move threshold
  }
};

// State tracking (to avoid duplicate alerts)
let state = {
  lastVixRegime: null,
  lastWallAlerts: {},
  lastWallAlertTimes: {},  // Cooldown tracking
  lastSignals: new Set(),
  lastGammaRegime: {},
  initialized: false
};

// Cooldown period in milliseconds (30 minutes)
const WALL_COOLDOWN_MS = 30 * 60 * 1000;

// ============================================
// TELEGRAM FUNCTIONS
// ============================================

function sendTelegram(message) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;

    const data = JSON.stringify({
      chat_id: CONFIG.telegram.chatId,
      text: message,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegram.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`[Telegram] Message sent: ${message.substring(0, 50)}...`);
          resolve(JSON.parse(body));
        } else {
          console.error(`[Telegram] Error: ${body}`);
          reject(new Error(body));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ============================================
// API FETCH FUNCTIONS
// ============================================

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    }).on('error', reject);
  });
}

async function getMarketData() {
  try {
    const [spyData, qqData, vixData, spyLevels, qqqLevels, context, sentiment, signals] = await Promise.all([
      fetchJson(`${CONFIG.apis.intel}/api/latest/SPY`),
      fetchJson(`${CONFIG.apis.intel}/api/latest/QQQ`),
      fetchJson(`${CONFIG.apis.intel}/api/latest/VIX`),
      fetchJson(`${CONFIG.apis.options}/api/levels/SPY`),
      fetchJson(`${CONFIG.apis.options}/api/levels/QQQ`),
      fetchJson(`${CONFIG.apis.options}/api/market/context`),
      fetchJson(`${CONFIG.apis.intel}/api/x/sentiment/overview?hours=24`),
      fetchJson(`${CONFIG.apis.intel}/api/sequencer/sequences/high-conviction`)
    ]);

    return {
      spy: spyData.data || spyData,
      qqq: qqData.data || qqData,
      vix: vixData.data || vixData,
      spyLevels,
      qqqLevels,
      context,
      sentiment: sentiment.data || sentiment,
      signals: signals.data || []
    };
  } catch (error) {
    console.error('[API] Error fetching market data:', error.message);
    return null;
  }
}

// ============================================
// ALERT CONDITION CHECKERS
// ============================================

function checkVixThresholds(vix, alerts) {
  const vixPrice = parseFloat(vix.current_price);

  // Determine current regime
  let currentRegime;
  if (vixPrice < 15) currentRegime = 'low';
  else if (vixPrice < 20) currentRegime = 'normal';
  else if (vixPrice < 25) currentRegime = 'elevated';
  else if (vixPrice < 35) currentRegime = 'high';
  else currentRegime = 'extreme';

  // Check for regime change
  if (state.lastVixRegime && state.lastVixRegime !== currentRegime) {
    const direction = vixPrice > (state.lastVixValue || 0) ? '📈' : '📉';
    alerts.push({
      type: 'VIX_REGIME',
      priority: currentRegime === 'elevated' || currentRegime === 'high' ? 'HIGH' : 'MEDIUM',
      message: `${direction} <b>VIX Regime Change</b>\n\nVIX: ${vixPrice.toFixed(2)}\n${state.lastVixRegime.toUpperCase()} → ${currentRegime.toUpperCase()}\n\n${getVixAdvice(currentRegime)}`
    });
  }

  state.lastVixRegime = currentRegime;
  state.lastVixValue = vixPrice;
}

function getVixAdvice(regime) {
  switch (regime) {
    case 'low': return '✅ Standard sizing OK';
    case 'normal': return '✅ Normal conditions';
    case 'elevated': return '⚠️ Widen stops 50% OR reduce size';
    case 'high': return '🛑 Reduce size 50%, expect large moves';
    case 'extreme': return '🚨 DANGER - Consider sitting out';
    default: return '';
  }
}

function checkWallProximity(symbol, price, levels, alerts) {
  const currentPrice = parseFloat(price);
  const callWall = levels.levels?.call_wall?.price;
  const putWall = levels.levels?.put_wall?.price;
  const gammaFlip = levels.levels?.gamma_flip?.price;
  const maxPain = levels.levels?.max_pain?.price;

  if (!callWall || !putWall) return;

  const callDistance = ((callWall - currentPrice) / currentPrice) * 100;
  const putDistance = ((currentPrice - putWall) / currentPrice) * 100;
  const wallSpread = ((callWall - putWall) / currentPrice) * 100;

  const alertKey = `${symbol}_wall`;
  const now = Date.now();

  // Check if walls are very close (pinned scenario)
  if (wallSpread < 0.3) {
    const pinnedKey = `${symbol}_pinned`;
    const lastPinnedAlert = state.lastWallAlertTimes[pinnedKey] || 0;

    if (now - lastPinnedAlert > WALL_COOLDOWN_MS) {
      alerts.push({
        type: 'WALL_PINNED',
        priority: 'HIGH',
        message: `📍 <b>${symbol} Pinned Between Walls</b>\n\nPrice: $${currentPrice.toFixed(2)}\nCall Wall: $${callWall.toFixed(2)}\nPut Wall: $${putWall.toFixed(2)}\nSpread: $${(callWall - putWall).toFixed(2)} (${wallSpread.toFixed(2)}%)\n\n⚡ Gamma squeeze zone - expect choppy action`
      });
      state.lastWallAlertTimes[pinnedKey] = now;
    }
    return; // Don't send individual wall alerts when pinned
  }

  // Check call wall with cooldown
  if (Math.abs(callDistance) <= CONFIG.thresholds.wallProximityPct) {
    const callKey = `${symbol}_call`;
    const lastCallAlert = state.lastWallAlertTimes[callKey] || 0;

    if (now - lastCallAlert > WALL_COOLDOWN_MS) {
      alerts.push({
        type: 'WALL_PROXIMITY',
        priority: 'HIGH',
        message: `🔴 <b>${symbol} at Call Wall</b>\n\nPrice: $${currentPrice.toFixed(2)}\nCall Wall: $${callWall.toFixed(2)} (${callDistance.toFixed(2)}%)\n\n⚠️ Dealers selling into strength\nWatch for rejection or breakout`
      });
      state.lastWallAlertTimes[callKey] = now;
      state.lastWallAlerts[alertKey] = 'call';
    }
  }
  // Check put wall with cooldown
  else if (Math.abs(putDistance) <= CONFIG.thresholds.wallProximityPct) {
    const putKey = `${symbol}_put`;
    const lastPutAlert = state.lastWallAlertTimes[putKey] || 0;

    if (now - lastPutAlert > WALL_COOLDOWN_MS) {
      alerts.push({
        type: 'WALL_PROXIMITY',
        priority: 'HIGH',
        message: `🟢 <b>${symbol} at Put Wall</b>\n\nPrice: $${currentPrice.toFixed(2)}\nPut Wall: $${putWall.toFixed(2)} (${putDistance.toFixed(2)}%)\n\n✅ Dealer support zone\nWatch for bounce`
      });
      state.lastWallAlertTimes[putKey] = now;
      state.lastWallAlerts[alertKey] = 'put';
    }
  }
  // Clear state if away from walls
  else if (Math.abs(callDistance) > 0.5 && Math.abs(putDistance) > 0.5) {
    state.lastWallAlerts[alertKey] = null;
  }

  // Check gamma flip crossing
  if (gammaFlip) {
    const currentGammaRegime = currentPrice > gammaFlip ? 'positive' : 'negative';
    if (state.lastGammaRegime[symbol] && state.lastGammaRegime[symbol] !== currentGammaRegime) {
      alerts.push({
        type: 'GAMMA_FLIP',
        priority: 'MEDIUM',
        message: `⚡ <b>${symbol} Gamma Flip Cross</b>\n\nPrice: $${currentPrice.toFixed(2)}\nGamma Flip: $${gammaFlip.toFixed(2)}\n\nRegime: ${currentGammaRegime.toUpperCase()}\n${currentGammaRegime === 'negative' ? '📊 Expect increased volatility' : '📊 Dealers dampening moves'}`
      });
    }
    state.lastGammaRegime[symbol] = currentGammaRegime;
  }
}

function checkHighConvictionSignals(signals, alerts) {
  if (!Array.isArray(signals)) return;

  for (const signal of signals) {
    if (signal.conviction >= CONFIG.thresholds.convictionMin) {
      const signalKey = `${signal.symbol}_${signal.direction}_${signal.id}`;

      if (!state.lastSignals.has(signalKey)) {
        const emoji = signal.direction === 'bullish' ? '🟢' : '🔴';
        alerts.push({
          type: 'HIGH_CONVICTION',
          priority: 'HIGH',
          message: `${emoji} <b>High Conviction Signal</b>\n\n${signal.symbol} ${signal.direction.toUpperCase()}\nConviction: ${signal.conviction}%\nPattern: ${signal.pattern}\n\nEntry Price: $${signal.price_at_early?.toFixed(2) || 'N/A'}\nCurrent: $${signal.price_at_confirm?.toFixed(2) || 'N/A'}`
        });
        state.lastSignals.add(signalKey);
      }
    }
  }

  // Cleanup old signals (keep last 50)
  if (state.lastSignals.size > 50) {
    const arr = Array.from(state.lastSignals);
    state.lastSignals = new Set(arr.slice(-25));
  }
}

// ============================================
// MAIN MONITOR LOOP
// ============================================

async function runCheck() {
  console.log(`\n[${new Date().toISOString()}] Running market check...`);

  const data = await getMarketData();
  if (!data) {
    console.log('[Monitor] Failed to get market data, skipping check');
    return;
  }

  const alerts = [];

  // Initialize state on first run (don't alert)
  if (!state.initialized) {
    console.log('[Monitor] Initializing state...');
    state.lastVixRegime = parseFloat(data.vix.current_price) < 15 ? 'low' :
                          parseFloat(data.vix.current_price) < 20 ? 'normal' :
                          parseFloat(data.vix.current_price) < 25 ? 'elevated' : 'high';
    state.lastVixValue = parseFloat(data.vix.current_price);
    state.lastGammaRegime['SPY'] = data.spyLevels.context?.gamma_regime;
    state.lastGammaRegime['QQQ'] = data.qqqLevels.context?.gamma_regime;
    state.initialized = true;
    console.log('[Monitor] State initialized, monitoring started');

    // Write initial market state for scanner
    writeMarketState(data);

    // Send startup message
    await sendTelegram(`🤖 <b>Wingman Monitor Online</b>\n\n` +
      `SPY: $${parseFloat(data.spy.current_price).toFixed(2)}\n` +
      `QQQ: $${parseFloat(data.qqq.current_price).toFixed(2)}\n` +
      `VIX: ${parseFloat(data.vix.current_price).toFixed(2)} (${state.lastVixRegime})\n\n` +
      `Monitoring every ${CONFIG.checkIntervalMs / 60000} minutes`
    );
    return;
  }

  // Write market state for scanner
  writeMarketState(data);

  // Run all checks
  checkVixThresholds(data.vix, alerts);
  checkWallProximity('SPY', data.spy.current_price, data.spyLevels, alerts);
  checkWallProximity('QQQ', data.qqq.current_price, data.qqqLevels, alerts);
  checkHighConvictionSignals(data.signals, alerts);

  // Send alerts
  for (const alert of alerts) {
    try {
      const prefix = alert.priority === 'HIGH' ? '🚨' : 'ℹ️';
      await sendTelegram(`${prefix} ${alert.message}`);

      // Log alert
      logAlert(alert);

      // Small delay between messages
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error('[Alert] Failed to send:', error.message);
    }
  }

  if (alerts.length === 0) {
    console.log('[Monitor] No alerts triggered');
  } else {
    console.log(`[Monitor] Sent ${alerts.length} alert(s)`);
  }
}

function logAlert(alert) {
  const logFile = path.join(__dirname, '..', 'data', 'alerts_log.json');

  let logs = [];
  try {
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
  } catch (e) {
    logs = [];
  }

  logs.push({
    timestamp: new Date().toISOString(),
    ...alert
  });

  // Keep last 500 alerts
  if (logs.length > 500) {
    logs = logs.slice(-500);
  }

  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}

// Write full market state to scanner.json for dashboard
function writeMarketState(data) {
  const stateFile = path.join(__dirname, '..', 'data', 'scanner.json');

  const marketState = {
    timestamp: new Date().toISOString(),
    vix: {
      price: parseFloat(data.vix?.current_price || 0),
      regime: state.lastVixRegime
    },
    spy: {
      price: parseFloat(data.spy?.current_price || 0),
      change_pct: parseFloat(data.spy?.change_percent || 0),
      levels: data.spyLevels?.levels || {},
      context: data.spyLevels?.context || {}
    },
    qqq: {
      price: parseFloat(data.qqq?.current_price || 0),
      change_pct: parseFloat(data.qqq?.change_percent || 0),
      levels: data.qqqLevels?.levels || {},
      context: data.qqqLevels?.context || {}
    },
    sentiment: data.sentiment || {},
    market_context: data.context || {},
    signals: (data.signals || []).slice(0, 5)
  };

  try {
    fs.writeFileSync(stateFile, JSON.stringify(marketState, null, 2));
    console.log('[Scanner] Market state written to scanner.json');
  } catch (e) {
    console.error('[Scanner] Failed to write market state:', e.message);
  }
}

// ============================================
// STARTUP
// ============================================

console.log('========================================');
console.log('       WINGMAN MARKET MONITOR');
console.log('========================================');
console.log(`Intel API: ${CONFIG.apis.intel}`);
console.log(`Options API: ${CONFIG.apis.options}`);
console.log(`Check Interval: ${CONFIG.checkIntervalMs / 1000}s`);
console.log(`Symbols: ${CONFIG.symbols.join(', ')}`);
console.log('========================================\n');

// Validate config
if (CONFIG.telegram.botToken === 'YOUR_BOT_TOKEN_HERE') {
  console.error('ERROR: Please set your Telegram bot token!');
  console.error('Edit CONFIG.telegram.botToken in this file');
  console.error('Or set TELEGRAM_BOT_TOKEN environment variable');
  process.exit(1);
}

if (CONFIG.telegram.chatId === 'YOUR_CHAT_ID_HERE') {
  console.error('ERROR: Please set your Telegram chat ID!');
  console.error('Edit CONFIG.telegram.chatId in this file');
  console.error('Or set TELEGRAM_CHAT_ID environment variable');
  process.exit(1);
}

// Run immediately, then on interval
runCheck();
setInterval(runCheck, CONFIG.checkIntervalMs);

console.log('Monitor running. Press Ctrl+C to stop.\n');
