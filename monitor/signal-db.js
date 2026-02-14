/**
 * SIGNAL DATABASE - SQLite Storage for Signal Validation
 *
 * Multi-checkpoint validation system:
 * - 4h checkpoint: Short-term signal accuracy
 * - 24h checkpoint: Intraday/overnight accuracy
 * - 7d checkpoint: Swing trade accuracy
 *
 * Tracks peak gain and max drawdown throughout the lifecycle.
 * ALL data is preserved permanently - no deletions, no overwrites.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Central Wingman database - all scanner data, signals, watchlist, history
const DB_PATH = path.join(__dirname, '..', 'data', 'wingman.db');

// Valid checkpoint types - whitelist for SQL injection prevention
const VALID_CHECKPOINT_TYPES = ['4h', '24h', '7d'];
const CHECKPOINT_HOURS = { '4h': 4, '24h': 24, '7d': 168 };

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
        -- Core signals table
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signal_id TEXT UNIQUE NOT NULL,
            timestamp TEXT NOT NULL,
            symbol TEXT NOT NULL,
            direction TEXT NOT NULL,
            entry_price REAL NOT NULL,
            score INTEGER,
            zone TEXT,
            tier TEXT,
            signals_json TEXT,

            -- Market context at entry
            vix REAL,
            vix_regime TEXT,
            spy_trend TEXT,
            spy_price REAL,
            gamma_regime TEXT,
            intraday_bias TEXT,

            -- Price tracking (updated each scan)
            current_price REAL,
            peak_price REAL,
            trough_price REAL,
            peak_gain_pct REAL DEFAULT 0,
            max_drawdown_pct REAL DEFAULT 0,
            last_updated TEXT,

            -- Checkpoint validation status
            checkpoint_4h_done INTEGER DEFAULT 0,
            checkpoint_24h_done INTEGER DEFAULT 0,
            checkpoint_7d_done INTEGER DEFAULT 0,

            -- Validation tracking (for signal-logger compatibility)
            validated INTEGER DEFAULT 0,
            validated_at TEXT,
            correct INTEGER,

            -- History context (for paper trade compatibility)
            signal_type TEXT,
            history_status TEXT,
            consecutive_days INTEGER,

            -- Final status
            status TEXT DEFAULT 'active',
            final_outcome TEXT,
            closed_at TEXT
        );

        -- Checkpoint snapshots (immutable history)
        CREATE TABLE IF NOT EXISTS checkpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signal_id TEXT NOT NULL,
            checkpoint_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            hours_elapsed REAL,
            price REAL NOT NULL,
            pct_change REAL NOT NULL,
            peak_gain_at_checkpoint REAL,
            max_drawdown_at_checkpoint REAL,
            direction_correct INTEGER,

            FOREIGN KEY (signal_id) REFERENCES signals(signal_id)
        );

        -- Price history for detailed analysis
        CREATE TABLE IF NOT EXISTS price_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signal_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            hours_elapsed REAL,
            price REAL NOT NULL,
            pct_change REAL NOT NULL,

            FOREIGN KEY (signal_id) REFERENCES signals(signal_id)
        );

        -- Scanner history for Day 2/Streak badge tracking
        CREATE TABLE IF NOT EXISTS scanner_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            first_seen TEXT,
            scans_today INTEGER DEFAULT 0,
            peak_score INTEGER,
            peak_zone TEXT,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            gap_pct REAL,
            rsi_eod REAL,
            -- Trend columns (added 2026-02-02)
            trend TEXT,              -- Symbol's own trend: strong_uptrend/uptrend/neutral/downtrend/strong_downtrend
            direction TEXT,          -- bullish/bearish/pinned/neutral
            spy_trend TEXT,          -- Market trend at time: bullish/bearish/neutral
            vix REAL,                -- VIX level
            vix_regime TEXT,         -- complacent/normal/elevated/fear/capitulation
            UNIQUE(symbol, date)
        );

        -- Pre-market scans table
        CREATE TABLE IF NOT EXISTS premarket_scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            market_open INTEGER DEFAULT 0,
            es_price REAL,
            es_change_pct REAL,
            nq_price REAL,
            nq_change_pct REAL,
            vix REAL,
            market_bias TEXT,
            scan_summary TEXT
        );

        -- Pre-market gaps/movers
        CREATE TABLE IF NOT EXISTS premarket_movers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            symbol TEXT NOT NULL,
            prev_close REAL,
            premarket_price REAL,
            gap_pct REAL,
            premarket_volume INTEGER,
            gap_type TEXT,
            catalyst TEXT,
            tier TEXT,
            score INTEGER,
            -- EOD tracking (filled by eod-gap-tracker.js)
            eod_close REAL,
            intraday_high REAL,
            intraday_low REAL,
            gap_filled INTEGER DEFAULT 0,
            fill_time TEXT,
            eod_change_pct REAL,
            outcome TEXT,
            eod_updated_at TEXT,
            FOREIGN KEY (scan_id) REFERENCES premarket_scans(id)
        );

        -- Gap ticker stats (aggregated analytics)
        CREATE TABLE IF NOT EXISTS gap_ticker_stats (
            symbol TEXT PRIMARY KEY,
            total_gaps INTEGER DEFAULT 0,
            total_gaps_up INTEGER DEFAULT 0,
            total_gaps_down INTEGER DEFAULT 0,
            avg_gap_pct REAL,
            fill_count INTEGER DEFAULT 0,
            fill_rate REAL,
            avg_follow_through REAL,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            win_rate REAL,
            last_gap_date TEXT,
            last_gap_pct REAL,
            updated_at TEXT
        );

        -- Watchlist table (replaces watchlist.json)
        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            enabled INTEGER DEFAULT 1,
            notes TEXT,
            source TEXT DEFAULT 'manual',
            added_at TEXT NOT NULL,
            added_by TEXT,
            gap_pct REAL,
            score_at_add INTEGER,
            tier_at_add TEXT,
            expires_at TEXT,
            last_scanned TEXT
        );

        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
        CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
        CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
        CREATE INDEX IF NOT EXISTS idx_signals_tier ON signals(tier);
        CREATE INDEX IF NOT EXISTS idx_signals_direction ON signals(direction);
        CREATE INDEX IF NOT EXISTS idx_signals_vix_regime ON signals(vix_regime);
        CREATE INDEX IF NOT EXISTS idx_signals_symbol_date ON signals(symbol, date(timestamp));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_one_active_per_symbol ON signals(symbol) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_checkpoints_signal ON checkpoints(signal_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_type ON checkpoints(checkpoint_type);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_signal_type ON checkpoints(signal_id, checkpoint_type);
        CREATE INDEX IF NOT EXISTS idx_price_snapshots_signal ON price_snapshots(signal_id);
        CREATE INDEX IF NOT EXISTS idx_scanner_history_symbol ON scanner_history(symbol);
        CREATE INDEX IF NOT EXISTS idx_scanner_history_date ON scanner_history(date);
        CREATE INDEX IF NOT EXISTS idx_premarket_scans_timestamp ON premarket_scans(timestamp);
        CREATE INDEX IF NOT EXISTS idx_premarket_movers_symbol ON premarket_movers(symbol);
        CREATE INDEX IF NOT EXISTS idx_premarket_movers_scan ON premarket_movers(scan_id);
        CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist(symbol);
        CREATE INDEX IF NOT EXISTS idx_watchlist_enabled ON watchlist(enabled);
        CREATE INDEX IF NOT EXISTS idx_watchlist_source ON watchlist(source);
        CREATE INDEX IF NOT EXISTS idx_gap_ticker_stats_symbol ON gap_ticker_stats(symbol);

        -- Bloodhound scan metadata (replaces scanner.json header)
        CREATE TABLE IF NOT EXISTS bloodhound_scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            vix REAL,
            vix_regime TEXT,
            spy_trend TEXT,
            spy_price REAL,
            risk_appetite TEXT,
            regime TEXT,
            position_size_modifier REAL,
            spy_levels_json TEXT,
            qqq_levels_json TEXT,
            scan_count INTEGER,
            tradeable_count INTEGER,
            alerts_sent INTEGER,
            watchlist_count INTEGER,
            sources_json TEXT
        );

        -- Individual ticker results (replaces dynamic_scan.json results array)
        CREATE TABLE IF NOT EXISTS bloodhound_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            price REAL,
            zone TEXT,
            tradeable INTEGER,
            action TEXT,
            put_wall REAL,
            call_wall REAL,
            max_pain REAL,
            gamma_flip REAL,
            vwap REAL,
            to_put_wall REAL,
            to_call_wall REAL,
            position_in_range REAL,
            rsi REAL,
            trend TEXT,
            momentum_5d REAL,
            momentum_20d REAL,
            bb_position REAL,
            volume_signal TEXT,
            fibonacci_json TEXT,
            score INTEGER,
            direction TEXT,
            tier TEXT,
            signals_json TEXT,
            is_watchlist INTEGER,
            sources_json TEXT,
            history_label TEXT,
            consecutive_days INTEGER,
            history_trend TEXT,
            reasoning_json TEXT,
            FOREIGN KEY (scan_id) REFERENCES bloodhound_scans(id)
        );

        CREATE INDEX IF NOT EXISTS idx_bloodhound_scans_timestamp ON bloodhound_scans(timestamp);
        CREATE INDEX IF NOT EXISTS idx_bloodhound_results_scan_id ON bloodhound_results(scan_id);
        CREATE INDEX IF NOT EXISTS idx_bloodhound_results_symbol ON bloodhound_results(symbol);
    `);

    // Earnings scanner tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS earnings_scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            strategy TEXT,
            total_scanned INTEGER,
            high_conviction_count INTEGER,
            tradeable_count INTEGER
        );

        CREATE TABLE IF NOT EXISTS earnings_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            earnings_date TEXT,
            days_to_earnings INTEGER,
            earnings_time TEXT,
            score INTEGER,
            direction TEXT,
            tier TEXT,
            signals_json TEXT,
            price REAL,
            rsi REAL,
            trend TEXT,
            iv_rank REAL,
            iv_percentile REAL,
            spy_trend TEXT,
            vix REAL,
            call_premium REAL,
            put_premium REAL,
            net_delta REAL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (scan_id) REFERENCES earnings_scans(id)
        );

        CREATE INDEX IF NOT EXISTS idx_earnings_scans_timestamp ON earnings_scans(timestamp);
        CREATE INDEX IF NOT EXISTS idx_earnings_results_scan_id ON earnings_results(scan_id);
        CREATE INDEX IF NOT EXISTS idx_earnings_results_symbol ON earnings_results(symbol);
    `);

    // Positions table (replaces positions.json)
    db.exec(`
        CREATE TABLE IF NOT EXISTS positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            direction TEXT NOT NULL,
            strategy TEXT,
            entry_price REAL NOT NULL,
            stop_price REAL,
            target_price REAL,
            shares INTEGER,
            entry_date TEXT NOT NULL,
            status TEXT DEFAULT 'open',
            exit_price REAL,
            exit_date TEXT,
            exit_reason TEXT,
            pnl REAL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
        CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
    `);

    // Market internals table (TICK, TRIN, breadth, volume, VIX, indices)
    db.exec(`
        CREATE TABLE IF NOT EXISTS market_internals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            date TEXT NOT NULL,
            tick REAL, tick_high REAL, tick_low REAL,
            trin REAL, advn REAL, decn REAL, ad_spread REAL,
            uvol REAL, dvol REAL, vol_ratio REAL,
            vix REAL, vix_open REAL, vix_high REAL, vix_low REAL, vix_change REAL, vix_change_pct REAL,
            spx REAL, spx_change REAL, spx_change_pct REAL, spx_high REAL, spx_low REAL,
            compx REAL, compx_change REAL, compx_change_pct REAL,
            dji REAL, dji_change REAL, dji_change_pct REAL
        );

        CREATE INDEX IF NOT EXISTS idx_market_internals_timestamp ON market_internals(timestamp);
        CREATE INDEX IF NOT EXISTS idx_market_internals_date ON market_internals(date);
    `);

    // Analysis journal table (research deep-dives)
    db.exec(`
        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            analysis_date TEXT NOT NULL,
            score INTEGER,
            tier TEXT,
            direction TEXT,
            verdict TEXT NOT NULL,
            price_at_analysis REAL,
            bull_factors_json TEXT,
            bull_summary TEXT,
            bear_factors_json TEXT,
            bear_summary TEXT,
            sector_etf TEXT,
            sector_rsi REAL,
            sector_rs_percentile REAL,
            rotation_phase TEXT,
            put_wall REAL,
            call_wall REAL,
            max_pain REAL,
            target_price REAL,
            stop_price REAL,
            vix REAL,
            vix_regime TEXT,
            spy_trend TEXT,
            spy_price REAL,
            verdict_reasoning TEXT,
            outcome TEXT,
            outcome_price REAL,
            outcome_date TEXT,
            outcome_notes TEXT,
            outcome_pct_change REAL,
            thesis_correct INTEGER,
            tags TEXT,
            source TEXT DEFAULT 'manual',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_symbol ON analyses(symbol);
        CREATE INDEX IF NOT EXISTS idx_analyses_date ON analyses(analysis_date);
        CREATE INDEX IF NOT EXISTS idx_analyses_verdict ON analyses(verdict);
        CREATE INDEX IF NOT EXISTS idx_analyses_outcome ON analyses(outcome);
    `);

    // Migration: Add decn and ad_spread columns to existing market_internals table
    migrateMarketInternals();

    // Migration: Add EOD columns to existing premarket_movers table
    migratePremarketMovers();

    // Migration: Add trend columns to existing scanner_history table
    migrateScannerHistory();

    // Migration: Create alerts table
    migrateAlerts();

    // Migration: Add option signal tracking columns
    migrateOptionTracking();

    // Migration: Add internals snapshot columns to signals table
    migrateSignalInternals();

    // Migration: Add sector RS columns to bloodhound_results table
    migrateBloodhoundRS();
}

/**
 * Add trend columns to existing scanner_history table
 */
