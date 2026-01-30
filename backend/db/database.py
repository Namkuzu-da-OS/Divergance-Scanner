"""
SQLite Database Connection
Provides persistent storage for alerts, divergence events, and RS snapshots
"""
import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager
from typing import Generator
import logging

logger = logging.getLogger(__name__)

# Database file location
DB_DIR = Path(__file__).parent.parent.parent / "data"
DB_PATH = DB_DIR / "divergence_scanner.db"


def ensure_db_dir():
    """Ensure the data directory exists"""
    DB_DIR.mkdir(parents=True, exist_ok=True)


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager for database connections.
    Usage:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(...)
    """
    ensure_db_dir()
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row  # Enable dict-like access
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the database schema"""
    ensure_db_dir()

    with get_db() as conn:
        cursor = conn.cursor()

        # Alerts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                severity TEXT NOT NULL,
                symbol TEXT NOT NULL,
                message TEXT NOT NULL,
                data TEXT,
                read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Index for common queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_alerts_created
            ON alerts(created_at DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_alerts_severity
            ON alerts(severity)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_alerts_symbol
            ON alerts(symbol)
        """)

        # Divergence events table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS divergence_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol_a TEXT NOT NULL,
                symbol_b TEXT NOT NULL,
                type TEXT NOT NULL,
                detected_at TIMESTAMP NOT NULL,
                resolved_at TIMESTAMP,
                peak_strength REAL,
                peak_zscore REAL,
                initial_zscore REAL,
                initial_strength REAL,
                resolution_outcome TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Index for divergence queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_divergence_pair
            ON divergence_events(symbol_a, symbol_b)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_divergence_detected
            ON divergence_events(detected_at DESC)
        """)

        # RS snapshots table (for historical tracking)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rs_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                rs_score REAL,
                rs_rank INTEGER,
                performance_1d REAL,
                performance_5d REAL,
                performance_20d REAL,
                performance_60d REAL,
                snapshot_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Index for RS queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_rs_symbol
            ON rs_snapshots(symbol, snapshot_at DESC)
        """)

        # Alert settings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alert_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                correlation_threshold REAL DEFAULT 2.0,
                rs_threshold REAL DEFAULT 5.0,
                critical_zscore REAL DEFAULT 2.5,
                warning_zscore REAL DEFAULT 2.0,
                sound_enabled INTEGER DEFAULT 1,
                browser_notifications INTEGER DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Insert default settings if not exists
        cursor.execute("""
            INSERT OR IGNORE INTO alert_settings (id) VALUES (1)
        """)

        conn.commit()
        logger.info(f"Database initialized at {DB_PATH}")


def get_db_path() -> str:
    """Get the database file path"""
    return str(DB_PATH)
