/**
 * Wingman Trade Client
 * Handles trade logging to the Market Intelligence Server
 *
 * Usage:
 *   const client = require('./trade-client');
 *
 *   // Log a new trade
 *   const trade = await client.logEntry({
 *     symbol: 'SPY',
 *     direction: 'long',
 *     strategy: 'vwap_reversion',
 *     entry_price: 691.50,
 *     stop_price: 689.00,
 *     target_price: 695.00,
 *     quantity: 100,
 *     notes: 'Bounce off VWAP lower band'
 *   });
 *
 *   // Close the trade
 *   await client.closeTrade(trade.trade_id, {
 *     exit_price: 694.50,
 *     exit_reason: 'target_hit'
 *   });
 */

const https = require('https');
const http = require('http');

const API_BASE = process.env.INTEL_API || 'http://192.168.10.60:3000';

// Helper to make HTTP requests
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const protocol = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Log a new trade entry
 * Server auto-captures market snapshot
 */
async function logEntry(trade) {
  const required = ['symbol', 'direction', 'entry_price'];
  for (const field of required) {
    if (!trade[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const result = await request('POST', '/api/trades', {
    symbol: trade.symbol.toUpperCase(),
    direction: trade.direction.toLowerCase(),
    strategy: trade.strategy || null,
    entry_price: parseFloat(trade.entry_price),
    stop_price: trade.stop_price ? parseFloat(trade.stop_price) : null,
    target_price: trade.target_price ? parseFloat(trade.target_price) : null,
    quantity: trade.quantity ? parseInt(trade.quantity) : null,
    risk_amount: trade.risk_amount ? parseFloat(trade.risk_amount) : null,
    notes: trade.notes || null
  });

  console.log(`[Trade] Logged ${trade.direction.toUpperCase()} ${trade.symbol} @ $${trade.entry_price}`);
  console.log(`[Trade] ID: ${result.trade_id}`);

  if (result.entry_snapshot) {
    console.log(`[Trade] Snapshot: VIX ${result.entry_snapshot.vix} (${result.entry_snapshot.vix_regime}), Gamma: ${result.entry_snapshot.gamma_regime}`);
  }

  return result;
}

/**
 * Close an existing trade
 * Server auto-calculates P&L and R-multiple
 */
async function closeTrade(tradeId, exit) {
  if (!tradeId) throw new Error('Trade ID required');
  if (!exit.exit_price) throw new Error('Exit price required');

  const result = await request('PATCH', `/api/trades/${tradeId}/close`, {
    exit_price: parseFloat(exit.exit_price),
    exit_reason: exit.exit_reason || 'manual',
    notes: exit.notes || null
  });

  console.log(`[Trade] Closed ${result.symbol} @ $${exit.exit_price}`);
  console.log(`[Trade] P&L: $${result.pnl_dollars?.toFixed(2)} (${result.pnl_percent?.toFixed(2)}%)`);
  console.log(`[Trade] R-Multiple: ${result.r_multiple?.toFixed(2)}R`);
  console.log(`[Trade] Outcome: ${result.outcome}`);

  return result;
}

/**
 * Get all open trades
 */
async function getOpenTrades() {
  return request('GET', '/api/trades/open');
}

/**
 * Get trade statistics with optional filters
 */
async function getStats(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.append(key, value);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return request('GET', `/api/trades/stats${query}`);
}

/**
 * Query trade history
 */
async function queryTrades(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.append(key, value);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return request('GET', `/api/trades${query}`);
}

/**
 * Get single trade with full snapshots
 */
async function getTrade(tradeId) {
  return request('GET', `/api/trades/${tradeId}`);
}

/**
 * Get market context before proposing a trade
 */
async function getMarketContext(symbol) {
  const [pressure, outlook] = await Promise.all([
    request('GET', `/api/options-walls/${symbol}/pressure`).catch(() => null),
    request('GET', '/api/market/outlook').catch(() => null)
  ]);

  return {
    pressure,
    outlook,
    summary: pressure ?
      `${symbol}: ${pressure.net_bias || 'NEUTRAL'} - Call Wall: $${pressure.call_wall?.strike || '--'}, Put Wall: $${pressure.put_wall?.strike || '--'}` :
      `${symbol}: Unable to fetch pressure data`
  };
}

// Export functions
module.exports = {
  logEntry,
  closeTrade,
  getOpenTrades,
  getStats,
  queryTrades,
  getTrade,
  getMarketContext,
  API_BASE
};

// CLI mode - run directly for quick operations
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  async function run() {
    switch (command) {
      case 'open':
        const open = await getOpenTrades();
        console.log('\n=== Open Trades ===');
        if (!open.trades?.length) {
          console.log('No open trades');
        } else {
          for (const t of open.trades) {
            console.log(`${t.id.slice(0,8)} | ${t.direction.toUpperCase()} ${t.symbol} @ $${t.entry_price} | Stop: $${t.stop_price || '--'} | Target: $${t.target_price || '--'}`);
          }
        }
        break;

      case 'stats':
        const stats = await getStats();
        console.log('\n=== Trade Statistics ===');
        console.log(`Total Trades: ${stats.total_trades}`);
        console.log(`Win Rate: ${(stats.win_rate * 100).toFixed(1)}%`);
        console.log(`Avg R: ${stats.avg_r?.toFixed(2)}R`);
        console.log(`Profit Factor: ${stats.profit_factor?.toFixed(2)}`);
        console.log(`Total P&L: $${stats.total_pnl?.toFixed(2)}`);
        break;

      case 'context':
        const symbol = args[1] || 'SPY';
        const ctx = await getMarketContext(symbol);
        console.log('\n=== Market Context ===');
        console.log(ctx.summary);
        if (ctx.outlook) {
          console.log(`Outlook: ${ctx.outlook.bias || 'neutral'}`);
        }
        break;

      default:
        console.log('Wingman Trade Client');
        console.log('Usage:');
        console.log('  node trade-client.js open      - Show open trades');
        console.log('  node trade-client.js stats     - Show performance stats');
        console.log('  node trade-client.js context [SYMBOL] - Get market context');
    }
  }

  run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
