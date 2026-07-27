"""Health and root endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "parabola-backend",
        "provider": settings.default_data_provider,
        "eager": settings.celery_task_always_eager,
    }
