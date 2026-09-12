"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartCandle as Candle } from "@/adapters/chart";
import { ReplayBoundary } from "./ReplayBoundary";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { computeIndicator, indicatorDef } from "./indicators";
import {
  createDrawing,
  hitTest,
  paint,
  type Drawing,
  type DrawingKind,
  type ProjectedDrawing,
} from "./drawings";

const UP = "#4ec9a0";
const DOWN = "#e8695f";

/** `null` means the cursor tool: pan/zoom, select and drag existing drawings. */
export type ActiveTool = DrawingKind | null;

export interface ChartHandle {
  pushCandle: (candle: Candle) => void;
  setCandles: (candles: Candle[]) => void;
  resetView: () => void;
}

export interface TradingViewChartProps {
  initialCandles: Candle[];
  onSelectCandle?: (candle: Candle | null) => void;
  onVisibleCountChange?: (count: number) => void;
  showBoundary?: boolean;
  /** Indicator ids currently enabled (see `indicators.ts`). */
  indicators?: string[];
  activeTool?: ActiveTool;
  drawings?: Drawing[];
  onDrawingsChange?: (drawings: Drawing[]) => void;
  /** Fired once a shape is completed, so the toolbar can drop back to cursor. */
  onDrawingComplete?: () => void;
  ref?: Ref<ChartHandle>;
}

