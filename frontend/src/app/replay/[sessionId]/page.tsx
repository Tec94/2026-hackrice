"use client";

import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReplayHeader } from "@/components/layout/ReplayHeader";
import { ChartToolbar } from "@/components/chart/ChartToolbar";
import { ChartStatusBar } from "@/components/chart/ChartStatusBar";
import { CoachSidebar } from "@/components/voice/CoachSidebar";
import { Button, ErrorBanner, Skeleton, Tabs } from "@/components/ui";
import { indicatorDef } from "@/components/chart/indicators";
import type { ActiveTool, ChartHandle } from "@/components/chart/TradingViewChart";
import type { Drawing } from "@/components/chart/drawings";
import { useReplaySession } from "@/hooks/useReplaySession";
import type { ChartCandle, Timeframe } from "@/adapters/chart";
import { timeToOffset } from "@/adapters/chart";
import { request } from "@/services/api-client";
import { ChartContextInput } from "@hackrice/contracts";

/** The chart touches `document` on init, so it must never render on the server. */
const TradingViewChart = dynamic(
  () => import("@/components/chart/TradingViewChart").then((m) => m.TradingViewChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full p-4">
        <Skeleton className="h-full w-full" />
      </div>
    ),
  },
);

type MobileTab = "chart" | "coach";

export default function ReplaySessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();

  const { session, candles, loading, error, unauthenticated, reload, changeTimeframe } =
    useReplaySession(sessionId);

  const [selected, setSelected] = useState<ChartCandle | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [tab, setTab] = useState<MobileTab>("chart");

  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [indicators, setIndicators] = useState<string[]>(["ema21"]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);

  const chartRef = useRef<ChartHandle>(null);
  const captureContext = useCallback(async () => {
    if (!session) throw new Error("Wait for the chart to load.");
    const current = await request("getChartContext", { params: { sessionId } });
    const visible = chartRef.current?.visibleCandles() ?? candles;
    if (!visible.length) throw new Error("Pan back to the historical candles before asking.");
    const from = visible[0].offsetMinutes;
    const to = Math.min(0, visible[visible.length - 1].offsetMinutes + ({ "5m": 5, "15m": 15, "1h": 60 }[session.timeframe]));
    return request("updateChartContext", { params: { sessionId }, body: ChartContextInput.parse({
      expectedRevision: current.revision, timeframe: session.timeframe, visibleRange: { from, to },
      ...(selected && selected.offsetMinutes >= from && selected.offsetMinutes < to ? { selectedCandleOffsetMinutes: selected.offsetMinutes } : {}),
      indicators: indicators.flatMap(id => id === "ema21" ? [{ name: "ema", period: 21 }] : id === "rsi14" ? [{ name: "rsi", period: 14 }] : []),
      drawings: drawings.filter(d => d.kind === "horizontal" || d.kind === "trendline").map(d => d.kind === "horizontal"
        ? { id: d.id, type: "horizontal_line", price: String(d.a.price) }
        : { id: d.id, type: "trendline", start: { offsetMinutes: timeToOffset(d.a.time), price: String(d.a.price) }, end: { offsetMinutes: timeToOffset(d.b.time), price: String(d.b.price) } }),
    }) });
  }, [session, sessionId, candles, selected, indicators, drawings]);

  // Send the user to sign-in when the session cookie is missing or expired.
  useEffect(() => {
    if (unauthenticated) {
      router.push(`/sign-in?next=${encodeURIComponent(`/replay/${sessionId}`)}`);
    }
  }, [unauthenticated, router, sessionId]);

  // Feed newly fetched bars into the existing chart instance.
  useEffect(() => {
    if (candles.length) chartRef.current?.setCandles(candles);
  }, [candles]);

  const onTimeframeChange = useCallback(
    (timeframe: Timeframe) => {
      setDrawings([]);
      setSelected(null);
      void changeTimeframe(timeframe);
    },
    [changeTimeframe],
  );

  if (error && !unauthenticated) {
    return (
      <div className="flex h-screen flex-col bg-ground">
        <ReplayHeader phase="explore" />
        <div className="grid flex-1 place-items-center p-6">
          <div className="w-full max-w-md space-y-3">
            <ErrorBanner
              title="Could not load this session"
              message={error}
              onRetry={() => void reload(sessionId)}
            />
            <Button variant="ghost" onClick={() => router.push("/")}>
              Back to markets
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ground">
      <a href="#workspace" className="skip-link">
        Skip to chart workspace
      </a>

      <ReplayHeader
        symbol={session?.symbol ?? "SOL/USDT"}
        timeframe={session?.timeframe}
        onTimeframeChange={!loading && session?.status === "exploring" ? onTimeframeChange : undefined}
        connected={!!session && !error}
        phase="explore"
      />

      <main
        id="workspace"
        className="flex min-h-0 flex-1 flex-col gap-px bg-ground lg:grid lg:grid-cols-workspace"
      >
        <div className="px-3 py-2 lg:hidden">
          <Tabs
            tabs={[
              { id: "chart", label: "Chart" },
              { id: "coach", label: "Coach" },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        <section
          className={`min-h-0 flex-1 flex-col ${tab === "chart" ? "flex" : "hidden"} lg:flex`}
          aria-label="Chart workspace"
        >
          <ChartToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            indicators={indicators}
            onIndicatorsChange={setIndicators}
            drawingCount={drawings.length}
            onClearDrawings={() => setDrawings([])}
            onResetView={() => chartRef.current?.resetView()}
            onToggleFullscreen={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.getElementById("workspace")?.requestFullscreen();
            }}
          />
          <div className="relative min-h-0 flex-1">
            {loading && !candles.length ? (
              <div className="h-full w-full p-4">
                <Skeleton className="h-full w-full" />
                <span className="sr-only">Loading session…</span>
              </div>
            ) : (
              <TradingViewChart
                ref={chartRef}
                initialCandles={candles}
                onSelectCandle={setSelected}
                onVisibleCountChange={setVisibleCount}
                indicators={indicators}
                activeTool={activeTool}
                drawings={drawings}
                onDrawingsChange={setDrawings}
                onDrawingComplete={() => setActiveTool(null)}
              />
            )}
          </div>
          <ChartStatusBar
            visibleCount={visibleCount}
            selected={selected}
            indicators={indicators.map((id) => indicatorDef(id)?.short ?? id)}
            drawingCount={drawings.length}
          />
        </section>

        <div className={`min-h-0 flex-1 flex-col ${tab === "coach" ? "flex" : "hidden"} lg:flex`}>
          {session?.status === "exploring" ? <CoachSidebar sessionId={sessionId} captureContext={captureContext} disabled={loading} /> :
            <div className="space-y-3 p-5"><p className="text-ink-muted">{session ? "Your analysis is already committed." : "Loading session…"}</p>{session && <Button onClick={() => router.push(`/replay/${sessionId}/feedback`)}>View feedback</Button>}</div>}
        </div>
      </main>
    </div>
  );
}
