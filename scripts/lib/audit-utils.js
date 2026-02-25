/**
 * AUDIT UTILITIES
 *
 * Shared functions for the deep data audit scripts.
 * Pattern follows ma-backtest.js (fetch/cache) and signal-db.js (DB access).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
// Uses Node 18+ global fetch (same as ma-backtest.js)

// ─── Constants ───────────────────────────────────────────────────────────────

const OPTIONS_API = 'http://192.168.10.60:8000';
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'wingman.db');
const HISTORY_DIR = path.join(__dirname, '..', '..', 'data', 'history');
const HOLD_DAYS = [1, 3, 5];

// ─── Database ────────────────────────────────────────────────────────────────

let _db = null;

function getDb() {
    if (!_db) {
        _db = new Database(DB_PATH);
        _db.pragma('journal_mode = WAL');
        _db.pragma('busy_timeout = 15000');
    }
    return _db;
}

function closeDb() {
    if (_db) {
        try { _db.close(); } catch (e) { /* already closed */ }
        _db = null;
    }
}

process.on('exit', closeDb);

// ─── API / History ───────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cacheFile(symbol) {
    return path.join(HISTORY_DIR, `${symbol}_daily.json`);
}

function cacheValid(symbol, fresh = false) {
    if (fresh) return false;
    const fp = cacheFile(symbol);
    if (!fs.existsSync(fp)) return false;
    const stat = fs.statSync(fp);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    return ageHours < 24;
}

/**
 * Fetch daily OHLCV from Options API with 24h file cache.
 * Returns sorted array of {datetime, open, high, low, close, volume} or null on failure.
 */
