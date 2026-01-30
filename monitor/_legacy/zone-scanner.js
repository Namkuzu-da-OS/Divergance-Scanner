/**
 * Zone Scanner
 *
 * Scans watchlist for buy/sell zone opportunities based on:
 * - Distance to put wall (buy zone)
 * - Distance to call wall (sell zone)
 * - RSI confirmation
 * - Trend alignment
 *
 * Rule: NO mid-range trades. Only at established support/resistance.
 */

const http = require('http');
const https = require('https');
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
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || externalConfig.telegram?.botToken || 'YOUR_BOT_TOKEN',
    chatId: process.env.TELEGRAM_CHAT_ID || externalConfig.telegram?.chatId || 'YOUR_CHAT_ID'
  },
  apis: {
    intel: externalConfig.apis?.intel || 'http://192.168.10.60:3000',
    options: externalConfig.apis?.options || 'http://192.168.10.60:8000'
  },
  scanIntervalMs: 2 * 60 * 1000,  // 2 minutes
  watchlistPath: path.join(__dirname, '..', 'data', 'watchlist.json'),
  scanResultsPath: path.join(__dirname, '..', 'data', 'scan_results.json')
};

// State tracking
let state = {
  zoneStates: {},      // Track last zone for each symbol
  alertTimes: {},      // Cooldown tracking
  initialized: false
};

// ============================================
// ZONE CLASSIFICATION
// ============================================