function migrateScannerHistory() {
    const columns = [
        { name: 'trend', type: 'TEXT' },
        { name: 'direction', type: 'TEXT' },
        { name: 'spy_trend', type: 'TEXT' },
        { name: 'vix', type: 'REAL' },
        { name: 'vix_regime', type: 'TEXT' },
        // New columns for full JSON migration
        { name: 'vwap', type: 'REAL' },
        { name: 'range_pct', type: 'REAL' },
        { name: 'volume_ratio', type: 'REAL' },
        { name: 'volume_avg_20d', type: 'REAL' },
        { name: 'peak_direction', type: 'TEXT' },
        { name: 'peak_signals_json', type: 'TEXT' },
        { name: 'time_in_scanner_mins', type: 'INTEGER' },
        { name: 'above_20ema', type: 'INTEGER' },
        { name: 'above_50sma', type: 'INTEGER' },
        { name: 'bb_position', type: 'TEXT' },
        { name: 'velocity', type: 'REAL' }
    ];

    for (const col of columns) {
        try {
            db.exec(`ALTER TABLE scanner_history ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to scanner_history`);
        } catch (e) {
            // Column already exists, ignore
        }
    }

    // Create indexes for trend analysis
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_scanner_history_trend ON scanner_history(trend)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_scanner_history_spy_trend ON scanner_history(spy_trend)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_scanner_history_vix_regime ON scanner_history(vix_regime)');
    } catch (e) {
        // Indexes already exist, ignore
    }
}

/**
 * Create alerts table for VIX regime changes and other alerts
 */
function migrateAlerts() {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                type TEXT NOT NULL,
                priority TEXT,
                symbol TEXT,
                message TEXT NOT NULL,
                details_json TEXT
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type)');
    } catch (e) {
        // Table/indexes already exist, ignore
    }
}

/**
 * Add EOD tracking columns to existing premarket_movers table
 */
function migrateMarketInternals() {
    const columns = [
        { name: 'decn', type: 'REAL' },
        { name: 'ad_spread', type: 'REAL' }
    ];

    for (const col of columns) {
        try {
            db.exec(`ALTER TABLE market_internals ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to market_internals`);
        } catch (e) {
            // Column already exists, ignore
        }
    }
}

function migratePremarketMovers() {
    const columns = [
        { name: 'eod_close', type: 'REAL' },
        { name: 'intraday_high', type: 'REAL' },
        { name: 'intraday_low', type: 'REAL' },
        { name: 'gap_filled', type: 'INTEGER DEFAULT 0' },
        { name: 'fill_time', type: 'TEXT' },
        { name: 'eod_change_pct', type: 'REAL' },
        { name: 'outcome', type: 'TEXT' },
        { name: 'eod_updated_at', type: 'TEXT' }
    ];

    for (const col of columns) {
        try {
            db.exec(`ALTER TABLE premarket_movers ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to premarket_movers`);
        } catch (e) {
            // Column already exists, ignore
        }
    }

    // Create indexes for new columns (after they exist)
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_premarket_movers_outcome ON premarket_movers(outcome)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_premarket_movers_gap_filled ON premarket_movers(gap_filled)');
    } catch (e) {
        // Indexes already exist, ignore
    }
}

/**
 * Add option signal tracking columns to signals and price_snapshots tables
 * Tracks unusual option contracts flagged by Bloodhound alerts
 */
function migrateOptionTracking() {
    // Option tracking columns on signals table
    const signalColumns = [
        { name: 'option_contract', type: 'TEXT' },
        { name: 'option_type', type: 'TEXT' },
        { name: 'option_strike', type: 'REAL' },
        { name: 'option_expiration', type: 'TEXT' },
        { name: 'option_dte', type: 'INTEGER' },
        { name: 'option_premium_entry', type: 'REAL' },
        { name: 'option_delta_entry', type: 'REAL' },
        { name: 'option_iv_entry', type: 'REAL' },
        { name: 'option_vol_oi', type: 'REAL' },
        { name: 'option_premium_flow', type: 'REAL' },
        { name: 'option_premium_peak', type: 'REAL' },
        { name: 'option_premium_peak_time', type: 'TEXT' },
        { name: 'option_premium_close', type: 'REAL' },
        { name: 'option_peak_gain_pct', type: 'REAL' },
        { name: 'option_close_gain_pct', type: 'REAL' },
        { name: 'option_hit_wall', type: 'INTEGER DEFAULT 0' },
        { name: 'option_outcome', type: 'TEXT' }
    ];

    for (const col of signalColumns) {
        try {
            db.exec(`ALTER TABLE signals ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to signals`);
        } catch (e) {
            // Column already exists, ignore
        }
    }

    // Option price columns on price_snapshots table
    const snapshotColumns = [
        { name: 'option_bid', type: 'REAL' },
        { name: 'option_ask', type: 'REAL' },
        { name: 'option_mark', type: 'REAL' },
        { name: 'option_gain_pct', type: 'REAL' }
    ];

    for (const col of snapshotColumns) {
        try {
            db.exec(`ALTER TABLE price_snapshots ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to price_snapshots`);
        } catch (e) {
            // Column already exists, ignore
        }
    }

    // Indexes for option signal queries
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_signals_option_contract ON signals(option_contract)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_signals_option_outcome ON signals(option_outcome)');
    } catch (e) {
        // Indexes already exist, ignore
    }
}

/**
 * Add market internals snapshot columns to signals table
 * Captures TICK/TRIN/A/D/Vol Ratio at signal entry for backtesting
 */
function migrateSignalInternals() {
    const columns = [
        { name: 'tick_at_entry', type: 'REAL' },
        { name: 'trin_at_entry', type: 'REAL' },
        { name: 'ad_spread_at_entry', type: 'REAL' },
        { name: 'vol_ratio_at_entry', type: 'REAL' }
    ];

    for (const col of columns) {
        try {
            db.exec(`ALTER TABLE signals ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to signals`);
        } catch (e) {
            // Column already exists, ignore
        }
    }
}

/**
 * Add sector RS columns to bloodhound_results table
 * For divergence scanner integration (relative strength scoring)
 */
function migrateBloodhoundRS() {
    const columns = [
        { name: 'sector_rs_percentile', type: 'REAL' },
        { name: 'sector_etf', type: 'TEXT' }
    ];

    for (const col of columns) {
        try {
            db.exec(`ALTER TABLE bloodhound_results ADD COLUMN ${col.name} ${col.type}`);
            console.log(`[SignalDB] Added column ${col.name} to bloodhound_results`);
        } catch (e) {
            // Column already exists, ignore
        }
    }
}

/**
 * Validate checkpoint type to prevent SQL injection
 */
function validateCheckpointType(checkpointType) {
    if (!VALID_CHECKPOINT_TYPES.includes(checkpointType)) {
        throw new Error(`Invalid checkpoint type: ${checkpointType}. Must be one of: ${VALID_CHECKPOINT_TYPES.join(', ')}`);
    }
    return true;
}

/**
 * Insert a new signal
 */
function insertSignal(signalData) {
    const stmt = getDb().prepare(`
        INSERT INTO signals (
            signal_id, timestamp, symbol, direction, entry_price,
            score, zone, tier, signals_json,
            vix, vix_regime, spy_trend, spy_price, gamma_regime, intraday_bias,
            current_price, peak_price, trough_price, last_updated,
            signal_type, history_status, consecutive_days,
            option_contract, option_type, option_strike, option_expiration,
            option_dte, option_premium_entry, option_delta_entry, option_iv_entry,
            option_vol_oi, option_premium_flow,
            option_premium_peak, option_premium_peak_time,
            tick_at_entry, trin_at_entry, ad_spread_at_entry, vol_ratio_at_entry,
            status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, 'active')
    `);

    try {
        // Option premium entry initializes peak if available
        const premEntry = signalData.option_premium_entry || null;
        stmt.run(
            signalData.id,
            signalData.timestamp,
            signalData.symbol,
            signalData.direction,
            signalData.entry_price,
            signalData.score,
            signalData.zone,
            signalData.tier,
            JSON.stringify(signalData.signals || []),
            signalData.vix,
            signalData.vix_regime,
            signalData.spy_trend,
            signalData.spy_price,
            signalData.gamma_regime,
            signalData.intraday_bias,
            signalData.entry_price,  // current_price starts at entry
            signalData.entry_price,  // peak starts at entry
            signalData.entry_price,  // trough starts at entry
            signalData.timestamp,
            signalData.signal_type || null,
            signalData.history_status || null,
            signalData.consecutive_days || null,
            // Option tracking fields
            signalData.option_contract || null,
            signalData.option_type || null,
            signalData.option_strike || null,
            signalData.option_expiration || null,
            signalData.option_dte != null ? signalData.option_dte : null,
            premEntry,
            signalData.option_delta_entry || null,
            signalData.option_iv_entry || null,
            signalData.option_vol_oi || null,
            signalData.option_premium_flow || null,
            premEntry,                        // peak starts at entry premium
            premEntry ? signalData.timestamp : null,  // peak time starts at entry
            signalData.tick_at_entry ?? null,
            signalData.trin_at_entry ?? null,
            signalData.ad_spread_at_entry ?? null,
            signalData.vol_ratio_at_entry ?? null
        );
        const optInfo = signalData.option_contract ? ` | Option: ${signalData.option_contract}` : '';
        console.log(`[SignalDB] Inserted signal ${signalData.id} @ $${signalData.entry_price}${optInfo}`);
        return true;
    } catch (e) {
        if (e.message.includes('UNIQUE constraint')) {
            console.log(`[SignalDB] Signal ${signalData.id} already exists`);
            return false;
        }
        throw e;
    }
}

/**
 * Update price tracking for an active signal
 * Returns false if signal not found, not active, or price is null/invalid
 * @param {string} signalId - Signal ID
 * @param {number} currentPrice - Current stock price
 * @param {object|null} optionPrice - Optional option price data { bid, ask, mark }
 */
