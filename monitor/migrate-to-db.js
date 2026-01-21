#!/usr/bin/env node
/**
 * DATABASE MIGRATION SCRIPT
 *
 * Migrates existing JSON data to SQLite database.
 * Run once to consolidate signal_log.json and scanner_history.json into opportunity_history.db.
 *
 * Usage: node monitor/migrate-to-db.js
 *
 * This script:
 * 1. Migrates signal_log.json → signals + checkpoints tables
 * 2. Migrates scanner_history.json → scanner_history table
 * 3. Creates backup of original files in data/archive/
 * 4. Reports migration statistics
 */

const fs = require('fs');
const path = require('path');
const signalDb = require('./signal-db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

// Ensure archive directory exists
if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function log(msg) {
    console.log(`[Migration] ${msg}`);
}

function logError(msg) {
    console.error(`[Migration ERROR] ${msg}`);
}

/**
 * Migrate signal_log.json to database
 */
function migrateSignalLog() {
    const signalLogPath = path.join(DATA_DIR, 'signal_log.json');

    if (!fs.existsSync(signalLogPath)) {
        log('signal_log.json not found, skipping...');
        return { migrated: 0, skipped: 0, errors: 0 };
    }

    log('Reading signal_log.json...');
    const signalLog = JSON.parse(fs.readFileSync(signalLogPath, 'utf8'));

    if (!signalLog.signals || !Array.isArray(signalLog.signals)) {
        log('No signals array found in signal_log.json');
        return { migrated: 0, skipped: 0, errors: 0 };
    }

    log(`Found ${signalLog.signals.length} signals to migrate`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const signal of signalLog.signals) {
        try {
            // Insert signal into database
            const inserted = signalDb.insertSignal({
                id: signal.id,
                timestamp: signal.timestamp,
                symbol: signal.symbol,
                direction: signal.direction,
                entry_price: signal.entry_price,
                score: signal.score,
                zone: signal.zone,
                tier: 'HIGH_CONVICTION', // All logged signals were HIGH_CONVICTION
                signals: signal.signals,
                vix: signal.context?.vix,
                vix_regime: signal.context?.vix_regime,
                spy_trend: signal.context?.spy_trend,
                gamma_regime: signal.context?.gamma_regime,
                signal_type: 'HIGH_CONVICTION',
                history_status: null,
                consecutive_days: null
            });

            if (!inserted) {
                skipped++;
                continue;
            }

            // If already validated in JSON, record as 4h checkpoint
            if (signal.validated && signal.current_price) {
                try {
                    signalDb.recordCheckpoint(signal.id, '4h', signal.current_price);

                    // If marked incorrect, close the signal
                    if (signal.correct === false) {
                        signalDb.closeSignal(signal.id, 'LOSS', 'migrated_from_json');
                    } else if (signal.correct === true) {
                        // Keep active for further checkpoints (24h, 7d)
                    }
                } catch (e) {
                    logError(`Failed to record checkpoint for ${signal.id}: ${e.message}`);
                }
            }

            migrated++;
        } catch (e) {
            logError(`Failed to migrate signal ${signal.id}: ${e.message}`);
            errors++;
        }
    }

    // Archive original file
    const archivePath = path.join(ARCHIVE_DIR, `signal_log_${Date.now()}.json`);
    fs.copyFileSync(signalLogPath, archivePath);
    log(`Archived original to ${archivePath}`);

    return { migrated, skipped, errors };
}

/**
 * Migrate scanner_history.json to database
 */
function migrateScannerHistory() {
    const historyPath = path.join(DATA_DIR, 'scanner_history.json');

    if (!fs.existsSync(historyPath)) {
        log('scanner_history.json not found, skipping...');
        return { migrated: 0, skipped: 0, errors: 0 };
    }

    log('Reading scanner_history.json...');
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

    if (!history.symbols || typeof history.symbols !== 'object') {
        log('No symbols object found in scanner_history.json');
        return { migrated: 0, skipped: 0, errors: 0 };
    }

    const symbolCount = Object.keys(history.symbols).length;
    log(`Found ${symbolCount} symbols to migrate`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const [symbol, data] of Object.entries(history.symbols)) {
        if (!data.daily_snapshots || !Array.isArray(data.daily_snapshots)) {
            skipped++;
            continue;
        }

        for (const snapshot of data.daily_snapshots) {
            try {
                signalDb.upsertScannerHistory(symbol, snapshot.date, {
                    first_seen: data.first_seen,
                    score: snapshot.peak_score,
                    zone: snapshot.scanner_data?.peak_zone,
                    price: snapshot.price_action?.vwap,
                    gap_pct: snapshot.price_action?.gap_from_prev_pct || 0,
                    rsi: snapshot.technicals_eod?.rsi
                });
                migrated++;
            } catch (e) {
                logError(`Failed to migrate ${symbol} ${snapshot.date}: ${e.message}`);
                errors++;
            }
        }
    }

    // Archive original file
    const archivePath = path.join(ARCHIVE_DIR, `scanner_history_${Date.now()}.json`);
    fs.copyFileSync(historyPath, archivePath);
    log(`Archived original to ${archivePath}`);

    return { migrated, skipped, errors };
}

/**
 * Migrate signal_tracking.json (if exists)
 */
function migrateSignalTracking() {
    const trackingPath = path.join(DATA_DIR, 'signal_tracking.json');

    if (!fs.existsSync(trackingPath)) {
        log('signal_tracking.json not found, skipping...');
        return { archived: false };
    }

    // Just archive it - this data is redundant with signals table
    const archivePath = path.join(ARCHIVE_DIR, `signal_tracking_${Date.now()}.json`);
    fs.copyFileSync(trackingPath, archivePath);
    log(`Archived signal_tracking.json to ${archivePath}`);

    return { archived: true };
}

/**
 * Archive alerts_log.json (deprecated)
 */
function archiveAlertsLog() {
    const alertsPath = path.join(DATA_DIR, 'alerts_log.json');

    if (!fs.existsSync(alertsPath)) {
        log('alerts_log.json not found, skipping...');
        return { archived: false };
    }

    const archivePath = path.join(ARCHIVE_DIR, `alerts_log_${Date.now()}.json`);
    fs.copyFileSync(alertsPath, archivePath);
    log(`Archived alerts_log.json to ${archivePath}`);

    return { archived: true };
}

/**
 * Main migration function
 */
async function runMigration() {
    console.log('');
    console.log('='.repeat(60));
    console.log('  DATABASE MIGRATION - Wingman Trading System');
    console.log('='.repeat(60));
    console.log('');

    // Check if database already has data
    const stats = signalDb.getDatabaseStats();
    if (stats.total_signals > 0) {
        log(`Database already contains ${stats.total_signals} signals.`);
        log('To re-run migration, manually clear the signals table first.');
        log('Continuing to migrate any new data...');
    }

    console.log('');
    log('Phase 1: Migrating signal_log.json...');
    const signalResults = migrateSignalLog();
    log(`  Migrated: ${signalResults.migrated}, Skipped: ${signalResults.skipped}, Errors: ${signalResults.errors}`);

    console.log('');
    log('Phase 2: Migrating scanner_history.json...');
    const historyResults = migrateScannerHistory();
    log(`  Migrated: ${historyResults.migrated} daily snapshots, Skipped: ${historyResults.skipped}, Errors: ${historyResults.errors}`);

    console.log('');
    log('Phase 3: Archiving other JSON files...');
    migrateSignalTracking();
    archiveAlertsLog();

    console.log('');
    log('Phase 4: Verifying database...');
    const finalStats = signalDb.getDatabaseStats();
    console.log('');
    console.log('  Final Database Stats:');
    console.log(`    Total Signals:     ${finalStats.total_signals}`);
    console.log(`    Active Signals:    ${finalStats.active_signals}`);
    console.log(`    Total Checkpoints: ${finalStats.total_checkpoints}`);
    console.log(`    Price Snapshots:   ${finalStats.total_snapshots}`);
    console.log(`    Oldest Signal:     ${finalStats.oldest_signal || 'N/A'}`);
    console.log(`    Newest Signal:     ${finalStats.newest_signal || 'N/A'}`);

    console.log('');
    console.log('='.repeat(60));
    console.log('  MIGRATION COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    console.log('Next steps:');
    console.log('  1. Verify data in database: sqlite3 data/opportunity_history.db ".tables"');
    console.log('  2. Check signal count: sqlite3 data/opportunity_history.db "SELECT COUNT(*) FROM signals"');
    console.log('  3. Restart Bloodhound scanner: pm2 restart bloodhound');
    console.log('');
    console.log('Archived files are in: data/archive/');
    console.log('Original JSON files are preserved (can be deleted after verification).');
    console.log('');
}

// Run if called directly
if (require.main === module) {
    runMigration().catch(e => {
        logError(`Migration failed: ${e.message}`);
        console.error(e);
        process.exit(1);
    });
}

module.exports = { runMigration, migrateSignalLog, migrateScannerHistory };
