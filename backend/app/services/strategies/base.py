"""Strategy abstractions shared by all models.

Every strategy exposes typed parameter metadata (used to build the frontend
control rail and to validate requests), a validator, and a signal generator.

Execution convention (anti-lookahead), enforced by the backtest engine:

    Signal is computed using data through bar t.
    Position is applied starting bar t+1.

Strategies therefore return *target positions/weights aligned to the bar on
which the signal was computed*; the engine shifts them by one bar before
applying returns.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import Any, Literal

import pandas as pd

StrategyKind = Literal["single", "portfolio"]


@dataclass(frozen=True)
class ParamSpec:
    id: str
    label: str
    type: Literal["int", "float"]
    min: float
    max: float
    default: float
    step: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ParameterError(ValueError):
    """Raised when supplied parameters are invalid (mapped to HTTP 422)."""


class Strategy(ABC):
    id: str
    name: str
    description: str
    version: str = "v1"
    kind: StrategyKind = "single"
    parameter_specs: list[ParamSpec] = []

    # -- metadata --------------------------------------------------------
    @classmethod
    def parameter_schema(cls) -> list[dict[str, Any]]:
        return [spec.to_dict() for spec in cls.parameter_specs]

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for spec in cls.parameter_specs:
            out[spec.id] = int(spec.default) if spec.type == "int" else float(spec.default)
        return out

    # -- validation ------------------------------------------------------
    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        """Coerce/validate against the spec (bounds + type). Subclasses may
        extend with cross-field rules by overriding and calling ``super()``."""
        clean: dict[str, Any] = {}
        by_id = {s.id: s for s in self.parameter_specs}
        for key, spec in by_id.items():
            raw = params.get(key, spec.default)
            try:
                value: Any = int(round(float(raw))) if spec.type == "int" else float(raw)
            except (TypeError, ValueError) as exc:
                raise ParameterError(f"parameter '{key}' must be numeric") from exc
            if value < spec.min or value > spec.max:
                raise ParameterError(
                    f"parameter '{key}'={value} out of range [{spec.min}, {spec.max}]"
                )
            clean[key] = value
        return clean

    # -- signals ---------------------------------------------------------
    @abstractmethod
    def generate_signals(self, data: Any, params: dict[str, Any]) -> pd.DataFrame:
        """Return target positions/weights aligned to the signal bar.

        Single-asset: DataFrame indexed by ts with a ``target_position`` column
        in {-1, 0, +1} plus optional diagnostic columns.

        Portfolio: DataFrame indexed by ts, columns = symbols, values = target
        weights that sum (in absolute value) to <= 1.
        """
        raise NotImplementedError
