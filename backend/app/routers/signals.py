"""Live signal / recommendation endpoint.

Computes each model's *current* (latest-bar) directional call for each pair, so
the frontend can show a consensus view ("who recommends what right now").
Reuses the same strategies + data loader as backtests, so a signal here matches
what a backtest would have held going into the next bar. Not a backtest — it
only evaluates the most recent bar."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.data_loader import build_bundle
from app.services.strategies import STRATEGY_REGISTRY

router = APIRouter(prefix="/api/signals", tags=["signals"])

# How much history to load per timeframe so model warmups are satisfied.
_LOOKBACK_DAYS = {"1d": 900, "1h": 120, "30m": 60, "15m": 45, "5m": 20, "1m": 10}


class SignalModel(BaseModel):
    id: str
    parameters: dict = Field(default_factory=dict)


class SignalRequest(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: str = "1d"
    models: list[SignalModel] | None = None  # default: all registered
    asof: datetime | None = None  # default: now


def _direction(x: float) -> int:
    return 1 if x > 0 else -1 if x < 0 else 0


@router.post("")
def compute_signals(req: SignalRequest, db: Session = Depends(get_db)):
    end = req.asof or datetime.now(timezone.utc)
    start = end - timedelta(days=_LOOKBACK_DAYS.get(req.timeframe, 900))

    symbols = [s.strip().upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=422, detail="no symbols")

    models = req.models or [SignalModel(id=mid) for mid in STRATEGY_REGISTRY]
    for m in models:
        if m.id not in STRATEGY_REGISTRY:
            raise HTTPException(status_code=422, detail=f"unknown strategy '{m.id}'")

    try:
        bundle = build_bundle(db, symbols, req.timeframe, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # per-symbol accumulation of each model's latest signal
    acc: dict[str, list[dict]] = {s: [] for s in symbols}

    for m in models:
        strat = STRATEGY_REGISTRY[m.id]
        defaults = {s.id: s.default for s in strat.parameter_specs}
        params = strat.validate_parameters({**defaults, **(m.parameters or {})})

        if strat.kind == "portfolio":
            panel = bundle.close_panel
            if panel is None or panel.empty:
                continue
            weights = strat.generate_signals(panel, params)
            last = weights.reindex(columns=panel.columns).iloc[-1]
            for sym in symbols:
                w = float(last.get(sym, 0.0)) if sym in last.index else 0.0
                acc[sym].append(
                    {"model": strat.id, "name": strat.name, "direction": _direction(w),
                     "strength": round(abs(w), 4)}
                )
        else:  # single-asset
            for sym in symbols:
                df = bundle.panels.get(sym)
                if df is None or df.empty:
                    continue
                sig = strat.generate_signals(df, params)
                tp = sig["target_position"].astype(float)
                val = float(tp.iloc[-1]) if len(tp) else 0.0
                acc[sym].append(
                    {"model": strat.id, "name": strat.name, "direction": _direction(val),
                     "strength": round(abs(val), 4)}
                )

    pairs = []
    for sym in symbols:
        sigs = acc[sym]
        longs = sum(1 for s in sigs if s["direction"] > 0)
        shorts = sum(1 for s in sigs if s["direction"] < 0)
        flats = sum(1 for s in sigs if s["direction"] == 0)
        net = _direction(longs - shorts)
        pairs.append({
            "symbol": sym,
            "consensus": {"direction": net, "long": longs, "short": shorts, "flat": flats,
                          "agree": max(longs, shorts)},
            "signals": sigs,
        })

    # strongest agreement first
    pairs.sort(key=lambda p: (p["consensus"]["agree"], abs(p["consensus"]["long"] - p["consensus"]["short"])), reverse=True)
    return {
        "asof": end.isoformat(),
        "timeframe": req.timeframe,
        "models": [m.id for m in models],
        "pairs": pairs,
    }
