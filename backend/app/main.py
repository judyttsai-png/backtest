"""PARABOLA FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import SessionLocal, init_db
from app.routers import backtests, data, health, signals, strategies, sweeps
from app.seed import seed_strategy_models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("parabola")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        seed_strategy_models(db)
        logger.info("PARABOLA backend ready (provider=%s, eager=%s)",
                    settings.default_data_provider, settings.celery_task_always_eager)
    finally:
        db.close()
    yield


app = FastAPI(title="PARABOLA", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(strategies.router)
app.include_router(backtests.router)
app.include_router(signals.router)
app.include_router(data.router)
app.include_router(sweeps.router)


@app.get("/")
def root() -> dict:
    return {"name": "PARABOLA", "docs": "/docs", "health": "/health"}
