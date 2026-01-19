/**
 * OPPORTUNITY SCANNER - SQLite Historical Data Collection
 *
 * Stores scan results for future analysis of what works and what doesn't.
 * NOT paper trading - just raw data collection for retrospective analysis.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'opportunity_history.db');

let db = null;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        initSchema();
    }
    return db;
}

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            symbols_scanned INTEGER,
            high_conviction_count INTEGER,
            tradeable_count INTEGER,
            watch_count INTEGER,
            market_vix REAL,
            market_spy_price REAL,
            market_spy_trend TEXT
        );

        CREATE TABLE IF NOT EXISTS opportunities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER,
            symbol TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            discovery_score INTEGER,
            discovery_sources TEXT,
            opportunity_score INTEGER,
            tier TEXT,
            price REAL,
            vol_oi_ratio REAL,
            unusual_activity TEXT,
            gap_percent REAL,
            iv_percentile REAL,
            rsi REAL,
            signals TEXT,
            FOREIGN KEY (scan_id) REFERENCES scans(id)
        );

        CREATE INDEX IF NOT EXISTS idx_opportunities_symbol ON opportunities(symbol);
        CREATE INDEX IF NOT EXISTS idx_opportunities_timestamp ON opportunities(timestamp);
        CREATE INDEX IF NOT EXISTS idx_opportunities_tier ON opportunities(tier);
    `);
}

function insertScan(scanMeta) {
    const stmt = getDb().prepare(`
        INSERT INTO scans (timestamp, symbols_scanned, high_conviction_count,
                          tradeable_count, watch_count, market_vix,
                          market_spy_price, market_spy_trend)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        scanMeta.timestamp,
        scanMeta.symbolsScanned,
        scanMeta.highConvictionCount,
        scanMeta.tradeableCount,
        scanMeta.watchCount,
        scanMeta.vix,
        scanMeta.spyPrice,
        scanMeta.spyTrend
    );

    return result.lastInsertRowid;
}

function insertOpportunity(scanId, opp) {
    const stmt = getDb().prepare(`
        INSERT INTO opportunities (scan_id, symbol, timestamp, discovery_score,
                                   discovery_sources, opportunity_score, tier,
                                   price, vol_oi_ratio, unusual_activity,
                                   gap_percent, iv_percentile, rsi, signals)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        scanId,
        opp.symbol,
        opp.timestamp,
        opp.discoveryScore,
        JSON.stringify(opp.discoverySources || []),
        opp.score,
        opp.tier,
        opp.price,
        opp.volOiRatio,
        opp.unusualActivity,
        opp.gapPercent,
        opp.ivPercentile,
        opp.rsi,
        JSON.stringify(opp.signals || [])
    );
}

function saveScanResults(results, marketContext) {
    const timestamp = new Date().toISOString();

    // Count tiers
    const tierCounts = results.reduce((acc, r) => {
        acc[r.tier] = (acc[r.tier] || 0) + 1;
        return acc;
    }, {});

    // Insert scan metadata
    const scanId = insertScan({
        timestamp,
        symbolsScanned: results.length,
        highConvictionCount: tierCounts['HIGH_CONVICTION'] || 0,
        tradeableCount: tierCounts['TRADEABLE'] || 0,
        watchCount: tierCounts['WATCH'] || 0,
        vix: marketContext?.vix,
        spyPrice: marketContext?.spyPrice,
        spyTrend: marketContext?.spyTrend
    });

    // Insert each opportunity
    for (const opp of results) {
        // Extract max vol/OI from unusual strikes
        let maxVolOi = null;
        if (opp.unusual?.topStrikes?.length) {
            maxVolOi = Math.max(...opp.unusual.topStrikes.map(s => s.volOiRatio || 0));
        }

        // Determine unusual activity direction
        let unusualActivity = null;
        if (opp.unusual?.callPutRatio > 2) unusualActivity = 'call_heavy';
        else if (opp.unusual?.callPutRatio < 0.5) unusualActivity = 'put_heavy';
        else if (opp.unusual?.callPutRatio) unusualActivity = 'balanced';

        insertOpportunity(scanId, {
            symbol: opp.symbol,
            timestamp,
            discoveryScore: opp.discovery_score,
            discoverySources: opp.discovery_sources,
            score: opp.score,
            tier: opp.tier,
            price: opp.price,
            volOiRatio: maxVolOi,
            unusualActivity: unusualActivity,
            gapPercent: opp.technicals?.gap,
            ivPercentile: opp.technicals?.ivRank,
            rsi: opp.technicals?.rsi,
            signals: opp.signals
        });
    }

    console.log(`[OpportunityDB] Saved scan: ${results.length} opportunities, scanId=${scanId}`);
    return scanId;
}

// Query helpers for future analysis
function getRecentScans(days = 7) {
    return getDb().prepare(`
        SELECT * FROM scans
        WHERE timestamp > datetime('now', '-${days} days')
        ORDER BY timestamp DESC
    `).all();
}

function getTierStats(days = 7) {
    return getDb().prepare(`
        SELECT tier, COUNT(*) as count
        FROM opportunities
        WHERE timestamp > datetime('now', '-${days} days')
        GROUP BY tier
    `).all();
}

function getTopSymbols(days = 7, limit = 10) {
    return getDb().prepare(`
        SELECT symbol, COUNT(*) as appearances, AVG(opportunity_score) as avg_score
        FROM opportunities
        WHERE timestamp > datetime('now', '-${days} days')
        GROUP BY symbol
        ORDER BY appearances DESC
        LIMIT ${limit}
    `).all();
}

module.exports = {
    getDb,
    saveScanResults,
    getRecentScans,
    getTierStats,
    getTopSymbols
};