function updatePriceTracking(signalId, currentPrice, optionPrice = null) {
    // Null price guard
    if (currentPrice === null || currentPrice === undefined || isNaN(currentPrice) || currentPrice <= 0) {
        console.log(`[SignalDB] Skipping price update for ${signalId} - invalid price: ${currentPrice}`);
        return false;
    }

    const signal = getDb().prepare('SELECT * FROM signals WHERE signal_id = ?').get(signalId);
    if (!signal || signal.status !== 'active') return false;

    const now = new Date().toISOString();
    const pctChange = ((currentPrice - signal.entry_price) / signal.entry_price) * 100;

    // Calculate new peak/trough
    const newPeak = Math.max(signal.peak_price || signal.entry_price, currentPrice);
    const newTrough = Math.min(signal.trough_price || signal.entry_price, currentPrice);

    // Calculate peak gain and max drawdown based on direction
    let peakGainPct, maxDrawdownPct;
    if (signal.direction === 'bullish') {
        // Bullish: gain when price goes UP, drawdown when price goes DOWN
        peakGainPct = ((newPeak - signal.entry_price) / signal.entry_price) * 100;
        maxDrawdownPct = ((newTrough - signal.entry_price) / signal.entry_price) * 100;
    } else if (signal.direction === 'bearish') {
        // Bearish: gain when price goes DOWN, drawdown when price goes UP
        peakGainPct = ((signal.entry_price - newTrough) / signal.entry_price) * 100;
        // Drawdown is negative because price went UP (wrong direction)
        maxDrawdownPct = -((newPeak - signal.entry_price) / signal.entry_price) * 100;
    } else {
        // Pinned/neutral - track max absolute move in either direction as gain,
        // and max adverse move as drawdown (so pinned signals can still WIN/LOSE)
        const upMove = ((newPeak - signal.entry_price) / signal.entry_price) * 100;
        const downMove = ((signal.entry_price - newTrough) / signal.entry_price) * 100;
        peakGainPct = Math.max(upMove, downMove);
        maxDrawdownPct = -Math.min(upMove, downMove);
    }

    getDb().prepare(`
        UPDATE signals SET
            current_price = ?,
            peak_price = ?,
            trough_price = ?,
            peak_gain_pct = ?,
            max_drawdown_pct = ?,
            last_updated = ?
        WHERE signal_id = ?
    `).run(currentPrice, newPeak, newTrough, peakGainPct, maxDrawdownPct, now, signalId);

    // Record price snapshot (every update) — includes option data if available
    const hoursElapsed = (Date.now() - new Date(signal.timestamp).getTime()) / (1000 * 60 * 60);
    const optMark = optionPrice?.mark || null;
    const optBid = optionPrice?.bid || null;
    const optAsk = optionPrice?.ask || null;
    const optGainPct = (optMark && signal.option_premium_entry && signal.option_premium_entry > 0)
        ? ((optMark - signal.option_premium_entry) / signal.option_premium_entry) * 100
        : null;

    getDb().prepare(`
        INSERT INTO price_snapshots (signal_id, timestamp, hours_elapsed, price, pct_change,
                                     option_bid, option_ask, option_mark, option_gain_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(signalId, now, hoursElapsed, currentPrice, pctChange,
           optBid, optAsk, optMark, optGainPct);

    return true;
}

/**
 * Update option price tracking on the signal itself (peak, entry, outcome)
 * Called alongside updatePriceTracking for signals with option contracts
 * @param {string} signalId - Signal ID
 * @param {object} optionPrice - { bid, ask, mark, delta, iv }
 * @returns {object|false} Tracking result or false if not applicable
 */
function updateOptionPriceTracking(signalId, optionPrice) {
    if (!optionPrice || !optionPrice.mark || optionPrice.mark <= 0) return false;

    const signal = getDb().prepare('SELECT * FROM signals WHERE signal_id = ?').get(signalId);
    if (!signal || signal.status !== 'active' || !signal.option_contract) return false;

    const now = new Date().toISOString();
    const mark = optionPrice.mark;

    // If no entry premium set yet, this is the first price fetch — establish entry
    if (!signal.option_premium_entry || signal.option_premium_entry <= 0) {
        getDb().prepare(`
            UPDATE signals SET
                option_premium_entry = ?,
                option_delta_entry = ?,
                option_iv_entry = ?,
                option_premium_peak = ?,
                option_premium_peak_time = ?
            WHERE signal_id = ?
        `).run(mark, optionPrice.delta || null, optionPrice.iv || null, mark, now, signalId);
        console.log(`[SignalDB] Set option entry premium for ${signalId}: $${mark.toFixed(2)}`);
        return { mark, gainPct: 0, peakGainPct: 0, isNewPeak: false, entrySet: true };
    }

    // Calculate gain from entry
    const entryPremium = signal.option_premium_entry;
    const gainPct = ((mark - entryPremium) / entryPremium) * 100;

    // Update peak if new high
    const currentPeak = signal.option_premium_peak || entryPremium;
    const isNewPeak = mark > currentPeak;
    const newPeak = isNewPeak ? mark : currentPeak;
    const peakTime = isNewPeak ? now : signal.option_premium_peak_time;
    const peakGainPct = ((newPeak - entryPremium) / entryPremium) * 100;

    getDb().prepare(`
        UPDATE signals SET
            option_premium_peak = ?,
            option_premium_peak_time = ?,
            option_peak_gain_pct = ?
        WHERE signal_id = ?
    `).run(newPeak, peakTime, peakGainPct, signalId);

    return { mark, gainPct, peakGainPct, isNewPeak, entrySet: false };
}

/**
 * Close an option signal with final outcome
 * Called when the option expires or when the signal is closed
 * @param {string} signalId - Signal ID
 * @param {number|null} closePremium - Final option mark price (null if expired worthless)
 */
function closeOptionSignal(signalId, closePremium) {
    const signal = getDb().prepare('SELECT * FROM signals WHERE signal_id = ?').get(signalId);
    if (!signal || !signal.option_contract) return;

    const entryPremium = signal.option_premium_entry;
    if (!entryPremium || entryPremium <= 0) {
        // Never got entry price, can't calculate
        getDb().prepare(`
            UPDATE signals SET
                option_premium_close = ?,
                option_outcome = 'UNKNOWN'
            WHERE signal_id = ?
        `).run(closePremium || 0, signalId);
        return;
    }

    const finalPremium = closePremium || 0;
    const closeGainPct = ((finalPremium - entryPremium) / entryPremium) * 100;
    const peakGainPct = signal.option_peak_gain_pct || 0;

    // Determine outcome based on peak gain
    let outcome;
    if (peakGainPct >= 100) {
        outcome = 'WIN';        // Option doubled
    } else if (peakGainPct >= 50) {
        outcome = 'PARTIAL_WIN'; // Solid gain but didn't double
    } else if (closeGainPct >= 0) {
        outcome = 'BREAKEVEN';   // Didn't lose money
    } else {
        outcome = 'LOSS';        // Lost money
    }

    getDb().prepare(`
        UPDATE signals SET
            option_premium_close = ?,
            option_close_gain_pct = ?,
            option_outcome = ?
        WHERE signal_id = ?
    `).run(finalPremium, closeGainPct, outcome, signalId);

    console.log(`[SignalDB] Closed option signal ${signalId}: ${outcome} (peak +${peakGainPct.toFixed(0)}%, close ${closeGainPct >= 0 ? '+' : ''}${closeGainPct.toFixed(0)}%)`);
}

/**
 * Check if stock price hit the target wall (call wall for bullish, put wall for bearish)
 * @param {string} signalId - Signal ID
 * @param {number} currentPrice - Current stock price
 */
function checkWallHit(signalId, currentPrice) {
    const signal = getDb().prepare(`
        SELECT s.*, br.call_wall, br.put_wall
        FROM signals s
        LEFT JOIN bloodhound_results br ON br.symbol = s.symbol
            AND br.scan_id = (SELECT MAX(scan_id) FROM bloodhound_results WHERE symbol = s.symbol)
        WHERE s.signal_id = ?
    `).get(signalId);

    if (!signal || !signal.option_contract || signal.option_hit_wall) return false;

    let hitWall = false;
    if (signal.direction === 'bullish' && signal.call_wall && currentPrice >= signal.call_wall) {
        hitWall = true;
    } else if (signal.direction === 'bearish' && signal.put_wall && currentPrice <= signal.put_wall) {
        hitWall = true;
    }

    if (hitWall) {
        getDb().prepare('UPDATE signals SET option_hit_wall = 1 WHERE signal_id = ?').run(signalId);
        console.log(`[SignalDB] ${signalId} hit target wall! Stock at $${currentPrice.toFixed(2)}`);
    }

    return hitWall;
}

/**
 * Get option signal performance stats
 * @param {number} days - Lookback period
 * @returns {object} Stats breakdown
 */
function getOptionSignalStats(days = 30) {
    const db = getDb();

    // Overall stats for signals that have option tracking
    const overall = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN option_outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN option_outcome = 'PARTIAL_WIN' THEN 1 ELSE 0 END) as partial_wins,
            SUM(CASE WHEN option_outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
            SUM(CASE WHEN option_outcome = 'BREAKEVEN' THEN 1 ELSE 0 END) as breakevens,
            SUM(CASE WHEN option_hit_wall = 1 THEN 1 ELSE 0 END) as wall_hits,
            ROUND(AVG(option_peak_gain_pct), 1) as avg_peak_gain,
            ROUND(AVG(option_close_gain_pct), 1) as avg_close_gain,
            ROUND(MAX(option_peak_gain_pct), 1) as max_peak_gain,
            ROUND(MIN(option_close_gain_pct), 1) as worst_close
        FROM signals
        WHERE option_contract IS NOT NULL
        AND timestamp > datetime('now', '-' || ? || ' days')
    `).get(days);

    // Active option signals (still being tracked)
    const active = db.prepare(`
        SELECT signal_id, symbol, option_contract, option_type, option_strike,
               option_premium_entry, option_premium_peak, option_peak_gain_pct,
               option_expiration, option_dte, score, direction, timestamp
        FROM signals
        WHERE option_contract IS NOT NULL AND status = 'active'
        ORDER BY timestamp DESC
    `).all();

    // Stats by score range
    const byScore = db.prepare(`
        SELECT
            CASE
                WHEN score >= 90 THEN '90-100'
                WHEN score >= 80 THEN '80-89'
                WHEN score >= 70 THEN '70-79'
                ELSE '50-69'
            END as score_range,
            COUNT(*) as total,
            SUM(CASE WHEN option_outcome IN ('WIN', 'PARTIAL_WIN') THEN 1 ELSE 0 END) as wins,
            ROUND(AVG(option_peak_gain_pct), 1) as avg_peak_gain
        FROM signals
        WHERE option_contract IS NOT NULL AND option_outcome IS NOT NULL
        AND timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY score_range
        ORDER BY score_range DESC
    `).all(days);

    // Stats by DTE
    const byDTE = db.prepare(`
        SELECT
            CASE
                WHEN option_dte = 0 THEN '0DTE'
                WHEN option_dte <= 2 THEN '1-2 DTE'
                WHEN option_dte <= 5 THEN '3-5 DTE'
                ELSE '5+ DTE'
            END as dte_range,
            COUNT(*) as total,
            SUM(CASE WHEN option_outcome IN ('WIN', 'PARTIAL_WIN') THEN 1 ELSE 0 END) as wins,
            ROUND(AVG(option_peak_gain_pct), 1) as avg_peak_gain
        FROM signals
        WHERE option_contract IS NOT NULL AND option_outcome IS NOT NULL
        AND timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY dte_range
    `).all(days);

    return { overall, active, byScore, byDTE };
}

/**
 * Record a checkpoint validation
 * Uses parameterized queries to prevent SQL injection
 */
function recordCheckpoint(signalId, checkpointType, currentPrice) {
    // Validate checkpoint type (prevents SQL injection)
    validateCheckpointType(checkpointType);

    // Null price guard
    if (currentPrice === null || currentPrice === undefined || isNaN(currentPrice) || currentPrice <= 0) {
        console.log(`[SignalDB] Skipping checkpoint for ${signalId} - invalid price: ${currentPrice}`);
        return false;
    }

    const signal = getDb().prepare('SELECT * FROM signals WHERE signal_id = ?').get(signalId);
    if (!signal) return false;

    const now = new Date().toISOString();
    const hoursElapsed = (Date.now() - new Date(signal.timestamp).getTime()) / (1000 * 60 * 60);
    const pctChange = ((currentPrice - signal.entry_price) / signal.entry_price) * 100;

    // Determine if direction was correct at this checkpoint
    let directionCorrect;
    if (signal.direction === 'bullish') {
        directionCorrect = pctChange >= 0.5;  // 0.5% threshold
    } else if (signal.direction === 'bearish') {
        directionCorrect = pctChange <= -0.5;
    } else if (signal.direction === 'pinned') {
        directionCorrect = Math.abs(pctChange) <= 1.0;
    } else {
        directionCorrect = false;  // Unknown direction
    }

    // Insert checkpoint record
    getDb().prepare(`
        INSERT INTO checkpoints (
            signal_id, checkpoint_type, timestamp, hours_elapsed,
            price, pct_change, peak_gain_at_checkpoint, max_drawdown_at_checkpoint,
            direction_correct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        signalId, checkpointType, now, hoursElapsed,
        currentPrice, pctChange, signal.peak_gain_pct, signal.max_drawdown_pct,
        directionCorrect ? 1 : 0
    );

    // Mark checkpoint as done using safe column mapping
    const columnMap = {
        '4h': 'checkpoint_4h_done',
        '24h': 'checkpoint_24h_done',
        '7d': 'checkpoint_7d_done'
    };
    const checkpointColumn = columnMap[checkpointType];

    // Also update validated fields for signal-logger compatibility
    getDb().prepare(`
        UPDATE signals SET
            ${checkpointColumn} = 1,
            validated = 1,
            validated_at = ?,
            correct = ?
        WHERE signal_id = ?
    `).run(now, directionCorrect ? 1 : 0, signalId);

    console.log(`[SignalDB] Recorded ${checkpointType} checkpoint for ${signalId}: ${directionCorrect ? 'CORRECT' : 'WRONG'} (${pctChange.toFixed(2)}%)`);
    return { pctChange, directionCorrect, hoursElapsed };
}

/**
 * Close a signal with final outcome
 */
function closeSignal(signalId, outcome, reason) {
    const now = new Date().toISOString();
    getDb().prepare(`
        UPDATE signals SET
            status = 'closed',
            final_outcome = ?,
            closed_at = ?
        WHERE signal_id = ?
    `).run(outcome, now, signalId);
    console.log(`[SignalDB] Closed signal ${signalId} with outcome: ${outcome}`);
}

/**
 * Close stale signals that have been active for more than 72 hours
 * Called after checkpoint validation to prevent infinite tracking
 */
function closeStaleSignals() {
    const cutoffTime = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    const staleSignals = getDb().prepare(`
        SELECT signal_id, symbol, peak_gain_pct, max_drawdown_pct
        FROM signals
        WHERE status = 'active' AND timestamp <= ?
    `).all(cutoffTime);

    for (const signal of staleSignals) {
        // Determine outcome based on final state
        let outcome;
        if (signal.peak_gain_pct >= 2) {
            outcome = 'WIN';
        } else if (signal.max_drawdown_pct <= -2) {
            outcome = 'LOSS';
        } else {
            outcome = 'BREAKEVEN';
        }

        closeSignal(signal.signal_id, outcome, 'time_stop_72h');
    }

    if (staleSignals.length > 0) {
        console.log(`[SignalDB] Closed ${staleSignals.length} stale signals (72h time stop)`);
    }

    return staleSignals.length;
}

/**
 * Get signals needing checkpoint validation
 * Uses safe column mapping instead of string interpolation
 *
 * Note: 7d checkpoints run on CLOSED signals too, because the 72h time stop
 * closes signals before 7 days. For 7d, we fetch the current price at checkpoint
 * time to see how the signal performed after a full week.
 */
function getSignalsForCheckpoint(checkpointType) {
    validateCheckpointType(checkpointType);

    const hours = CHECKPOINT_HOURS[checkpointType];
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Use safe column mapping
    const columnMap = {
        '4h': 'checkpoint_4h_done',
        '24h': 'checkpoint_24h_done',
        '7d': 'checkpoint_7d_done'
    };
    const checkpointColumn = columnMap[checkpointType];

    // 4h and 24h: only active signals (still being tracked)
    // 7d: include closed signals too (72h time stop closes before 7d checkpoint)
    const statusFilter = checkpointType === '7d'
        ? "status IN ('active', 'closed')"
        : "status = 'active'";

    return getDb().prepare(`
        SELECT * FROM signals
        WHERE ${statusFilter}
        AND ${checkpointColumn} = 0
        AND timestamp <= ?
    `).all(cutoffTime);
}

/**
 * Get all active signals for price updates
 */
function getActiveSignals() {
    return getDb().prepare(`
        SELECT * FROM signals WHERE status = 'active'
    `).all();
}

/**
 * Check if any signal (active or closed) exists today for a symbol
 * Prevents re-logging after auto-close (the dedup bug)
 */
function hasSignalToday(symbol) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    return getDb().prepare(`
        SELECT signal_id, status, score, zone, direction
        FROM signals
        WHERE symbol = ? AND date(timestamp) = ?
        LIMIT 1
    `).get(symbol, today);
}

/**
 * Calculate statistics by various dimensions
 */
function getStats(options = {}) {
    const { days = 30, checkpointType = '4h' } = options;
    validateCheckpointType(checkpointType);

    // Base win rate across all validated checkpoints
    const baseStats = getDb().prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN direction_correct = 1 THEN 1 ELSE 0 END) as correct,
            AVG(pct_change) as avg_change,
            AVG(peak_gain_at_checkpoint) as avg_peak_gain,
            AVG(max_drawdown_at_checkpoint) as avg_drawdown
        FROM checkpoints c
        JOIN signals s ON c.signal_id = s.signal_id
        WHERE c.checkpoint_type = ?
        AND c.timestamp > datetime('now', '-' || ? || ' days')
    `).get(checkpointType, days);

    const winRate = baseStats.total > 0
        ? ((baseStats.correct / baseStats.total) * 100).toFixed(1)
        : 0;

    return {
        checkpoint_type: checkpointType,
        days: days,
        total_validated: baseStats.total,
        correct: baseStats.correct,
        win_rate: parseFloat(winRate),
        avg_change: parseFloat((baseStats.avg_change || 0).toFixed(2)),
        avg_peak_gain: parseFloat((baseStats.avg_peak_gain || 0).toFixed(2)),
        avg_drawdown: parseFloat((baseStats.avg_drawdown || 0).toFixed(2))
    };
}

/**
 * Get stats by tier
 */
