"""
Configuration settings for the Divergence Scanner
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # API settings
    api_title: str = "Inter-Market Divergence Scanner"
    api_version: str = "1.0.0"
    api_prefix: str = "/api"

    # Server settings - UNIQUE PORT to avoid conflicts
    host: str = "0.0.0.0"
    port: int = 8042

    # Data server connection (your Options Calc server)
    data_server_url: str = "http://192.168.1.100:8000"  # Update this in .env
    data_server_timeout: int = 30

    # Polling intervals (seconds)
    quote_poll_interval: float = 5.0       # Quotes for real-time display
    history_poll_interval: float = 300.0   # Price history (5 minutes)
    divergence_scan_interval: float = 60.0 # Divergence calculations

    # Divergence thresholds
    correlation_breakdown_threshold: float = 2.0  # Z-score threshold
    rs_change_threshold: float = 5.0              # % RS change to trigger alert

    # CORS settings - allow all origins for LAN access
    cors_origins: List[str] = ["*"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()
