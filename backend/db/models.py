"""
Database Models
Data classes and helper functions for database entities
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any, List
import json
import uuid

from backend.db.database import get_db


@dataclass
class Alert:
    """Alert model with database persistence"""
    id: str
    type: str
    severity: str
    symbol: str
    message: str
    data: Dict[str, Any] = field(default_factory=dict)
    read: bool = False
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        timestamp = self.created_at.isoformat() if self.created_at else None
        return {
            "id": self.id,
            "type": self.type,
            "severity": self.severity,
            "symbol": self.symbol,
            "message": self.message,
            "data": self.data,
            "read": self.read,
            "created_at": timestamp,
            "timestamp": timestamp,  # Alias for frontend compatibility
        }

    @classmethod
    def from_row(cls, row) -> "Alert":
        """Create Alert from database row"""
        return cls(
            id=row["id"],
            type=row["type"],
            severity=row["severity"],
            symbol=row["symbol"],
            message=row["message"],
            data=json.loads(row["data"]) if row["data"] else {},
            read=bool(row["read"]),
            created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
        )

    def save(self):
        """Save alert to database"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO alerts (id, type, severity, symbol, message, data, read, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                self.id,
                self.type,
                self.severity,
                self.symbol,
                self.message,
                json.dumps(self.data),
                1 if self.read else 0,
                self.created_at.isoformat() if self.created_at else datetime.now().isoformat(),
            ))

    @classmethod
    def get_all(cls, limit: int = 100, unread_only: bool = False,
                severity: Optional[str] = None, symbol: Optional[str] = None,
                alert_type: Optional[str] = None) -> List["Alert"]:
        """Get alerts with optional filtering"""
        with get_db() as conn:
            cursor = conn.cursor()

            query = "SELECT * FROM alerts WHERE 1=1"
            params = []

            if unread_only:
                query += " AND read = 0"
            if severity:
                query += " AND severity = ?"
                params.append(severity)
            if symbol:
                query += " AND symbol LIKE ?"
                params.append(f"%{symbol}%")
            if alert_type:
                query += " AND type = ?"
                params.append(alert_type)

            query += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)

            cursor.execute(query, params)
            return [cls.from_row(row) for row in cursor.fetchall()]

    @classmethod
    def mark_read(cls, alert_id: str) -> bool:
        """Mark an alert as read"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE alerts SET read = 1 WHERE id = ?", (alert_id,))
            return cursor.rowcount > 0

    @classmethod
    def mark_all_read(cls) -> int:
        """Mark all alerts as read"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE alerts SET read = 1 WHERE read = 0")
            return cursor.rowcount

    @classmethod
    def get_count(cls, unread_only: bool = False) -> int:
        """Get alert count"""
        with get_db() as conn:
            cursor = conn.cursor()
            if unread_only:
                cursor.execute("SELECT COUNT(*) FROM alerts WHERE read = 0")
            else:
                cursor.execute("SELECT COUNT(*) FROM alerts")
            return cursor.fetchone()[0]

    @classmethod
    def delete_old(cls, days: int = 90) -> int:
        """Delete alerts older than specified days"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM alerts
                WHERE created_at < datetime('now', ?)
            """, (f'-{days} days',))
            return cursor.rowcount


