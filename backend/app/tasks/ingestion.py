"""Data ingestion Celery task."""
from __future__ import annotations

import logging
from datetime import datetime

from app.celery_app import celery_app
from app.db import SessionLocal
from app.services.data_manager import ingest_symbol

logger = logging.getLogger(__name__)


@celery_app.task(bind=True)
def ingest_symbols_task(
    self,
    symbols: list[str],
    timeframe: str,
    start_iso: str,
    end_iso: str,
    provider: str | None = None,
):
    db = SessionLocal()
    results = []
    try:
        start = datetime.fromisoformat(start_iso)
        end = datetime.fromisoformat(end_iso)
        for symbol in symbols:
            results.append(
                ingest_symbol(
                    db, symbol, timeframe=timeframe, start=start, end=end, provider=provider
                )
            )
        return {"results": results}
    except Exception:
        logger.exception("ingestion failed for %s", symbols)
        db.rollback()
        raise
    finally:
        db.close()
