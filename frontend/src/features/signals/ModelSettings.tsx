import { useState } from "react";
import type { StrategyMeta } from "../../types/api";

interface Props {
  strategies: StrategyMeta[];
  overrides: Record<string, Record<string, number>>;
  onChange: (modelId: string, paramId: string, value: number) => void;
  onReset: () => void;
}

/** Collapsible editor exposing every parameter of every model (built from the
 *  strategy metadata). Default collapsed so it's out of the way; open it to tune
 *  any variable and the recommendations recompute. */
export function ModelSettings({ strategies, overrides, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const dirty = Object.values(overrides).some((o) => Object.keys(o).length > 0);

  return (
    <div className="modelsettings">
      <div className="settings-head">
        <button type="button" className="settings-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} model settings — edit any variable{dirty ? " (edited)" : ""}
        </button>
        {dirty && (
          <button type="button" className="settings-reset" onClick={onReset}>
            reset to defaults
          </button>
        )}
      </div>
      {open && (
        <div className="settings-body">
          {strategies.map((m) => (
            <div key={m.id} className="settings-row">
              <span className="settings-model">{m.name}</span>
              <div className="settings-params">
                {m.parameters.map((p) => (
                  <label key={p.id} title={`${p.min}–${p.max}, default ${p.default}`}>
                    {p.label}
                    <input
                      type="number"
                      step={p.step || 1}
                      min={p.min}
                      max={p.max}
                      value={overrides[m.id]?.[p.id] ?? p.default}
                      onChange={(e) => onChange(m.id, p.id, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
