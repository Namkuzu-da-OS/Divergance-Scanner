/**
 * API CACHE - Cross-Process Shared Cache via SQLite
 *
 * All PM2 scanner processes share wingman.db. When Bloodhound fetches
 * technicals for NVDA, Opportunity Scanner gets it free from cache.
 *
 * Follows same DB pattern as signal-db.js (WAL mode, 15s busy_timeout).
 *
 * Never cached:
 *   - /api/levels/* (gamma walls shift with real-time flow)
 *   - /api/quotes/* (must be real-time)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'wingman.db');

// TTL constants (milliseconds)
const TTL = {
    TECHNICALS: 15 * 60 * 1000,   // 15 min — RSI, MAs, BBs from daily candles
    FLOW:       15 * 60 * 1000,   // 15 min — options flow aggregates
    ANALYSIS:   10 * 60 * 1000,   // 10 min — IV, skew shift slowly
    IV:         10 * 60 * 1000,   // 10 min — IV rank/percentile
    CONTEXT:     5 * 60 * 1000,   //  5 min — VIX regime can shift
    CALENDAR:   24 * 60 * 60 * 1000  // 24 hours — earnings dates are static
};

let db = null;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 15000');
        initSchema();
    }
    return db;
}

function closeDb() {
    if (db) {
        try { db.close(); } catch (e) { /* already closed */ }
        db = null;
    }
}
process.on('exit', closeDb);

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_cache (
            url TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            ttl_ms INTEGER NOT NULL,
            source_process TEXT
        )
    `);
}

// Prepared statements (lazy-initialized)
let _stmts = null;
function stmts() {
    if (!_stmts) {
        const d = getDb();
        _stmts = {
            get: d.prepare('SELECT data, cached_at, ttl_ms FROM api_cache WHERE url = ?'),
            set: d.prepare('INSERT OR REPLACE INTO api_cache (url, data, cached_at, ttl_ms, source_process) VALUES (?, ?, ?, ?, ?)'),
            cleanup: d.prepare('DELETE FROM api_cache WHERE (cached_at + ttl_ms) < ?'),
            countTotal: d.prepare('SELECT COUNT(*) as total FROM api_cache'),
            countFresh: d.prepare('SELECT COUNT(*) as fresh FROM api_cache WHERE (cached_at + ttl_ms) >= ?')
        };
    }
    return _stmts;
}

/**
 * Get cached data for a URL. Returns parsed JSON or null if expired/missing.
 */
function get(url) {
    try {
        const row = stmts().get.get(url);
        if (!row) return null;

        const now = Date.now();
        if ((row.cached_at + row.ttl_ms) < now) {
            return null; // expired
        }

        return JSON.parse(row.data);
    } catch (e) {
        console.error(`[API Cache] get error: ${e.message}`);
        return null;
    }
}

/**
 * Store data in cache.
 */
function set(url, data, ttlMs, source) {
    try {
        stmts().set.run(url, JSON.stringify(data), Date.now(), ttlMs, source || 'unknown');
    } catch (e) {
        console.error(`[API Cache] set error: ${e.message}`);
    }
}

/**
 * Cache-through wrapper. Check cache first, call fetchFn on miss, save result.
 * Returns the data (from cache or fresh fetch).
 *
 * @param {string} url - The API URL (used as cache key)
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @param {function} fetchFn - Async function that returns the data (called on cache miss)
 * @param {string} source - Process name for tracking (e.g. 'bloodhound')
 * @returns {Promise<any>} The data
 */
async function wrap(url, ttlMs, fetchFn, source) {
    // Check cache first
    const cached = get(url);
    if (cached !== null) {
        return cached;
    }

    // Cache miss — fetch fresh
    const data = await fetchFn();
    if (data !== null && data !== undefined) {
        set(url, data, ttlMs, source);
    }
    return data;
}

/**
 * Delete expired cache entries.
 */
function cleanup() {
    try {
        const result = stmts().cleanup.run(Date.now());
        if (result.changes > 0) {
            console.log(`[API Cache] Cleaned ${result.changes} expired entries`);
        }
    } catch (e) {
        console.error(`[API Cache] cleanup error: ${e.message}`);
    }
}

/**
 * Get cache statistics.
 */
function stats() {
    try {
        const now = Date.now();
        const total = stmts().countTotal.get().total;
        const fresh = stmts().countFresh.get(now).fresh;
        return { total, fresh, stale: total - fresh };
    } catch (e) {
        console.error(`[API Cache] stats error: ${e.message}`);
        return { total: 0, fresh: 0, stale: 0 };
    }
}

module.exports = { get, set, wrap, cleanup, stats, TTL };
