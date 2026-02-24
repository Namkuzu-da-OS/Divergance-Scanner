/**
 * OPPORTUNITY SCANNER - SQLite Historical Data Collection
 *
 * Stores scan results for future analysis of what works and what doesn't.
 * NOT paper trading - just raw data collection for retrospective analysis.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'wingman.db');

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

// Graceful shutdown — close DB on process exit
function closeDb() {
    if (db) {
        try { db.close(); } catch (e) { /* already closed */ }
        db = null;
    }
}
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('exit', closeDb);

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

    // Migration: Add new columns for full JSON migration
    migrateOpportunities();
}

function migrateOpportunities() {
    const columns = [
        { name: 'direction', type: 'TEXT' },
        { name: 'call_put_ratio', type: 'REAL' },
        { name: 'net_premium', type: 'REAL' },
        { name: 'top_strikes_json', type: 'TEXT' },
        { name: 'call_volume', type: 'INTEGER' },
        { name: 'put_volume', type: 'INTEGER' },
        { name: 'volume_ratio', type: 'REAL' },
        { name: 'earnings_date', type: 'TEXT' },
        { name: 'earnings_days_to', type: 'INTEGER' },
        { name: 'earnings_time', type: 'TEXT' },
        { name: 'opportunity_tags', type: 'TEXT' }
    ];

    for (const col of columns) {
        try {
            db.exec(`ALTER TABLE opportunities ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[OpportunityDB] Added column ${col.name} to opportunities`);
        } catch (e) {
            // Column already exists, ignore
        }
    }
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
                                   gap_percent, iv_percentile, rsi, signals,
                                   direction, call_put_ratio, net_premium,
                                   top_strikes_json, call_volume, put_volume,
                                   volume_ratio, earnings_date, earnings_days_to,
                                   earnings_time, opportunity_tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(opp.signals || []),
        opp.direction,
        opp.callPutRatio,
        opp.netPremium,
        JSON.stringify(opp.topStrikes || null),
        opp.callVolume,
        opp.putVolume,
        opp.volumeRatio,
        opp.earningsDate,
        opp.earningsDaysTo,
        opp.earningsTime,
        JSON.stringify(opp.opportunityTags || [])
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
            signals: opp.signals,
            opportunityTags: opp.opportunities,
            direction: opp.direction,
            callPutRatio: opp.unusual?.callPutRatio,
            netPremium: opp.unusual?.netPremium,
            topStrikes: opp.unusual?.topStrikes,
            callVolume: opp.unusual?.callVolume,
            putVolume: opp.unusual?.putVolume,
            volumeRatio: opp.technicals?.volumeRatio,
            earningsDate: opp.earnings?.date,
            earningsDaysTo: opp.earnings?.daysTo,
            earningsTime: opp.earnings?.time
        });
    }

    console.log(`[OpportunityDB] Saved scan: ${results.length} opportunities, scanId=${scanId}`);
    return scanId;
}

// Query helpers for future analysis
function getRecentScans(days = 7) {
    return getDb().prepare(`
        SELECT * FROM scans
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        ORDER BY timestamp DESC
    `).all(days);
}

function getTierStats(days = 7) {
    return getDb().prepare(`
        SELECT tier, COUNT(*) as count
        FROM opportunities
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY tier
    `).all(days);
}

function getTopSymbols(days = 7, limit = 10) {
    return getDb().prepare(`
        SELECT symbol, COUNT(*) as appearances, AVG(opportunity_score) as avg_score
        FROM opportunities
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY symbol
        ORDER BY appearances DESC
        LIMIT ?
    `).all(days, limit);
}

/**
 * Get latest opportunity scan with full nested structure
 * Returns data shaped identically to opportunities.json
 */
