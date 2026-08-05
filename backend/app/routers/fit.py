"""Strategy-fit matrix: which strategy best fits each currency.

For every requested pair and every *single-asset* strategy, run a backtest on the
out-of-sample tail (last `oos_frac` of history) and report net Sharpe / return /
win-rate. The frontend renders this as a pair × strategy heatmap so you can read
off, at a glance, which model to trade on which currency.

Single-asset only — portfolio strategies (velcross) rank a basket and have no
per-pair cell.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.backtest_engine import run_strategy_backtest
from app.services.data_loader import CandleBundle, build_bundle
from app.services.strategies import STRATEGY_REGISTRY

router = APIRouter(prefix="/api/fit-matrix", tags=["fit"])

# History to load per timeframe (enough for a long OOS tail + warmups).
_LOOKBACK_DAYS = {"1d": 4000, "1h": 300, "30m": 150, "15m": 90}


class FitRequest(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: str = "1d"
    cost_bps: float = 0.5
    oos_frac: float = 0.25


def _round(x, n=3):
    return None if x is None or x != x else round(float(x), n)


@router.post("")
def fit_matrix(req: FitRequest, db: Session = Depends(get_db)):
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=_LOOKBACK_DAYS.get(req.timeframe, 4000))
    symbols = [s.strip().upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=422, detail="no symbols")

    try:
        bundle = build_bundle(db, symbols, req.timeframe, start, end, skip_missing=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    single = [(sid, s) for sid, s in STRATEGY_REGISTRY.items() if s.kind == "single"]
    strat_meta = [{"id": sid, "name": s.name} for sid, s in single]

    pairs: list[str] = []
    cells: list[dict] = []
    for sym in bundle.symbols:
        dfp = bundle.panels.get(sym)
        if dfp is None or len(dfp) < 120:
            continue
        pairs.append(sym)
        cut = int(len(dfp) * (1.0 - req.oos_frac))
        oos = dfp.iloc[cut:]
        for sid, _strat in single:
            try:
                b = CandleBundle(
                    timeframe=req.timeframe, symbols=[sym], panels={sym: oos},
                    close_panel=None, benchmark=None,
                )
                m = run_strategy_backtest(
                    sid, {}, b,
                    {"mode": "long_short", "cost_bps": req.cost_bps, "initial_capital": 1000},
                ).metrics
                cells.append({
                    "pair": sym, "strategy": sid,
                    "sharpe": _round(m.sharpe), "return": _round(m.total_return, 4),
                    "win_rate": _round(m.win_rate),
                })
            except Exception:
                cells.append({"pair": sym, "strategy": sid,
                              "sharpe": None, "return": None, "win_rate": None})

    # Best strategy per pair, by OOS Sharpe.
    best: dict[str, str] = {}
    for sym in pairs:
        scored = [(c["strategy"], c["sharpe"]) for c in cells
                  if c["pair"] == sym and c["sharpe"] is not None]
        if scored:
            best[sym] = max(scored, key=lambda x: x[1])[0]

    return {
        "strategies": strat_meta,
        "pairs": pairs,
        "cells": cells,
        "best": best,
        "timeframe": req.timeframe,
        "cost_bps": req.cost_bps,
        "oos_frac": req.oos_frac,
    }
