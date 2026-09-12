/**
 * Geometry for the landing hero's static chart.
 *
 * Generated once at module scope from a fixed seed so the marketing shape is
 * identical on server and client. Unrelated to session data.
 */

export const HERO_W = 700;
export const HERO_H = 300;
/** Where the visible data stops and the hidden region begins. */
export const CUT_X = 452;
/** Room reserved on the right for the price axis labels. */
export const AXIS_W = 44;

const PRICE_HIGH = 109.6;
const PRICE_LOW = 97.6;
const TOP_PAD = 12;
const BOTTOM_PAD = 26;

export function priceToY(price: number): number {
  const t = (PRICE_HIGH - price) / (PRICE_HIGH - PRICE_LOW);
  return TOP_PAD + t * (HERO_H - TOP_PAD - BOTTOM_PAD);
}

export interface HeroBar {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT = 58;
const START_X = 26;
const STEP = (CUT_X - START_X - 8) / COUNT;

/**
 * A rise, a rounded top, a decline, then a partial recovery into the cutoff —
 * an ambiguous shape, which is the point: it should not read as an obvious call.
 */
function trend(i: number): number {
  const t = i / (COUNT - 1);
  const rise = 100.2 + 6.6 * Math.sin(Math.PI * Math.min(t / 0.52, 1) * 0.5);
  const fall = t > 0.46 ? -7.4 * Math.pow((t - 0.46) / 0.38, 1.5) : 0;
  const recover = t > 0.8 ? 4.3 * ((t - 0.8) / 0.2) : 0;
  return rise + fall + recover;
}

function build(): HeroBar[] {
  const rand = mulberry32(41207);
  const bars: HeroBar[] = [];
  let prevClose = trend(0);

  for (let i = 0; i < COUNT; i += 1) {
    const target = trend(i);
    const open = prevClose;
    const close = target + (rand() - 0.5) * 0.62;
    const spread = Math.abs(close - open) + 0.28 + rand() * 0.5;
    const high = Math.max(open, close) + spread * rand() * 0.8;
    const low = Math.min(open, close) - spread * rand() * 0.8;

    bars.push({ x: START_X + i * STEP, open, high, low, close });
    prevClose = close;
  }
  return bars;
}

export const heroBars: HeroBar[] = build();

/** 9-period moving average over the closes, as an SVG path. */
function movingAveragePath(bars: HeroBar[], period = 9): string {
  const points: string[] = [];
  for (let i = period - 1; i < bars.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += bars[j].close;
    const y = priceToY(sum / period);
    points.push(`${points.length === 0 ? "M" : "L"}${bars[i].x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

export const heroMa = movingAveragePath(heroBars);
