"""Rolling out-of-sample stability scorecard.

Scales up the notebook's single 75/25 split into K sequential folds: run the same
strategy independently on each fold and report how *consistent* the result is
across time. A strategy that's positive in one window and negative in the next
isn't a robust edge — it's a fluke that happened to land in-sample.

No parameter fitting here (the strategy's params are fixed), so every fold is
already an honest out-of-sample read: the question is stability, not tuning.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from app.services.backtest_engine import ExecutionConfig, run_strategy_backtest
from app.services.data_loader import CandleBundle
from app.services.strategies.registry import get_strategy


def _slice(bundle: CandleBundle, lo: int, hi: int) -> CandleBundle:
    return CandleBundle(
        timeframe=bundle.timeframe,
        symbols=bundle.symbols,
        panels={s: df.iloc[lo:hi] for s, df in bundle.panels.items()},
        close_panel=None if bundle.close_panel is None else bundle.close_panel.iloc[lo:hi],
        benchmark=None if bundle.benchmark is None else bundle.benchmark.iloc[lo:hi],
        instrument_ids=bundle.instrument_ids,
    )


def run_walkforward(
    strategy_id: str,
    params: dict[str, Any],
    bundle: CandleBundle,
    exec_cfg: ExecutionConfig | dict[str, Any],
    folds: int = 5,
) -> dict[str, Any]:
    strat = get_strategy(strategy_id)
    if strat.kind == "portfolio":
        idx = None if bundle.close_panel is None else bundle.close_panel.index
    else:
        idx = bundle.panels[bundle.symbols[0]].index
    if idx is None or len(idx) < 60:
        raise ValueError("not enough history for a walk-forward")

    n = len(idx)
    folds = max(2, min(int(folds), 12))
    edges = np.linspace(0, n, folds + 1).astype(int)

    detail: list[dict[str, Any]] = []
    for k in range(folds):
        lo, hi = int(edges[k]), int(edges[k + 1])
        if hi - lo < 30:  # too short to mean anything
            continue
        try:
            m = run_strategy_backtest(strategy_id, params, _slice(bundle, lo, hi), exec_cfg).metrics
            detail.append({
                "fold": k + 1,
                "start": idx[lo].date().isoformat(),
                "end": idx[hi - 1].date().isoformat(),
                "total_return": m.total_return,
                "sharpe": m.sharpe,
                "max_drawdown": m.max_drawdown,
                "win_rate": m.win_rate,
            })
        except Exception as exc:  # a fold with no trades / degenerate data
            detail.append({
                "fold": k + 1,
                "start": idx[lo].date().isoformat(),
                "end": idx[hi - 1].date().isoformat(),
                "error": str(exc),
            })

    scored = [d for d in detail if "sharpe" in d]
    rets = [d["total_return"] for d in scored]
    sharpes = [d["sharpe"] for d in scored if d["sharpe"] == d["sharpe"]]  # drop NaN
    n_pos = sum(1 for r in rets if r > 0)

    summary = {
        "folds_scored": len(scored),
        "folds_positive": n_pos,
        "consistency": (n_pos / len(rets)) if rets else None,  # fraction of folds in the green
        "mean_sharpe": float(np.mean(sharpes)) if sharpes else None,
        "std_sharpe": float(np.std(sharpes)) if sharpes else None,
        "min_sharpe": float(np.min(sharpes)) if sharpes else None,
        "worst_return": float(min(rets)) if rets else None,
        "best_return": float(max(rets)) if rets else None,
    }
    return {"summary": summary, "folds": detail}
