import { useEffect, useRef, useState } from "react";
import type { HeatmapResponse } from "../../types/api";

const CELL = 38;
const PAD_LEFT = 44;
const PAD_BOTTOM = 28;
const PAD_TOP = 8;
const PAD_RIGHT = 8;

const INK = [14, 20, 29];
const AMBER = [242, 180, 65];
const CORAL = [229, 100, 78];

function lerp(a: number[], b: number[], t: number) {
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(",")})`;
}

function colorFor(v: number | null, maxAbs: number): string {
  if (v == null || maxAbs === 0) return "rgb(18,24,35)";
  const t = Math.max(-1, Math.min(1, v / maxAbs));
  return t >= 0 ? lerp(INK, AMBER, t) : lerp(INK, CORAL, -t);
}

interface Hover {
  x: number;
  y: number;
  col: number;
  row: number;
  value: number | null;
}

interface Props {
  heatmap: HeatmapResponse;
  onApply: (patch: Record<string, number>) => void;
}

export function HeatmapCanvas({ heatmap, onApply }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const cols = heatmap.x_values.length;
  const rows = heatmap.y_values.length;
  const width = PAD_LEFT + cols * CELL + PAD_RIGHT;
  const height = PAD_TOP + rows * CELL + PAD_BOTTOM;

  const maxAbs = Math.max(
    0.0001,
    ...heatmap.z.flat().filter((v): v is number => v != null).map((v) => Math.abs(v)),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#6e7a8c";

    // cells: row 0 is drawn at the bottom (y ascending upward)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const value = heatmap.z[r]?.[c] ?? null;
        const px = PAD_LEFT + c * CELL;
        const py = PAD_TOP + (rows - 1 - r) * CELL;
        ctx.fillStyle = colorFor(value, maxAbs);
        ctx.fillRect(px, py, CELL - 1, CELL - 1);
      }
    }

    // axis ticks
    ctx.fillStyle = "#6e7a8c";
    ctx.textAlign = "center";
    for (let c = 0; c < cols; c++) {
      ctx.fillText(String(heatmap.x_values[c]), PAD_LEFT + c * CELL + CELL / 2, height - 14);
    }
    ctx.textAlign = "right";
    for (let r = 0; r < rows; r++) {
      const py = PAD_TOP + (rows - 1 - r) * CELL + CELL / 2 + 3;
      ctx.fillText(String(heatmap.y_values[r]), PAD_LEFT - 6, py);
    }

    // highlight hovered cell
    if (hover && hover.col >= 0 && hover.row >= 0) {
      const px = PAD_LEFT + hover.col * CELL;
      const py = PAD_TOP + (rows - 1 - hover.row) * CELL;
      ctx.strokeStyle = "#e8eaed";
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 2, CELL - 2);
    }
  }, [heatmap, hover, maxAbs, width, height, cols, rows]);

  const locate = (e: React.MouseEvent): Hover | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const col = Math.floor((mx - PAD_LEFT) / CELL);
    const rowFromTop = Math.floor((my - PAD_TOP) / CELL);
    const row = rows - 1 - rowFromTop;
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return { x: mx, y: my, col, row, value: heatmap.z[row]?.[col] ?? null };
  };

  const onMove = (e: React.MouseEvent) => {
    const h = locate(e);
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      setHover(h);
      rafRef.current = null;
    });
  };

  const onClick = (e: React.MouseEvent) => {
    const h = locate(e);
    if (!h) return;
    onApply({
      [heatmap.x_param]: heatmap.x_values[h.col],
      [heatmap.y_param]: heatmap.y_values[h.row],
    });
  };

  return (
    <div className="heatwrap">
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          className="heatcanvas"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
        />
        {hover && (
          <div
            className="hmtip"
            style={{ left: Math.min(hover.x + 14, width - 120), top: hover.y + 12 }}
          >
            {heatmap.x_param}=<b>{heatmap.x_values[hover.col]}</b> {heatmap.y_param}=
            <b>{heatmap.y_values[hover.row]}</b>
            <br />
            {heatmap.metric}: <b>{hover.value == null ? "—" : hover.value.toFixed(3)}</b>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="hmaxis">
          x · {heatmap.x_param}
          <br />
          y · {heatmap.y_param}
        </div>
        <div className="hmbar">
          <span>low</span>
          <span className="grad" />
          <span>high</span>
        </div>
        <div className="hmaxis">click a cell to adopt its parameters</div>
      </div>
    </div>
  );
}
