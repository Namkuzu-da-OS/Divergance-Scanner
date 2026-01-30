"""API Routes"""
from .relative_strength import router as relative_strength_router
from .divergence import router as divergence_router
from .rotation import router as rotation_router
from .alerts import router as alerts_router

__all__ = [
    "relative_strength_router",
    "divergence_router",
    "rotation_router",
    "alerts_router",
]
