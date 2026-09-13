import type { ChartContext } from "@hackrice/contracts";
import { offsetToTime } from "./chart";
import { DRAWING_COLOR, type Drawing } from "../components/chart/drawings";

export function snapshotIndicators(snapshot: ChartContext): string[] {
  return (
    snapshot.appearance?.indicatorIds ??
    snapshot.indicators
      .map((indicator) => `${indicator.name}${indicator.period}`)
      .filter((id) => ["ema21", "rsi14"].includes(id))
  );
}
export function snapshotDrawings(snapshot: ChartContext): Drawing[] {
  if (snapshot.appearance)
    return snapshot.appearance.drawings.map((d) => ({
      id: d.id,
      kind: d.kind,
      a: { time: offsetToTime(d.a.offsetMinutes), price: Number(d.a.price) },
      b: { time: offsetToTime(d.b.offsetMinutes), price: Number(d.b.price) },
      color: DRAWING_COLOR,
    }));
  return snapshot.drawings.map((d) =>
    d.type === "horizontal_line"
      ? {
          id: d.id,
          kind: "horizontal",
          a: {
            time: offsetToTime(snapshot.visibleRange.from),
            price: Number(d.price),
          },
          b: { time: offsetToTime(0), price: Number(d.price) },
          color: DRAWING_COLOR,
        }
      : {
          id: d.id,
          kind: "trendline",
          a: {
            time: offsetToTime(d.start.offsetMinutes),
            price: Number(d.start.price),
          },
          b: {
            time: offsetToTime(d.end.offsetMinutes),
            price: Number(d.end.price),
          },
          color: DRAWING_COLOR,
        },
  );
}
