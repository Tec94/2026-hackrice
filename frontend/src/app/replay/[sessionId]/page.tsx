"use client";
import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { ChartToolbar, DrawingRail } from "@/components/chart/ChartToolbar";
import { CoachSidebar } from "@/components/voice/CoachSidebar";
import { Button, ErrorBanner, Skeleton } from "@/components/ui";
import { computeIndicator, indicatorDef } from "@/components/chart/indicators";
import type {
  ActiveTool,
  ChartHandle,
} from "@/components/chart/TradingViewChart";
import type { Drawing } from "@/components/chart/drawings";
import { useReplaySession } from "@/hooks/useReplaySession";
import {
  describeOffset,
  timeToOffset,
  type ChartCandle,
  type Timeframe,
} from "@/adapters/chart";
import { snapshotDrawings, snapshotIndicators } from "@/adapters/snapshot";
import { request } from "@/services/api-client";
import { ChartContextInput, type ChartContext } from "@hackrice/contracts";
const TradingViewChart = dynamic(
  () =>
    import("@/components/chart/TradingViewChart").then(
      (m) => m.TradingViewChart,
    ),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);
export default function ReplaySessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const {
    session,
    candles,
    snapshot,
    loading,
    error,
    unauthenticated,
    reload,
    changeTimeframe,
  } = useReplaySession(sessionId);
  const [selected, setSelected] = useState<ChartCandle | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [indicators, setIndicators] = useState<string[]>(["ema21"]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [saved, setSaved] = useState<ChartContext | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const chartRef = useRef<ChartHandle>(null);
  const readOnly = !!session && session.status !== "exploring";
  useEffect(() => {
    if (snapshot) {
      setIndicators(
        snapshot.appearance
          ? snapshotIndicators(snapshot)
          : snapshot.revision === 0
            ? ["ema21"]
            : snapshotIndicators(snapshot),
      );
      setDrawings(snapshotDrawings(snapshot));
      setSaved(snapshot);
      setDirty(false);
      setSelected(
        candles.find(
          (c) => c.offsetMinutes === snapshot.selectedCandleOffsetMinutes,
        ) ?? null,
      );
    }
  }, [snapshot]);
  useEffect(() => {
    if (unauthenticated)
      router.replace(
        `/sign-in?next=${encodeURIComponent(`/replay/${sessionId}`)}`,
      );
  }, [unauthenticated, router, sessionId]);
  useEffect(() => {
    if (candles.length) chartRef.current?.setCandles(candles);
  }, [candles]);
  const captureContext = useCallback(async () => {
    if (!session || !saved) throw new Error("Wait for the chart to load.");
    if (readOnly) return saved;
    const current = await request("getChartContext", { params: { sessionId } });
    const visible = chartRef.current?.visibleCandles() ?? candles;
    if (!visible.length)
      throw new Error("Pan back to the historical candles before asking.");
    const from = visible[0].offsetMinutes;
    const to = Math.min(
      0,
      visible[visible.length - 1].offsetMinutes +
        { "5m": 5, "15m": 15, "1h": 60 }[session.timeframe],
    );
    const snapPoint = (point: Drawing["a"]) => {
      const nearest = candles.reduce(
        (best, c) =>
          Math.abs(c.time - point.time) < Math.abs(best.time - point.time)
            ? c
            : best,
        candles[0],
      );
      return {
        offsetMinutes: nearest.offsetMinutes,
        price: String(Math.max(0, point.price)),
      };
    };
    const result = await request("updateChartContext", {
      params: { sessionId },
      body: ChartContextInput.parse({
        expectedRevision: current.revision,
        timeframe: session.timeframe,
        visibleRange: { from, to },
        ...(selected &&
        selected.offsetMinutes >= from &&
        selected.offsetMinutes < to
          ? { selectedCandleOffsetMinutes: selected.offsetMinutes }
          : {}),
        indicators: indicators.flatMap((id) =>
          id === "ema21"
            ? [{ name: "ema", period: 21 }]
            : id === "rsi14"
              ? [{ name: "rsi", period: 14 }]
              : [],
        ),
        drawings: drawings.flatMap<ChartContext["drawings"][number]>((d) =>
          d.kind === "horizontal"
            ? [
                {
                  id: d.id,
                  type: "horizontal_line",
                  price: String(Math.max(0, d.a.price)),
                },
              ]
            : d.kind === "trendline" &&
                snapPoint(d.a).offsetMinutes !== snapPoint(d.b).offsetMinutes
              ? [
                  {
                    id: d.id,
                    type: "trendline",
                    start: snapPoint(d.a),
                    end: snapPoint(d.b),
                  },
                ]
              : [],
        ),
        appearance: {
          indicatorIds: indicators,
          drawings: drawings.map((d) => ({
            id: d.id,
            kind: d.kind,
            a: snapPoint(d.a),
            b: snapPoint(d.b),
          })),
        },
      }),
    });
    setSaved(result);
    setDirty(false);
    setSaveError("");
    return result;
  }, [
    session,
    saved,
    readOnly,
    sessionId,
    candles,
    selected,
    indicators,
    drawings,
  ]);
  const save = async () => {
    setSaving(true);
    try {
      await captureContext();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save chart.");
    } finally {
      setSaving(false);
    }
  };
  const candle = selected ?? candles.at(-1);
  const values = candle
    ? [
        ["Direction", candle.close >= candle.open ? "▲ Up" : "▼ Down"],
        ["Open", candle.open.toFixed(2)],
        ["High", candle.high.toFixed(2)],
        ["Low", candle.low.toFixed(2)],
        ["Close", candle.close.toFixed(2)],
        ["Volume", candle.volume.toLocaleString()],
      ]
    : [];
  const candlePanel = (
    <section className="bench-bay candle-bay surface-inset">
      <header className="bay-header">
        <h2>Selected candle</h2>
        <span className="text-micro text-ink-muted">{session?.timeframe}</span>
      </header>
      <div className="bay-scroll">
        <p className="mb-3 text-micro text-ink-faint">
          {candle ? describeOffset(candle.offsetMinutes) : "Select a candle"}
        </p>
        <dl className="candle-values">
          {values.map(([label, value]) => (
            <div className="contents" key={label}>
              <dt>{label}</dt>
              <dd
                className={
                  label === "Direction"
                    ? candle!.close >= candle!.open
                      ? "text-bull"
                      : "text-bear"
                    : ""
                }
              >
                {value}
              </dd>
            </div>
          ))}
          {indicators.map((id) => {
            const point = computeIndicator(id, candles)[0]?.find(
              (p) => p.time === candle?.time,
            );
            return (
              <div className="contents" key={id}>
                <dt>{indicatorDef(id)?.short}</dt>
                <dd>{point ? point.value.toFixed(2) : "—"}</dd>
              </div>
            );
          })}
          <dt>Drawings</dt>
          <dd>{drawings.length}</dd>
        </dl>
      </div>
      <footer className="bay-footer">
        <p className="text-micro text-ink-muted">
          {dirty ? "Unsaved changes" : readOnly ? "Frozen" : "Synced"} ·
          snapshot r{saved?.revision ?? 0}
        </p>
        {!readOnly && dirty && (
          <Button
            className="mt-2 w-full text-tiny"
            disabled={saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save chart"}
          </Button>
        )}
      </footer>
    </section>
  );
  return (
    <div className="replay-shell">
      <a href="#workspace" className="skip-link">
        Skip to chart workspace
      </a>
      <AppHeader
        status={session?.status ?? "exploring"}
        timeframe={session?.timeframe ?? "15m"}
        horizon={session?.predictionHorizon ?? "1h"}
      />
      {error && !unauthenticated ? (
        <main className="grid flex-1 place-content-center gap-4 p-6">
          <ErrorBanner
            title="Could not load this session"
            message={error}
            onRetry={() => void reload(sessionId)}
          />
          <Button onClick={() => router.push("/#markets")}>
            Back to markets
          </Button>
        </main>
      ) : (
        <main id="workspace" className="workspace">
          <section
            id="chart-stage"
            className="chart-stage"
            aria-label="Chart workspace"
          >
            <ChartToolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              indicators={indicators}
              onIndicatorsChange={(ids) => {
                setIndicators(ids);
                setDirty(true);
              }}
              drawingCount={drawings.length}
              onClearDrawings={() => {
                setDrawings([]);
                setDirty(true);
              }}
              onResetView={() => chartRef.current?.resetView()}
              onToggleFullscreen={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else
                  void document
                    .getElementById("chart-stage")
                    ?.requestFullscreen();
              }}
              timeframe={session?.timeframe ?? "15m"}
              onTimeframeChange={
                readOnly
                  ? undefined
                  : (tf) => {
                      setSelected(null);
                      void changeTimeframe(tf);
                    }
              }
              readOnly={readOnly}
            />
            <div className="chart-canvas">
              {loading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <TradingViewChart
                  key={session?.timeframe}
                  ref={chartRef}
                  initialCandles={candles}
                  onSelectCandle={(c) => {
                    if (c) setSelected(c);
                  }}
                  indicators={indicators}
                  activeTool={activeTool}
                  drawings={drawings}
                  onDrawingsChange={(items) => {
                    setDrawings(items);
                    setDirty(true);
                  }}
                  onDrawingComplete={() => setActiveTool(null)}
                  readOnly={readOnly}
                  horizon={session?.predictionHorizon}
                />
              )}
              {!readOnly && (
                <DrawingRail
                  activeTool={activeTool}
                  onToolChange={setActiveTool}
                  drawingCount={drawings.length}
                  onClearDrawings={() => {
                    setDrawings([]);
                    setDirty(true);
                  }}
                />
              )}
            </div>
            {saveError && (
              <ErrorBanner
                title="Chart not saved"
                message={saveError}
                onRetry={save}
              />
            )}
          </section>
          {session && saved ? (
            <CoachSidebar
              sessionId={sessionId}
              captureContext={captureContext}
              disabled={loading}
              readOnly={readOnly}
              revision={saved.revision}
              candlePanel={candlePanel}
            />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </main>
      )}
    </div>
  );
}
