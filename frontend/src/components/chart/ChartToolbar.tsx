"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  RotateCcw,
  Search,
  Square,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { Presence } from "@/components/ui/Presence";
import type { Timeframe } from "@/adapters/chart";
import { Button, IconButton } from "@/components/ui";
import { INDICATOR_DEFS, indicatorDef } from "./indicators";
import type { DrawingKind } from "./drawings";
import type { ActiveTool } from "./TradingViewChart";
import { cn } from "@/utilities/cn";

const DRAWING_TOOLS: Array<{
  id: DrawingKind;
  label: string;
  Icon: typeof Minus;
}> = [
  { id: "trendline", label: "Trend line", Icon: TrendingUp },
  { id: "horizontal", label: "Horizontal line", Icon: Minus },
  { id: "ray", label: "Ray", Icon: MoveUpRight },
  { id: "rectangle", label: "Rectangle", Icon: Square },
];

export interface ChartToolbarProps {
  timeframe?: Timeframe;
  onTimeframeChange?: (timeframe: Timeframe) => void;
  readOnly?: boolean;
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
  indicators: string[];
  onIndicatorsChange: (ids: string[]) => void;
  drawingCount: number;
  onClearDrawings: () => void;
  onResetView?: () => void;
  onToggleFullscreen?: () => void;
}

export function ChartToolbar({
  timeframe = "15m",
  onTimeframeChange,
  readOnly = false,
  activeTool,
  onToolChange,
  indicators,
  onIndicatorsChange,
  drawingCount,
  onClearDrawings,
  onResetView,
  onToggleFullscreen,
}: ChartToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape, and focus search when it opens.
  useEffect(() => {
    if (!menuOpen) return;
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggle = (id: string) =>
    onIndicatorsChange(
      indicators.includes(id)
        ? indicators.filter((i) => i !== id)
        : [...indicators, id],
    );

  const matches = INDICATOR_DEFS.filter((d) =>
    d.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="chart-toolbar">
      <div className="segmented" aria-label="Timeframe">
        {(["5m", "15m", "1h"] as const).map((tf) => (
          <button
            key={tf}
            aria-pressed={timeframe === tf}
            disabled={!onTimeframeChange}
            onClick={() => onTimeframeChange?.(tf)}
          >
            {tf}
          </button>
        ))}
      </div>
      {/* Indicator picker */}
      <div className="relative" ref={menuRef}>
        <button
          disabled={readOnly}
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-3 text-tiny text-ink-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
        >
          + Indicator
          {indicators.length > 0 && (
            <span className="nums rounded-full bg-accent-500/15 px-1.5 text-micro text-accent-300">
              {indicators.length}
            </span>
          )}
          <ChevronDown size={14} aria-hidden="true" />
        </button>

        <Presence
          open={menuOpen}
          className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl2 surface"
        >
          <div role="dialog" aria-label="Indicators">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <h3 className="text-lead font-semibold text-ink">Indicators</h3>
              <IconButton
                label="Close indicators"
                onClick={() => setMenuOpen(false)}
                className="-mr-2"
              >
                <X size={16} />
              </IconButton>
            </div>

            <div className="flex items-center gap-2 border-y border-line px-4 py-2.5">
              <Search
                size={15}
                className="shrink-0 text-ink-faint"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search indicators"
                className="w-full bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </div>

            <ul className="max-h-72 overflow-y-auto py-1">
              {matches.length === 0 && (
                <li className="px-4 py-6 text-center text-tiny text-ink-faint">
                  No indicator matches “{query}”.
                </li>
              )}
              {matches.map((def) => {
                const on = indicators.includes(def.id);
                return (
                  <li key={def.id}>
                    <button
                      onClick={() => toggle(def.id)}
                      aria-pressed={on}
                      className="flex min-h-touch w-full items-center gap-3 px-4 text-left text-base text-ink-muted hover:bg-raised hover:text-ink"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: on ? def.color : "transparent",
                          boxShadow: on ? "none" : "inset 0 0 0 1px #3a3a3a",
                        }}
                      />
                      <span className="flex-1">
                        {def.label}
                        <span className="ml-2 text-micro text-ink-faint">
                          {["ema21", "rsi14"].includes(def.id)
                            ? "sent to coach"
                            : "visual"}
                        </span>
                      </span>
                      {on && (
                        <Check
                          size={15}
                          className="text-accent-300"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line p-3 text-micro text-ink-muted">
              EMA 21 and RSI 14 reach the coach; other overlays are visual.
            </p>
          </div>
        </Presence>
      </div>

      {/* Active indicator chips */}
      {indicators.length > 0 && (
        <div className="hidden items-center gap-1 lg:flex">
          {indicators.map((id) => {
            const def = indicatorDef(id);
            if (!def) return null;
            return (
              <button
                key={id}
                disabled={readOnly}
                onClick={() => toggle(id)}
                title={`Remove ${def.label}`}
                className="stagger-item control-surface group inline-flex min-h-touch items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-micro text-ink-muted hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: def.color }}
                />
                {def.short}
                <X
                  size={11}
                  className="text-ink-faint group-hover:text-ink"
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          className="hidden px-3 text-tiny sm:inline-flex"
          onClick={onResetView}
        >
          Reset view
        </Button>
        <Button className="fullscreen-exit" onClick={onToggleFullscreen}>
          Exit fullscreen · Esc
        </Button>
        <IconButton label="Fullscreen chart" onClick={onToggleFullscreen}>
          <Maximize2 size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}

export function DrawingRail({
  activeTool,
  onToolChange,
  drawingCount,
  onClearDrawings,
}: Pick<
  ChartToolbarProps,
  "activeTool" | "onToolChange" | "drawingCount" | "onClearDrawings"
>) {
  return (
    <div className="drawing-rail" role="group" aria-label="Chart tools">
      <button
        aria-label="Cursor"
        aria-pressed={activeTool === null}
        onClick={() => onToolChange(null)}
        className={cn(
          "grid place-items-center rounded-lg",
          activeTool === null && "control-surface text-ink",
        )}
      >
        <MousePointer2 size={15} />
      </button>
      {DRAWING_TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          aria-label={label}
          title={label}
          aria-pressed={activeTool === id}
          onClick={() => onToolChange(activeTool === id ? null : id)}
          className={cn(
            "grid place-items-center rounded-lg text-ink-muted",
            activeTool === id && "control-surface text-ink",
          )}
        >
          <Icon size={16} />
        </button>
      ))}
      <button
        aria-label="Clear all drawings"
        title="Clear all drawings"
        disabled={!drawingCount}
        className="mt-2 grid place-items-center rounded-lg text-ink-muted disabled:opacity-30"
        onClick={onClearDrawings}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
