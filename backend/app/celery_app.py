"""Celery application. Supports an eager (in-process) mode for local/no-infra
runs via CELERY_TASK_ALWAYS_EAGER, so the full backtest lifecycle works without
a broker or worker."""
from __future__ import annotations

from celery import Celery

from app.config import settings

# In eager mode, use an in-memory transport so no Redis broker is required.
_broker = "memory://" if settings.celery_task_always_eager else settings.celery_broker_url
_backend = "cache+memory://" if settings.celery_task_always_eager else settings.celery_result_backend

celery_app = Celery(
    "parabola",
    broker=_broker,
    backend=_backend,
    include=[
        "app.tasks.backtests",
        "app.tasks.sweeps",
        "app.tasks.ingestion",
    ],
)

celery_app.conf.update(
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=settings.celery_task_always_eager,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)
