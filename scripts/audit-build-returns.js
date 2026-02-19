#!/usr/bin/env node

/**
 * AUDIT: Build Forward Returns Dataset
 *
 * Fetches daily OHLCV for all symbols in bloodhound_results + opportunities,
 * computes 1d/3d/5d forward returns, stores in audit_returns table.
 *
 * This is the foundation for all downstream analysis scripts.
 *
 * Usage:
 *   node scripts/audit-build-returns.js           # Build dataset (uses cache)
 *   node scripts/audit-build-returns.js --fresh    # Force re-fetch all history
 */

const {
    getDb, closeDb, fetchHistory, buildDateIndex, computeForwardReturns,
    sleep, HOLD_DAYS, COLORS, printHeader, hasFlag
} = require('./lib/audit-utils');

const args = process.argv.slice(2);
const FRESH = hasFlag(args, '--fresh');

// ─── Schema ──────────────────────────────────────────────────────────────────

function initSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audit_returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            close_price REAL NOT NULL,
            return_1d REAL,
            return_3d REAL,
            return_5d REAL,
            max_gain_5d REAL,
            max_drawdown_5d REAL,
            UNIQUE(symbol, date)
        );
        CREATE INDEX IF NOT EXISTS idx_audit_returns_symbol_date
            ON audit_returns(symbol, date);
    `);
}

// ─── Unique Symbols ──────────────────────────────────────────────────────────

function getUniqueSymbols(db) {
    const rows = db.prepare(`
        SELECT DISTINCT symbol FROM (
            SELECT DISTINCT r.symbol
            FROM bloodhound_results r
            UNION
            SELECT DISTINCT o.symbol
            FROM opportunities o
            UNION
            SELECT DISTINCT s.symbol
            FROM signals s
            UNION
            SELECT DISTINCT sh.symbol
            FROM scanner_history sh
        )
        ORDER BY symbol
    `).all();
    return rows.map(r => r.symbol);
}

// ─── Observation Dates ───────────────────────────────────────────────────────

function getObservationDates(db, symbol) {
    const rows = db.prepare(`
        SELECT DISTINCT date_val FROM (
            SELECT DISTINCT date(s.timestamp) as date_val
            FROM bloodhound_results r
            JOIN bloodhound_scans s ON r.scan_id = s.id
            WHERE r.symbol = ?
            UNION
            SELECT DISTINCT date(o.timestamp) as date_val
            FROM opportunities o
            WHERE o.symbol = ?
            UNION
            SELECT DISTINCT date(s.timestamp) as date_val
            FROM signals s
            WHERE s.symbol = ?
            UNION
            SELECT DISTINCT sh.date as date_val
            FROM scanner_history sh
            WHERE sh.symbol = ?
        )
        ORDER BY date_val
    `).all(symbol, symbol, symbol, symbol);
    return rows.map(r => r.date_val);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const startTime = Date.now();
    const db = getDb();
    initSchema(db);

    printHeader('AUDIT: Building Forward Returns Dataset');

    // Get existing count
    const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM audit_returns').get().cnt;
    if (existingCount > 0 && !FRESH) {
        console.log(`  Existing audit_returns: ${existingCount} rows`);
        console.log(`  Use --fresh to rebuild from scratch\n`);
    }

    if (FRESH) {
        db.exec('DELETE FROM audit_returns');
        console.log('  Cleared existing audit_returns (--fresh mode)\n');
    }

    const symbols = getUniqueSymbols(db);
    console.log(`  Unique symbols to process: ${symbols.length}`);

    const insert = db.prepare(`
        INSERT OR IGNORE INTO audit_returns
            (symbol, date, close_price, return_1d, return_3d, return_5d, max_gain_5d, max_drawdown_5d)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalInserted = 0;
    let totalSkipped = 0;
    let fetchCount = 0;
    let cacheCount = 0;
    let failCount = 0;

    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const pct = ((i + 1) / symbols.length * 100).toFixed(0);
        process.stdout.write(`\r  [${pct}%] Processing ${symbol.padEnd(8)} (${i + 1}/${symbols.length})`);

        // Fetch history
        const candles = await fetchHistory(symbol, FRESH);
        if (!candles || candles.length < 10) {
            failCount++;
            continue;
        }

        // Track cache vs fetch
        const fs = require('fs');
        const path = require('path');
        const cacheAge = (() => {
            try {
                const stat = fs.statSync(path.join(__dirname, '..', 'data', 'history', `${symbol}_daily.json`));
                return (Date.now() - stat.mtimeMs) / 1000;
            } catch { return 999999; }
        })();
        if (cacheAge < 5) fetchCount++; // just written = was fetched
        else cacheCount++;

        const dateIndex = buildDateIndex(candles);
        const dates = getObservationDates(db, symbol);

        let symbolInserted = 0;
        for (const dateStr of dates) {
            const returns = computeForwardReturns(candles, dateIndex, dateStr);
            if (!returns) {
                totalSkipped++;
                continue;
            }

            const result = insert.run(
                symbol, dateStr, returns.close_price,
                returns.return_1d, returns.return_3d, returns.return_5d,
                returns.max_gain_5d, returns.max_drawdown_5d
            );
            if (result.changes > 0) symbolInserted++;
        }

        totalInserted += symbolInserted;

        // API pacing — 200ms between symbols (only if we actually fetched)
        if (cacheAge < 5) await sleep(200);
    }

    // Final count
    const finalCount = db.prepare('SELECT COUNT(*) as cnt FROM audit_returns').get().cnt;

    // Summary
    console.log('\n');
    printHeader('Build Complete');
    console.log(`  Symbols processed:  ${symbols.length}`);
    console.log(`    From cache:       ${cacheCount}`);
    console.log(`    API fetched:      ${fetchCount}`);
    console.log(`    Failed:           ${failCount}`);
    console.log(`  Rows inserted:      ${totalInserted}`);
    console.log(`  Rows skipped:       ${totalSkipped} (date not in history or duplicate)`);
    console.log(`  Total in table:     ${COLORS.bold}${finalCount}${COLORS.reset}`);

    // Date range
    const range = db.prepare('SELECT MIN(date) as min_date, MAX(date) as max_date FROM audit_returns').get();
    console.log(`  Date range:         ${range.min_date} to ${range.max_date}`);

    // Returns coverage
    const coverage = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN return_1d IS NOT NULL THEN 1 ELSE 0 END) as has_1d,
            SUM(CASE WHEN return_3d IS NOT NULL THEN 1 ELSE 0 END) as has_3d,
            SUM(CASE WHEN return_5d IS NOT NULL THEN 1 ELSE 0 END) as has_5d
        FROM audit_returns
    `).get();
    console.log(`  With 1d returns:    ${coverage.has_1d}/${coverage.total}`);
    console.log(`  With 3d returns:    ${coverage.has_3d}/${coverage.total}`);
    console.log(`  With 5d returns:    ${coverage.has_5d}/${coverage.total}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Completed in ${elapsed}s\n`);
}

main().catch(e => {
    console.error('\nFatal error:', e.message);
    process.exit(1);
});
