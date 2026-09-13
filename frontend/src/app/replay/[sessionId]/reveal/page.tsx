"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type * as C from "@hackrice/contracts";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button, ErrorBanner, Skeleton, Textarea } from "@/components/ui";
import { request, isApiError } from "@/services/api-client";
import { toChartCandles, type ChartCandle } from "@/adapters/chart";
import { snapshotDrawings, snapshotIndicators } from "@/adapters/snapshot";
import type { ChartHandle } from "@/components/chart/TradingViewChart";
const TradingViewChart = dynamic(
  () =>
    import("@/components/chart/TradingViewChart").then(
      (m) => m.TradingViewChart,
    ),
  { ssr: false },
);
const direction = { higher: "Higher ▲", lower: "Lower ▼", unchanged: "Flat —" };
export default function OutcomeRevealPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [reveal, setReveal] = useState<z.infer<typeof C.Reveal> | null>(null);
  const [history, setHistory] = useState<z.infer<typeof C.History> | null>(
    null,
  );
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [reflection, setReflection] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDrawings, setShowDrawings] = useState(true);
  const chart = useRef<ChartHandle>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await request("reveal", { params: { sessionId } });
      const [bars, h] = await Promise.all([
        request("getBars", {
          params: { sessionId },
          query: {
            timeframe: result.session.timeframe,
            from: result.session.chartRange.from,
            to: result.session.chartRange.to,
          },
        }),
        request("getHistory", { params: { sessionId } }),
      ]);
      setCandles(toChartCandles(bars.bars));
      setHistory(h);
      setReflection(h.reflection?.text ?? "");
      setReveal(result);
    } catch (e) {
      if (isApiError(e, "unauthenticated"))
        router.replace(
          `/sign-in?next=${encodeURIComponent(`/replay/${sessionId}/reveal`)}`,
        );
      else
        setError(
          isApiError(e, "state_conflict")
            ? "Reveal requires a submitted analysis and a confirmed devnet receipt. Check the receipt on the feedback page."
            : "Could not load the revealed session.",
        );
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);
  useEffect(() => {
    void load();
  }, [load]);
  const submission = history?.submissions[0]?.submission;
  const snapshot = history?.snapshots?.find(
    (s) => s.id === submission?.chartSnapshotId,
  );
  const complete = reveal?.session.status === "completed";
  const matched =
    !!reveal && submission?.prediction === reveal.observedDirection;
  const evidence =
    history?.evaluations[0]?.findings.filter(
      (f) => f.category === "evidence",
    ) ?? [];
  const format = (value: string) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <div className="replay-shell">
      <AppHeader
        status={reveal?.session.status ?? "revealed"}
        timeframe={reveal?.session.timeframe}
        horizon={reveal?.session.predictionHorizon}
        revealReady
      />
      <main className="feedback-layout">
        <section className="feedback-chart" aria-label="Revealed chart">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-tiny text-ink-muted">
              {reveal
                ? `Range extended by +${reveal.session.predictionHorizon} · ${candles.filter((c) => c.offsetMinutes >= 0).length} complete candles`
                : "Revealing the horizon…"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="px-3 text-tiny"
                aria-pressed={showDrawings}
                onClick={() => setShowDrawings(!showDrawings)}
              >
                Your drawings
              </Button>
              <Button
                variant="ghost"
                className="px-3 text-tiny"
                onClick={() => chart.current?.resetView()}
              >
                Reset view
              </Button>
            </div>
          </div>
          <div className="chart-canvas">
            {reveal && candles.length ? (
              <>
                <TradingViewChart
                  ref={chart}
                  initialCandles={candles}
                  showBoundary={false}
                  horizon={reveal.session.predictionHorizon}
                  indicators={snapshot ? snapshotIndicators(snapshot) : []}
                  drawings={
                    snapshot && showDrawings ? snapshotDrawings(snapshot) : []
                  }
                  readOnly
                />
                <div
                  className="reveal-curtain hatch-hidden"
                  aria-hidden="true"
                />
              </>
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </div>
          {reveal && (
            <dl className="summary-values">
              {[
                ["Close at cutoff", format(reveal.referenceClose)],
                [
                  `Close at +${reveal.session.predictionHorizon}`,
                  format(reveal.horizonClose),
                ],
                ["Change", format(reveal.change)],
                ["Percent", `${format(reveal.percentChange)}%`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="nums font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <aside className="feedback-aside pane-enter">
          <header className="bay-header">
            <div>
              <h1 className="font-semibold">Outcome and your call</h1>
              <p className="mt-1 text-tiny text-ink-muted">
                Revealing does not change your evidence check
              </p>
            </div>
          </header>
          <div className="bay-scroll space-y-5">
            {error && (
              <ErrorBanner
                title="Reveal unavailable"
                message={error}
                onRetry={load}
              />
            )}{" "}
            {loading && !reveal && <p role="status">Loading the outcome…</p>}
            {reveal && submission && (
              <>
                <div className="outcome-grid">
                  <div
                    className="outcome-card"
                    data-result={matched ? "correct" : "wrong"}
                  >
                    <p className="eyebrow">
                      You said · {matched ? "correct" : "wrong"}
                    </p>
                    <p className="mt-3 text-lead font-semibold">
                      {direction[submission.prediction]} ·{" "}
                      {submission.confidencePercent}%
                    </p>
                  </div>
                  <div className="outcome-card">
                    <p className="eyebrow">Market did</p>
                    <p className="mt-3 text-lead font-semibold">
                      {direction[reveal.observedDirection]} ·{" "}
                      {format(reveal.percentChange)}%
                    </p>
                  </div>
                </div>
                <p className="text-tiny leading-relaxed text-ink-muted">
                  Direction {matched ? "matched" : "did not match"}. One sample
                  cannot establish the quality of your reasoning. Your evidence
                  check is unchanged:{" "}
                  {evidence.filter((f) => f.status === "supported").length}{" "}
                  supported,{" "}
                  {evidence.filter((f) => f.status === "contradicted").length}{" "}
                  contradicted,{" "}
                  {evidence.filter((f) => f.status === "not_assessable").length}{" "}
                  not assessable.
                </p>
                <p className="text-micro text-ink-faint">
                  Flat means the horizon close exactly equals the cutoff close.
                </p>
                <dl className="grid grid-cols-2 gap-3 lg:hidden">
                  {[
                    ["At cutoff", format(reveal.referenceClose)],
                    ["At horizon", format(reveal.horizonClose)],
                    ["Change", format(reveal.change)],
                    ["Percent", `${format(reveal.percentChange)}%`],
                  ].map(([label, value]) => (
                    <div className="surface-inset p-3" key={label}>
                      <dt className="text-micro text-ink-muted">{label}</dt>
                      <dd className="nums mt-1">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="surface-inset p-4">
                  <h2 className="eyebrow">Invalidation you set</h2>
                  <p className="mt-2 text-tiny leading-relaxed">
                    {submission.invalidation ?? "No invalidation supplied."}
                  </p>
                  {submission.invalidation && (
                    <p className="mt-2 text-micro text-ink-faint">
                      Preserved as written; this free-text condition is not
                      automatically assessed.
                    </p>
                  )}
                </div>
                <label className="block text-tiny text-ink-muted">
                  Reflection · saved with the session
                  <Textarea
                    rows={5}
                    className="mt-2"
                    value={reflection}
                    onChange={(e) => setReflection(e.target.value)}
                    placeholder="What would you examine differently next time?"
                    readOnly={complete}
                  />
                </label>
                {complete && (
                  <p role="status" className="text-tiny text-bull">
                    ✓ Session completed. Your reflection is saved.
                  </p>
                )}
              </>
            )}
          </div>
          <footer className="bay-footer flex flex-wrap items-center justify-between gap-3">
            <Link
              className="text-tiny text-ink-muted"
              href={`/replay/${sessionId}/feedback`}
            >
              Back to feedback
            </Link>
            {complete ? (
              <Button variant="primary" onClick={() => router.push("/history")}>
                Your record
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={saving || !reveal}
                onClick={async () => {
                  setSaving(true);
                  setError("");
                  try {
                    if (reflection.trim())
                      await request("reflect", {
                        params: { sessionId },
                        body: { text: reflection.trim() },
                      });
                    await request("complete", { params: { sessionId } });
                    router.push("/history");
                  } catch {
                    setError(
                      "Could not save and complete the session. Your changes are still here; try again.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Complete session"}
              </Button>
            )}
          </footer>
        </aside>
      </main>
    </div>
  );
}
