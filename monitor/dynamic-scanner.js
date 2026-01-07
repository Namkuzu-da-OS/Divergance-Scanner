/**
 * Dynamic Scanner
 *
 * Scans for tradeable opportunities using dynamic watchlist sourced from:
 * - High conviction signals (port 3000)
 * - Author consensus / trending tickers from X
 * - AI market outlook themes
 *
 * Then applies zone filter logic (no mid-range trades).
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '8527216242:AAEHs1p5ESUL7dLZoobvJonU_3SGy5wRGTo',
    chatId: process.env.TELEGRAM_CHAT_ID || '8370088021'
  },
  apis: {
    intel: 'http://192.168.10.239:3000',
    options: 'http://192.168.10.239:8000'
  },
  scanIntervalMs: 2 * 60 * 1000,  // 2 minutes
  outputPath: path.join(__dirname, '..', 'data', 'dynamic_scan.json'),

  // Liquidity filter - minimum requirements
  liquidity: {
    minAvgVolume: 500000,        // Minimum average daily volume
    minOptionVolume: 1000,       // Minimum option volume
    requireWeeklies: true        // Must have weekly options
  },

  // Zone thresholds
  zones: {
    buyZoneThresholdPct: 0.5,
    sellZoneThresholdPct: 0.5,
    rsiOverbought: 75,
    rsiOversold: 30
  },

  // Core symbols always scanned (high liquidity guaranteed)
  coreSymbols: ['SPY', 'QQQ'],

  // Maximum symbols to scan per cycle (to avoid overload)
  maxSymbols: 15
};

// State tracking
let state = {
  zoneStates: {},
  alertTimes: {},
  lastDynamicList: [],
  initialized: false
};

// ============================================
// ZONE CLASSIFICATION (from zone-scanner.js)
// ============================================

const ZONES = {
  BUY_ZONE: 'BUY_ZONE',
  SELL_ZONE: 'SELL_ZONE',
  MID_RANGE: 'MID_RANGE',
  OVERBOUGHT: 'OVERBOUGHT',
  OVERSOLD: 'OVERSOLD',
  EXTENDED_HIGH: 'EXTENDED_HIGH',
  EXTENDED_LOW: 'EXTENDED_LOW'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => reject(new Error('Timeout')), timeoutMs);

    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error from ${url}`));
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

// ============================================
// DYNAMIC WATCHLIST SOURCING
// ============================================

async function getHighConvictionSignals() {
  try {
    const data = await fetchJson(`${CONFIG.apis.intel}/api/sequencer/high-conviction`);
    // Extract unique symbols from signals
    const symbols = [];
    if (data && Array.isArray(data.signals)) {
      data.signals.forEach(signal => {
        if (signal.symbol && !symbols.includes(signal.symbol)) {
          symbols.push({
            symbol: signal.symbol,
            source: 'high_conviction',
            conviction: signal.conviction || signal.confidence || 0,
            direction: signal.direction || signal.bias
          });
        }
      });
    }
    console.log(`[Source] High Conviction: ${symbols.length} symbols`);
    return symbols;
  } catch (e) {
    console.log(`[Source] High Conviction: Failed - ${e.message}`);
    return [];
  }
}

async function getTrendingTickers() {
  try {
    const data = await fetchJson(`${CONFIG.apis.intel}/api/x/tickers/trending`);
    const symbols = [];
    if (data && Array.isArray(data.tickers)) {
      data.tickers.forEach(ticker => {
        const sym = ticker.symbol || ticker.ticker || ticker;
        if (typeof sym === 'string' && !symbols.find(s => s.symbol === sym)) {
          symbols.push({
            symbol: sym.toUpperCase(),
            source: 'trending',
            mentions: ticker.mentions || ticker.count || 0,
            sentiment: ticker.sentiment
          });
        }
      });
    }
    console.log(`[Source] Trending: ${symbols.length} symbols`);
    return symbols;
  } catch (e) {
    console.log(`[Source] Trending: Failed - ${e.message}`);
    return [];
  }
}

async function getAuthorConsensus() {
  // Try multiple possible endpoint patterns for author consensus
  const endpoints = [
    `${CONFIG.apis.intel}/api/x/authors/consensus`,
    `${CONFIG.apis.intel}/api/signals/consensus`,
    `${CONFIG.apis.intel}/api/x/consensus`,
    `${CONFIG.apis.intel}/api/author-intelligence`
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(endpoint);
      const symbols = [];

      // Handle various response formats
      const consensusData = data.consensus || data.tickers || data.signals || data;

      if (Array.isArray(consensusData)) {
        consensusData.forEach(item => {
          const sym = item.symbol || item.ticker;
          if (sym && !symbols.find(s => s.symbol === sym)) {
            symbols.push({
              symbol: sym.toUpperCase(),
              source: 'author_consensus',
              authorCount: item.author_count || item.authors || item.count || 0,
              direction: item.direction || item.bias || item.sentiment,
              category: item.category || item.action
            });
          }
        });
      }

      if (symbols.length > 0) {
        console.log(`[Source] Author Consensus: ${symbols.length} symbols`);
        return symbols;
      }
    } catch (e) {
      // Try next endpoint
    }
  }

  console.log(`[Source] Author Consensus: Not available`);
  return [];
}

async function getMarketOutlookThemes() {
  try {
    const data = await fetchJson(`${CONFIG.apis.intel}/api/market/outlook`);
    const symbols = [];

    // Extract symbols mentioned in outlook themes/narrative
    if (data) {
      const themes = data.themes || data.sectors || [];
      const narrative = data.narrative || data.summary || '';

      // Common symbols that might be in themes
      const commonSymbols = ['NVDA', 'TSLA', 'AMD', 'AAPL', 'META', 'GOOGL', 'AMZN', 'MSFT', 'IBIT', 'COIN'];

      commonSymbols.forEach(sym => {
        if (narrative.toUpperCase().includes(sym) ||
            themes.some(t => (t.name || t).toUpperCase().includes(sym))) {
          symbols.push({
            symbol: sym,
            source: 'ai_outlook',
            theme: true
          });
        }
      });
    }

    console.log(`[Source] AI Outlook: ${symbols.length} symbols`);
    return symbols;
  } catch (e) {
    console.log(`[Source] AI Outlook: Failed - ${e.message}`);
    return [];
  }
}

async function buildDynamicWatchlist() {
  console.log('\n[Dynamic] Building watchlist from sources...');

  // Gather from all sources in parallel
  const [highConv, trending, consensus, outlook] = await Promise.all([
    getHighConvictionSignals(),
    getTrendingTickers(),
    getAuthorConsensus(),
    getMarketOutlookThemes()
  ]);

  // Combine and deduplicate
  const symbolMap = new Map();

  // Add core symbols first (guaranteed)
  CONFIG.coreSymbols.forEach(sym => {
    symbolMap.set(sym, {
      symbol: sym,
      sources: ['core'],
      score: 100,
      isCore: true
    });
  });

  // Add from sources with scoring
  const addSymbols = (list, weight) => {
    list.forEach(item => {
      const sym = item.symbol;
      if (symbolMap.has(sym)) {
        const existing = symbolMap.get(sym);
        existing.sources.push(item.source);
        existing.score += weight;
        if (item.conviction) existing.conviction = item.conviction;
        if (item.direction) existing.direction = item.direction;
        if (item.authorCount) existing.authorCount = item.authorCount;
      } else {
        symbolMap.set(sym, {
          symbol: sym,
          sources: [item.source],
          score: weight,
          conviction: item.conviction,
          direction: item.direction,
          authorCount: item.authorCount,
          category: item.category
        });
      }
    });
  };

  // Weight by source importance
  addSymbols(consensus, 40);      // Author consensus most important
  addSymbols(highConv, 30);       // High conviction signals
  addSymbols(trending, 20);       // Trending on X
  addSymbols(outlook, 10);        // AI outlook themes

  // Convert to array and sort by score
  let candidates = Array.from(symbolMap.values())
    .sort((a, b) => b.score - a.score);

  // Limit to max symbols
  candidates = candidates.slice(0, CONFIG.maxSymbols);

  console.log(`[Dynamic] Final watchlist: ${candidates.length} symbols`);
  candidates.forEach((c, i) => {
    const sources = c.sources.join('+');
    console.log(`  ${i + 1}. ${c.symbol} (score: ${c.score}, sources: ${sources})`);
  });

  state.lastDynamicList = candidates;
  return candidates;
}

// ============================================
// ZONE ANALYSIS (adapted from zone-scanner.js)
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
      return { symbol, error: 'Missing levels data' };
    }

    // Calculate distances
    const distToPutWall = ((price - putWall) / price) * 100;
    const distToCallWall = ((callWall - price) / price) * 100;
    const rangeSize = ((callWall - putWall) / price) * 100;
    const positionInRange = (price - putWall) / (callWall - putWall);

    const { buyZoneThresholdPct, sellZoneThresholdPct, rsiOverbought, rsiOversold } = CONFIG.zones;

    // Determine zone
    let zone;
    let tradeable = false;
    let action = null;
    let reasoning = [];

    if (rsi > rsiOverbought) {
      zone = ZONES.OVERBOUGHT;
      reasoning.push(`RSI ${rsi.toFixed(1)} > ${rsiOverbought} (overbought)`);
    } else if (rsi < rsiOversold) {
      zone = ZONES.OVERSOLD;
      reasoning.push(`RSI ${rsi.toFixed(1)} < ${rsiOversold} (oversold)`);
      if (distToPutWall <= buyZoneThresholdPct) {
        zone = ZONES.BUY_ZONE;
        tradeable = true;
        action = 'BUY';
        reasoning.push(`At put wall + oversold = Strong buy`);
      }
    } else if (price > callWall) {
      zone = ZONES.EXTENDED_HIGH;
      reasoning.push(`Price above call wall (breakout or reversal)`);
    } else if (price < putWall) {
      zone = ZONES.EXTENDED_LOW;
      reasoning.push(`Price below put wall (breakdown or reversal)`);
    } else if (distToPutWall <= buyZoneThresholdPct) {
      zone = ZONES.BUY_ZONE;
      tradeable = true;
      action = 'BUY';
      reasoning.push(`Within ${buyZoneThresholdPct}% of put wall ($${putWall.toFixed(2)})`);
      reasoning.push(`RSI ${rsi.toFixed(1)} - not overbought`);
      if (trend === 'uptrend' || trend === 'strong_uptrend') {
        reasoning.push(`Trend aligned: ${trend}`);
      }
    } else if (distToCallWall <= sellZoneThresholdPct) {
      zone = ZONES.SELL_ZONE;
      tradeable = true;
      action = 'SELL';
      reasoning.push(`Within ${sellZoneThresholdPct}% of call wall ($${callWall.toFixed(2)})`);
      reasoning.push(`RSI ${rsi.toFixed(1)} - not oversold`);
      if (trend === 'downtrend' || trend === 'strong_downtrend') {
        reasoning.push(`Trend aligned: ${trend}`);
      }
    } else {
      zone = ZONES.MID_RANGE;
      reasoning.push(`Mid-range (${(positionInRange * 100).toFixed(0)}% between walls)`);
      reasoning.push(`No trade - wait for support/resistance`);
    }

    return {
      symbol,
      price,
      zone,
      tradeable,
      action,
      reasoning,
      levels: { putWall, callWall, maxPain, gammaFlip, vwap },
      distances: { toPutWall: distToPutWall, toCallWall: distToCallWall, rangeSize, positionInRange },
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

function shouldAlert(symbol, newZone, sourceInfo) {
  const cooldownMs = 60 * 60 * 1000; // 1 hour cooldown

  const lastZone = state.zoneStates[symbol];
  const lastAlertTime = state.alertTimes[symbol] || 0;
  const now = Date.now();

  const zoneChanged = lastZone !== newZone;
  const cooldownPassed = (now - lastAlertTime) > cooldownMs;
  const isTradeable = newZone === ZONES.BUY_ZONE || newZone === ZONES.SELL_ZONE;

  return zoneChanged && isTradeable && cooldownPassed;
}

async function sendZoneAlert(analysis, sourceInfo) {
  const emoji = analysis.action === 'BUY' ? '🟢' : '🔴';
  const zoneEmoji = analysis.zone === ZONES.BUY_ZONE ? '📗 BUY ZONE' : '📕 SELL ZONE';

  // Include source info
  const sourceStr = escapeHtml(sourceInfo?.sources?.join(' + ') || 'scan');
  const scoreStr = sourceInfo?.score ? ` | Score: ${sourceInfo.score}` : '';
  const dirStr = sourceInfo?.direction ? ` | Consensus: ${escapeHtml(sourceInfo.direction)}` : '';

  // Escape dynamic content to prevent HTML parsing errors
  const trend = escapeHtml(analysis.technicals.trend);
  const volumeSignal = escapeHtml(analysis.technicals.volumeSignal);
  const reasons = analysis.reasoning.map(r => '• ' + escapeHtml(r)).join('\n');

  const message = `${emoji} <b>${analysis.symbol} - ${zoneEmoji}</b>

<b>Price:</b> $${analysis.price.toFixed(2)}
<b>Action:</b> ${analysis.action}
<b>Source:</b> ${sourceStr}${scoreStr}${dirStr}

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

⚡ Dynamic scan: Narrative + Zone aligned`;

  await sendTelegram(message);

  state.zoneStates[analysis.symbol] = analysis.zone;
  state.alertTimes[analysis.symbol] = Date.now();
}

// ============================================
// MAIN SCANNER
// ============================================

async function runDynamicScan() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toISOString()}] Running DYNAMIC scan...`);
  console.log('='.repeat(50));

  // Build dynamic watchlist
  const watchlist = await buildDynamicWatchlist();

  if (watchlist.length === 0) {
    console.log('[Scanner] No symbols to scan');
    return;
  }

  const results = [];
  const alerts = [];

  for (const candidate of watchlist) {
    const analysis = await analyzeSymbol(candidate.symbol);

    // Attach source info
    analysis.sourceInfo = {
      sources: candidate.sources,
      score: candidate.score,
      direction: candidate.direction,
      authorCount: candidate.authorCount,
      isCore: candidate.isCore
    };

    results.push(analysis);

    if (analysis.error) {
      console.log(`[Scan] ${candidate.symbol}: Error - ${analysis.error}`);
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

    const sourceStr = candidate.sources.join('+');
    console.log(`[Scan] ${candidate.symbol}: ${zoneIcon} ${analysis.zone} @ $${analysis.price.toFixed(2)} (RSI: ${analysis.technicals.rsi.toFixed(1)}) [${sourceStr}]`);

    // Check if we should alert
    if (shouldAlert(candidate.symbol, analysis.zone, candidate) && analysis.tradeable) {
      alerts.push({ analysis, sourceInfo: candidate });
    }

    // Update state
    state.zoneStates[analysis.symbol] = analysis.zone;

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 200));
  }

  // Send alerts
  for (const { analysis, sourceInfo } of alerts) {
    try {
      await sendZoneAlert(analysis, sourceInfo);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`[Alert] Failed for ${analysis.symbol}:`, e.message);
    }
  }

  // Write results
  const output = {
    timestamp: new Date().toISOString(),
    scanType: 'dynamic',
    sources: {
      highConviction: true,
      trending: true,
      authorConsensus: true,
      aiOutlook: true
    },
    scanCount: results.length,
    tradeableCount: results.filter(r => r.tradeable).length,
    results: results.sort((a, b) => {
      if (a.tradeable && !b.tradeable) return -1;
      if (!a.tradeable && b.tradeable) return 1;
      return (b.sourceInfo?.score || 0) - (a.sourceInfo?.score || 0);
    })
  };

  try {
    fs.writeFileSync(CONFIG.outputPath, JSON.stringify(output, null, 2));
    console.log(`[Scanner] Results written to dynamic_scan.json`);
  } catch (e) {
    console.error('[Scanner] Failed to write results:', e.message);
  }

  // Summary
  const buyZones = results.filter(r => r.zone === ZONES.BUY_ZONE);
  const sellZones = results.filter(r => r.zone === ZONES.SELL_ZONE);
  const midRange = results.filter(r => r.zone === ZONES.MID_RANGE);

  console.log(`\n[Summary]`);
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
  console.log('     WINGMAN DYNAMIC SCANNER');
  console.log('========================================');
  console.log(`Intel API: ${CONFIG.apis.intel}`);
  console.log(`Options API: ${CONFIG.apis.options}`);
  console.log(`Scan Interval: ${CONFIG.scanIntervalMs / 1000}s`);
  console.log(`Max Symbols: ${CONFIG.maxSymbols}`);
  console.log('========================================');
  console.log('Sources: High Conviction + Trending + Author Consensus + AI Outlook');
  console.log('========================================\n');

  // Initial scan
  await runDynamicScan();

  // Continue scanning if running standalone
  if (require.main === module) {
    console.log('\n[Scanner] Running continuous dynamic scans...\n');
    setInterval(runDynamicScan, CONFIG.scanIntervalMs);
  }
}

// Export for module use
module.exports = { runDynamicScan, buildDynamicWatchlist, analyzeSymbol, ZONES };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
