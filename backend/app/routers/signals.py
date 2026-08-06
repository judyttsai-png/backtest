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
    timeframe: str | None = None  # per-model bar size; falls back to the request timeframe


class SignalRequest(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: str = "1d"
    models: list[SignalModel] | None = None  # default: all registered
    asof: datetime | None = None  # default: now


def _direction(x: float) -> int:
    return 1 if x > 0 else -1 if x < 0 else 0


def _nan_to_none(x: float) -> float | None:
    return None if x != x else x  # NaN -> None


def _reading(model_id: str, sig, params: dict) -> tuple[float | None, str, float | None]:
    """The model's key index value, its unit, and the barrier it's compared to."""
    try:
        if model_id == "dmi":
            return _nan_to_none(round(float(sig["adx"].iloc[-1]), 1)), "ADX", float(params.get("adx_floor", 0))
        if model_id == "sma":
            f, s = float(sig["fast_sma"].iloc[-1]), float(sig["slow_sma"].iloc[-1])
            spread = (f / s - 1) * 100 if s else float("nan")
            return _nan_to_none(round(spread, 3)), "% fast vs slow", 0.0
        if model_id == "meanrev":
            return _nan_to_none(round(float(sig["z"].iloc[-1]), 2)), "σ move", float(params.get("z_full", 0))
    except Exception:
        pass
    return None, "", None


def _conviction(model_id: str, value, threshold, strength: float) -> float:
    """A 0–1 signal-strength score, comparable across strategies (so a book can be
    sized by it). Binary strategies (SMA/DMI) get a graded score from how far past
    their trigger they are; magnitude strategies (mean reversion) use their own size."""
    try:
        if model_id == "dmi" and value is not None and threshold:
            return max(0.0, min(1.0, (abs(value) - threshold) / threshold))  # ADX above floor
        if model_id == "sma" and value is not None:
            return max(0.0, min(1.0, abs(value) / 0.5))  # full at 0.5% fast-vs-slow spread
    except Exception:
        pass
    return float(max(0.0, min(1.0, strength)))  # meanrev etc. already sized


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

    # Each model can run on its own bar size; load one bundle per distinct
    # timeframe (a model with no timeframe uses the request default).
    def tf_of(m: SignalModel) -> str:
        return m.timeframe or req.timeframe

    bundles: dict[str, object] = {}
    for tf in {tf_of(m) for m in models} | {req.timeframe}:
        s = end - timedelta(days=_LOOKBACK_DAYS.get(tf, 900))
        try:
            bundles[tf] = build_bundle(db, symbols, tf, s, end, skip_missing=True)
        except ValueError:
            bundles[tf] = None

    if all(b is None for b in bundles.values()):
        raise HTTPException(status_code=422, detail="no data for the requested symbols/timeframes")

    # available pairs = union across every bundle actually loaded
    avail: list[str] = []
    for b in bundles.values():
        if b is not None:
            for s in b.symbols:
                if s not in avail:
                    avail.append(s)
    symbols = avail
    acc: dict[str, list[dict]] = {s: [] for s in symbols}

    for m in models:
        tf = tf_of(m)
        bundle = bundles.get(tf)
        if bundle is None:
            continue
        strat = STRATEGY_REGISTRY[m.id]
        defaults = {s.id: s.default for s in strat.parameter_specs}
        params = strat.validate_parameters({**defaults, **(m.parameters or {})})

        if strat.kind == "portfolio":
            panel = bundle.close_panel
            if panel is None or panel.empty:
                continue
            weights = strat.generate_signals(panel, params)
            last = weights.reindex(columns=panel.columns).iloc[-1]
            vthr = params.get("vthr")
            for sym in symbols:
                if sym not in panel.columns:
                    continue
                w = float(last.get(sym, 0.0)) if sym in last.index else 0.0
                acc[sym].append(
                    {"model": strat.id, "name": strat.name, "direction": _direction(w),
                     "strength": round(abs(w), 4), "value": None, "unit": "weight",
                     "threshold": vthr, "timeframe": tf}
                )
        else:  # single-asset
            for sym in symbols:
                df = bundle.panels.get(sym)
                if df is None or df.empty:
                    continue
                sig = strat.generate_signals(df, params)
                tp = sig["target_position"].astype(float)
                val = float(tp.iloc[-1]) if len(tp) else 0.0
                value, unit, threshold = _reading(strat.id, sig, params)
                acc[sym].append(
                    {"model": strat.id, "name": strat.name, "direction": _direction(val),
                     "strength": round(abs(val), 4), "value": value, "unit": unit,
                     "threshold": threshold, "timeframe": tf}
                )

    # latest close per pair (for the positions panel's live P&L); prefer the
    # request's default timeframe, else any timeframe that has the pair.
    prices: dict[str, float] = {}
    tf_order = [req.timeframe, *[t for t in bundles if t != req.timeframe]]
    for sym in symbols:
        for tf in tf_order:
            b = bundles.get(tf)
            panel = b.panels.get(sym) if b is not None else None
            if panel is not None and not panel.empty:
                prices[sym] = round(float(panel["close"].iloc[-1]), 6)
                break

    pairs = []
    for sym in symbols:
        sigs = acc[sym]
        longs = sum(1 for s in sigs if s["direction"] > 0)
        shorts = sum(1 for s in sigs if s["direction"] < 0)
        flats = sum(1 for s in sigs if s["direction"] == 0)
        net = _direction(longs - shorts)
        pairs.append({
            "symbol": sym,
            "price": prices.get(sym),
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


# ---------------------------------------------------------------------------
# Playbook-driven signals: each pair uses its own assigned strategy + bar +
# constants, plus a volatility-based (ATR) stop / target recommendation.
# ---------------------------------------------------------------------------
class PlaybookSignalItem(BaseModel):
    pair: str
    strategy: str
    timeframe: str = "1d"
    params: dict = Field(default_factory=dict)


class PlaybookSignalRequest(BaseModel):
    items: list[PlaybookSignalItem]
    asof: datetime | None = None
    atr_len: int = 14
    stop_mult: float = 1.5  # stop distance = stop_mult × ATR
    target_mult: float = 2.0  # target distance = target_mult × ATR


def _atr_pct(df, length: int) -> float | None:
    """Average true range of the last `length` bars, as a fraction of price."""
    try:
        high = df["high"].astype(float).to_numpy()
        low = df["low"].astype(float).to_numpy()
        close = df["close"].astype(float).to_numpy()
        prev = np.roll(close, 1)
        prev[0] = close[0]
        tr = np.maximum.reduce([high - low, np.abs(high - prev), np.abs(low - prev)])
        atr = float(np.nanmean(tr[-length:])) if len(tr) >= length else float(np.nanmean(tr))
        px = close[-1]
        return atr / px if px else None
    except Exception:
        return None


@router.post("/playbook")
def playbook_signals(req: PlaybookSignalRequest, db: Session = Depends(get_db)):
    """One live call per pair using that pair's assigned strategy/bar/params, with
    a volatility-scaled stop and target. Powers the Playbook-driven Signals tab."""
    from collections import defaultdict

    end = req.asof or datetime.now(timezone.utc)
    by_tf: dict[str, list[PlaybookSignalItem]] = defaultdict(list)
    for it in req.items:
        if it.strategy in STRATEGY_REGISTRY and STRATEGY_REGISTRY[it.strategy].kind == "single":
            by_tf[it.timeframe].append(it)

    # one bundle per distinct timeframe
    bundles: dict[str, object] = {}
    for tf, items in by_tf.items():
        start = end - timedelta(days=_LOOKBACK_DAYS.get(tf, 900))
        syms = sorted({it.pair.upper() for it in items})
        try:
            bundles[tf] = build_bundle(db, syms, tf, start, end, skip_missing=True)
        except ValueError:
            bundles[tf] = None

    # Stops/targets are sized off the DAILY ATR for every pair — a real day's range
    # is the right yardstick for a hold, whatever bar the signal fires on (a 15-min
    # ATR would make the stop razor-thin and get hit in minutes).
    all_syms = sorted({it.pair.upper() for it in req.items})
    try:
        atr_bundle = build_bundle(db, all_syms, "1d",
                                  end - timedelta(days=_LOOKBACK_DAYS["1d"]), end, skip_missing=True)
    except ValueError:
        atr_bundle = None

    def daily_atr(sym: str) -> float | None:
        d = atr_bundle.panels.get(sym) if atr_bundle is not None else None
        return _atr_pct(d, int(req.atr_len)) if d is not None and not d.empty else None

    pairs = []
    for tf, items in by_tf.items():
        bundle = bundles.get(tf)
        if bundle is None:
            continue
        for it in items:
            sym = it.pair.upper()
            df = bundle.panels.get(sym)
            if df is None or df.empty:
                continue
            strat = STRATEGY_REGISTRY[it.strategy]
            defaults = {s.id: s.default for s in strat.parameter_specs}
            params = strat.validate_parameters({**defaults, **(it.params or {})})
            sig = strat.generate_signals(df, params)
            tp = sig["target_position"].astype(float)
            val = float(tp.iloc[-1]) if len(tp) else 0.0
            value, unit, threshold = _reading(strat.id, sig, params)
            price = round(float(df["close"].iloc[-1]), 6)
            atr = daily_atr(sym)  # daily ATR, not the signal bar's
            pairs.append({
                "symbol": sym,
                "price": price,
                "strategy": strat.id,
                "name": strat.name,
                "timeframe": tf,
                "direction": _direction(val),
                "strength": round(abs(val), 4),
                "value": value,
                "unit": unit,
                "threshold": threshold,
                "atr_pct": None if atr is None else round(atr * 100, 3),
                "stop_pct": None if atr is None else round(atr * req.stop_mult * 100, 3),
                "target_pct": None if atr is None else round(atr * req.target_mult * 100, 3),
            })

    # actionable (non-flat) calls first
    pairs.sort(key=lambda p: (p["direction"] != 0, p["strength"]), reverse=True)
    return {"asof": end.isoformat(), "pairs": pairs,
            "stop_mult": req.stop_mult, "target_mult": req.target_mult}


# ---------------------------------------------------------------------------
# Velocity Crossover is cross-sectional: it ranks the whole basket. It has no
# per-currency card, so it gets its own "basket" view — the current target
# weights (long the strongest, short the weakest).
# ---------------------------------------------------------------------------
class BasketRequest(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: str = "1d"
    params: dict = Field(default_factory=dict)
    asof: datetime | None = None


@router.post("/basket")
def basket_signals(req: BasketRequest, db: Session = Depends(get_db)):
    end = req.asof or datetime.now(timezone.utc)
    start = end - timedelta(days=_LOOKBACK_DAYS.get(req.timeframe, 900))
    symbols = [s.strip().upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=422, detail="no symbols")
    try:
        bundle = build_bundle(db, symbols, req.timeframe, start, end, skip_missing=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    panel = bundle.close_panel
    if panel is not None:
        # Velcross is cross-sectional — drop any bar where a pair is missing so the
        # latest row is a *complete* cross-section (recent gap-filled bars can be
        # partial, which would otherwise leave the ranking empty).
        panel = panel.dropna(how="any")
    if panel is None or panel.empty:
        raise HTTPException(status_code=422, detail="no basket data")

    strat = STRATEGY_REGISTRY["velcross"]
    defaults = {s.id: s.default for s in strat.parameter_specs}
    # Live "current ranking" view: rebalance-at-today (rebal=1) and drop the entry
    # gate (vthr=0) so it always shows the tilt — the strongest names velcross would
    # go long and the weakest it would short right now. The gate only matters for
    # whether a backtest actually *enters*; here we just show the ranking.
    params = strat.validate_parameters({**defaults, **(req.params or {}), "rebal": 1, "vthr": 0})
    weights = strat.generate_signals(panel, params).reindex(columns=panel.columns)
    # Use the most recent bar that actually has a ranking (the very last bar can be
    # degenerate if the recent gap-filled data is flat / low-vol).
    active = (weights != 0).any(axis=1)
    last_i = weights.index[active][-1] if active.any() else weights.index[-1]
    last = weights.loc[last_i]
    asof_bar = last_i

    rows = []
    for sym in panel.columns:
        w = float(last.get(sym, 0.0))
        px = panel.loc[asof_bar, sym]
        rows.append({
            "symbol": sym,
            "weight": round(w, 4),
            "direction": _direction(w),
            "price": None if px != px else round(float(px), 6),
        })
    rows.sort(key=lambda r: r["weight"], reverse=True)  # longs first, shorts last
    longs = sum(1 for r in rows if r["direction"] > 0)
    shorts = sum(1 for r in rows if r["direction"] < 0)
    return {
        "asof": asof_bar.to_pydatetime().isoformat() if hasattr(asof_bar, "to_pydatetime") else str(asof_bar),
        "timeframe": req.timeframe,
        "rows": rows, "long_count": longs, "short_count": shorts,
        "gross": round(float(last.abs().sum()), 4),
    }