@dataclass
class DivergenceEvent:
    """Tracks divergence events over time"""
    id: Optional[int]
    symbol_a: str
    symbol_b: str
    type: str
    detected_at: datetime
    resolved_at: Optional[datetime] = None
    peak_strength: Optional[float] = None
    peak_zscore: Optional[float] = None
    initial_zscore: Optional[float] = None
    initial_strength: Optional[float] = None
    resolution_outcome: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "symbol_a": self.symbol_a,
            "symbol_b": self.symbol_b,
            "type": self.type,
            "detected_at": self.detected_at.isoformat() if self.detected_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "peak_strength": self.peak_strength,
            "peak_zscore": self.peak_zscore,
            "initial_zscore": self.initial_zscore,
            "initial_strength": self.initial_strength,
            "resolution_outcome": self.resolution_outcome,
            "duration_hours": self.duration_hours,
        }

    @property
    def duration_hours(self) -> Optional[float]:
        """Calculate duration in hours"""
        if self.resolved_at and self.detected_at:
            delta = self.resolved_at - self.detected_at
            return delta.total_seconds() / 3600
        elif self.detected_at:
            delta = datetime.now() - self.detected_at
            return delta.total_seconds() / 3600
        return None

    @classmethod
    def from_row(cls, row) -> "DivergenceEvent":
        """Create from database row"""
        return cls(
            id=row["id"],
            symbol_a=row["symbol_a"],
            symbol_b=row["symbol_b"],
            type=row["type"],
            detected_at=datetime.fromisoformat(row["detected_at"]) if row["detected_at"] else None,
            resolved_at=datetime.fromisoformat(row["resolved_at"]) if row["resolved_at"] else None,
            peak_strength=row["peak_strength"],
            peak_zscore=row["peak_zscore"],
            initial_zscore=row["initial_zscore"],
            initial_strength=row["initial_strength"],
            resolution_outcome=row["resolution_outcome"],
        )

    def save(self) -> int:
        """Save to database, returns ID"""
        with get_db() as conn:
            cursor = conn.cursor()
            if self.id:
                cursor.execute("""
                    UPDATE divergence_events SET
                        resolved_at = ?, peak_strength = ?, peak_zscore = ?,
                        resolution_outcome = ?
                    WHERE id = ?
                """, (
                    self.resolved_at.isoformat() if self.resolved_at else None,
                    self.peak_strength,
                    self.peak_zscore,
                    self.resolution_outcome,
                    self.id,
                ))
                return self.id
            else:
                cursor.execute("""
                    INSERT INTO divergence_events
                    (symbol_a, symbol_b, type, detected_at, initial_zscore, initial_strength)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    self.symbol_a,
                    self.symbol_b,
                    self.type,
                    self.detected_at.isoformat(),
                    self.initial_zscore,
                    self.initial_strength,
                ))
                self.id = cursor.lastrowid
                return self.id

    @classmethod
    def find_active(cls, symbol_a: str, symbol_b: str) -> Optional["DivergenceEvent"]:
        """Find active (unresolved) divergence for a pair"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM divergence_events
                WHERE symbol_a = ? AND symbol_b = ? AND resolved_at IS NULL
                ORDER BY detected_at DESC LIMIT 1
            """, (symbol_a, symbol_b))
            row = cursor.fetchone()
            return cls.from_row(row) if row else None

    @classmethod
    def get_history(cls, symbol_a: Optional[str] = None, symbol_b: Optional[str] = None,
                    days: int = 90, limit: int = 100) -> List["DivergenceEvent"]:
        """Get divergence history with optional filtering"""
        with get_db() as conn:
            cursor = conn.cursor()

            query = """
                SELECT * FROM divergence_events
                WHERE detected_at > datetime('now', ?)
            """
            params = [f'-{days} days']

            if symbol_a:
                query += " AND symbol_a = ?"
                params.append(symbol_a)
            if symbol_b:
                query += " AND symbol_b = ?"
                params.append(symbol_b)

            query += " ORDER BY detected_at DESC LIMIT ?"
            params.append(limit)

            cursor.execute(query, params)
            return [cls.from_row(row) for row in cursor.fetchall()]


@dataclass
class RSSnapshot:
    """Historical RS ranking snapshot"""
    id: Optional[int]
    symbol: str
    rs_score: float
    rs_rank: int
    performance_1d: Optional[float] = None
    performance_5d: Optional[float] = None
    performance_20d: Optional[float] = None
    performance_60d: Optional[float] = None
    snapshot_at: datetime = field(default_factory=datetime.now)

    def save(self):
        """Save to database"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO rs_snapshots
                (symbol, rs_score, rs_rank, performance_1d, performance_5d,
                 performance_20d, performance_60d, snapshot_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                self.symbol,
                self.rs_score,
                self.rs_rank,
                self.performance_1d,
                self.performance_5d,
                self.performance_20d,
                self.performance_60d,
                self.snapshot_at.isoformat(),
            ))

    @classmethod
    def get_history(cls, symbol: str, days: int = 30) -> List[dict]:
        """Get RS history for a symbol"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT rs_score, rs_rank, snapshot_at
                FROM rs_snapshots
                WHERE symbol = ? AND snapshot_at > datetime('now', ?)
                ORDER BY snapshot_at ASC
            """, (symbol, f'-{days} days'))
            return [dict(row) for row in cursor.fetchall()]

    @classmethod
    def cleanup_old(cls, days: int = 90) -> int:
        """Delete old snapshots to manage database size"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM rs_snapshots
                WHERE snapshot_at < datetime('now', ?)
            """, (f'-{days} days',))
            return cursor.rowcount


@dataclass
class AlertSettings:
    """User-configurable alert settings"""
    correlation_threshold: float = 2.0
    rs_threshold: float = 5.0
    critical_zscore: float = 2.5
    warning_zscore: float = 2.0
    sound_enabled: bool = True
    browser_notifications: bool = True

    def to_dict(self) -> dict:
        return {
            "correlation_threshold": self.correlation_threshold,
            "rs_threshold": self.rs_threshold,
            "critical_zscore": self.critical_zscore,
            "warning_zscore": self.warning_zscore,
            "sound_enabled": self.sound_enabled,
            "browser_notifications": self.browser_notifications,
        }

    @classmethod
    def load(cls) -> "AlertSettings":
        """Load settings from database"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM alert_settings WHERE id = 1")
            row = cursor.fetchone()
            if row:
                return cls(
                    correlation_threshold=row["correlation_threshold"],
                    rs_threshold=row["rs_threshold"],
                    critical_zscore=row["critical_zscore"],
                    warning_zscore=row["warning_zscore"],
                    sound_enabled=bool(row["sound_enabled"]),
                    browser_notifications=bool(row["browser_notifications"]),
                )
            return cls()

    def save(self):
        """Save settings to database"""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE alert_settings SET
                    correlation_threshold = ?,
                    rs_threshold = ?,
                    critical_zscore = ?,
                    warning_zscore = ?,
                    sound_enabled = ?,
                    browser_notifications = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            """, (
                self.correlation_threshold,
                self.rs_threshold,
                self.critical_zscore,
                self.warning_zscore,
                1 if self.sound_enabled else 0,
                1 if self.browser_notifications else 0,
            ))