const ZONES = {
  BUY_ZONE: 'BUY_ZONE',           // At put wall, not overbought
  SELL_ZONE: 'SELL_ZONE',         // At call wall, not oversold
  MID_RANGE: 'MID_RANGE',         // Between walls - NO TRADE
  OVERBOUGHT: 'OVERBOUGHT',       // RSI > threshold
  OVERSOLD: 'OVERSOLD',           // RSI < threshold
  EXTENDED_HIGH: 'EXTENDED_HIGH', // Above call wall
  EXTENDED_LOW: 'EXTENDED_LOW'    // Below put wall
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// HTML escape for Telegram messages
function escapeHtml(text) {
  if (text === null || text === undefined) return 'N/A';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendTelegram(message) {
  return new Promise((resolve, reject) => {
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
          console.log(`[Telegram] Sent: ${message.substring(0, 50)}...`);
          resolve(JSON.parse(body));
        } else {
          reject(new Error(body));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function loadWatchlist() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.watchlistPath, 'utf8'));
    return data;
  } catch (e) {
    console.error('[Scanner] Failed to load watchlist:', e.message);
    return { symbols: [], settings: {} };
  }
}

// ============================================
// ZONE ANALYSIS
// ============================================

async function analyzeSymbol(symbol) {
  try {
    const [technicals, levels] = await Promise.all([
      fetchJson(`${CONFIG.apis.options}/api/technicals/${symbol}`),
      fetchJson(`${CONFIG.apis.options}/api/levels/${symbol}`)
    ]);

    const price = technicals.current;
    const rsi = technicals.rsi;
    const trend = technicals.trend;

    const putWall = levels.levels?.put_wall?.price;
    const callWall = levels.levels?.call_wall?.price;
    const maxPain = levels.levels?.max_pain?.price;
    const gammaFlip = levels.levels?.gamma_flip?.price;
    const vwap = levels.levels?.vwap;

    if (!price || !putWall || !callWall) {
      return { symbol, error: 'Missing data' };
    }

    // Calculate distances
    const distToPutWall = ((price - putWall) / price) * 100;
    const distToCallWall = ((callWall - price) / price) * 100;
    const rangeSize = ((callWall - putWall) / price) * 100;
    const positionInRange = (price - putWall) / (callWall - putWall);

    // Load settings
    const watchlist = loadWatchlist();
    const settings = watchlist.settings || {};
    const buyThreshold = settings.buyZoneThresholdPct || 0.5;
    const sellThreshold = settings.sellZoneThresholdPct || 0.5;
    const overboughtRsi = settings.rsiOverbought || 75;
    const oversoldRsi = settings.rsiOversold || 30;

    // Determine zone
    let zone;
    let tradeable = false;
    let action = null;
    let reasoning = [];

    // Check overbought/oversold first
    if (rsi > overboughtRsi) {
      zone = ZONES.OVERBOUGHT;
      reasoning.push(`RSI ${rsi.toFixed(1)} > ${overboughtRsi} (overbought)`);
    } else if (rsi < oversoldRsi) {
      zone = ZONES.OVERSOLD;
      reasoning.push(`RSI ${rsi.toFixed(1)} < ${oversoldRsi} (oversold)`);
      // Oversold at support = strong buy signal
      if (distToPutWall <= buyThreshold) {
        zone = ZONES.BUY_ZONE;
        tradeable = true;
        action = 'BUY';
        reasoning.push(`At put wall support + oversold = Strong buy`);
      }
    }
    // Check position relative to walls
    else if (price > callWall) {
      zone = ZONES.EXTENDED_HIGH;
      reasoning.push(`Price above call wall (breakout or reversal pending)`);
    } else if (price < putWall) {
      zone = ZONES.EXTENDED_LOW;
      reasoning.push(`Price below put wall (breakdown or reversal pending)`);
    }
    // Check buy zone (at put wall)
    else if (distToPutWall <= buyThreshold) {
      zone = ZONES.BUY_ZONE;
      tradeable = true;
      action = 'BUY';
      reasoning.push(`Within ${buyThreshold}% of put wall ($${putWall.toFixed(2)})`);
      reasoning.push(`RSI ${rsi.toFixed(1)} - not overbought`);
      if (trend === 'uptrend' || trend === 'strong_uptrend') {
        reasoning.push(`Trend aligned: ${trend}`);
      }
    }
    // Check sell zone (at call wall)
    else if (distToCallWall <= sellThreshold) {
      zone = ZONES.SELL_ZONE;
      tradeable = true;
      action = 'SELL';
      reasoning.push(`Within ${sellThreshold}% of call wall ($${callWall.toFixed(2)})`);
      reasoning.push(`RSI ${rsi.toFixed(1)} - not oversold`);
      if (trend === 'downtrend' || trend === 'strong_downtrend') {
        reasoning.push(`Trend aligned: ${trend}`);
      }
    }
    // Mid-range - no trade
    else {
      zone = ZONES.MID_RANGE;
      reasoning.push(`Mid-range (${(positionInRange * 100).toFixed(0)}% between walls)`);
      reasoning.push(`Wait for price to reach support or resistance`);
    }

    return {
      symbol,
      price,
      zone,
      tradeable,
      action,
      reasoning,
      levels: {
        putWall,
        callWall,
        maxPain,
        gammaFlip,
        vwap
      },
      distances: {
        toPutWall: distToPutWall,
        toCallWall: distToCallWall,
        rangeSize,
        positionInRange
      },
      technicals: {
        rsi,
        trend,
        momentum5d: technicals.momentum_5d,
        momentum20d: technicals.momentum_20d,
        bbPosition: technicals.bb_position,
        volumeSignal: technicals.volume_signal
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return { symbol, error: error.message };
  }
}

// ============================================
// ALERT LOGIC
// ============================================

function shouldAlert(symbol, newZone) {
  const watchlist = loadWatchlist();
  const cooldownMs = (watchlist.settings?.alertCooldownMinutes || 60) * 60 * 1000;

  const lastZone = state.zoneStates[symbol];
  const lastAlertTime = state.alertTimes[symbol] || 0;
  const now = Date.now();

  // Alert if:
  // 1. Zone changed to a tradeable zone
  // 2. Cooldown has passed
  const zoneChanged = lastZone !== newZone;
  const cooldownPassed = (now - lastAlertTime) > cooldownMs;
  const isTradeable = newZone === ZONES.BUY_ZONE || newZone === ZONES.SELL_ZONE;

  return zoneChanged && isTradeable && cooldownPassed;
}

async function sendZoneAlert(analysis) {
  const emoji = analysis.action === 'BUY' ? '🟢' : '🔴';
  const zoneEmoji = analysis.zone === ZONES.BUY_ZONE ? '📗 BUY ZONE' : '📕 SELL ZONE';

  // Escape dynamic content to prevent HTML parsing errors
  const trend = escapeHtml(analysis.technicals.trend);
  const volumeSignal = escapeHtml(analysis.technicals.volumeSignal);
  const reasons = analysis.reasoning.map(r => '• ' + escapeHtml(r)).join('\n');

  const message = `${emoji} <b>${analysis.symbol} - ${zoneEmoji}</b>

<b>Price:</b> $${analysis.price.toFixed(2)}
<b>Action:</b> ${analysis.action}

<b>Levels:</b>
• Put Wall: $${analysis.levels.putWall.toFixed(2)} (${analysis.distances.toPutWall.toFixed(2)}% away)
• Call Wall: $${analysis.levels.callWall.toFixed(2)} (${analysis.distances.toCallWall.toFixed(2)}% away)
• Max Pain: $${analysis.levels.maxPain?.toFixed(2) || 'N/A'}

<b>Technicals:</b>
• RSI: ${analysis.technicals.rsi.toFixed(1)}
• Trend: ${trend}
• Volume: ${volumeSignal}

<b>Why:</b>
${reasons}

⚡ Per trading rules: This is at an established level, not mid-range.`;

  await sendTelegram(message);

  state.zoneStates[analysis.symbol] = analysis.zone;
  state.alertTimes[analysis.symbol] = Date.now();
}

// ============================================
// MAIN SCANNER
// ============================================

async function runScan() {
  console.log(`\n[${new Date().toISOString()}] Running zone scan...`);

  const watchlist = loadWatchlist();
  const enabledSymbols = watchlist.symbols
    .filter(s => s.enabled)
    .map(s => s.symbol);

  if (enabledSymbols.length === 0) {
    console.log('[Scanner] No symbols enabled in watchlist');
    return;
  }

  console.log(`[Scanner] Scanning ${enabledSymbols.length} symbols: ${enabledSymbols.join(', ')}`);

  const results = [];
  const alerts = [];

  for (const symbol of enabledSymbols) {
    const analysis = await analyzeSymbol(symbol);
    results.push(analysis);

    if (analysis.error) {
      console.log(`[Scanner] ${symbol}: Error - ${analysis.error}`);
      continue;
    }

    const zoneIcon = {
      [ZONES.BUY_ZONE]: '🟢',
      [ZONES.SELL_ZONE]: '🔴',
      [ZONES.MID_RANGE]: '⚪',
      [ZONES.OVERBOUGHT]: '🔥',
      [ZONES.OVERSOLD]: '❄️',
      [ZONES.EXTENDED_HIGH]: '⬆️',
      [ZONES.EXTENDED_LOW]: '⬇️'
    }[analysis.zone] || '❓';

    console.log(`[Scanner] ${symbol}: ${zoneIcon} ${analysis.zone} @ $${analysis.price.toFixed(2)} (RSI: ${analysis.technicals.rsi.toFixed(1)})`);

    // Check if we should alert
    if (shouldAlert(symbol, analysis.zone) && analysis.tradeable) {
      alerts.push(analysis);
    }

    // Update state regardless
    state.zoneStates[symbol] = analysis.zone;

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 200));
  }

  // Send alerts
  for (const alert of alerts) {
    try {
      await sendZoneAlert(alert);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`[Scanner] Failed to send alert for ${alert.symbol}:`, e.message);
    }
  }

  // Write results to file
  const output = {
    timestamp: new Date().toISOString(),
    scanCount: results.length,
    tradeableCount: results.filter(r => r.tradeable).length,
    results: results.sort((a, b) => {
      // Sort: tradeable first, then by zone
      if (a.tradeable && !b.tradeable) return -1;
      if (!a.tradeable && b.tradeable) return 1;
      return 0;
    })
  };

  try {
    fs.writeFileSync(CONFIG.scanResultsPath, JSON.stringify(output, null, 2));
    console.log(`[Scanner] Results written to scan_results.json`);
  } catch (e) {
    console.error('[Scanner] Failed to write results:', e.message);
  }

  // Summary
  const buyZones = results.filter(r => r.zone === ZONES.BUY_ZONE);
  const sellZones = results.filter(r => r.zone === ZONES.SELL_ZONE);
  const midRange = results.filter(r => r.zone === ZONES.MID_RANGE);

  console.log(`\n[Scanner] Summary:`);
  console.log(`  🟢 Buy Zones: ${buyZones.length} (${buyZones.map(r => r.symbol).join(', ') || 'none'})`);
  console.log(`  🔴 Sell Zones: ${sellZones.length} (${sellZones.map(r => r.symbol).join(', ') || 'none'})`);
  console.log(`  ⚪ Mid-Range (no trade): ${midRange.length}`);
  console.log(`  📨 Alerts sent: ${alerts.length}`);
}

// ============================================
// STARTUP
// ============================================

async function main() {
  console.log('========================================');
  console.log('       WINGMAN ZONE SCANNER');
  console.log('========================================');
  console.log(`Options API: ${CONFIG.apis.options}`);
  console.log(`Scan Interval: ${CONFIG.scanIntervalMs / 1000}s`);
  console.log(`Watchlist: ${CONFIG.watchlistPath}`);
  console.log('========================================\n');

  // Initial scan
  await runScan();

  // If running standalone, continue scanning
  if (require.main === module) {
    console.log('\n[Scanner] Running continuous scans...\n');
    setInterval(runScan, CONFIG.scanIntervalMs);
  }
}

// Export for use as module
module.exports = { runScan, analyzeSymbol, ZONES };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
