"""PARABOLA FastAPI application entrypoint."""
from __future__ import annotations

import base64
import logging
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import SessionLocal, init_db
from app.routers import backtests, data, health, signals, strategies, sweeps, walkforward
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

@app.middleware("http")
async def password_gate(request: Request, call_next):
    """HTTP basic auth over the whole app when BASIC_AUTH_USER is set. /health is
    left open so cloud health checks work. No user configured => no auth (dev)."""
    user = settings.basic_auth_user
    if user and request.url.path != "/health":
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode("utf-8")
                u, _, p = decoded.partition(":")
                ok = secrets.compare_digest(u, user) and secrets.compare_digest(
                    p, settings.basic_auth_pass
                )
            except Exception:
                ok = False
        if not ok:
            return Response(
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="BACKTEST"'},
                content="Authentication required",
            )
    return await call_next(request)


app.include_router(health.router)
app.include_router(strategies.router)
app.include_router(backtests.router)
app.include_router(signals.router)
app.include_router(data.router)
app.include_router(sweeps.router)
app.include_router(walkforward.router)


# Single-origin serving: when a built frontend is present, serve it at "/" (added
# last so the API routes above take precedence). Otherwise expose a JSON root.
if settings.frontend_dist and os.path.isdir(settings.frontend_dist):
    app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")
else:

    @app.get("/")
    def root() -> dict:
        return {"name": "BACKTEST", "docs": "/docs", "health": "/health"}
