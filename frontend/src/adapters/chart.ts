import type { UTCTimestamp } from "lightweight-charts";
import * as C from "@hackrice/contracts";
import type { z } from "zod";

/**
 * Bridges the API's chart representation to what `lightweight-charts` needs.
 *
 * Two mismatches, both handled here so no component has to know about them:
 *
 *  1. The API expresses time as **minutes relative to the cutoff** (negative in
 *     the past, 0 at the cutoff). The real wall-clock of the cutoff is withheld
 *     on purpose — revealing it would leak which historical window is being
 *     replayed. The chart needs absolute timestamps, so offset 0 is anchored to
 *     a fixed synthetic epoch. Axis labels are therefore *relative* dates, which
 *     is the honest presentation for a blind replay.
 *
 *  2. Prices and volumes arrive as decimal **strings** (exact, no float drift).
 *     The chart needs numbers.
 */

export type ApiCandle = z.infer<typeof C.Candle>;
export type Timeframe = z.infer<typeof C.Timeframe>;

/**
 * Synthetic wall-clock for offset 0. Arbitrary but fixed, so bars land at
 * stable positions and never imply a real date.
 */
export const CUTOFF_EPOCH_SECONDS = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000;

export function offsetToTime(offsetMinutes: number): UTCTimestamp {
  return (CUTOFF_EPOCH_SECONDS + offsetMinutes * 60) as UTCTimestamp;
}

export function timeToOffset(time: number): number {
  return Math.round((time - CUTOFF_EPOCH_SECONDS) / 60);
}

/** Chart-ready bar. Mirrors the old local `Candle`, so components need no change. */
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Retained so drawings and questions can refer back to API offsets. */
  offsetMinutes: number;
}

export function toChartCandle(bar: ApiCandle): ChartCandle {
  return {
    time: offsetToTime(bar.openOffsetMinutes),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    offsetMinutes: bar.openOffsetMinutes,
  };
}

export function toChartCandles(bars: ApiCandle[]): ChartCandle[] {
  return bars.map(toChartCandle);
}

/** Minutes per bar, for range maths. */
export const timeframeMinutes = C.timeframeMinutes;

/** Timeframes the API supports. The UI must not offer any others. */
export const SUPPORTED_TIMEFRAMES = C.Timeframe.options;

/** Formats a negative offset as a human span, e.g. "2d 4h ago". */
export function describeOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "cutoff";
  const total = Math.abs(offsetMinutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const parts = [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(
    Boolean,
  );
  return `${parts.slice(0, 2).join(" ")} ${offsetMinutes < 0 ? "before cutoff" : "after cutoff"}`;
}

/** Price formatting that matches the API's 2-decimal quoting. */
export function formatPrice(value: number): string {
  return value.toFixed(2);
}