function getLatestOpportunityScan() {
    const latestScan = getDb().prepare(`
        SELECT * FROM scans ORDER BY id DESC LIMIT 1
    `).get();

    if (!latestScan) return null;

    const rows = getDb().prepare(`
        SELECT * FROM opportunities WHERE scan_id = ? ORDER BY opportunity_score DESC
    `).all(latestScan.id);

    return {
        timestamp: latestScan.timestamp,
        scannerStatus: 'running',
        scannerMode: 'dynamic',
        marketContext: {
            vix: latestScan.market_vix,
            spyPrice: latestScan.market_spy_price,
            spyTrend: latestScan.market_spy_trend
        },
        symbolsScanned: latestScan.symbols_scanned,
        results: rows.map(r => ({
            symbol: r.symbol,
            score: r.opportunity_score,
            tier: r.tier,
            price: r.price,
            direction: r.direction,
            discovery_score: r.discovery_score,
            discovery_sources: JSON.parse(r.discovery_sources || '[]'),
            signals: JSON.parse(r.signals || '[]'),
            opportunities: JSON.parse(r.opportunity_tags || '[]'),
            unusual: {
                callPutRatio: r.call_put_ratio,
                netPremium: r.net_premium,
                callVolume: r.call_volume,
                putVolume: r.put_volume,
                volOiRatio: r.vol_oi_ratio,
                topStrikes: JSON.parse(r.top_strikes_json || 'null')
            },
            technicals: {
                gap: r.gap_percent,
                ivRank: r.iv_percentile,
                rsi: r.rsi,
                volumeRatio: r.volume_ratio
            },
            earnings: r.earnings_date ? {
                date: r.earnings_date,
                daysTo: r.earnings_days_to,
                time: r.earnings_time
            } : null
        })),
        summary: {
            highConviction: rows.filter(r => r.tier === 'HIGH_CONVICTION').length,
            tradeable: rows.filter(r => r.tier === 'TRADEABLE').length,
            watch: rows.filter(r => r.tier === 'WATCH').length,
            filtered: 0
        }
    };
}

/**
 * Get recent high-scoring symbols from opportunity scanner for Bloodhound discovery.
 * Returns one row per symbol with their max score, best tier, and discovery sources.
 * @param {number} hours - Lookback window (default 24)
 * @returns {Array<{symbol: string, maxScore: number, tier: string, direction: string, sources: string[]}>}
 */
function getRecentHighScoreSymbols(hours = 24) {
    try {
        const rows = getDb().prepare(`
            SELECT symbol,
                   MAX(opportunity_score) as max_score,
                   -- Pick tier from the row with the highest score
                   (SELECT o2.tier FROM opportunities o2
                    WHERE o2.symbol = o.symbol
                      AND o2.timestamp > datetime('now', '-' || ? || ' hours')
                      AND o2.tier IN ('HIGH_CONVICTION', 'TRADEABLE')
                    ORDER BY o2.opportunity_score DESC LIMIT 1) as best_tier,
                   -- Pick direction from the row with the highest score
                   (SELECT o3.direction FROM opportunities o3
                    WHERE o3.symbol = o.symbol
                      AND o3.timestamp > datetime('now', '-' || ? || ' hours')
                      AND o3.tier IN ('HIGH_CONVICTION', 'TRADEABLE')
                    ORDER BY o3.opportunity_score DESC LIMIT 1) as direction,
                   -- Aggregate discovery sources
                   GROUP_CONCAT(DISTINCT o.discovery_sources) as all_sources,
                   -- Flow data for cross-scanner injection
                   (SELECT o4.vol_oi_ratio FROM opportunities o4
                    WHERE o4.symbol = o.symbol
                      AND o4.timestamp > datetime('now', '-' || ? || ' hours')
                      AND o4.tier IN ('HIGH_CONVICTION', 'TRADEABLE')
                    ORDER BY o4.opportunity_score DESC LIMIT 1) as vol_oi_ratio,
                   (SELECT o5.net_premium FROM opportunities o5
                    WHERE o5.symbol = o.symbol
                      AND o5.timestamp > datetime('now', '-' || ? || ' hours')
                      AND o5.tier IN ('HIGH_CONVICTION', 'TRADEABLE')
                    ORDER BY o5.opportunity_score DESC LIMIT 1) as net_premium
            FROM opportunities o
            WHERE o.timestamp > datetime('now', '-' || ? || ' hours')
              AND o.tier IN ('HIGH_CONVICTION', 'TRADEABLE')
            GROUP BY o.symbol
            ORDER BY max_score DESC
        `).all(hours, hours, hours, hours, hours);

        return rows.map(r => ({
            symbol: r.symbol,
            maxScore: r.max_score,
            tier: r.best_tier,
            direction: r.direction,
            sources: parseSources(r.all_sources),
            vol_oi_ratio: r.vol_oi_ratio,
            net_premium: r.net_premium
        }));
    } catch (err) {
        console.error(`[OpportunityDB] getRecentHighScoreSymbols error: ${err.message}`);
        return [];
    }
}

/** Parse concatenated JSON source arrays into a flat deduplicated array */
function parseSources(allSources) {
    if (!allSources) return [];
    const set = new Set();
    for (const chunk of allSources.split(',')) {
        try {
            const arr = JSON.parse(chunk);
            if (Array.isArray(arr)) arr.forEach(s => set.add(s));
        } catch { /* skip malformed */ }
    }
    return Array.from(set);
}

module.exports = {
    getDb,
    saveScanResults,
    getRecentScans,
    getTierStats,
    getTopSymbols,
    getLatestOpportunityScan,
    getRecentHighScoreSymbols
};
