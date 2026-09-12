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
import { IconButton } from "@/components/ui";
import { INDICATOR_DEFS, indicatorDef } from "./indicators";
import type { DrawingKind } from "./drawings";
import type { ActiveTool } from "./TradingViewChart";
import { cn } from "@/utilities/cn";

const DRAWING_TOOLS: Array<{ id: DrawingKind; label: string; Icon: typeof Minus }> = [
  { id: "trendline", label: "Trend line", Icon: TrendingUp },
  { id: "horizontal", label: "Horizontal line", Icon: Minus },
  { id: "ray", label: "Ray", Icon: MoveUpRight },
  { id: "rectangle", label: "Rectangle", Icon: Square },
];

export interface ChartToolbarProps {
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
      indicators.includes(id) ? indicators.filter((i) => i !== id) : [...indicators, id],
    );

  const matches = INDICATOR_DEFS.filter((d) =>
    d.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-wrap items-center gap-1 bg-panel px-2 py-1.5">
      {/* Cursor + drawing tools */}
      <div className="flex items-center gap-0.5" role="group" aria-label="Chart tools">
        <button
          onClick={() => onToolChange(null)}
          aria-label="Cursor"
          title="Cursor"
          aria-pressed={activeTool === null}
          className={cn(
            "grid h-touch w-touch place-items-center rounded-lg transition-colors duration-150 motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
            activeTool === null
              ? "bg-raised text-accent-300"
              : "text-ink-faint hover:bg-raised hover:text-ink",
          )}
        >
          <MousePointer2 size={17} strokeWidth={1.75} />
        </button>

        {DRAWING_TOOLS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onToolChange(activeTool === id ? null : id)}
            aria-label={label}
            title={label}
            aria-pressed={activeTool === id}
            className={cn(
              "grid h-touch w-touch place-items-center rounded-lg transition-colors duration-150 motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
              activeTool === id
                ? "bg-raised text-accent-300"
                : "text-ink-faint hover:bg-raised hover:text-ink",
            )}
          >
            <Icon size={17} strokeWidth={1.75} />
          </button>
        ))}

        {drawingCount > 0 && (
          <IconButton label="Clear all drawings" onClick={onClearDrawings}>
            <Trash2 size={16} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      {/* Indicator picker */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-3 text-tiny text-ink-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
        >
          Indicators
          {indicators.length > 0 && (
            <span className="nums rounded-full bg-accent-500/15 px-1.5 text-micro text-accent-300">
              {indicators.length}
            </span>
          )}
          <ChevronDown size={14} aria-hidden="true" />
        </button>

        {menuOpen && (
          <div
            role="dialog"
            aria-label="Indicators"
            className="absolute left-0 top-full z-30 mt-1 w-80 animate-rise-in overflow-hidden rounded-xl2 bg-panel shadow-lift ring-1 ring-inset ring-line"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <h3 className="text-lead font-semibold text-ink">Indicators</h3>
              <IconButton label="Close indicators" onClick={() => setMenuOpen(false)} className="-mr-2">
                <X size={16} />
              </IconButton>
            </div>

            <div className="flex items-center gap-2 border-y border-line px-4 py-2.5">
              <Search size={15} className="shrink-0 text-ink-faint" aria-hidden="true" />
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
                        style={{ backgroundColor: on ? def.color : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1px #3a3a3a" }}
                      />
                      <span className="flex-1">{def.label}</span>
                      {on && <Check size={15} className="text-accent-300" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
                onClick={() => toggle(id)}
                title={`Remove ${def.label}`}
                className="group inline-flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-micro text-ink-muted hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: def.color }}
                />
                {def.short}
                <X size={11} className="text-ink-faint group-hover:text-ink" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="Reset view" onClick={onResetView}>
          <RotateCcw size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Fullscreen chart" onClick={onToggleFullscreen}>
          <Maximize2 size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
