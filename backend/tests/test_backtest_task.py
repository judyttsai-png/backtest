"""Integration-style test: the worker task completes a real backtest end to end."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select

from app.models import BacktestEquityPoint, BacktestRun, TradeLog
from app.tasks.backtests import run_backtest_task


def test_worker_completes_backtest_and_persists_outputs(db):
    run = BacktestRun(
        strategy_model_id="roc",
        strategy_version="v1",
        status="queued",
        parameters={"look": 20, "thr": 1.0},
        execution_config={"mode": "long_short", "cost_bps": 5.0, "initial_capital": 100000.0},
        timeframe="1d",
        start_ts=datetime(2021, 1, 1, tzinfo=timezone.utc),
        end_ts=datetime(2023, 1, 1, tzinfo=timezone.utc),
        universe={"symbols": ["MSFT"], "benchmark_symbol": None, "provider": "synthetic"},
        initial_capital=100000.0,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    run_id = run.id

    # Eager mode executes synchronously.
    run_backtest_task.delay(str(run_id))

    db.expire_all()
    completed = db.get(BacktestRun, run_id)
    assert completed.status == "completed"
    assert completed.progress == 1.0
    assert completed.sharpe is not None
    assert completed.final_equity is not None

    n_equity = db.execute(
        select(func.count(BacktestEquityPoint.ts)).where(
            BacktestEquityPoint.backtest_run_id == run_id
        )
    ).scalar_one()
    assert n_equity > 100

    n_trades = db.execute(
        select(func.count(TradeLog.id)).where(TradeLog.backtest_run_id == run_id)
    ).scalar_one()
    assert n_trades == completed.trade_count
