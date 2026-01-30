"""
Alerts API Routes
Alert management and retrieval with database persistence
"""
from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from datetime import datetime
from enum import Enum
import uuid
import logging

from backend.db.models import Alert as AlertModel, AlertSettings

router = APIRouter(prefix="/alerts", tags=["Alerts"])
logger = logging.getLogger(__name__)


class AlertSeverity(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertType(Enum):
    CORRELATION_BREAKDOWN = "correlation_breakdown"
    RS_SHIFT = "rs_shift"
    ROTATION = "rotation"
    PRICE_EXTREME = "price_extreme"


def determine_severity(zscore: float, rs_direction: str, settings: AlertSettings = None) -> AlertSeverity:
    """
    Determine alert severity based on 3-tier system:
    - CRITICAL: |z-score| >= critical_zscore (default 2.5)
    - WARNING: |z-score| >= warning_zscore (default 2.0) OR rs_direction shift
    - INFO: Any other divergence
    """
    if settings is None:
        settings = AlertSettings.load()

    if abs(zscore) >= settings.critical_zscore:
        return AlertSeverity.CRITICAL
    elif abs(zscore) >= settings.warning_zscore or rs_direction != "neutral":
        return AlertSeverity.WARNING
    else:
        return AlertSeverity.INFO


def add_alert(
    alert_type: AlertType,
    severity: AlertSeverity,
    symbol: str,
    message: str,
    data: dict = None
) -> AlertModel:
    """Add a new alert to the database"""
    alert = AlertModel(
        id=str(uuid.uuid4()),
        type=alert_type.value,
        severity=severity.value,
        symbol=symbol,
        message=message,
        data=data or {},
        read=False,
        created_at=datetime.now()
    )
    alert.save()
    logger.info(f"Alert created: [{severity.value}] {symbol} - {message[:50]}")
    return alert


def get_unread_alerts():
    """Get all unread alerts"""
    return AlertModel.get_all(unread_only=True)


@router.get("")
async def get_alerts(
    unread_only: bool = Query(False, description="Only return unread alerts"),
    limit: int = Query(50, ge=1, le=500, description="Maximum alerts to return"),
    severity: Optional[str] = Query(None, description="Filter by severity: info, warning, critical"),
    symbol: Optional[str] = Query(None, description="Filter by symbol (partial match)"),
    alert_type: Optional[str] = Query(None, description="Filter by type: correlation_breakdown, rs_shift, rotation")
):
    """
    Get alerts with filtering.
    """
    alerts = AlertModel.get_all(
        limit=limit,
        unread_only=unread_only,
        severity=severity,
        symbol=symbol,
        alert_type=alert_type
    )

    return {
        "alerts": [a.to_dict() for a in alerts],
        "count": len(alerts),
        "unread_count": AlertModel.get_count(unread_only=True),
    }


@router.get("/count")
async def get_alert_count():
    """
    Get alert counts by severity.
    """
    with_severity = {}
    for sev in ["info", "warning", "critical"]:
        with_severity[sev] = len(AlertModel.get_all(limit=1000, severity=sev))

    return {
        "total": AlertModel.get_count(),
        "unread": AlertModel.get_count(unread_only=True),
        "by_severity": with_severity
    }


@router.post("/mark-read/{alert_id}")
async def mark_alert_read(alert_id: str):
    """
    Mark a single alert as read.
    """
    success = AlertModel.mark_read(alert_id)
    if success:
        return {"status": "ok", "alert_id": alert_id}
    return {"status": "not_found", "alert_id": alert_id}


@router.post("/mark-all-read")
async def mark_all_read():
    """
    Mark all alerts as read.
    """
    count = AlertModel.mark_all_read()
    return {"status": "ok", "marked_count": count}


@router.delete("")
async def clear_alerts(
    days_old: int = Query(None, description="Only clear alerts older than N days")
):
    """
    Clear alerts. Optionally only clear old alerts.
    """
    if days_old:
        count = AlertModel.delete_old(days=days_old)
        return {"status": "ok", "cleared_count": count, "criteria": f"older than {days_old} days"}
    else:
        # Clear all by deleting very old (365 days covers everything)
        count = AlertModel.delete_old(days=0)
        return {"status": "ok", "cleared_count": count}


# Settings endpoints
@router.get("/settings")
async def get_alert_settings():
    """
    Get current alert threshold settings.
    """
    settings = AlertSettings.load()
    return settings.to_dict()


@router.post("/settings")
async def update_alert_settings(
    correlation_threshold: Optional[float] = Query(None, ge=0.5, le=5.0),
    rs_threshold: Optional[float] = Query(None, ge=1.0, le=20.0),
    critical_zscore: Optional[float] = Query(None, ge=1.5, le=5.0),
    warning_zscore: Optional[float] = Query(None, ge=1.0, le=4.0),
    sound_enabled: Optional[bool] = Query(None),
    browser_notifications: Optional[bool] = Query(None)
):
    """
    Update alert threshold settings.
    """
    settings = AlertSettings.load()

    if correlation_threshold is not None:
        settings.correlation_threshold = correlation_threshold
    if rs_threshold is not None:
        settings.rs_threshold = rs_threshold
    if critical_zscore is not None:
        settings.critical_zscore = critical_zscore
    if warning_zscore is not None:
        settings.warning_zscore = warning_zscore
    if sound_enabled is not None:
        settings.sound_enabled = sound_enabled
    if browser_notifications is not None:
        settings.browser_notifications = browser_notifications

    # Validate critical > warning
    if settings.critical_zscore <= settings.warning_zscore:
        raise HTTPException(
            status_code=400,
            detail="Critical z-score must be greater than warning z-score"
        )

    settings.save()
    logger.info(f"Alert settings updated: {settings.to_dict()}")
    return {"status": "ok", "settings": settings.to_dict()}


@router.post("/settings/reset")
async def reset_alert_settings():
    """
    Reset settings to defaults.
    """
    settings = AlertSettings()  # Default values
    settings.save()
    return {"status": "ok", "settings": settings.to_dict()}
