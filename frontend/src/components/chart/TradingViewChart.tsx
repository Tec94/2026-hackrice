"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
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
import { describeOffset, timeToOffset, offsetToTime } from "@/adapters/chart";
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

const UP = "#34c77b";
const DOWN = "#f0524f";

/** `null` means the cursor tool: pan/zoom, select and drag existing drawings. */
export type ActiveTool = DrawingKind | null;

export interface ChartHandle {
  pushCandle: (candle: Candle) => void;
  setCandles: (candles: Candle[]) => void;
  resetView: () => void;
  visibleCandles: () => Candle[];
}

export interface TradingViewChartProps {
  initialCandles: Candle[];
  onSelectCandle?: (candle: Candle | null) => void;
  onVisibleCountChange?: (count: number) => void;
  showBoundary?: boolean;
  horizon?: "5m" | "15m" | "1h";
  readOnly?: boolean;
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
    color:
      c.close >= c.open ? "rgba(78,201,160,0.38)" : "rgba(232,105,95,0.38)",
  };
}

function axisOffset(time: Time) {
  const offset = timeToOffset(Number(time));
  if (!offset) return "0";
  const minutes = Math.abs(offset);
  return `${offset < 0 ? "−" : "+"}${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ""}${minutes % 60 ? `${minutes % 60}m` : ""}`;
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
  horizon = "1h",
  readOnly = false,
  indicators = [],
  activeTool = null,
  drawings = [],
  onDrawingsChange,
  onDrawingComplete,
  ref,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [boundary, setBoundary] = useState<{
    left: number;
    right: number;
  } | null>(null);
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
    const plotW =
      rect.width - (chartRef.current?.priceScale("right").width() ?? 0);
    const plotH = rect.height - (chartRef.current?.timeScale().height() ?? 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, plotH);
    ctx.clip();

    const all = [...drawingsRef.current];
    if (draftRef.current) all.push(draftRef.current);
    const projected = all
      .map(toScreen)
      .filter((p): p is ProjectedDrawing => p !== null);
    paint(ctx, projected, plotW, selectedRef.current);
    ctx.restore();
  }, [toScreen]);

  /** Recomputes every enabled indicator against the current data. */
  const refreshIndicators = useCallback(() => {
    indicatorRefs.current.forEach((seriesList, id) => {
      const values = computeIndicator(id, dataRef.current);
      seriesList.forEach((s, i) => {
        s.setData(
          (values[i] ?? []).map((p) => ({
            time: p.time as UTCTimestamp,
            value: p.value,
          })),
        );
      });
    });
  }, []);

  const chartData = (candles: Candle[]) => {
    const minutes = { "5m": 5, "15m": 15, "1h": 60 }[horizon];
    const interval =
      candles.length > 1
        ? candles[1].offsetMinutes - candles[0].offsetMinutes
        : minutes;
    const last = candles.at(-1)?.offsetMinutes ?? -interval;
    const whitespace = [];
    for (
      let offset = Math.max(0, last + interval);
      offset <= minutes;
      offset += interval
    )
      whitespace.push({ time: offsetToTime(offset) });
    return [...candles.map(toBar), ...whitespace];
  };
  const fitView = () => {
    const chart = chartRef.current;
    if (!chart || !dataRef.current.length) return;
    const width =
      (containerRef.current?.clientWidth ?? 0) -
      chart.priceScale("right").width();
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = "11px system-ui";
    // Reserve the measured label width, so the withheld horizon cannot collapse into the price axis.
    const labels =
      width < 640
        ? `Hidden · +${horizon}`
        : `Replay boundary · 0     Hidden · +${horizon}`;
    const labelWidth = (context?.measureText(labels).width ?? 0) + 32;
    const last = dataRef.current.length - 1;
    chart.timeScale().setVisibleLogicalRange({
      from: 0,
      to: showBoundary
        ? (last * width) / Math.max(1, width - labelWidth)
        : last + 1,
    });
  };
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
        series.setData(chartData(candles));
        volume.setData(candles.map(toVol));
        dataRef.current = candles;
        refreshIndicators();
        fitView();
        redraw();
      },
      resetView() {
        fitView();
        redraw();
      },
      visibleCandles() {
        const range = chartRef.current?.timeScale().getVisibleRange();
        return range
          ? dataRef.current.filter(
              (c) => c.time >= Number(range.from) && c.time <= Number(range.to),
            )
          : dataRef.current;
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
        background: { type: ColorType.Solid, color: "#19191c" },
        textColor: "#a8a8a8",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#ffffff08" },
        horzLines: { color: "#ffffff08" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#262626",
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: "#262626",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: axisOffset,
      },
      localization: {
        priceFormatter: (p: number) => p.toFixed(2),
        timeFormatter: (time: Time) =>
          describeOffset(timeToOffset(Number(time))),
      },
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
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    candleSeries.setData(chartData(seed));
    volumeSeries.setData(seed.map(toVol));

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    dataRef.current = seed;

    const timeScale = chart.timeScale();
    fitView();

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
        countRef.current(
          dataRef.current.filter((c) => c.time >= from && c.time <= to).length,
        );
      }
      const cutoffX = timeScale.timeToCoordinate(offsetToTime(0));
      const right = chart.priceScale("right").width();
      setBoundary(
        cutoffX == null ? null : { left: Math.max(0, cutoffX), right },
      );
      // Drawings are stored in chart space, so any pan/zoom needs a repaint.
      redraw();
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    timeScale.subscribeVisibleTimeRangeChange(handleRange);
    timeScale.subscribeVisibleLogicalRangeChange(redraw);
    handleRange();
    setReady(true);

    const onResize = () => {
      handleRange();
      redraw();
    };
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

    // Oscillators each need their own horizontal band, or they overlap each
    // other and the volume histogram. Lay them out bottom-up in enable order.
    const oscillators = indicators.filter(
      (id) => indicatorDef(id)?.pane === "separate",
    );
    const laneFor = (id: string) => {
      const index = oscillators.indexOf(id);
      if (index === -1) return null;
      // Volume occupies the lowest band; oscillators stack above it.
      const height = 0.14;
      const bottom = 0.2 + index * (height + 0.03);
      return { top: 1 - bottom - height, bottom };
    };

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
        line.setData(
          series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
        );
        return line;
      });

      const lane = laneFor(id);
      if (def.pane === "separate" && lane) {
        chart.priceScale(`pane-${id}`).applyOptions({ scaleMargins: lane });
      }
      live.set(id, created);
    }

    // Reflow: adding or removing an oscillator shifts every lane below it, and
    // the price/volume scales must give up room for the stack.
    for (const id of oscillators) {
      const lane = laneFor(id);
      if (lane)
        chart.priceScale(`pane-${id}`).applyOptions({ scaleMargins: lane });
    }
    const stackTop = oscillators.length
      ? 1 - (0.2 + oscillators.length * 0.17)
      : 0.74;
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.08, bottom: Math.max(0.2, 1 - stackTop) },
    });
    chart
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
  }, [indicators, ready]);

  /* -------------------------------- drawings ------------------------------- */

  useEffect(() => {
    redraw();
  }, [drawings, selectedId, redraw, ready]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const host = hostRef.current;
    if (!canvas || !host || !ready || readOnly) return;

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("button, a, input, textarea, select")
      )
        return;
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
          e.preventDefault();
          e.stopPropagation();
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
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);

      if (draftRef.current) {
        const d = draftRef.current;
        draftRef.current = null;
        // A horizontal line is a single click; everything else needs a drag.
        if (
          d.kind === "horizontal" ||
          d.a.time !== d.b.time ||
          d.a.price !== d.b.price
        ) {
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

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedRef.current
      ) {
        onChangeRef.current?.(
          drawingsRef.current.filter((d) => d.id !== selectedRef.current),
        );
        setSelectedId(null);
      }
      if (e.key === "Escape") {
        draftRef.current = null;
        setSelectedId(null);
        redraw();
      }
    };

    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("pointermove", onMove, true);
    host.addEventListener("pointerup", onUp, true);
    window.addEventListener("keydown", onKey);
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMove, true);
      host.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ready, toScreen, fromScreen, redraw, readOnly]);

  return (
    <div ref={hostRef} className="relative h-full w-full bg-ground">
      <div ref={containerRef} className="h-full w-full" />

      {/* Unarmed chart gestures pass through; the host captures drawing hits. */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0"
        style={{
          // The chart's own canvases are positioned, so the overlay needs an
          // explicit stacking order to sit above them and receive pointers.
          zIndex: 3,
          pointerEvents: !readOnly && activeTool !== null ? "auto" : "none",
          cursor: activeTool !== null ? "crosshair" : "default",
        }}
      />

      {boundary && ready && !error && (
        <ReplayBoundary
          {...boundary}
          horizon={horizon}
          revealed={!showBoundary}
        />
      )}
      {selectedId && !readOnly && (
        <div className="control-surface absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl p-2 text-tiny">
          <span>
            Selected: {drawings.find((d) => d.id === selectedId)?.kind}
          </span>
          <button
            className="min-h-touch px-2"
            onClick={() => {
              const source = drawings.find((d) => d.id === selectedId);
              if (source)
                onDrawingsChange?.([
                  ...drawings,
                  { ...source, id: crypto.randomUUID() },
                ]);
            }}
          >
            Duplicate
          </button>
          <button
            className="min-h-touch px-2 text-bear"
            onClick={() => {
              onDrawingsChange?.(drawings.filter((d) => d.id !== selectedId));
              setSelectedId(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

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
