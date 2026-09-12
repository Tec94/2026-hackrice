/**
 * Drawing model.
 *
 * `lightweight-charts` has no drawing primitives, so shapes are stored in chart
 * space (time + price) and painted onto a canvas laid over the chart. Storing
 * logical coordinates rather than pixels is what keeps a drawing pinned to the
 * candles it was drawn against when the user pans or zooms.
 */

export type DrawingKind = "trendline" | "horizontal" | "ray" | "rectangle";

export interface Point {
  /** UNIX seconds. */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  a: Point;
  b: Point;
  color: string;
}

export const DRAWING_COLOR = "#d4a24b";

export function createDrawing(kind: DrawingKind, a: Point, b: Point): Drawing {
  return {
    id: crypto.randomUUID(),
    kind,
    a,
    b,
    color: DRAWING_COLOR,
  };
}

/** Screen-space projection of a drawing, ready to paint. */
export interface ProjectedDrawing {
  drawing: Drawing;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export function paint(
  ctx: CanvasRenderingContext2D,
  items: ProjectedDrawing[],
  width: number,
  selectedId: string | null,
) {
  // `width` is the data area only — the caller excludes the price axis so a
  // drawing never paints over the axis labels.
  for (const p of items) {
    const active = p.drawing.id === selectedId;
    ctx.save();
    ctx.strokeStyle = p.drawing.color;
    ctx.fillStyle = p.drawing.color;
    ctx.lineWidth = active ? 2.25 : 1.5;
    ctx.setLineDash([]);

    switch (p.drawing.kind) {
      case "horizontal":
        ctx.beginPath();
        ctx.moveTo(0, p.ay);
        ctx.lineTo(width, p.ay);
        ctx.stroke();
        break;

      case "ray": {
        // Extends past the second point to the right edge.
        const dx = p.bx - p.ax;
        const dy = p.by - p.ay;
        const scale = dx === 0 ? 0 : (width - p.ax) / dx;
        const ex = dx === 0 ? p.bx : width;
        const ey = dx === 0 ? p.by : p.ay + dy * scale;
        ctx.beginPath();
        ctx.moveTo(p.ax, p.ay);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        break;
      }

      case "rectangle":
        ctx.globalAlpha = 0.12;
        ctx.fillRect(p.ax, p.ay, p.bx - p.ax, p.by - p.ay);
        ctx.globalAlpha = 1;
        ctx.strokeRect(p.ax, p.ay, p.bx - p.ax, p.by - p.ay);
        break;

      case "trendline":
      default:
        ctx.beginPath();
        ctx.moveTo(p.ax, p.ay);
        ctx.lineTo(p.bx, p.by);
        ctx.stroke();
        break;
    }

    if (active) {
      for (const [hx, hy] of handlePoints(p)) {
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function handlePoints(p: ProjectedDrawing): Array<[number, number]> {
  if (p.drawing.kind === "horizontal") return [[p.ax, p.ay]];
  return [
    [p.ax, p.ay],
    [p.bx, p.by],
  ];
}

/** Hit test in screen space, with a forgiving tolerance for touch. */
export function hitTest(items: ProjectedDrawing[], x: number, y: number, tol = 7): string | null {
  // Reverse order so the most recently drawn shape wins.
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const p = items[i];
    const k = p.drawing.kind;

    if (k === "horizontal") {
      if (Math.abs(y - p.ay) <= tol) return p.drawing.id;
      continue;
    }
    if (k === "rectangle") {
      const x0 = Math.min(p.ax, p.bx) - tol;
      const x1 = Math.max(p.ax, p.bx) + tol;
      const y0 = Math.min(p.ay, p.by) - tol;
      const y1 = Math.max(p.ay, p.by) + tol;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return p.drawing.id;
      continue;
    }
    if (distanceToSegment(x, y, p.ax, p.ay, p.bx, p.by) <= tol) return p.drawing.id;
  }
  return null;
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