function toBar(c: Candle) {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function toVol(c: Candle) {
  return {
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? "rgba(78,201,160,0.38)" : "rgba(232,105,95,0.38)",
  };
}

/**
 * The chart workspace.
 *
 * The spec describes TradingView Advanced Charts, which is licensed and not on
 * npm; this builds the same workspace on `lightweight-charts`. That library has
 * no drawing primitives and no indicator library, so both are implemented here:
 * indicators are computed in `indicators.ts` and added as line series, and
 * drawings are painted onto a canvas overlay in chart coordinates.
 *
 * The chart is created ONCE. Replay stepping goes through `pushCandle`, which
 * calls `series.update()` — rebuilding would drop the user's zoom and crosshair.
 *
 * Must be rendered client-side only — `createChart` touches `document`.
 */
export function TradingViewChart({
  initialCandles,
  onSelectCandle,
  onVisibleCountChange,
  showBoundary = true,
  indicators = [],
  activeTool = null,
  drawings = [],
  onDrawingsChange,
  onDrawingComplete,
  ref,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  /** id -> the line series that make up one indicator. */
  const indicatorRefs = useRef(new Map<string, ISeriesApi<"Line">[]>());
  const dataRef = useRef<Candle[]>(initialCandles);

  const selectRef = useRef(onSelectCandle);
  const countRef = useRef(onVisibleCountChange);
  selectRef.current = onSelectCandle;
  countRef.current = onVisibleCountChange;
  const initialRef = useRef(initialCandles);

  // Drawing state kept in refs so the pointer handlers never need re-binding.
  const toolRef = useRef<ActiveTool>(activeTool);
  const drawingsRef = useRef<Drawing[]>(drawings);
  const onChangeRef = useRef(onDrawingsChange);
  const onCompleteRef = useRef(onDrawingComplete);
  toolRef.current = activeTool;
  drawingsRef.current = drawings;
  onChangeRef.current = onDrawingsChange;
  onCompleteRef.current = onDrawingComplete;

  const draftRef = useRef<Drawing | null>(null);
  const dragRef = useRef<{
    id: string;
    handle: "a" | "b" | "whole";
    startX: number;
    startY: number;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  /* --------------------------- coordinate mapping -------------------------- */

  const toScreen = useCallback((d: Drawing): ProjectedDrawing | null => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return null;
    const ts = chart.timeScale();
    const ax = ts.timeToCoordinate(d.a.time as UTCTimestamp);
    const bx = ts.timeToCoordinate(d.b.time as UTCTimestamp);
    const ay = series.priceToCoordinate(d.a.price);
    const by = series.priceToCoordinate(d.b.price);
    if (ax === null || bx === null || ay === null || by === null) return null;
    return { drawing: d, ax, ay, bx, by };
  }, []);

  const fromScreen = useCallback((x: number, y: number) => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return null;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time === null || price === null) return null;
    return { time: Number(time), price: Number(price) };
  }, []);

  const redraw = useCallback(() => {
    const canvas = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Clip to the plot area so nothing paints over the price or time axes.
    const plotW = rect.width - (chartRef.current?.priceScale("right").width() ?? 0);
    const plotH = rect.height - (chartRef.current?.timeScale().height() ?? 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, plotH);
    ctx.clip();

    const all = [...drawingsRef.current];
    if (draftRef.current) all.push(draftRef.current);
    const projected = all.map(toScreen).filter((p): p is ProjectedDrawing => p !== null);
    paint(ctx, projected, plotW, selectedRef.current);
    ctx.restore();
  }, [toScreen]);

  /** Recomputes every enabled indicator against the current data. */
  const refreshIndicators = useCallback(() => {
    indicatorRefs.current.forEach((seriesList, id) => {
      const values = computeIndicator(id, dataRef.current);
      seriesList.forEach((s, i) => {
        s.setData((values[i] ?? []).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      });
    });
  }, []);

  useImperativeHandle(
    ref,
    (): ChartHandle => ({
      pushCandle(candle) {
        const series = candleSeriesRef.current;
        const volume = volumeSeriesRef.current;
        if (!series || !volume) return;
        series.update(toBar(candle));
        volume.update(toVol(candle));
        dataRef.current = [...dataRef.current, candle];
        refreshIndicators();
        redraw();
      },
      setCandles(candles) {
        const series = candleSeriesRef.current;
        const volume = volumeSeriesRef.current;
        if (!series || !volume) return;
        series.setData(candles.map(toBar));
        volume.setData(candles.map(toVol));
        dataRef.current = candles;
        refreshIndicators();
        chartRef.current?.timeScale().fitContent();
        redraw();
      },
      resetView() {
        chartRef.current?.timeScale().fitContent();
        redraw();
      },
    }),
    [redraw, refreshIndicators],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const seed = initialRef.current;
    if (!seed.length) {
      setError("No historical data was returned for this range.");
      return;
    }

    const chart: IChartApi = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#a8a8a8",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1c1c1c" },
        horzLines: { color: "#1c1c1c" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#262626",
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (p: number) => p.toFixed(2) },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    candleSeries.setData(seed.map(toBar));
    volumeSeries.setData(seed.map(toVol));

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    dataRef.current = seed;

    const timeScale = chart.timeScale();
    timeScale.fitContent();

    const handleCrosshair = (param: { time?: Time }) => {
      if (!selectRef.current) return;
      if (param.time === undefined) {
        selectRef.current(null);
        return;
      }
      const time = Number(param.time);
      selectRef.current(dataRef.current.find((c) => c.time === time) ?? null);
    };

    const handleRange = () => {
      const range = timeScale.getVisibleRange();
      if (range && countRef.current) {
        const from = Number(range.from);
        const to = Number(range.to);
        countRef.current(dataRef.current.filter((c) => c.time >= from && c.time <= to).length);
      }
      // Drawings are stored in chart space, so any pan/zoom needs a repaint.
      redraw();
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    timeScale.subscribeVisibleTimeRangeChange(handleRange);
    timeScale.subscribeVisibleLogicalRangeChange(redraw);
    handleRange();
    setReady(true);

    const onResize = () => redraw();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.unsubscribeCrosshairMove(handleCrosshair);
      timeScale.unsubscribeVisibleTimeRangeChange(handleRange);
      timeScale.unsubscribeVisibleLogicalRangeChange(redraw);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorRefs.current.clear();
    };
    // Built once and mutated through the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------- indicators ------------------------------ */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const live = indicatorRefs.current;

    // Remove any that were switched off.
    live.forEach((seriesList, id) => {
      if (!indicators.includes(id)) {
        seriesList.forEach((s) => chart.removeSeries(s));
        live.delete(id);
      }
    });

    // Add any newly enabled.
    for (const id of indicators) {
      if (live.has(id)) continue;
      const def = indicatorDef(id);
      if (!def) continue;

      const values = computeIndicator(id, dataRef.current);
      const colors = [def.color, ...(def.extraColors ?? []), def.color];
      const created = values.map((series, i) => {
        const line = chart.addSeries(LineSeries, {
          color: colors[i] ?? def.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          // Oscillators get their own scale so they don't crush the price axis.
          priceScaleId: def.pane === "separate" ? `pane-${id}` : "right",
        });
        line.setData(series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
        return line;
      });

      if (def.pane === "separate") {
        chart.priceScale(`pane-${id}`).applyOptions({ scaleMargins: { top: 0.78, bottom: 0.02 } });
      }
      live.set(id, created);
    }
  }, [indicators, ready]);

  /* -------------------------------- drawings ------------------------------- */

  useEffect(() => {
    redraw();
  }, [drawings, selectedId, redraw, ready]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !ready) return;

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      const { x, y } = local(e);
      const tool = toolRef.current;

      if (tool === null) {
        // Cursor mode: select, and begin dragging if something was hit.
        const projected = drawingsRef.current
          .map(toScreen)
          .filter((p): p is ProjectedDrawing => p !== null);
        const hit = hitTest(projected, x, y);
        setSelectedId(hit);
        if (hit) {
          const p = projected.find((q) => q.drawing.id === hit)!;
          const nearA = Math.hypot(x - p.ax, y - p.ay) <= 8;
          const nearB = Math.hypot(x - p.bx, y - p.by) <= 8;
          dragRef.current = {
            id: hit,
            handle: nearA ? "a" : nearB ? "b" : "whole",
            startX: x,
            startY: y,
          };
          canvas.setPointerCapture(e.pointerId);
        }
        redraw();
        return;
      }

      const pt = fromScreen(x, y);
      if (!pt) return;
      draftRef.current = createDrawing(tool, pt, pt);
      canvas.setPointerCapture(e.pointerId);
      redraw();
    };

    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);

      if (draftRef.current) {
        const pt = fromScreen(x, y);
        if (!pt) return;
        // A horizontal line only needs its price, so keep both ends level.
        draftRef.current = {
          ...draftRef.current,
          b:
            draftRef.current.kind === "horizontal"
              ? { ...pt, price: draftRef.current.a.price }
              : pt,
        };
        redraw();
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;
      const pt = fromScreen(x, y);
      if (!pt) return;

      const next = drawingsRef.current.map((d) => {
        if (d.id !== drag.id) return d;
        if (drag.handle === "a") {
          return {
            ...d,
            a: pt,
            b: d.kind === "horizontal" ? { ...d.b, price: pt.price } : d.b,
          };
        }
        if (drag.handle === "b") return { ...d, b: pt };
        // Whole-shape move: shift both ends by the pointer delta in chart space.
        const from = fromScreen(drag.startX, drag.startY);
        if (!from) return d;
        const dt = pt.time - from.time;
        const dp = pt.price - from.price;
        return {
          ...d,
          a: { time: d.a.time + dt, price: d.a.price + dp },
          b: { time: d.b.time + dt, price: d.b.price + dp },
        };
      });
      if (drag.handle === "whole") {
        dragRef.current = { ...drag, startX: x, startY: y };
      }
      onChangeRef.current?.(next);
    };

    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

      if (draftRef.current) {
        const d = draftRef.current;
        draftRef.current = null;
        // A horizontal line is a single click; everything else needs a drag.
        if (d.kind === "horizontal" || d.a.time !== d.b.time || d.a.price !== d.b.price) {
          onChangeRef.current?.([...drawingsRef.current, d]);
          setSelectedId(d.id);
        }
        onCompleteRef.current?.();
        redraw();
        return;
      }
      dragRef.current = null;
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never swallow Backspace while the user is typing in a field.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        onChangeRef.current?.(drawingsRef.current.filter((d) => d.id !== selectedRef.current));
        setSelectedId(null);
      }
      if (e.key === "Escape") {
        draftRef.current = null;
        setSelectedId(null);
        redraw();
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [ready, toScreen, fromScreen, redraw]);

  return (
    <div className="relative h-full w-full bg-ground">
      <div ref={containerRef} className="h-full w-full" />

      {/*
        The overlay only intercepts pointer events while a drawing tool is armed
        or a shape exists to select; otherwise it stays transparent so the chart
        keeps its own pan and zoom.
      */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0"
        style={{
          // The chart's own canvases are positioned, so the overlay needs an
          // explicit stacking order to sit above them and receive pointers.
          zIndex: 3,
          pointerEvents: activeTool !== null || drawings.length > 0 ? "auto" : "none",
          cursor: activeTool !== null ? "crosshair" : "default",
        }}
      />

      {showBoundary && ready && !error && <ReplayBoundary />}

      {!ready && !error && (
        <div className="absolute inset-0 p-4">
          <Skeleton className="h-full w-full" />
          <span className="sr-only">Loading chart…</span>
        </div>
      )}

      {/* Datafeed failure: explain, offer retry, and never draw fake candles. */}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <ErrorBanner
            title="Historical data could not be loaded"
            message={`${error} Analysis cannot be submitted until the chart loads.`}
            onRetry={() => setError(null)}
          />
        </div>
      )}
    </div>
  );
}
