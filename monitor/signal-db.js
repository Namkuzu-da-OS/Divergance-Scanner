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

// Use the same database as opportunity scanner - consolidated storage
const DB_PATH = path.join(__dirname, '..', 'data', 'opportunity_history.db');

// Valid checkpoint types - whitelist for SQL injection prevention
const VALID_CHECKPOINT_TYPES = ['4h', '24h', '7d'];
const CHECKPOINT_HOURS = { '4h': 4, '24h': 24, '7d': 168 };

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
            FOREIGN KEY (scan_id) REFERENCES premarket_scans(id)
        );

        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
        CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
        CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
        CREATE INDEX IF NOT EXISTS idx_signals_tier ON signals(tier);
        CREATE INDEX IF NOT EXISTS idx_signals_direction ON signals(direction);
        CREATE INDEX IF NOT EXISTS idx_signals_vix_regime ON signals(vix_regime);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_signal ON checkpoints(signal_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_type ON checkpoints(checkpoint_type);
        CREATE INDEX IF NOT EXISTS idx_price_snapshots_signal ON price_snapshots(signal_id);
        CREATE INDEX IF NOT EXISTS idx_scanner_history_symbol ON scanner_history(symbol);
        CREATE INDEX IF NOT EXISTS idx_scanner_history_date ON scanner_history(date);
        CREATE INDEX IF NOT EXISTS idx_premarket_scans_timestamp ON premarket_scans(timestamp);
        CREATE INDEX IF NOT EXISTS idx_premarket_movers_symbol ON premarket_movers(symbol);
        CREATE INDEX IF NOT EXISTS idx_premarket_movers_scan ON premarket_movers(scan_id);
    `);
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
            status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);

    try {
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
            signalData.consecutive_days || null
        );
        console.log(`[SignalDB] Inserted signal ${signalData.id} @ $${signalData.entry_price}`);
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
 */
function updatePriceTracking(signalId, currentPrice) {
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
        // Pinned - just track absolute deviation as drawdown
        peakGainPct = 0;
        maxDrawdownPct = -Math.max(
            Math.abs(((newPeak - signal.entry_price) / signal.entry_price) * 100),
            Math.abs(((newTrough - signal.entry_price) / signal.entry_price) * 100)
        );
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

    // Record price snapshot (every update)
    const hoursElapsed = (Date.now() - new Date(signal.timestamp).getTime()) / (1000 * 60 * 60);
    getDb().prepare(`
        INSERT INTO price_snapshots (signal_id, timestamp, hours_elapsed, price, pct_change)
        VALUES (?, ?, ?, ?, ?)
    `).run(signalId, now, hoursElapsed, currentPrice, pctChange);

    return true;
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

    return getDb().prepare(`
        SELECT * FROM signals
        WHERE status = 'active'
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
 */
function upsertScannerHistory(symbol, date, data) {
    const existing = getDb().prepare(
        'SELECT * FROM scanner_history WHERE symbol = ? AND date = ?'
    ).get(symbol, date);

    if (existing) {
        // Update existing record
        getDb().prepare(`
            UPDATE scanner_history SET
                scans_today = scans_today + 1,
                peak_score = MAX(peak_score, ?),
                peak_zone = CASE WHEN ? > peak_score THEN ? ELSE peak_zone END,
                high_price = MAX(high_price, ?),
                low_price = MIN(low_price, ?),
                close_price = ?,
                rsi_eod = ?
            WHERE symbol = ? AND date = ?
        `).run(
            data.score || 0,
            data.score || 0, data.zone,
            data.price || 0,
            data.price || 999999,
            data.price,
            data.rsi,
            symbol, date
        );
    } else {
        // Insert new record
        getDb().prepare(`
            INSERT INTO scanner_history (
                symbol, date, first_seen, scans_today,
                peak_score, peak_zone,
                open_price, high_price, low_price, close_price,
                gap_pct, rsi_eod
            ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            symbol, date, data.first_seen || new Date().toISOString(),
            data.score || 0, data.zone,
            data.price, data.price, data.price, data.price,
            data.gap_pct || 0, data.rsi
        );
    }
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
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Check consecutive days
    let consecutiveDays = 0;
    const sortedDates = history.map(h => h.date).sort().reverse();

    for (let i = 0; i < sortedDates.length; i++) {
        const expectedDate = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        if (sortedDates[i] === expectedDate) {
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

module.exports = {
    getDb,
    insertSignal,
    updatePriceTracking,
    recordCheckpoint,
    closeSignal,
    closeStaleSignals,
    getSignalsForCheckpoint,
    getActiveSignals,
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
    getAllHistoryStatuses,
    // Pre-market functions
    insertPremarketScan,
    insertPremarketMover,
    getRecentPremarketScans,
    getPremarketMovers,
    getLatestPremarketData,
    getTodayPremarketStats,
    getTodaySessionMovers
};
