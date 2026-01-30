"""
Inter-Market Divergence Scanner - FastAPI Backend
"""
import sys
import os
from pathlib import Path

# Add project root to path for module imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from backend.core.config import get_settings
from backend.api.routes import (
    relative_strength_router,
    divergence_router,
    rotation_router,
    alerts_router,
)
from backend.api.websocket import router as ws_router
from backend.services.polling_service import get_polling_service
from backend.services.data_client import shutdown_data_client
from backend.db.database import init_db, get_db_path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    logger.info("=" * 50)
    logger.info("Starting Inter-Market Divergence Scanner")
    logger.info(f"Data server: {settings.data_server_url}")
    logger.info(f"Running on port: {settings.port}")
    logger.info("=" * 50)

    # Initialize database
    init_db()
    logger.info(f"Database initialized at {get_db_path()}")

    # Start polling service
    polling_service = get_polling_service()
    polling_service.start()
    logger.info("Polling service started")

    yield

    # Shutdown
    logger.info("Shutting down...")
    polling_service.stop()
    await shutdown_data_client()
    logger.info("Shutdown complete")


app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description="Inter-Market Divergence Scanner - Track SPY vs QQQ, sector rotation, and money flow",
    lifespan=lifespan
)

# CORS middleware - allow all origins for LAN access
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # Must be False when using wildcard origins
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(relative_strength_router, prefix=settings.api_prefix)
app.include_router(divergence_router, prefix=settings.api_prefix)
app.include_router(rotation_router, prefix=settings.api_prefix)
app.include_router(alerts_router, prefix=settings.api_prefix)
app.include_router(ws_router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": settings.api_title,
        "version": settings.api_version,
        "status": "running",
        "data_server": settings.data_server_url,
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    from backend.services.data_client import get_data_client

    client = get_data_client()
    data_server_healthy = await client.health_check()

    return {
        "status": "healthy" if data_server_healthy else "degraded",
        "data_server": "connected" if data_server_healthy else "disconnected",
    }


@app.get("/api/symbols")
async def get_symbols():
    """Get all tracked symbols"""
    from backend.core.symbols import SYMBOL_UNIVERSE, ALL_SYMBOLS

    return {
        "symbols": ALL_SYMBOLS,
        "by_category": {
            category: list(symbols.keys())
            for category, symbols in SYMBOL_UNIVERSE.items()
        },
        "total": len(ALL_SYMBOLS),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