function getStatsByTier(checkpointType = '4h', days = 30) {
    validateCheckpointType(checkpointType);
    return getDb().prepare(`
        SELECT
            s.tier,
            COUNT(*) as total,
            SUM(CASE WHEN c.direction_correct = 1 THEN 1 ELSE 0 END) as correct,
            ROUND(AVG(c.pct_change), 2) as avg_change,
            ROUND(AVG(c.peak_gain_at_checkpoint), 2) as avg_peak_gain
        FROM checkpoints c
        JOIN signals s ON c.signal_id = s.signal_id
        WHERE c.checkpoint_type = ?
        AND c.timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY s.tier
        ORDER BY correct * 1.0 / total DESC
    `).all(checkpointType, days);
}

/**
 * Get stats by VIX regime
 */
function getStatsByVixRegime(checkpointType = '4h', days = 30) {
    validateCheckpointType(checkpointType);
    return getDb().prepare(`
        SELECT
            s.vix_regime,
            COUNT(*) as total,
            SUM(CASE WHEN c.direction_correct = 1 THEN 1 ELSE 0 END) as correct,
            ROUND(AVG(c.pct_change), 2) as avg_change
        FROM checkpoints c
        JOIN signals s ON c.signal_id = s.signal_id
        WHERE c.checkpoint_type = ?
        AND c.timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY s.vix_regime
    `).all(checkpointType, days);
}

/**
 * Get stats by direction
 */
function getStatsByDirection(checkpointType = '4h', days = 30) {
    validateCheckpointType(checkpointType);
    return getDb().prepare(`
        SELECT
            s.direction,
            COUNT(*) as total,
            SUM(CASE WHEN c.direction_correct = 1 THEN 1 ELSE 0 END) as correct,
            ROUND(AVG(c.pct_change), 2) as avg_change
        FROM checkpoints c
        JOIN signals s ON c.signal_id = s.signal_id
        WHERE c.checkpoint_type = ?
        AND c.timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY s.direction
    `).all(checkpointType, days);
}

/**
 * Get stats comparing checkpoints
 */
function compareCheckpoints(days = 30) {
    return getDb().prepare(`
        SELECT
            checkpoint_type,
            COUNT(*) as total,
            SUM(CASE WHEN direction_correct = 1 THEN 1 ELSE 0 END) as correct,
            ROUND(AVG(pct_change), 2) as avg_change,
            ROUND(AVG(peak_gain_at_checkpoint), 2) as avg_peak_gain
        FROM checkpoints
        WHERE timestamp > datetime('now', '-' || ? || ' days')
        GROUP BY checkpoint_type
        ORDER BY checkpoint_type
    `).all(days);
}

/**
 * Get recent signals with their checkpoint data
 */
function getRecentSignals(limit = 50) {
    return getDb().prepare(`
        SELECT s.*,
            (SELECT pct_change FROM checkpoints WHERE signal_id = s.signal_id AND checkpoint_type = '4h') as change_4h,
            (SELECT pct_change FROM checkpoints WHERE signal_id = s.signal_id AND checkpoint_type = '24h') as change_24h,
            (SELECT pct_change FROM checkpoints WHERE signal_id = s.signal_id AND checkpoint_type = '7d') as change_7d
        FROM signals s
        ORDER BY timestamp DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Get signal count and database stats
 */
function getDatabaseStats() {
    const signals = getDb().prepare('SELECT COUNT(*) as count FROM signals').get();
    const checkpoints = getDb().prepare('SELECT COUNT(*) as count FROM checkpoints').get();
    const snapshots = getDb().prepare('SELECT COUNT(*) as count FROM price_snapshots').get();
    const active = getDb().prepare("SELECT COUNT(*) as count FROM signals WHERE status = 'active'").get();
    const oldest = getDb().prepare('SELECT MIN(timestamp) as oldest FROM signals').get();
    const newest = getDb().prepare('SELECT MAX(timestamp) as newest FROM signals').get();

    return {
        total_signals: signals.count,
        active_signals: active.count,
        total_checkpoints: checkpoints.count,
        total_snapshots: snapshots.count,
        oldest_signal: oldest.oldest,
        newest_signal: newest.newest
    };
}

// ============================================
// SCANNER HISTORY FUNCTIONS (Day 2/Streak)
// ============================================

/**
 * Insert or update scanner history for a symbol on a given date
 * Now includes all fields from scanner_history.json and signal_tracking.json
 */
function upsertScannerHistory(symbol, date, data) {
    const existing = getDb().prepare(
        'SELECT * FROM scanner_history WHERE symbol = ? AND date = ?'
    ).get(symbol, date);

    // Calculate velocity (score change from previous entry)
    let velocity = null;
    if (data.score !== undefined) {
        const prevEntry = getDb().prepare(`
            SELECT peak_score FROM scanner_history
            WHERE symbol = ? AND date < ?
            ORDER BY date DESC LIMIT 1
        `).get(symbol, date);
        if (prevEntry) {
            velocity = (data.score || 0) - (prevEntry.peak_score || 0);
        }
    }

    if (existing) {
        // Update existing record (trend data always updates to latest)
        getDb().prepare(`
            UPDATE scanner_history SET
                scans_today = scans_today + 1,
                peak_score = MAX(peak_score, ?),
                peak_zone = CASE WHEN ? > peak_score THEN ? ELSE peak_zone END,
                high_price = MAX(high_price, ?),
                low_price = MIN(low_price, ?),
                close_price = ?,
                rsi_eod = ?,
                trend = ?,
                direction = ?,
                spy_trend = ?,
                vix = ?,
                vix_regime = ?,
                vwap = COALESCE(?, vwap),
                range_pct = COALESCE(?, range_pct),
                volume_ratio = COALESCE(?, volume_ratio),
                volume_avg_20d = COALESCE(?, volume_avg_20d),
                peak_direction = CASE WHEN ? > peak_score THEN ? ELSE peak_direction END,
                peak_signals_json = CASE WHEN ? > peak_score THEN ? ELSE peak_signals_json END,
                time_in_scanner_mins = ?,
                above_20ema = COALESCE(?, above_20ema),
                above_50sma = COALESCE(?, above_50sma),
                bb_position = COALESCE(?, bb_position),
                velocity = COALESCE(?, velocity)
            WHERE symbol = ? AND date = ?
        `).run(
            data.score || 0,
            data.score || 0, data.zone,
            data.price || 0,
            data.price || 999999,
            data.price,
            data.rsi,
            data.trend,
            data.direction,
            data.spy_trend,
            data.vix,
            data.vix_regime,
            data.vwap,
            data.range_pct,
            data.volume_ratio,
            data.volume_avg_20d,
            data.score || 0, data.peak_direction || data.direction,
            data.score || 0, data.peak_signals_json || JSON.stringify(data.peak_signals || []),
            data.time_in_scanner_mins,
            data.above_20ema ? 1 : 0,
            data.above_50sma ? 1 : 0,
            data.bb_position,
            velocity,
            symbol, date
        );
    } else {
        // Insert new record
        getDb().prepare(`
            INSERT INTO scanner_history (
                symbol, date, first_seen, scans_today,
                peak_score, peak_zone,
                open_price, high_price, low_price, close_price,
                gap_pct, rsi_eod,
                trend, direction, spy_trend, vix, vix_regime,
                vwap, range_pct, volume_ratio, volume_avg_20d,
                peak_direction, peak_signals_json, time_in_scanner_mins,
                above_20ema, above_50sma, bb_position, velocity
            ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            symbol, date, data.first_seen || new Date().toISOString(),
            data.score || 0, data.zone,
            data.price, data.price, data.price, data.price,
            data.gap_pct || 0, data.rsi,
            data.trend, data.direction, data.spy_trend, data.vix, data.vix_regime,
            data.vwap, data.range_pct, data.volume_ratio, data.volume_avg_20d,
            data.peak_direction || data.direction,
            data.peak_signals_json || JSON.stringify(data.peak_signals || []),
            data.time_in_scanner_mins || 0,
            data.above_20ema ? 1 : 0,
            data.above_50sma ? 1 : 0,
            data.bb_position,
            velocity
        );
    }

    return { velocity };
}

/**
 * Get scanner history for a symbol
 */
function getScannerHistory(symbol, days = 14) {
    return getDb().prepare(`
        SELECT * FROM scanner_history
        WHERE symbol = ?
        AND date > date('now', '-' || ? || ' days')
        ORDER BY date DESC
    `).all(symbol, days);
}

/**
 * Compute history status for a symbol (NEW, DAY_2, STREAK, RETURNED)
 */
function computeHistoryStatus(symbol) {
    const history = getScannerHistory(symbol, 14);

    if (history.length === 0) {
        return { label: 'NEW', consecutive_days: 0, trend: null };
    }

    const today = new Date().toISOString().split('T')[0];

    // Check consecutive TRADING days (skip weekends)
    let consecutiveDays = 0;
    const sortedDates = history.map(h => h.date).sort().reverse();

    // Build list of expected trading days going backwards from today
    function getTradingDaysBack(count) {
        const dates = [];
        let d = new Date();
        d.setHours(12, 0, 0, 0); // noon to avoid timezone edge cases
        for (let found = 0; found < count; ) {
            const dateStr = d.toISOString().split('T')[0];
            const day = d.getDay();
            if (day !== 0 && day !== 6) { // Skip Saturday (6) and Sunday (0)
                dates.push(dateStr);
                found++;
            }
            d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
        }
        return dates;
    }

    const expectedDates = getTradingDaysBack(sortedDates.length + 5);
    for (let i = 0; i < sortedDates.length && i < expectedDates.length; i++) {
        if (sortedDates[i] === expectedDates[i]) {
            consecutiveDays++;
        } else {
            break;
        }
    }

    // Determine trend
    let trend = null;
    if (history.length >= 2) {
        const recentScore = history[0].peak_score;
        const prevScore = history[1].peak_score;
        if (recentScore > prevScore + 5) trend = 'RISING';
        else if (recentScore < prevScore - 5) trend = 'FADING';
        else trend = 'STABLE';
    }

    // Determine label
    let label;
    if (consecutiveDays >= 3) {
        label = 'STREAK';
    } else if (consecutiveDays === 2) {
        label = 'DAY_2';
    } else if (consecutiveDays === 1 && history.length > 1) {
        label = 'RETURNED';
    } else {
        label = 'NEW';
    }

    return {
        label,
        consecutive_days: consecutiveDays,
        trend,
        first_seen: history[history.length - 1]?.first_seen,
        peak_score_ever: Math.max(...history.map(h => h.peak_score))
    };
}

/**
 * Compute history status for gap symbols from premarket_movers table
 * Similar to computeHistoryStatus but queries premarket_movers instead of scanner_history
 * @param {string} symbol - The symbol to check
 * @returns {object} - { label, consecutive_days, trend }
 */
function computeGapHistoryStatus(symbol) {
    // Get distinct dates this symbol appeared in premarket_movers
    const history = getDb().prepare(`
        SELECT DISTINCT date(timestamp) as date
        FROM premarket_movers
        WHERE symbol = ?
        ORDER BY date DESC
        LIMIT 14
    `).all(symbol);

    if (history.length === 0) {
        return { label: 'NEW', consecutive_days: 0, trend: null };
    }

    // Get today's date in EST (same as getSessionWatchlist)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Check consecutive days backwards from today
    let consecutiveDays = 0;
    for (let i = 0; i < history.length; i++) {
        // Calculate expected date (today - i days)
        const expected = new Date();
        expected.setDate(expected.getDate() - i);
        const expectedDate = expected.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

        if (history[i].date === expectedDate) {
            consecutiveDays++;
        } else {
            break;
        }
    }

    // Determine label
    let label;
    if (consecutiveDays >= 3) {
        label = 'STREAK';
    } else if (consecutiveDays === 2) {
        label = 'DAY_2';
    } else if (consecutiveDays === 1 && history.length > 1) {
        label = 'RETURNED';
    } else {
        label = 'NEW';
    }

    return {
        label,
        consecutive_days: consecutiveDays,
        trend: null  // Gap history doesn't track score trend like scanner_history
    };
}

/**
 * Get all symbols with their history status
 */
function getAllHistoryStatuses() {
    const symbols = getDb().prepare(`
        SELECT DISTINCT symbol FROM scanner_history
        WHERE date > date('now', '-14 days')
    `).all();

    return symbols.map(s => ({
        symbol: s.symbol,
        ...computeHistoryStatus(s.symbol)
    }));
}

/**
 * Get symbol velocity (score change from last scan)
 * This replaces signal_tracking.json functionality
 */
function getSymbolVelocity(symbol) {
    const recent = getDb().prepare(`
        SELECT peak_score, date FROM scanner_history
        WHERE symbol = ?
        ORDER BY date DESC
        LIMIT 2
    `).all(symbol);

    if (recent.length < 2) {
        return { velocity: 0, prevScore: 0, currentScore: recent[0]?.peak_score || 0 };
    }

    const currentScore = recent[0].peak_score || 0;
    const prevScore = recent[1].peak_score || 0;
    const velocity = currentScore - prevScore;

    return { velocity, prevScore, currentScore };
}

/**
 * Get velocity for all recent symbols (for batch processing)
 */
function getAllVelocities() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return getDb().prepare(`
        SELECT
            t.symbol,
            t.peak_score as current_score,
            y.peak_score as prev_score,
            (t.peak_score - COALESCE(y.peak_score, 0)) as velocity
        FROM scanner_history t
        LEFT JOIN scanner_history y ON t.symbol = y.symbol AND y.date = ?
        WHERE t.date = ?
        ORDER BY velocity DESC
    `).all(yesterday, today);
}

// ============================================
// ALERTS FUNCTIONS
// ============================================

/**
 * Insert a new alert (e.g., VIX regime change)
 */
