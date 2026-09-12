import { ArrowDown, ArrowUp } from "lucide-react";
import type { ChartCandle as Candle } from "@/adapters/chart";
import { cn } from "@/utilities/cn";

function fmt(value: number) {
  return value.toFixed(2);
}

function clock(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export interface ChartStatusBarProps {
  visibleCount: number;
  selected: Candle | null;
  indicators?: string[];
  drawingCount?: number;
  synced?: boolean;
}

function OHLC({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-micro text-ink-faint">{label}</span>
      <span className="nums text-tiny text-ink">{fmt(value)}</span>
    </span>
  );
}

/**
 * Text summary of chart state. Doubles as the accessible description of the
 * canvas, which screen readers cannot otherwise reach (spec §18).
 */
export function ChartStatusBar({
  visibleCount,
  selected,
  indicators = [],
  drawingCount = 0,
  synced = true,
}: ChartStatusBarProps) {
  const rising = selected ? selected.close >= selected.open : false;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-panel px-3 py-2">
      <span className="text-micro text-ink-faint">
        Visible <span className="nums text-tiny text-ink-muted">{visibleCount}</span>
      </span>

      {selected ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="nums text-tiny font-medium text-ink">{clock(selected.time)}</span>
          <OHLC label="O" value={selected.open} />
          <OHLC label="H" value={selected.high} />
          <OHLC label="L" value={selected.low} />
          <OHLC label="C" value={selected.close} />
          {/* Direction never relies on colour alone: arrow + word carry it too. */}
          <span
            className={cn(
              "flex items-center gap-1 text-micro font-medium",
              rising ? "text-bull" : "text-bear",
            )}
          >
            {rising ? (
              <ArrowUp size={12} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <ArrowDown size={12} strokeWidth={2.5} aria-hidden="true" />
            )}
            {rising ? "up" : "down"}
          </span>
        </span>
      ) : (
        <span className="text-micro text-ink-faint">Hover the chart to inspect a candle</span>
      )}

      <span className="hidden text-micro text-ink-faint sm:inline">
        {indicators.length ? indicators.join(" · ") : "No indicators"}
      </span>

      {drawingCount > 0 && (
        <span className="hidden text-micro text-ink-faint sm:inline">
          <span className="nums text-tiny text-ink-muted">{drawingCount}</span> drawing
          {drawingCount === 1 ? "" : "s"}
        </span>
      )}

      <span className="ml-auto flex items-center gap-1.5 text-micro text-ink-faint">
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 rounded-full", synced ? "bg-bull" : "bg-replay-400")}
        />
        {synced ? "Synced" : "Syncing…"}
      </span>
    </div>
  );
}
