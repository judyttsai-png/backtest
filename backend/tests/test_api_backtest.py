"""API tests for backtest creation and validation."""
from __future__ import annotations

BASE = {
    "strategy_model_id": "sma",
    "parameters": {"fast": 10, "slow": 40},
    "symbols": ["AAPL"],
    "timeframe": "1d",
    "start_ts": "2021-01-01T00:00:00Z",
    "end_ts": "2023-01-01T00:00:00Z",
    "execution": {"mode": "long_flat", "cost_bps": 5},
}


def test_create_backtest_returns_run_id(client):
    resp = client.post("/api/backtests", json=BASE)
    assert resp.status_code == 201
    body = resp.json()
    assert "run_id" in body
    assert body["status"] in {"queued", "running", "completed"}


def test_backtest_completes_eagerly_and_exposes_metrics(client):
    run_id = client.post("/api/backtests", json=BASE).json()["run_id"]

    status = client.get(f"/api/backtests/{run_id}").json()
    assert status["status"] == "completed"

    metrics = client.get(f"/api/backtests/{run_id}/metrics")
    assert metrics.status_code == 200
    m = metrics.json()
    assert m["sharpe"] is not None
    assert m["trade_count"] is not None

    equity = client.get(f"/api/backtests/{run_id}/equity").json()
    assert len(equity["points"]) > 100
    assert len(equity["benchmark"]) > 100


def test_unknown_strategy_is_422(client):
    body = {**BASE, "strategy_model_id": "does_not_exist"}
    assert client.post("/api/backtests", json=body).status_code == 422


def test_invalid_params_is_422(client):
    body = {**BASE, "parameters": {"fast": 40, "slow": 10}}  # slow <= fast
    assert client.post("/api/backtests", json=body).status_code == 422


def test_strategies_endpoint_lists_three(client):
    strategies = client.get("/api/strategies").json()
    ids = {s["id"] for s in strategies}
    assert {"sma", "roc", "velacc"}.issubset(ids)


def test_metrics_on_missing_run_is_404(client):
    import uuid

    resp = client.get(f"/api/backtests/{uuid.uuid4()}/metrics")
    assert resp.status_code == 404