function insertAlert(alertData) {
    const stmt = getDb().prepare(`
        INSERT INTO alerts (timestamp, type, priority, symbol, message, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        alertData.timestamp || new Date().toISOString(),
        alertData.type,
        alertData.priority || 'MEDIUM',
        alertData.symbol || null,
        alertData.message,
        JSON.stringify(alertData.details || {})
    );

    console.log(`[SignalDB] Alert inserted: ${alertData.type} - ${alertData.message}`);
}

/**
 * Get recent alerts from database
 */
function getRecentAlerts(options = {}) {
    const { limit = 50, type = null, days = 7 } = options;

    let query = `
        SELECT * FROM alerts
        WHERE timestamp > datetime('now', '-' || ? || ' days')
    `;
    const params = [days];

    if (type) {
        query += ` AND type = ?`;
        params.push(type);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    return getDb().prepare(query).all(...params);
}

/**
 * Get alerts formatted for dashboard display
 */
function getAlertsForDashboard(options = {}) {
    const alerts = getRecentAlerts(options);

    return alerts.map(a => ({
        id: a.id,
        timestamp: a.timestamp,
        type: a.type,
        priority: a.priority,
        symbol: a.symbol,
        message: a.message,
        details: JSON.parse(a.details_json || '{}')
    }));
}

// ============================================
// PRE-MARKET SCANNER FUNCTIONS
// ============================================

/**
 * Insert a new pre-market scan
 */
function insertPremarketScan(scanData) {
    const stmt = getDb().prepare(`
        INSERT INTO premarket_scans (
            timestamp, market_open, es_price, es_change_pct,
            nq_price, nq_change_pct, vix, market_bias, scan_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        scanData.timestamp || new Date().toISOString(),
        scanData.market_open ? 1 : 0,
        scanData.es_price,
        scanData.es_change_pct,
        scanData.nq_price,
        scanData.nq_change_pct,
        scanData.vix,
        scanData.market_bias,
        scanData.scan_summary
    );

    return result.lastInsertRowid;
}

/**
 * Insert a pre-market mover
 */
function insertPremarketMover(scanId, moverData) {
    const stmt = getDb().prepare(`
        INSERT INTO premarket_movers (
            scan_id, timestamp, symbol, prev_close, premarket_price,
            gap_pct, premarket_volume, gap_type, catalyst, tier, score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        scanId,
        moverData.timestamp || new Date().toISOString(),
        moverData.symbol,
        moverData.prev_close,
        moverData.premarket_price,
        moverData.gap_pct,
        moverData.premarket_volume,
        moverData.gap_type,
        moverData.catalyst,
        moverData.tier,
        moverData.score
    );
}

/**
 * Get recent pre-market scans
 */
function getRecentPremarketScans(limit = 10) {
    return getDb().prepare(`
        SELECT * FROM premarket_scans
        ORDER BY timestamp DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Get pre-market movers for a scan
 */
function getPremarketMovers(scanId) {
    return getDb().prepare(`
        SELECT * FROM premarket_movers
        WHERE scan_id = ?
        ORDER BY ABS(gap_pct) DESC
    `).all(scanId);
}

/**
 * Get latest pre-market scan with movers
 */
function getLatestPremarketData() {
    const latestScan = getDb().prepare(`
        SELECT * FROM premarket_scans
        ORDER BY timestamp DESC
        LIMIT 1
    `).get();

    if (!latestScan) {
        return null;
    }

    const movers = getPremarketMovers(latestScan.id);
    return {
        scan: latestScan,
        movers: movers
    };
}

/**
 * Get pre-market stats for today
 */
function getTodayPremarketStats() {
    const today = new Date().toISOString().split('T')[0];

    const scans = getDb().prepare(`
        SELECT COUNT(*) as scan_count,
               MIN(timestamp) as first_scan,
               MAX(timestamp) as last_scan
        FROM premarket_scans
        WHERE date(timestamp) = ?
    `).get(today);

    const topGappers = getDb().prepare(`
        SELECT pm.symbol, pm.gap_pct, pm.gap_type, pm.tier, pm.catalyst
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE date(ps.timestamp) = ?
        GROUP BY pm.symbol
        ORDER BY ABS(pm.gap_pct) DESC
        LIMIT 10
    `).all(today);

    return {
        ...scans,
        top_gappers: topGappers
    };
}

/**
 * Get all unique movers from today's session with full details
 * Used to restore session watchlist after scanner restart
 */
function getTodaySessionMovers() {
    const today = new Date().toISOString().split('T')[0];

    // Get all unique movers from today, keeping the best (peak) data for each
    const movers = getDb().prepare(`
        SELECT
            pm.symbol,
            MIN(pm.timestamp) as first_seen,
            MAX(pm.timestamp) as last_seen,
            COUNT(*) as scan_count,
            MAX(ABS(pm.gap_pct)) as peak_gap_pct,
            pm.prev_close,
            pm.premarket_price,
            pm.gap_pct,
            pm.premarket_volume,
            pm.gap_type,
            pm.catalyst,
            pm.tier,
            pm.score
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE date(ps.timestamp) = ?
        GROUP BY pm.symbol
        ORDER BY peak_gap_pct DESC
    `).all(today);

    return movers;
}

// ============================================
// GAP ANALYTICS FUNCTIONS
// ============================================

/**
 * Update EOD data for a gap (called by eod-gap-tracker.js)
 */
function updateGapEOD(moverId, eodData) {
    const { close, high, low, prevClose } = eodData;
    const now = new Date().toISOString();

    // Get the original gap data
    const mover = getDb().prepare('SELECT * FROM premarket_movers WHERE id = ?').get(moverId);
    if (!mover) return false;

    // Calculate if gap filled
    const gapUp = mover.gap_pct > 0;
    let gapFilled = 0;
    let fillTime = null;

    if (gapUp) {
        // Gap up fills if low touches prev_close
        gapFilled = low <= prevClose ? 1 : 0;
    } else {
        // Gap down fills if high touches prev_close
        gapFilled = high >= prevClose ? 1 : 0;
    }

    // Calculate EOD change from premarket price
    const eodChangePct = ((close - mover.premarket_price) / mover.premarket_price) * 100;

    // Determine outcome
    let outcome;
    const gapDirection = mover.gap_pct > 0 ? 'up' : 'down';
    const closeVsOpen = close > mover.premarket_price ? 'up' : close < mover.premarket_price ? 'down' : 'flat';

    if (Math.abs(eodChangePct) < 0.5) {
        outcome = 'SCRATCH';
    } else if (gapDirection === 'up' && closeVsOpen === 'up') {
        outcome = 'WIN';  // Gap up, closed higher
    } else if (gapDirection === 'down' && closeVsOpen === 'down') {
        outcome = 'WIN';  // Gap down, closed lower
    } else {
        outcome = 'LOSS'; // Gap faded
    }

    getDb().prepare(`
        UPDATE premarket_movers SET
            eod_close = ?,
            intraday_high = ?,
            intraday_low = ?,
            gap_filled = ?,
            fill_time = ?,
            eod_change_pct = ?,
            outcome = ?,
            eod_updated_at = ?
        WHERE id = ?
    `).run(close, high, low, gapFilled, fillTime, eodChangePct, outcome, now, moverId);

    return { gapFilled, outcome, eodChangePct };
}

/**
 * Get gaps that need EOD tracking (from today, no EOD data yet)
 */
function getGapsNeedingEOD() {
    const today = new Date().toISOString().split('T')[0];

    // Get ONE row per symbol (the one with peak gap) that needs EOD data
    return getDb().prepare(`
        SELECT
            pm.id,
            pm.symbol,
            pm.gap_pct,
            pm.prev_close,
            pm.premarket_price,
            pm.tier
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE date(ps.timestamp) = ?
        AND pm.eod_close IS NULL
        AND pm.id IN (
            -- Subquery to get the row with peak gap for each symbol today
            SELECT pm2.id FROM premarket_movers pm2
            JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
            WHERE pm2.symbol = pm.symbol
            AND date(ps2.timestamp) = ?
            ORDER BY ABS(pm2.gap_pct) DESC
            LIMIT 1
        )
        GROUP BY pm.symbol
    `).all(today, today);
}

/**
 * Get gap fill rates by various dimensions
 */
function getGapFillRates(options = {}) {
    const { days = null } = options; // null = all time

    const dateFilter = days ? `AND date(ps.timestamp) > date('now', '-' || ? || ' days')` : '';
    const dateParams = days ? [days] : [];

    // Overall fill rate
    const overall = getDb().prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as filled,
            ROUND(AVG(CASE WHEN gap_filled = 1 THEN 100.0 ELSE 0 END), 1) as fill_rate
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.eod_close IS NOT NULL
        ${dateFilter}
    `).get(...dateParams);

    // By tier
    const byTier = getDb().prepare(`
        SELECT
            pm.tier,
            COUNT(*) as total,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as filled,
            ROUND(AVG(CASE WHEN gap_filled = 1 THEN 100.0 ELSE 0 END), 1) as fill_rate
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.eod_close IS NOT NULL
        ${dateFilter}
        GROUP BY pm.tier
        ORDER BY fill_rate DESC
    `).all(...dateParams);

    // By gap size bucket
    const bySize = getDb().prepare(`
        SELECT
            CASE
                WHEN ABS(gap_pct) >= 5 THEN '5%+'
                WHEN ABS(gap_pct) >= 3 THEN '3-5%'
                WHEN ABS(gap_pct) >= 2 THEN '2-3%'
                ELSE '<2%'
            END as size_bucket,
            COUNT(*) as total,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as filled,
            ROUND(AVG(CASE WHEN gap_filled = 1 THEN 100.0 ELSE 0 END), 1) as fill_rate
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.eod_close IS NOT NULL
        ${dateFilter}
        GROUP BY size_bucket
        ORDER BY fill_rate DESC
    `).all(...dateParams);

    // By catalyst
    const byCatalyst = getDb().prepare(`
        SELECT
            CASE WHEN catalyst IS NOT NULL AND catalyst != '' THEN 'With Catalyst' ELSE 'No Catalyst' END as has_catalyst,
            COUNT(*) as total,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as filled,
            ROUND(AVG(CASE WHEN gap_filled = 1 THEN 100.0 ELSE 0 END), 1) as fill_rate
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.eod_close IS NOT NULL
        ${dateFilter}
        GROUP BY has_catalyst
    `).all(...dateParams);

    // By direction
    const byDirection = getDb().prepare(`
        SELECT
            CASE WHEN gap_pct > 0 THEN 'Gap Up' ELSE 'Gap Down' END as direction,
            COUNT(*) as total,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as filled,
            ROUND(AVG(CASE WHEN gap_filled = 1 THEN 100.0 ELSE 0 END), 1) as fill_rate
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.eod_close IS NOT NULL
        ${dateFilter}
        GROUP BY direction
    `).all(...dateParams);

    return {
        days: days || 'all_time',
        overall,
        by_tier: byTier,
        by_size: bySize,
        by_catalyst: byCatalyst,
        by_direction: byDirection
    };
}

/**
 * Get ticker-specific gap history
 * Note: Groups by DATE to count distinct gap events (not individual scans)
 */
function getTickerGapHistory(symbol, options = {}) {
    const { days = null, limit = 20 } = options;
    symbol = symbol.toUpperCase();

    const dateFilter = days ? `AND date(ps.timestamp) > date('now', '-' || ? || ' days')` : '';
    const dateParams = days ? [days] : [];

    // Get recent gaps for this ticker - one per day with peak values
    const gaps = getDb().prepare(`
        SELECT
            pm.symbol,
            date(ps.timestamp) as gap_date,
            MAX(ABS(pm.gap_pct)) as peak_gap_pct,
            MAX(pm.gap_pct) as gap_pct,
            MAX(pm.tier) as tier,
            MAX(pm.gap_filled) as gap_filled,
            MAX(pm.outcome) as outcome,
            MAX(pm.eod_close) as eod_close
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.symbol = ?
        ${dateFilter}
        GROUP BY date(ps.timestamp)
        ORDER BY gap_date DESC
        LIMIT ?
    `).all(symbol, ...dateParams, limit);

    // Get aggregate stats - counting DISTINCT DAYS
    // Each subquery and main WHERE uses (symbol, [days]) params
    const pair = [symbol, ...dateParams];
    const stats = getDb().prepare(`
        SELECT
            COUNT(DISTINCT date(ps.timestamp)) as total_gaps,
            (SELECT COUNT(DISTINCT date(ps2.timestamp)) FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ? AND pm2.gap_pct > 0 ${dateFilter}) as gaps_up,
            (SELECT COUNT(DISTINCT date(ps2.timestamp)) FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ? AND pm2.gap_pct < 0 ${dateFilter}) as gaps_down,
            ROUND(AVG(ABS(gap_pct)), 2) as avg_gap_pct,
            MAX(ABS(gap_pct)) as max_gap_pct,
            (SELECT COUNT(DISTINCT date(ps2.timestamp)) FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ? AND pm2.gap_filled = 1 ${dateFilter}) as filled_count,
            (SELECT COUNT(DISTINCT date(ps2.timestamp)) FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ? AND pm2.outcome = 'WIN' ${dateFilter}) as wins,
            (SELECT COUNT(DISTINCT date(ps2.timestamp)) FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ? AND pm2.outcome = 'LOSS' ${dateFilter}) as losses,
            (SELECT COUNT(DISTINCT date(ps2.timestamp)) FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ? AND pm2.eod_close IS NOT NULL ${dateFilter}) as tracked_count
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.symbol = ?
        ${dateFilter}
    `).get(...pair, ...pair, ...pair, ...pair, ...pair, ...pair, ...pair);

    // Calculate rates
    const fillRate = stats.tracked_count > 0
        ? Math.round((stats.filled_count / stats.tracked_count) * 100)
        : null;
    const winRate = (stats.wins + stats.losses) > 0
        ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
        : null;

    return {
        symbol,
        days: days || 'all_time',
        stats: {
            ...stats,
            fill_rate: fillRate,
            win_rate: winRate
        },
        recent_gaps: gaps
    };
}

/**
 * Get repeat offenders (tickers that gap frequently)
 */
function getRepeatOffenders(options = {}) {
    const { days = 30, minGaps = 2, limit = 20 } = options;

    return getDb().prepare(`
        SELECT
            pm.symbol,
            COUNT(*) as gap_count,
            SUM(CASE WHEN gap_pct > 0 THEN 1 ELSE 0 END) as gaps_up,
            SUM(CASE WHEN gap_pct < 0 THEN 1 ELSE 0 END) as gaps_down,
            ROUND(AVG(ABS(gap_pct)), 2) as avg_gap_pct,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as filled_count,
            SUM(CASE WHEN eod_close IS NOT NULL THEN 1 ELSE 0 END) as tracked_count,
            ROUND(
                CASE WHEN SUM(CASE WHEN eod_close IS NOT NULL THEN 1 ELSE 0 END) > 0
                THEN (SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) * 100.0 /
                      SUM(CASE WHEN eod_close IS NOT NULL THEN 1 ELSE 0 END))
                ELSE NULL END
            , 1) as fill_rate,
            MAX(date(ps.timestamp)) as last_gap_date
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE date(ps.timestamp) > date('now', '-' || ? || ' days')
        GROUP BY pm.symbol
        HAVING COUNT(*) >= ?
        ORDER BY gap_count DESC
        LIMIT ?
    `).all(days, minGaps, limit);
}

/**
 * Get today's gaps enriched with historical context
 */
function getTodayGapsWithHistory() {
    const today = new Date().toISOString().split('T')[0];

    // Get today's unique gaps - one per symbol with peak gap value
    const todayGaps = getDb().prepare(`
        SELECT
            pm.symbol,
            MAX(ABS(pm.gap_pct)) as peak_gap,
            (SELECT gap_pct FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = pm.symbol AND date(ps2.timestamp) = date(ps.timestamp)
             ORDER BY ABS(pm2.gap_pct) DESC LIMIT 1) as gap_pct,
            MAX(pm.tier) as tier,
            MAX(pm.catalyst) as catalyst
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE date(ps.timestamp) = ?
        GROUP BY pm.symbol
        ORDER BY peak_gap DESC
    `).all(today);

    // Enrich each with history
    return todayGaps.map(gap => {
        const history = getTickerGapHistory(gap.symbol, { days: 30 });
        return {
            ...gap,
            history_30d: {
                total_gaps: history.stats.total_gaps,
                fill_rate: history.stats.fill_rate,
                avg_gap_pct: history.stats.avg_gap_pct,
                recent: history.recent_gaps.slice(0, 5).map(g => ({
                    date: g.gap_date,
                    gap_pct: g.gap_pct,
                    filled: g.gap_filled,
                    outcome: g.outcome
                }))
            }
        };
    });
}

/**
 * Update aggregated ticker stats (called after EOD tracking)
 */
function updateTickerStats(symbol) {
    symbol = symbol.toUpperCase();
    const now = new Date().toISOString();

    const stats = getDb().prepare(`
        SELECT
            COUNT(*) as total_gaps,
            SUM(CASE WHEN gap_pct > 0 THEN 1 ELSE 0 END) as total_gaps_up,
            SUM(CASE WHEN gap_pct < 0 THEN 1 ELSE 0 END) as total_gaps_down,
            ROUND(AVG(gap_pct), 2) as avg_gap_pct,
            SUM(CASE WHEN gap_filled = 1 THEN 1 ELSE 0 END) as fill_count,
            ROUND(AVG(eod_change_pct), 2) as avg_follow_through,
            SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
            SUM(CASE WHEN eod_close IS NOT NULL THEN 1 ELSE 0 END) as tracked_count,
            MAX(date(ps.timestamp)) as last_gap_date,
            (SELECT gap_pct FROM premarket_movers pm2
             JOIN premarket_scans ps2 ON pm2.scan_id = ps2.id
             WHERE pm2.symbol = ?
             ORDER BY ps2.timestamp DESC LIMIT 1) as last_gap_pct
        FROM premarket_movers pm
        JOIN premarket_scans ps ON pm.scan_id = ps.id
        WHERE pm.symbol = ?
    `).get(symbol, symbol);

    const fillRate = stats.tracked_count > 0
        ? (stats.fill_count / stats.tracked_count)
        : null;
    const winRate = (stats.wins + stats.losses) > 0
        ? (stats.wins / (stats.wins + stats.losses))
        : null;

    getDb().prepare(`
        INSERT OR REPLACE INTO gap_ticker_stats (
            symbol, total_gaps, total_gaps_up, total_gaps_down,
            avg_gap_pct, fill_count, fill_rate, avg_follow_through,
            wins, losses, win_rate, last_gap_date, last_gap_pct, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        symbol,
        stats.total_gaps,
        stats.total_gaps_up,
        stats.total_gaps_down,
        stats.avg_gap_pct,
        stats.fill_count,
        fillRate,
        stats.avg_follow_through,
        stats.wins,
        stats.losses,
        winRate,
        stats.last_gap_date,
        stats.last_gap_pct,
        now
    );
}

/**
 * Get all ticker stats for display
 */
function getAllTickerStats(options = {}) {
    const { minGaps = 1, limit = 50 } = options;

    return getDb().prepare(`
        SELECT * FROM gap_ticker_stats
        WHERE total_gaps >= ?
        ORDER BY total_gaps DESC
        LIMIT ?
    `).all(minGaps, limit);
}

// ============================================
// SESSION WATCHLIST FUNCTIONS
// Reconstructs daily gap session from premarket_movers
// ============================================

/**
 * Get session watchlist for a specific date
 * Reconstructs from premarket_movers table - persists after premarket.json clears
 * @param {string} date - Date in YYYY-MM-DD format (defaults to today)
 */
function getSessionWatchlist(date = null) {
    // Default to today in EST
    if (!date) {
        date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    }

    // Get session stats with latest data for each symbol
    // Uses subquery to get the most recent row per symbol for price data
    const results = getDb().prepare(`
        SELECT
            m.symbol,
            stats.scan_count,
            stats.peak_gap_pct,
            stats.peak_direction,
            stats.peak_score,
            stats.tier,
            stats.first_seen,
            stats.last_seen,
            stats.peak_volume,
            stats.catalyst,
            m.prev_close,
            m.premarket_price,
            m.gap_pct,
            m.gap_type,
            m.score
        FROM premarket_movers m
        INNER JOIN (
            SELECT
                symbol,
                COUNT(*) as scan_count,
                ROUND(MAX(ABS(gap_pct)), 2) as peak_gap_pct,
                -- Peak direction (historical reference only, UI uses gap_pct sign for current)
                CASE WHEN MAX(gap_pct) > 0 THEN 'UP' ELSE 'DOWN' END as peak_direction,
                MAX(score) as peak_score,
                CASE
                    WHEN MAX(score) >= 70 THEN 'HIGH_CONVICTION'
                    WHEN MAX(score) >= 50 THEN 'TRADEABLE'
                    ELSE 'WATCH'
                END as tier,
                MIN(timestamp) as first_seen,
                MAX(timestamp) as last_seen,
                MAX(premarket_volume) as peak_volume,
                MAX(catalyst) as catalyst
            FROM premarket_movers
            WHERE DATE(timestamp) = ?
              AND gap_pct IS NOT NULL
              AND ABS(gap_pct) >= 2
            GROUP BY symbol
        ) stats ON m.symbol = stats.symbol AND m.timestamp = stats.last_seen
        ORDER BY stats.peak_gap_pct DESC
    `).all(date);

    // Add history status to each result
    return results.map(r => ({
        ...r,
        history_status: computeGapHistoryStatus(r.symbol)
    }));
}

/**
 * Get list of available session dates for lookback
 * @param {number} limit - Max number of dates to return
 */
function getSessionDates(limit = 30) {
    return getDb().prepare(`
        SELECT DISTINCT
            DATE(timestamp) as date,
            COUNT(DISTINCT symbol) as symbol_count,
            COUNT(*) as scan_count
        FROM premarket_movers
        WHERE gap_pct IS NOT NULL
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
        LIMIT ?
    `).all(limit);
}

// ============================================
// WATCHLIST FUNCTIONS
// ============================================

/**
 * Add or update a symbol in watchlist
 * Sources: 'manual', 'premarket_gap', 'bloodhound', 'earnings'
 */
function addToWatchlist(symbol, options = {}) {
    symbol = symbol.toUpperCase();
    const now = new Date().toISOString();

    const {
        notes = null,
        source = 'manual',
        addedBy = null,
        gapPct = null,
        scoreAtAdd = null,
        tierAtAdd = null,
        expiresAt = null
    } = options;

    const existing = getDb().prepare('SELECT * FROM watchlist WHERE symbol = ?').get(symbol);

    if (existing) {
        // PROTECT manual entries — automation NEVER overwrites them
        if (existing.source === 'manual') {
            console.log(`[Watchlist] Skipped ${symbol} — manual entry protected (attempted by ${source})`);
            return { action: 'skipped_manual', symbol };
        }
        // Update existing non-manual entry - re-enable if disabled, update notes/metadata
        getDb().prepare(`
            UPDATE watchlist SET
                enabled = 1,
                notes = COALESCE(?, notes),
                source = CASE WHEN ? IS NOT NULL THEN ? ELSE source END,
                gap_pct = COALESCE(?, gap_pct),
                score_at_add = COALESCE(?, score_at_add),
                tier_at_add = COALESCE(?, tier_at_add),
                expires_at = COALESCE(?, expires_at)
            WHERE symbol = ?
        `).run(notes, source, source, gapPct, scoreAtAdd, tierAtAdd, expiresAt, symbol);
        console.log(`[Watchlist] Updated ${symbol} (source: ${source})`);
        return { action: 'updated', symbol };
    } else {
        // Insert new
        getDb().prepare(`
            INSERT INTO watchlist (symbol, enabled, notes, source, added_at, added_by, gap_pct, score_at_add, tier_at_add, expires_at)
            VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(symbol, notes, source, now, addedBy, gapPct, scoreAtAdd, tierAtAdd, expiresAt);
        console.log(`[Watchlist] Added ${symbol} (source: ${source})`);
        return { action: 'added', symbol };
    }
}

/**
 * Remove a symbol from watchlist
 */
function removeFromWatchlist(symbol) {
    symbol = symbol.toUpperCase();
    const result = getDb().prepare('DELETE FROM watchlist WHERE symbol = ?').run(symbol);
    if (result.changes > 0) {
        console.log(`[Watchlist] Removed ${symbol}`);
        return true;
    }
    return false;
}

/**
 * Enable/disable a symbol (keeps it in list)
 */
function setWatchlistEnabled(symbol, enabled) {
    symbol = symbol.toUpperCase();
    const result = getDb().prepare('UPDATE watchlist SET enabled = ? WHERE symbol = ?').run(enabled ? 1 : 0, symbol);
    return result.changes > 0;
}

/**
 * Update notes for a watchlist symbol (works on manual entries too)
 */
function setWatchlistNotes(symbol, notes) {
    symbol = symbol.toUpperCase();
    const result = getDb().prepare('UPDATE watchlist SET notes = ? WHERE symbol = ?').run(notes, symbol);
    return result.changes > 0;
}

/**
 * Get enabled watchlist symbols (for scanners)
 */
function getWatchlist() {
    return getDb().prepare(`
        SELECT symbol FROM watchlist
        WHERE enabled = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY added_at DESC
    `).all().map(r => r.symbol);
}

/**
 * Get full watchlist with all metadata
 */
function getWatchlistFull() {
    return getDb().prepare(`
        SELECT * FROM watchlist
        ORDER BY enabled DESC, added_at DESC
    `).all();
}

/**
 * Get watchlist partitioned into static (manual) and dynamic (automated) entries.
 * Static entries get reserved slots in discovery — they always scan.
 * Dynamic entries compete for remaining slots.
 */
function getWatchlistPartitioned() {
    const rows = getDb().prepare(`
        SELECT symbol, source FROM watchlist
        WHERE enabled = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY added_at DESC
    `).all();

    const staticSymbols = [];
    const dynamicSymbols = [];

    for (const row of rows) {
        if (row.source === 'manual') {
            staticSymbols.push(row.symbol);
        } else {
            dynamicSymbols.push({ symbol: row.symbol, source: row.source });
        }
    }

    return { static: staticSymbols, dynamic: dynamicSymbols };
}

/**
 * Check if symbol is in watchlist
 */
function isInWatchlist(symbol) {
    symbol = symbol.toUpperCase();
    const result = getDb().prepare('SELECT 1 FROM watchlist WHERE symbol = ? AND enabled = 1').get(symbol);
    return !!result;
}

/**
 * Update last scanned timestamp
 */
function updateWatchlistScanned(symbol) {
    symbol = symbol.toUpperCase();
    const now = new Date().toISOString();
    getDb().prepare('UPDATE watchlist SET last_scanned = ? WHERE symbol = ?').run(now, symbol);
}

/**
 * Clean expired watchlist entries
 */
function cleanExpiredWatchlist() {
    const result = getDb().prepare(`
        DELETE FROM watchlist
        WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();
    if (result.changes > 0) {
        console.log(`[Watchlist] Cleaned ${result.changes} expired entries`);
    }
    return result.changes;
}

/**
 * Migrate from watchlist.json to database (one-time)
 */
function migrateWatchlistFromJson(jsonPath) {
    const fs = require('fs');
    try {
        const content = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(content);

        let migrated = 0;
        for (const item of data.symbols || []) {
            const existing = getDb().prepare('SELECT 1 FROM watchlist WHERE symbol = ?').get(item.symbol);
            if (!existing) {
                addToWatchlist(item.symbol, {
                    notes: item.notes,
                    source: 'manual'
                });
                if (!item.enabled) {
                    setWatchlistEnabled(item.symbol, false);
                }
                migrated++;
            }
        }
        console.log(`[Watchlist] Migrated ${migrated} symbols from JSON`);
        return migrated;
    } catch (e) {
        console.log(`[Watchlist] Migration failed: ${e.message}`);
        return 0;
    }
}

/**
 * Get watchlist stats
 */
function getWatchlistStats() {
    const total = getDb().prepare('SELECT COUNT(*) as count FROM watchlist').get();
    const enabled = getDb().prepare('SELECT COUNT(*) as count FROM watchlist WHERE enabled = 1').get();
    const bySources = getDb().prepare(`
        SELECT source, COUNT(*) as count
        FROM watchlist
        WHERE enabled = 1
        GROUP BY source
    `).all();

    return {
        total: total.count,
        enabled: enabled.count,
        by_source: bySources
    };
}

// ============================================
// BLOODHOUND SCANNER FUNCTIONS
// ============================================

/**
 * Insert a bloodhound scan record (metadata)
 * Returns the scan_id for linking results
 */
function insertBloodhoundScan(scanData) {
    const stmt = getDb().prepare(`
        INSERT INTO bloodhound_scans (
            timestamp, vix, vix_regime, spy_trend, spy_price,
            risk_appetite, regime, position_size_modifier,
            spy_levels_json, qqq_levels_json,
            scan_count, tradeable_count, alerts_sent, watchlist_count,
            sources_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        scanData.timestamp || new Date().toISOString(),
        scanData.vix,
        scanData.vixRegime,
        scanData.spyTrend,
        scanData.spyPrice,
        scanData.riskAppetite,
        scanData.regime,
        scanData.positionSizeModifier,
        JSON.stringify(scanData.spyLevels || {}),
        JSON.stringify(scanData.qqqLevels || {}),
        scanData.scanCount || 0,
        scanData.tradeableCount || 0,
        scanData.alertsSent || 0,
        scanData.watchlistCount || 0,
        JSON.stringify(scanData.sources || [])
    );

    return result.lastInsertRowid;
}

/**
 * Insert bloodhound results (batch insert for all tickers)
 */
function insertBloodhoundResults(scanId, results) {
    const stmt = getDb().prepare(`
        INSERT INTO bloodhound_results (
            scan_id, symbol, price, zone, tradeable, action,
            put_wall, call_wall, max_pain, gamma_flip, vwap,
            to_put_wall, to_call_wall, position_in_range,
            rsi, trend, momentum_5d, momentum_20d, bb_position, volume_signal,
            fibonacci_json, score, direction, tier, signals_json,
            is_watchlist, sources_json,
            history_label, consecutive_days, history_trend, reasoning_json,
            sector_rs_percentile, sector_etf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = getDb().transaction((items) => {
        for (const r of items) {
            stmt.run(
                scanId,
                r.symbol,
                r.price,
                r.zone,
                r.tradeable ? 1 : 0,
                r.action,
                r.levels?.putWall,
                r.levels?.callWall,
                r.levels?.maxPain,
                r.levels?.gammaFlip,
                r.levels?.vwap,
                r.distances?.toPutWall,
                r.distances?.toCallWall,
                r.distances?.positionInRange,
                r.technicals?.rsi,
                r.technicals?.trend,
                r.technicals?.momentum5d,
                r.technicals?.momentum20d,
                r.technicals?.bbPosition,
                r.technicals?.volumeSignal,
                JSON.stringify(r.fibonacci || null),
                r.sourceInfo?.score || 0,
                r.sourceInfo?.direction,
                r.sourceInfo?.tier,
                JSON.stringify(r.sourceInfo?.signals || []),
                r.sourceInfo?.isWatchlist ? 1 : 0,
                JSON.stringify(r.sourceInfo?.sources || []),
                r.history_status?.label,
                r.history_status?.consecutive_days,
                r.history_status?.trend,
                JSON.stringify(r.reasoning || []),
                r.sectorRsPercentile ?? null,
                r.sectorEtf ?? null
            );
        }
    });

    insertMany(results);
    console.log(`[SignalDB] Inserted ${results.length} bloodhound results for scan ${scanId}`);
}

/**
 * Get the most recent bloodhound scan with all results
 * Returns data in format compatible with dynamic_scan.json
 */
function getLatestBloodhoundScan() {
    const scan = getDb().prepare(`
        SELECT * FROM bloodhound_scans
        ORDER BY id DESC
        LIMIT 1
    `).get();

    if (!scan) {
        return null;
    }

    const results = getDb().prepare(`
        SELECT * FROM bloodhound_results
        WHERE scan_id = ?
        ORDER BY score DESC
    `).all(scan.id);

    // Transform to dynamic_scan.json format
    return {
        timestamp: scan.timestamp,
        scanType: 'bloodhound',
        sources: {
            highConviction: true,
            trending: false,
            authorConsensus: false,
            aiOutlook: true
        },
        marketContext: {
            vix: scan.vix,
            vixRegime: scan.vix_regime,
            spyTrend: scan.spy_trend,
            spyPrice: scan.spy_price,
            riskAppetite: scan.risk_appetite,
            regime: scan.regime,
            positionSizeModifier: scan.position_size_modifier,
            spyLevels: JSON.parse(scan.spy_levels_json || '{}'),
            qqqLevels: JSON.parse(scan.qqq_levels_json || '{}'),
            rotationRegime: JSON.parse(scan.spy_levels_json || '{}').rotationRegime || null
        },
        scanCount: scan.scan_count,
        tradeableCount: scan.tradeable_count,
        results: results.map(r => ({
            symbol: r.symbol,
            price: r.price,
            zone: r.zone,
            tradeable: r.tradeable === 1,
            action: r.action,
            reasoning: JSON.parse(r.reasoning_json || '[]'),
            levels: {
                putWall: r.put_wall,
                callWall: r.call_wall,
                maxPain: r.max_pain,
                gammaFlip: r.gamma_flip,
                vwap: r.vwap
            },
            distances: {
                toPutWall: r.to_put_wall,
                toCallWall: r.to_call_wall,
                positionInRange: r.position_in_range
            },
            technicals: {
                rsi: r.rsi,
                trend: r.trend,
                momentum5d: r.momentum_5d,
                momentum20d: r.momentum_20d,
                bbPosition: r.bb_position,
                volumeSignal: r.volume_signal
            },
            fibonacci: JSON.parse(r.fibonacci_json || 'null'),
            timestamp: scan.timestamp,
            sourceInfo: {
                sources: JSON.parse(r.sources_json || '[]'),
                score: r.score,
                direction: r.direction,
                signals: JSON.parse(r.signals_json || '[]'),
                isWatchlist: r.is_watchlist === 1,
                tier: r.tier
            },
            history_status: r.history_label ? {
                label: r.history_label,
                consecutive_days: r.consecutive_days,
                trend: r.history_trend
            } : null,
            sectorRs: r.sector_rs_percentile != null ? {
                percentile: r.sector_rs_percentile,
                sectorEtf: r.sector_etf
            } : null
        }))
    };
}

/**
 * Get bloodhound scan summary (for scanner.html - lighter format)
 * Returns data in format compatible with scanner.json
 */
function getBloodhoundScanSummary() {
    const scan = getDb().prepare(`
        SELECT * FROM bloodhound_scans
        ORDER BY id DESC
        LIMIT 1
    `).get();

    if (!scan) {
        return null;
    }

    // Get top 15 opportunities by score
    const topOpportunities = getDb().prepare(`
        SELECT * FROM bloodhound_results
        WHERE scan_id = ?
        ORDER BY score DESC
        LIMIT 15
    `).all(scan.id);

    // Get SPY and QQQ data
    const spyResult = getDb().prepare(`
        SELECT * FROM bloodhound_results
        WHERE scan_id = ? AND symbol = 'SPY'
    `).get(scan.id);

    const qqqResult = getDb().prepare(`
        SELECT * FROM bloodhound_results
        WHERE scan_id = ? AND symbol = 'QQQ'
    `).get(scan.id);

    let spyLevels = JSON.parse(scan.spy_levels_json || '{}');
    let qqqLevels = JSON.parse(scan.qqq_levels_json || '{}');

    // If SPY/QQQ levels are incomplete (API timeout during scan), fall back to previous scan
    if (!spyLevels.call_wall || !spyLevels.put_wall) {
        const prevScan = getDb().prepare(`
            SELECT spy_levels_json FROM bloodhound_scans
            WHERE id < ? AND spy_levels_json LIKE '%call_wall%'
            ORDER BY id DESC LIMIT 1
        `).get(scan.id);
        if (prevScan) {
            const prevLevels = JSON.parse(prevScan.spy_levels_json);
            // Preserve gammaRegime/ivRank from current scan, backfill wall data
            spyLevels = { ...prevLevels, gammaRegime: spyLevels.gammaRegime || prevLevels.gammaRegime, ivRank: spyLevels.ivRank || prevLevels.ivRank };
        }
    }
    if (!qqqLevels.call_wall || !qqqLevels.put_wall) {
        const prevScan = getDb().prepare(`
            SELECT qqq_levels_json FROM bloodhound_scans
            WHERE id < ? AND qqq_levels_json LIKE '%call_wall%'
            ORDER BY id DESC LIMIT 1
        `).get(scan.id);
        if (prevScan) {
            const prevLevels = JSON.parse(prevScan.qqq_levels_json);
            qqqLevels = { ...prevLevels, ...qqqLevels };
        }
    }

    // Pull change_pct from market internals ($SPX → SPY, $COMPX → QQQ)
    const internals = getLatestInternals();
    const spyChangePct = internals?.spx_change_pct ?? 0;
    const qqqChangePct = internals?.compx_change_pct ?? 0;

    return {
        timestamp: scan.timestamp,
        vix: {
            price: scan.vix || 0,
            regime: scan.vix_regime || 'unknown'
        },
        spy: {
            price: scan.spy_price || 0,
            change_pct: Math.round(spyChangePct * 100) / 100,
            levels: spyLevels,
            context: {
                regime: scan.regime,
                gamma_regime: spyLevels.gammaRegime || 'unknown',
                iv_rank: spyLevels.ivRank || 0
            }
        },
        qqq: {
            price: qqqResult?.price || qqqLevels?.underlying_price || 0,
            change_pct: Math.round(qqqChangePct * 100) / 100,
            levels: qqqLevels,
            context: {}
        },
        market_context: {
            vix_regime: scan.vix_regime,
            spy_trend: scan.spy_trend,
            risk_appetite: scan.risk_appetite,
            position_size_modifier: scan.position_size_modifier,
            bias: 'NEUTRAL',
            swing_bias: 'NEUTRAL',
            gamma_regime: spyLevels.gammaRegime || 'unknown',
            iv_rank: spyLevels.ivRank || 0
        },
        discovery: {
            themes: [],
            intradayBias: 'NEUTRAL',
            swingBias: 'NEUTRAL',
            sourcesUsed: JSON.parse(scan.sources_json || '[]')
        },
        symbolsScanned: scan.scan_count,
        topOpportunities: topOpportunities.map(r => ({
            symbol: r.symbol,
            score: r.score,
            direction: r.direction,
            tier: r.tier,
            signals: JSON.parse(r.signals_json || '[]'),
            atWall: r.to_put_wall !== null && Math.abs(r.to_put_wall) < 0.5 ||
                    r.to_call_wall !== null && Math.abs(r.to_call_wall) < 0.5,
            wallActivity: null,
            sources: JSON.parse(r.sources_json || '[]'),
            history_status: r.history_label ? {
                label: r.history_label,
                consecutive_days: r.consecutive_days,
                trend: r.history_trend
            } : null
        })),
        alertsSent: scan.alerts_sent,
        watchListCount: scan.watchlist_count
    };
}

/**
 * Delete bloodhound scans older than N days
 */
function cleanupOldBloodhoundScans(daysToKeep = 7) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

    // Delete results first (foreign key)
    const resultsDeleted = getDb().prepare(`
        DELETE FROM bloodhound_results
        WHERE scan_id IN (
            SELECT id FROM bloodhound_scans WHERE timestamp < ?
        )
    `).run(cutoff);

    // Delete scans
    const scansDeleted = getDb().prepare(`
        DELETE FROM bloodhound_scans WHERE timestamp < ?
    `).run(cutoff);

    if (scansDeleted.changes > 0) {
        console.log(`[SignalDB] Cleaned up ${scansDeleted.changes} old bloodhound scans (${resultsDeleted.changes} results)`);
    }

    return { scansDeleted: scansDeleted.changes, resultsDeleted: resultsDeleted.changes };
}

/**
 * Get bloodhound scan history (for analytics)
 */
function getBloodhoundScanHistory(limit = 100) {
    return getDb().prepare(`
        SELECT
            id,
            timestamp,
            vix,
            vix_regime,
            spy_trend,
            spy_price,
            scan_count,
            tradeable_count,
            alerts_sent
        FROM bloodhound_scans
        ORDER BY id DESC
        LIMIT ?
    `).all(limit);
}

// ============================================
// EARNINGS SCANNER FUNCTIONS
// ============================================

/**
 * Insert an earnings scan record
 * Returns the scan_id for linking results
 */
function insertEarningsScan(scanData) {
    const stmt = getDb().prepare(`
        INSERT INTO earnings_scans (
            timestamp, strategy, total_scanned,
            high_conviction_count, tradeable_count
        ) VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        scanData.timestamp || new Date().toISOString(),
        scanData.strategy || 'PREM',
        scanData.total_scanned || 0,
        scanData.high_conviction_count || 0,
        scanData.tradeable_count || 0
    );

    console.log(`[SignalDB] Inserted earnings scan: ${scanData.total_scanned} results, scanId=${result.lastInsertRowid}`);
    return result.lastInsertRowid;
}

/**
 * Insert a single earnings result linked to a scan
 */
function insertEarningsResult(scanId, result) {
    const stmt = getDb().prepare(`
        INSERT INTO earnings_results (
            scan_id, symbol, earnings_date, days_to_earnings, earnings_time,
            score, direction, tier, signals_json,
            price, rsi, trend, iv_rank, iv_percentile,
            spy_trend, vix, call_premium, put_premium, net_delta,
            timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        scanId,
        result.symbol,
        result.earnings_date,
        result.days_to_earnings,
        result.earnings_time,
        result.score,
        result.direction,
        result.tier,
        JSON.stringify(result.signals || []),
        result.details?.price || result.price,
        result.details?.rsi || result.rsi,
        result.details?.trend || result.trend,
        result.details?.ivRank,
        result.details?.ivPercentile,
        result.details?.spyTrend,
        result.details?.vix,
        result.details?.callPremium,
        result.details?.putPremium,
        result.details?.netDelta,
        result.timestamp || new Date().toISOString()
    );
}

/**
 * Get latest earnings scan with all results
 * Returns data shaped identically to earnings-scan.json
 */
function getLatestEarningsScan() {
    const scan = getDb().prepare(`
        SELECT * FROM earnings_scans ORDER BY id DESC LIMIT 1
    `).get();

    if (!scan) return null;

    const rows = getDb().prepare(`
        SELECT * FROM earnings_results WHERE scan_id = ? ORDER BY score DESC
    `).all(scan.id);

    return {
        last_updated: scan.timestamp,
        strategy: scan.strategy,
        total_scanned: scan.total_scanned,
        high_conviction: scan.high_conviction_count,
        tradeable: scan.tradeable_count,
        results: rows.map(r => ({
            symbol: r.symbol,
            earnings_date: r.earnings_date,
            days_to_earnings: r.days_to_earnings,
            earnings_time: r.earnings_time,
            score: r.score,
            direction: r.direction,
            tier: r.tier,
            signals: JSON.parse(r.signals_json || '[]'),
            details: {
                price: r.price,
                rsi: r.rsi,
                trend: r.trend,
                ivRank: r.iv_rank,
                ivPercentile: r.iv_percentile,
                spyTrend: r.spy_trend,
                vix: r.vix,
                callPremium: r.call_premium,
                putPremium: r.put_premium,
                netDelta: r.net_delta
            },
            timestamp: r.timestamp
        }))
    };
}

// ==================== POSITIONS FUNCTIONS ====================

/**
 * Get all open positions with computed summary
 */
function getOpenPositions() {
    const positions = getDb().prepare(
        'SELECT * FROM positions WHERE status = ? ORDER BY entry_date DESC'
    ).all('open');

    const totalExposure = positions.reduce((sum, p) => sum + (p.entry_price * (p.shares || 0)), 0);
    const totalRisk = positions.reduce((sum, p) => {
        if (!p.stop_price || !p.shares) return sum;
        return sum + Math.abs(p.entry_price - p.stop_price) * p.shares;
    }, 0);

    return {
        positions,
        summary: {
            total_open: positions.length,
            total_exposure: totalExposure,
            total_risk: totalRisk,
            total_unrealized_pnl: 0,
            total_unrealized_pnl_pct: 0
        }
    };
}

/**
 * Add a new position
 */
function addPosition(data) {
    const stmt = getDb().prepare(`
        INSERT INTO positions (symbol, direction, strategy, entry_price, stop_price, target_price, shares, entry_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        data.symbol,
        data.direction || 'long',
        data.strategy || null,
        data.entry_price,
        data.stop_price || null,
        data.target_price || null,
        data.shares || null,
        data.entry_date || new Date().toISOString(),
        data.notes || null
    );

    console.log(`[SignalDB] Added position: ${data.symbol} @ $${data.entry_price}`);
    return result.lastInsertRowid;
}

/**
 * Close a position by ID
 */
function closePosition(id, exitData) {
    const position = getDb().prepare('SELECT * FROM positions WHERE id = ?').get(id);
    if (!position) return null;

    const exitPrice = exitData.exit_price;
    const pnl = position.direction === 'short'
        ? (position.entry_price - exitPrice) * (position.shares || 0)
        : (exitPrice - position.entry_price) * (position.shares || 0);

    getDb().prepare(`
        UPDATE positions SET
            status = 'closed',
            exit_price = ?,
            exit_date = ?,
            exit_reason = ?,
            pnl = ?,
            updated_at = datetime('now')
        WHERE id = ?
    `).run(
        exitPrice,
        exitData.exit_date || new Date().toISOString(),
        exitData.exit_reason || null,
        pnl,
        id
    );

    console.log(`[SignalDB] Closed position #${id} (${position.symbol}): P&L $${pnl.toFixed(2)}`);
    return { id, symbol: position.symbol, pnl };
}

// ============================================
// MARKET INTERNALS FUNCTIONS
// ============================================

/**
 * Store a market internals snapshot
 */
function insertMarketInternals(data) {
    const stmt = getDb().prepare(`
        INSERT INTO market_internals (
            timestamp, date,
            tick, tick_high, tick_low,
            trin, advn, decn, ad_spread,
            uvol, dvol, vol_ratio,
            vix, vix_open, vix_high, vix_low, vix_change, vix_change_pct,
            spx, spx_change, spx_change_pct, spx_high, spx_low,
            compx, compx_change, compx_change_pct,
            dji, dji_change, dji_change_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        data.timestamp || new Date().toISOString(),
        data.date || new Date().toISOString().substring(0, 10),
        data.tick ?? null, data.tick_high ?? null, data.tick_low ?? null,
        data.trin ?? null, data.advn ?? null, data.decn ?? null, data.ad_spread ?? null,
        data.uvol ?? null, data.dvol ?? null, data.vol_ratio ?? null,
        data.vix ?? null, data.vix_open ?? null, data.vix_high ?? null, data.vix_low ?? null, data.vix_change ?? null, data.vix_change_pct ?? null,
        data.spx ?? null, data.spx_change ?? null, data.spx_change_pct ?? null, data.spx_high ?? null, data.spx_low ?? null,
        data.compx ?? null, data.compx_change ?? null, data.compx_change_pct ?? null,
        data.dji ?? null, data.dji_change ?? null, data.dji_change_pct ?? null
    );

    return result.lastInsertRowid;
}

/**
 * Get the most recent internals snapshot
 */
function getLatestInternals() {
    return getDb().prepare(`
        SELECT * FROM market_internals
        ORDER BY id DESC LIMIT 1
    `).get() || null;
}

/**
 * Get internals history for the last N hours (oldest first, for charts)
 */
function getInternalsHistory(hours = 6) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return getDb().prepare(`
        SELECT * FROM market_internals
        WHERE timestamp >= ?
        ORDER BY timestamp ASC
    `).all(cutoff);
}

/**
 * Get all internals readings for today (by date string)
 */
function getInternalsToday() {
    const today = new Date().toISOString().substring(0, 10);
    return getDb().prepare(`
        SELECT * FROM market_internals
        WHERE date = ?
        ORDER BY timestamp ASC
    `).all(today);
}

// ============================================================
// ANALYSIS JOURNAL FUNCTIONS
// ============================================================

/**
 * Insert a new analysis
 */
function insertAnalysis(data) {
    const stmt = getDb().prepare(`
        INSERT INTO analyses (
            symbol, analysis_date, score, tier, direction, verdict,
            price_at_analysis,
            bull_factors_json, bull_summary,
            bear_factors_json, bear_summary,
            sector_etf, sector_rsi, sector_rs_percentile, rotation_phase,
            put_wall, call_wall, max_pain, target_price, stop_price,
            vix, vix_regime, spy_trend, spy_price,
            verdict_reasoning, tags, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        data.symbol,
        data.analysis_date || new Date().toISOString(),
        data.score || null,
        data.tier || null,
        data.direction || null,
        data.verdict,
        data.price_at_analysis || null,
        data.bull_factors_json ? JSON.stringify(data.bull_factors_json) : null,
        data.bull_summary || null,
        data.bear_factors_json ? JSON.stringify(data.bear_factors_json) : null,
        data.bear_summary || null,
        data.sector_etf || null,
        data.sector_rsi || null,
        data.sector_rs_percentile || null,
        data.rotation_phase || null,
        data.put_wall || null,
        data.call_wall || null,
        data.max_pain || null,
        data.target_price || null,
        data.stop_price || null,
        data.vix || null,
        data.vix_regime || null,
        data.spy_trend || null,
        data.spy_price || null,
        data.verdict_reasoning || null,
        data.tags || null,
        data.source || 'manual'
    );

    console.log(`[SignalDB] Added analysis: ${data.symbol} - ${data.verdict}`);
    return result.lastInsertRowid;
}

/**
 * Get analyses with optional filtering
 */
function getAnalyses(filters = {}) {
    let query = 'SELECT * FROM analyses WHERE 1=1';
    const params = [];

    if (filters.symbol) {
        query += ' AND symbol = ?';
        params.push(filters.symbol.toUpperCase());
    }
    if (filters.verdict) {
        query += ' AND verdict = ?';
        params.push(filters.verdict);
    }
    if (filters.outcome) {
        query += ' AND outcome = ?';
        params.push(filters.outcome);
    }
    if (filters.direction) {
        query += ' AND direction = ?';
        params.push(filters.direction);
    }
    if (filters.has_outcome !== undefined) {
        query += filters.has_outcome ? ' AND outcome IS NOT NULL' : ' AND outcome IS NULL';
    }
    if (filters.days) {
        const cutoff = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000).toISOString();
        query += ' AND analysis_date >= ?';
        params.push(cutoff);
    }
    if (filters.tag) {
        query += ' AND tags LIKE ?';
        params.push(`%${filters.tag}%`);
    }

    query += ' ORDER BY analysis_date DESC';

    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
    }

    const rows = getDb().prepare(query).all(...params);

    return rows.map(row => ({
        ...row,
        bull_factors: row.bull_factors_json ? JSON.parse(row.bull_factors_json) : [],
        bear_factors: row.bear_factors_json ? JSON.parse(row.bear_factors_json) : []
    }));
}

/**
 * Get a single analysis by ID
 */
function getAnalysisById(id) {
    const row = getDb().prepare('SELECT * FROM analyses WHERE id = ?').get(id);
    if (!row) return null;
    return {
        ...row,
        bull_factors: row.bull_factors_json ? JSON.parse(row.bull_factors_json) : [],
        bear_factors: row.bear_factors_json ? JSON.parse(row.bear_factors_json) : []
    };
}

/**
 * Update the outcome for an existing analysis
 */
function updateAnalysisOutcome(id, outcomeData) {
    const analysis = getDb().prepare('SELECT * FROM analyses WHERE id = ?').get(id);
    if (!analysis) return null;

    let pctChange = null;
    if (outcomeData.outcome_price && analysis.price_at_analysis) {
        pctChange = ((outcomeData.outcome_price - analysis.price_at_analysis) / analysis.price_at_analysis) * 100;
        if (analysis.direction === 'bearish') pctChange = -pctChange;
    }

    getDb().prepare(`
        UPDATE analyses SET
            outcome = ?,
            outcome_price = ?,
            outcome_date = ?,
            outcome_notes = ?,
            outcome_pct_change = ?,
            thesis_correct = ?,
            updated_at = datetime('now')
        WHERE id = ?
    `).run(
        outcomeData.outcome,
        outcomeData.outcome_price || null,
        outcomeData.outcome_date || new Date().toISOString(),
        outcomeData.outcome_notes || null,
        pctChange,
        outcomeData.thesis_correct !== undefined ? outcomeData.thesis_correct : null,
        id
    );

    console.log(`[SignalDB] Updated analysis #${id} outcome: ${outcomeData.outcome}`);
    return { id, symbol: analysis.symbol, outcome: outcomeData.outcome, pct_change: pctChange };
}

/**
 * Get aggregate stats for the research dashboard
 */
function getAnalysisStats() {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM analyses').get().count;
    const withOutcome = db.prepare('SELECT COUNT(*) as count FROM analyses WHERE outcome IS NOT NULL').get().count;

    const byVerdict = db.prepare(
        'SELECT verdict, COUNT(*) as count FROM analyses GROUP BY verdict'
    ).all();

    const byOutcome = db.prepare(
        'SELECT outcome, COUNT(*) as count FROM analyses WHERE outcome IS NOT NULL GROUP BY outcome'
    ).all();

    const thesisAccuracy = db.prepare(
        'SELECT COUNT(*) as total, SUM(CASE WHEN thesis_correct = 1 THEN 1 ELSE 0 END) as correct FROM analyses WHERE thesis_correct IS NOT NULL'
    ).get();

    const avgPctChange = db.prepare(
        'SELECT AVG(outcome_pct_change) as avg_change FROM analyses WHERE outcome_pct_change IS NOT NULL'
    ).get();

    const uniqueSymbols = db.prepare('SELECT COUNT(DISTINCT symbol) as count FROM analyses').get().count;

    return {
        total,
        pending: total - withOutcome,
        with_outcome: withOutcome,
        unique_symbols: uniqueSymbols,
        by_verdict: byVerdict,
        by_outcome: byOutcome,
        thesis_accuracy: thesisAccuracy.total > 0
            ? ((thesisAccuracy.correct / thesisAccuracy.total) * 100).toFixed(1)
            : null,
        thesis_total: thesisAccuracy.total,
        avg_pct_change: avgPctChange.avg_change
    };
}

module.exports = {
    getDb,
    insertSignal,
    updatePriceTracking,
    recordCheckpoint,
    closeSignal,
    closeStaleSignals,
    getSignalsForCheckpoint,
    getActiveSignals,
    hasSignalToday,
    getStats,
    getStatsByTier,
    getStatsByVixRegime,
    getStatsByDirection,
    compareCheckpoints,
    getRecentSignals,
    getDatabaseStats,
    // Scanner history functions
    upsertScannerHistory,
    getScannerHistory,
    computeHistoryStatus,
    computeGapHistoryStatus,
    getAllHistoryStatuses,
    // Velocity tracking (replaces signal_tracking.json)
    getSymbolVelocity,
    getAllVelocities,
    // Alerts functions (replaces alerts_log.json)
    insertAlert,
    getRecentAlerts,
    getAlertsForDashboard,
    // Pre-market functions
    insertPremarketScan,
    insertPremarketMover,
    getRecentPremarketScans,
    getPremarketMovers,
    getLatestPremarketData,
    getTodayPremarketStats,
    getTodaySessionMovers,
    // Gap analytics functions
    updateGapEOD,
    getGapsNeedingEOD,
    getGapFillRates,
    getTickerGapHistory,
    getRepeatOffenders,
    getTodayGapsWithHistory,
    updateTickerStats,
    getAllTickerStats,
    // Session watchlist functions (database-backed, persists after premarket.json clears)
    getSessionWatchlist,
    getSessionDates,
    // Watchlist functions
    addToWatchlist,
    removeFromWatchlist,
    setWatchlistEnabled,
    setWatchlistNotes,
    getWatchlist,
    getWatchlistFull,
    getWatchlistPartitioned,
    isInWatchlist,
    updateWatchlistScanned,
    cleanExpiredWatchlist,
    migrateWatchlistFromJson,
    getWatchlistStats,
    // Option signal tracking functions
    updateOptionPriceTracking,
    closeOptionSignal,
    checkWallHit,
    getOptionSignalStats,
    // Bloodhound scanner functions
    insertBloodhoundScan,
    insertBloodhoundResults,
    getLatestBloodhoundScan,
    getBloodhoundScanSummary,
    cleanupOldBloodhoundScans,
    getBloodhoundScanHistory,
    // Earnings scanner functions
    insertEarningsScan,
    insertEarningsResult,
    getLatestEarningsScan,
    // Positions functions (replaces positions.json)
    getOpenPositions,
    addPosition,
    closePosition,
    // Market internals functions
    insertMarketInternals,
    getLatestInternals,
    getInternalsHistory,
    getInternalsToday,
    // Analysis journal functions
    insertAnalysis,
    getAnalyses,
    getAnalysisById,
    updateAnalysisOutcome,
    getAnalysisStats
};
