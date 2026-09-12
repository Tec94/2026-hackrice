import type { ChartCandle as Candle } from "@/adapters/chart";

export interface LinePoint {
  time: number;
  value: number;
}

/** Where an indicator draws: on the price chart, or in its own pane below. */
export type IndicatorPane = "price" | "separate";

export interface IndicatorDef {
  id: string;
  label: string;
  short: string;
  pane: IndicatorPane;
  color: string;
  /** Extra series drawn alongside the main line (Bollinger bands, MACD signal). */
  extraColors?: string[];
}

export const INDICATOR_DEFS: IndicatorDef[] = [
  { id: "sma20", label: "SMA 20", short: "SMA 20", pane: "price", color: "#d4a24b" },
  { id: "sma50", label: "SMA 50", short: "SMA 50", pane: "price", color: "#7c6ce4" },
  { id: "ema21", label: "EMA 21", short: "EMA 21", pane: "price", color: "#4ec9a0" },
  {
    id: "bb20",
    label: "Bollinger Bands (20, 2)",
    short: "BB 20",
    pane: "price",
    color: "#8a8a8a",
    extraColors: ["#8a8a8a"],
  },
  { id: "rsi14", label: "Relative Strength Index (14)", short: "RSI 14", pane: "separate", color: "#d4a24b" },
  {
    id: "macd",
    label: "MACD (12, 26, 9)",
    short: "MACD",
    pane: "separate",
    color: "#7c6ce4",
    extraColors: ["#e8695f"],
  },
];

export function indicatorDef(id: string): IndicatorDef | undefined {
  return INDICATOR_DEFS.find((d) => d.id === id);
}

/* --------------------------------- Maths ---------------------------------- */

export function sma(candles: Candle[], period: number): LinePoint[] {
  if (period <= 0 || candles.length < period) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function ema(candles: Candle[], period: number): LinePoint[] {
  if (period <= 0 || candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  // Seed with the SMA of the first `period` closes, the conventional start.
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i += 1) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/** Bollinger Bands → [upper, middle, lower]. */
export function bollinger(
  candles: Candle[],
  period = 20,
  mult = 2,
): [LinePoint[], LinePoint[], LinePoint[]] {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  if (candles.length < period) return [upper, middle, lower];

  for (let i = period - 1; i < candles.length; i += 1) {
    const win = candles.slice(i - period + 1, i + 1);
    const mean = win.reduce((s, c) => s + c.close, 0) / period;
    const variance = win.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const t = candles[i].time;
    upper.push({ time: t, value: mean + mult * sd });
    middle.push({ time: t, value: mean });
    lower.push({ time: t, value: mean - mult * sd });
  }
  return [upper, middle, lower];
}

/** Wilder-smoothed RSI, 0–100. */
export function rsi(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length <= period) return [];
  const out: LinePoint[] = [];
  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i += 1) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out.push({ time: candles[period].time, value: rsiValue(gain, loss) });

  for (let i = period + 1; i < candles.length; i += 1) {
    const d = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out.push({ time: candles[i].time, value: rsiValue(gain, loss) });
  }
  return out;
}

function rsiValue(gain: number, loss: number): number {
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

/** MACD → [macd line, signal line]. */
export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9,
): [LinePoint[], LinePoint[]] {
  const fastE = ema(candles, fast);
  const slowE = ema(candles, slow);
  if (!fastE.length || !slowE.length) return [[], []];

  const fastBy = new Map(fastE.map((p) => [p.time, p.value]));
  const line: LinePoint[] = [];
  for (const p of slowE) {
    const f = fastBy.get(p.time);
    if (f !== undefined) line.push({ time: p.time, value: f - p.value });
  }

  // Signal is an EMA of the MACD line itself.
  if (line.length < signal) return [line, []];
  const k = 2 / (signal + 1);
  const sig: LinePoint[] = [];
  let prev = line.slice(0, signal).reduce((s, p) => s + p.value, 0) / signal;
  sig.push({ time: line[signal - 1].time, value: prev });
  for (let i = signal; i < line.length; i += 1) {
    prev = line[i].value * k + prev * (1 - k);
    sig.push({ time: line[i].time, value: prev });
  }
  return [line, sig];
}

/** Computes every series an indicator needs, in draw order. */
export function computeIndicator(id: string, candles: Candle[]): LinePoint[][] {
  switch (id) {
    case "sma20":
      return [sma(candles, 20)];
    case "sma50":
      return [sma(candles, 50)];
    case "ema21":
      return [ema(candles, 21)];
    case "bb20": {
      const [u, m, l] = bollinger(candles);
      return [u, m, l];
    }
    case "rsi14":
      return [rsi(candles, 14)];
    case "macd": {
      const [line, sig] = macd(candles);
      return [line, sig];
    }
    default:
      return [];
  }
}