async function fetchHistory(symbol, fresh = false) {
    if (cacheValid(symbol, fresh)) {
        const data = JSON.parse(fs.readFileSync(cacheFile(symbol), 'utf8'));
        return data.candles || [];
    }

    const url = `${OPTIONS_API}/api/history/${symbol}?period_type=year&period=1&frequency_type=daily&frequency=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data.candles || data.candles.length === 0) {
            throw new Error('No candles returned');
        }

        // Ensure history dir exists
        if (!fs.existsSync(HISTORY_DIR)) {
            fs.mkdirSync(HISTORY_DIR, { recursive: true });
        }

        fs.writeFileSync(cacheFile(symbol), JSON.stringify(data));
        return data.candles;
    } catch (e) {
        clearTimeout(timeout);
        console.error(`  Failed to fetch ${symbol}: ${e.message}`);
        return null;
    }
}

// ─── Date / Forward Returns ──────────────────────────────────────────────────

/**
 * Build a Map<'YYYY-MM-DD', arrayIndex> from candles for O(1) date lookups.
 * Schwab candles have datetime as epoch ms.
 */
function buildDateIndex(candles) {
    const index = new Map();
    for (let i = 0; i < candles.length; i++) {
        const d = new Date(candles[i].datetime);
        // Convert to ET date string (UTC-5 in winter, UTC-4 in summer)
        // Schwab timestamps are midnight ET as epoch, so simple conversion works
        const dateStr = d.toISOString().split('T')[0];
        index.set(dateStr, i);
    }
    return index;
}

/**
 * Compute forward returns for a given date.
 * Returns {close_price, return_1d, return_3d, return_5d, max_gain_5d, max_drawdown_5d}
 * or null if the date isn't in the candle data.
 */
function computeForwardReturns(candles, dateIndex, dateStr) {
    const idx = dateIndex.get(dateStr);
    if (idx === undefined) return null;

    const entryClose = candles[idx].close;
    if (!entryClose || entryClose <= 0) return null;

    const result = { close_price: entryClose };

    // Forward returns at 1d, 3d, 5d
    for (const d of HOLD_DAYS) {
        const fwdIdx = idx + d;
        if (fwdIdx < candles.length) {
            result[`return_${d}d`] = ((candles[fwdIdx].close - entryClose) / entryClose) * 100;
        } else {
            result[`return_${d}d`] = null;
        }
    }

    // Max gain and drawdown within 5-day window (using daily high/low)
    let maxGain = -Infinity;
    let maxDD = Infinity;
    const windowEnd = Math.min(idx + 5, candles.length - 1);
    for (let i = idx + 1; i <= windowEnd; i++) {
        const gainPct = ((candles[i].high - entryClose) / entryClose) * 100;
        const ddPct = ((candles[i].low - entryClose) / entryClose) * 100;
        if (gainPct > maxGain) maxGain = gainPct;
        if (ddPct < maxDD) maxDD = ddPct;
    }
    result.max_gain_5d = maxGain === -Infinity ? null : maxGain;
    result.max_drawdown_5d = maxDD === Infinity ? null : maxDD;

    return result;
}

// ─── Factor Extraction ───────────────────────────────────────────────────────

/**
 * Map raw signal strings from signals_json to canonical factor names.
 * Based on exact strings from bloodhound-scanner.js signals.push() calls.
 * Order matters — more specific patterns must come before general ones.
 */
const FACTOR_MAP = [
    // Zone factors
    { match: s => s.includes('PINNED between walls'),          factor: 'PINNED' },
    { match: s => s.includes('BREAKOUT above call wall'),      factor: 'BREAKOUT' },
    { match: s => s.includes('BREAKDOWN below put wall'),      factor: 'BREAKDOWN' },
    { match: s => s.includes('At put wall support'),           factor: 'AT_PUT_WALL' },
    { match: s => s.includes('At call wall resistance'),       factor: 'AT_CALL_WALL' },

    // RSI (specific before general)
    { match: s => s.includes('RSI pullback in uptrend'),       factor: 'RSI_PULLBACK_UP' },
    { match: s => s.includes('RSI bounce in downtrend'),       factor: 'RSI_BOUNCE_DOWN' },
    { match: s => s.startsWith('RSI oversold'),                factor: 'RSI_OVERSOLD' },
    { match: s => s.startsWith('RSI overbought'),              factor: 'RSI_OVERBOUGHT' },

    // Bollinger Bands
    { match: s => s.includes('At lower Bollinger'),            factor: 'LOWER_BB' },
    { match: s => s.includes('At upper Bollinger'),            factor: 'UPPER_BB' },

    // Volume
    { match: s => s.includes('Volume spike'),                  factor: 'VOLUME_SPIKE' },
    { match: s => s.includes('Elevated volume'),               factor: 'ELEVATED_VOLUME' },

    // Wall activity (mixed case in DB: "wall engaged", "wall ACTIVE", "wall dormant")
    { match: s => /wall engaged/i.test(s),                     factor: 'WALL_ENGAGED' },
    { match: s => /wall ACTIVE/i.test(s),                      factor: 'WALL_ACTIVE' },
    { match: s => /wall dormant/i.test(s),                     factor: 'WALL_DORMANT' },

    // Options flow — unusual (specific before general)
    { match: s => s.includes('Unusual PUT') && s.includes('OTM'),  factor: 'UNUSUAL_PUT_OTM' },
    { match: s => s.includes('Unusual PUT') && s.includes('ITM'),  factor: 'UNUSUAL_PUT_ITM' },
    { match: s => s.includes('Unusual PUT') && s.includes('ATM'),  factor: 'UNUSUAL_PUT_ATM' },
    { match: s => s.includes('Unusual PUT') && s.includes('0DTE'), factor: 'UNUSUAL_PUT_0DTE' },
    { match: s => s.includes('Unusual PUT'),                       factor: 'UNUSUAL_PUT' },
    { match: s => s.includes('Unusual CALL'),                      factor: 'UNUSUAL_CALL' },

    // Options flow — elevated
    { match: s => s.includes('Elevated call'),                 factor: 'ELEVATED_CALL' },
    { match: s => s.includes('Elevated put'),                  factor: 'ELEVATED_PUT' },

    // Flow bias
    { match: s => s.includes('Heavy call bias'),               factor: 'HEAVY_CALLS' },
    { match: s => s.includes('Heavy put bias'),                factor: 'HEAVY_PUTS' },
    { match: s => s.includes('SMART FLOW'),                    factor: 'SMART_FLOW' },
    { match: s => s.includes('Flow direction') && s.includes('opposes'), factor: 'FLOW_OPPOSES' },

    // VIX regime
    { match: s => s.includes('VIX fear'),                      factor: 'VIX_FEAR' },
    { match: s => s.includes('VIX elevated'),                  factor: 'VIX_ELEVATED' },

    // MA signals
    { match: s => s.includes('MA trend confirmed'),            factor: 'MA_CONFIRMED' },
    { match: s => s.includes('MA opposes signal'),             factor: 'MA_OPPOSES' },
    { match: s => s.includes('Near SMA 50'),                   factor: 'NEAR_SMA50' },

    // Market context
    { match: s => s.includes('Counter-trend'),                 factor: 'COUNTER_TREND' },
    { match: s => s.includes('Dip buy'),                       factor: 'DIP_BUY' },
    { match: s => s.includes('Chasing'),                       factor: 'CHASING' },
    { match: s => s.includes('Index ETF penalty'),             factor: 'INDEX_ETF' },

    // Cross-scanner flow confirmation (from Opportunity Scanner)
    { match: s => s.includes('Flow confirmed by Opportunity Scanner') && s.includes('(HC'), factor: 'OPP_FLOW_HC' },
    { match: s => s.includes('Flow confirmed by Opportunity Scanner') && s.includes('(T'),  factor: 'OPP_FLOW_T' },

    // Sector RS
    { match: s => s.includes('Strong sector RS'),              factor: 'SECTOR_RS_TOP' },
    { match: s => s.includes('Above-avg sector RS'),           factor: 'SECTOR_RS_ABOVE' },
    { match: s => s.includes('Weak sector RS'),                factor: 'SECTOR_RS_WEAK' },
    { match: s => s.includes('Sector headwind'),               factor: 'SECTOR_RS_BOTTOM' },

    // History
    { match: s => s.includes('New discovery'),                 factor: 'NEW_DISCOVERY' },
    { match: s => s.includes('Day 2 setup'),                   factor: 'DAY_2' },
    { match: s => s.includes('Streak'),                        factor: 'STREAK' },
    { match: s => s.includes('Returned setup'),                factor: 'RETURNED' },

    // Confluence / alignment
    { match: s => s.includes('Confluence zone'),               factor: 'CONFLUENCE_ZONE' },
    { match: s => s.includes('TF aligned'),                    factor: 'TF_ALIGNED' },
    { match: s => s.includes('Above gamma flip'),              factor: 'ABOVE_GAMMA_FLIP' },
    { match: s => s.includes('Below gamma flip'),              factor: 'BELOW_GAMMA_FLIP' },
    { match: s => s.includes('Extended high'),                 factor: 'EXTENDED_HIGH' },

    // Internals
    { match: s => s.includes('Internals confirm bullish'),     factor: 'INTERNALS_BULL' },
    { match: s => s.includes('Internals confirm bearish'),     factor: 'INTERNALS_BEAR' },
    { match: s => s.includes('Internals oppose bullish'),      factor: 'INTERNALS_OPPOSE_BULL' },
    { match: s => s.includes('Internals oppose bearish'),      factor: 'INTERNALS_OPPOSE_BEAR' },

    // MA bounce / divergence (from external modules)
    { match: s => s.startsWith('✅') && s.includes('bounce'),  factor: 'MA_BOUNCE' },
    { match: s => s.startsWith('✅') && s.includes('ivergence'), factor: 'DIVERGENCE_BB' },
    { match: s => s.startsWith('✅'),                           factor: 'BACKTEST_VALIDATED' },

    // HIGH CONFLUENCE flag
    { match: s => s.includes('HIGH CONFLUENCE'),               factor: 'HIGH_CONFLUENCE' },
];

/**
 * Parse signals_json string → Set of canonical factor names.
 */
function extractFactors(signalsJson) {
    let signals;
    try {
        signals = JSON.parse(signalsJson || '[]');
    } catch (e) {
        return new Set();
    }

    const factors = new Set();
    for (const sig of signals) {
        if (typeof sig !== 'string') continue;
        for (const { match, factor } of FACTOR_MAP) {
            if (match(sig)) {
                factors.add(factor);
                break; // first match wins
            }
        }
    }
    return factors;
}

/**
 * Get all unique factor names that appear in a set of observations.
 */
function getActiveFactors(observations) {
    const all = new Set();
    for (const obs of observations) {
        for (const f of obs.factors) {
            all.add(f);
        }
    }
    return [...all].sort();
}

// ─── Statistics ──────────────────────────────────────────────────────────────

/**
 * Calculate win rate and basic stats from an array of returns.
 * @param {number[]} returns - Array of percentage returns
 * @param {string} direction - 'bullish', 'bearish', or 'pinned'
 * @returns {{ count, wins, wr, avg, median }}
 */
function calcWinRate(returns, direction = 'bullish') {
    if (!returns || returns.length === 0) {
        return { count: 0, wins: 0, wr: 0, avg: 0, median: 0 };
    }

    const wins = returns.filter(r => {
        if (direction === 'bearish') return r < 0; // price dropped = win for bearish
        return r > 0; // price rose = win for bullish/pinned/neutral
    }).length;

    const sorted = [...returns].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;

    return {
        count: returns.length,
        wins,
        wr: (wins / returns.length) * 100,
        avg,
        median
    };
}

/**
 * Pearson R² between two arrays.
 */
function pearsonR2(xs, ys) {
    if (xs.length !== ys.length || xs.length < 3) return 0;
    const n = xs.length;
    const meanX = xs.reduce((s, x) => s + x, 0) / n;
    const meanY = ys.reduce((s, y) => s + y, 0) / n;

    let ssXY = 0, ssXX = 0, ssYY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        ssXY += dx * dy;
        ssXX += dx * dx;
        ssYY += dy * dy;
    }

    if (ssXX === 0 || ssYY === 0) return 0;
    const r = ssXY / Math.sqrt(ssXX * ssYY);
    return r * r;
}

// ─── Reporting ───────────────────────────────────────────────────────────────

const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
};

/**
 * Format a win rate with color coding.
 * Green >= 65%, Yellow 50-65%, Red < 50%
 */
function fmtWR(wr, count) {
    const pct = wr.toFixed(1) + '%';
    const suffix = count !== undefined ? ` (n=${count})` : '';

    if (count !== undefined && count < 5) {
        return `${COLORS.dim}${pct}${suffix}${COLORS.reset}`;
    }
    if (wr >= 65) return `${COLORS.green}${pct}${suffix}${COLORS.reset}`;
    if (wr >= 50) return `${COLORS.yellow}${pct}${suffix}${COLORS.reset}`;
    return `${COLORS.red}${pct}${suffix}${COLORS.reset}`;
}

/**
 * Format a percentage with sign and color.
 */
function fmtPct(pct) {
    if (pct === null || pct === undefined) return '  —  ';
    const sign = pct >= 0 ? '+' : '';
    const str = `${sign}${pct.toFixed(2)}%`;
    if (pct >= 0.5) return `${COLORS.green}${str}${COLORS.reset}`;
    if (pct <= -0.5) return `${COLORS.red}${str}${COLORS.reset}`;
    return str;
}

/**
 * Print a formatted table header.
 */
function printHeader(title) {
    const line = '─'.repeat(80);
    console.log(`\n${COLORS.cyan}${line}${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.white}  ${title}${COLORS.reset}`);
    console.log(`${COLORS.cyan}${line}${COLORS.reset}`);
}

/**
 * Print a row in a table with fixed-width columns.
 */
function printRow(cols, widths) {
    const parts = cols.map((col, i) => {
        const w = widths[i] || 12;
        const str = String(col);
        // Strip ANSI for padding calculation
        const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
        const pad = Math.max(0, w - visible.length);
        return str + ' '.repeat(pad);
    });
    console.log('  ' + parts.join(''));
}

// ─── CLI Helpers ─────────────────────────────────────────────────────────────

function getArg(args, flag, defaultVal) {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return defaultVal;
    return args[idx + 1];
}

function hasFlag(args, flag) {
    return args.includes(flag);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    // Constants
    OPTIONS_API,
    DB_PATH,
    HISTORY_DIR,
    HOLD_DAYS,

    // Database
    getDb,
    closeDb,

    // API / History
    sleep,
    fetchHistory,
    buildDateIndex,
    computeForwardReturns,

    // Factor parsing
    FACTOR_MAP,
    extractFactors,
    getActiveFactors,

    // Statistics
    calcWinRate,
    pearsonR2,

    // Reporting
    COLORS,
    fmtWR,
    fmtPct,
    printHeader,
    printRow,

    // CLI
    getArg,
    hasFlag,
};
