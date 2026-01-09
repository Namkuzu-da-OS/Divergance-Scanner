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
  lastVixValue: null,
  initialized: false
};

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
    // Only fetch what we need: VIX for regime changes, SPY/QQQ for startup message
    const [spyData, qqData, vixData] = await Promise.all([
      fetchJson(`${CONFIG.apis.intel}/api/latest/SPY`),
      fetchJson(`${CONFIG.apis.intel}/api/latest/QQQ`),
      fetchJson(`${CONFIG.apis.intel}/api/latest/VIX`)
    ]);

    return {
      spy: spyData.data || spyData,
      qqq: qqData.data || qqData,
      vix: vixData.data || vixData
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

// NOTE: Wall proximity and pinned alerts removed - Bloodhound handles these
// NOTE: High conviction signals removed - Bloodhound handles these

// ============================================
// BLOODHOUND PAUSE CHECK
// ============================================

async function isBloodhoundPaused() {
  try {
    const status = await fetchJson('http://localhost:8081/status');
    return status.paused === true;
  } catch (error) {
    // If Bloodhound control server unreachable, assume not paused
    console.log('[Monitor] Could not reach Bloodhound status endpoint, continuing...');
    return false;
  }
}

// ============================================
// MAIN MONITOR LOOP
// ============================================

async function runCheck() {
  console.log(`\n[${new Date().toISOString()}] Running market check...`);

  // Check if Bloodhound is paused - if so, skip this check
  const paused = await isBloodhoundPaused();
  if (paused) {
    console.log('[Monitor] Bloodhound is paused, skipping alerts');
    return;
  }

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
    state.initialized = true;
    console.log('[Monitor] State initialized, monitoring started');

    // Note: Bloodhound handles scanner.json - Monitor only sends Telegram alerts

    // Send startup message
    await sendTelegram(`🤖 <b>Wingman Monitor Online</b>\n\n` +
      `SPY: $${parseFloat(data.spy.current_price).toFixed(2)}\n` +
      `QQQ: $${parseFloat(data.qqq.current_price).toFixed(2)}\n` +
      `VIX: ${parseFloat(data.vix.current_price).toFixed(2)} (${state.lastVixRegime})\n\n` +
      `Monitoring VIX regime changes only\n` +
      `(Wall/signal alerts handled by Bloodhound)`
    );
    return;
  }

  // Run VIX check only (Bloodhound handles wall proximity and signals)
  checkVixThresholds(data.vix, alerts);

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
  const RETENTION_DAYS = 30;

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

  // Time-based retention: keep 30 days
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const hotAlerts = logs.filter(a => new Date(a.timestamp) > cutoffDate);
  const archiveAlerts = logs.filter(a => new Date(a.timestamp) <= cutoffDate);

  // Save hot alerts
  fs.writeFileSync(logFile, JSON.stringify(hotAlerts, null, 2));

  // Archive old alerts to monthly files
  if (archiveAlerts.length > 0) {
    const archiveMonth = new Date().toISOString().slice(0, 7); // "2026-01"
    const archivePath = path.join(__dirname, '..', 'data', `alerts_archive_${archiveMonth}.json`);

    let existingArchive = [];
    try {
      if (fs.existsSync(archivePath)) {
        existingArchive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      }
    } catch (e) {
      existingArchive = [];
    }

    existingArchive.push(...archiveAlerts);
    fs.writeFileSync(archivePath, JSON.stringify(existingArchive, null, 2));
    console.log(`[Monitor] Archived ${archiveAlerts.length} alerts to ${archivePath}`);
  }
}

// Note: scanner.json is now exclusively written by Bloodhound Scanner
// Monitor's role is purely Telegram alerts for state changes

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
