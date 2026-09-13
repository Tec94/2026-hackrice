"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import type * as C from "@hackrice/contracts";
import { AppHeader } from "@/components/layout/AppHeader";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import { Button, ErrorBanner, Skeleton } from "@/components/ui";
import { request, isApiError } from "@/services/api-client";
import { toChartCandles, type ChartCandle } from "@/adapters/chart";
import { snapshotDrawings, snapshotIndicators } from "@/adapters/snapshot";
const TradingViewChart = dynamic(
  () =>
    import("@/components/chart/TradingViewChart").then(
      (m) => m.TradingViewChart,
    ),
  { ssr: false },
);
export default function AnalysisFeedbackPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [history, setHistory] = useState<z.infer<typeof C.History> | null>(
    null,
  );
  const [receipt, setReceipt] = useState<z.infer<typeof C.Receipt> | null>(
    null,
  );
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState<z.infer<typeof C.Learning> | null>(
    null,
  );
  const [learningBusy, setLearningBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const h = await request("getHistory", { params: { sessionId } });
      setHistory(h);
      const submission = h.submissions[0]?.submission;
      if (!submission) return;
      const snapshot =
        h.snapshots?.find((s) => s.id === submission.chartSnapshotId) ??
        (await request("getChartContext", {
          params: { sessionId },
          query: { chartSnapshotId: submission.chartSnapshotId },
        }));
      if (!h.snapshots) h.snapshots = [snapshot];
      const [bars, r] = await Promise.all([
        request("getBars", {
          params: { sessionId },
          query: {
            timeframe: snapshot.timeframe,
            from: h.session.chartRange.from,
            to: 0,
          },
        }),
        request("getReceipt", { params: { sessionId } }),
      ]);
      setCandles(toChartCandles(bars.bars));
      setReceipt(r);
    } catch (e) {
      if (isApiError(e, "unauthenticated"))
        router.replace(
          `/sign-in?next=${encodeURIComponent(`/replay/${sessionId}/feedback`)}`,
        );
      else setError("Could not load your saved feedback.");
    } finally {
      setBusy(false);
    }
  }, [sessionId, router]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!busy && (history || error))
      window.dispatchEvent(new Event("chartroom:feedback-ready"));
  }, [history, error, busy]);
  // A devnet receipt confirms on its own a few seconds after submitting, but
  // nothing pushes that to this page, so reveal stayed locked until a reload.
  // Check until it settles, then stop; the refresh button remains for retrying
  // a receipt that failed.
  useEffect(() => {
    if (!receipt || receipt.status === "confirmed" || receipt.status === "failed") return;
    let live = true;
    const timer = setInterval(() => {
      void request("refreshReceipt", { params: { sessionId } })
        .then((next) => { if (live) setReceipt(next); })
        .catch(() => {});
    }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [receipt, sessionId]);
  const submission = history?.submissions[0]?.submission;
  const snapshot = history?.snapshots?.find(
    (s) => s.id === submission?.chartSnapshotId,
  );
  const evaluation = history?.evaluations.find(
    (e) => e.submissionId === history.submissions[0]?.id,
  );
  const revealed =
    history && ["revealed", "completed"].includes(history.session.status);
  return (
    <div className="replay-shell">
      <AppHeader
        status={history?.session.status ?? "submitted"}
        timeframe={snapshot?.timeframe ?? history?.session.timeframe}
        horizon={history?.session.predictionHorizon}
        revealReady={receipt?.status === "confirmed"}
      />
      <main className="feedback-layout">
        <section className="feedback-chart" aria-label="Chart as submitted">
          <div className="flex items-center justify-end gap-3">
            <Link
              className="button-ghost rounded-lg px-3 py-3 text-tiny"
              href={`/replay/${sessionId}`}
            >
              Back to chart
            </Link>
          </div>
          <div className="chart-canvas">
            {candles.length && snapshot ? (
              <TradingViewChart
                initialCandles={candles}
                indicators={snapshotIndicators(snapshot)}
                drawings={snapshotDrawings(snapshot)}
                horizon={history?.session.predictionHorizon}
                readOnly
              />
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </div>
          {submission && (
            <dl className="summary-values">
              <div>
                <dt className="eyebrow">Committed thesis</dt>
                <dd className="line-clamp-2" title={submission.thesis}>
                  {submission.thesis}
                </dd>
              </div>
              <div>
                <dt>Prediction</dt>
                <dd>
                  {submission.prediction === "higher"
                    ? "Higher ▲"
                    : submission.prediction === "lower"
                      ? "Lower ▼"
                      : "Flat —"}
                </dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd className="capitalize">{submission.hypotheticalAction}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{submission.confidencePercent}%</dd>
              </div>
            </dl>
          )}
        </section>
        <aside className="feedback-aside pane-enter">
          <header className="bay-header">
            <div>
              <h1 className="font-semibold">Evidence check</h1>
            </div>
          </header>
          <div className="bay-scroll space-y-5">
            {error && (
              <ErrorBanner
                title="Feedback unavailable"
                message={error}
                onRetry={load}
              />
            )}{" "}
            {busy && !history && <p role="status">Loading feedback…</p>}
            {history && !submission && (
              <p>
                No analysis submitted.{" "}
                <Link className="text-accent-300" href={`/replay/${sessionId}`}>
                  Return to the chart
                </Link>
                .
              </p>
            )}
            {evaluation && submission && (
              <FeedbackPanel
                evaluation={evaluation}
                submission={submission}
                facts={history?.facts}
              />
            )}
            {submission && (
              <details className="lg:hidden">
                <summary className="text-tiny text-ink-muted">
                  Committed analysis
                </summary>
                <p className="mt-3">{submission.thesis}</p>
                <p className="mt-2 text-tiny">
                  {submission.prediction} · {submission.hypotheticalAction} ·{" "}
                  {submission.confidencePercent}% confidence
                </p>
              </details>
            )}
            {evaluation && (
              <section>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="eyebrow">Learning memory</h2>
                  <Button
                    variant="ghost"
                    className="px-3 text-tiny"
                    disabled={learningBusy}
                    onClick={async () => {
                      setLearningBusy(true);
                      try {
                        setLearning(
                          await request("getLearning", {
                            params: { sessionId },
                          }),
                        );
                      } catch {
                        setError("Could not retrieve learning records.");
                      } finally {
                        setLearningBusy(false);
                      }
                    }}
                  >
                    {learningBusy ? "Retrieving…" : "Retrieve patterns"}
                  </Button>
                </div>
                {learning && (
                  <div className="mt-3 space-y-2" aria-live="polite">
                    <p className="text-tiny text-ink-muted">
                      {learning.status === "completed"
                        ? `${learning.records.length} saved patterns`
                        : learning.status === "pending"
                          ? "Retrieval is pending. Retrieve again to check."
                          : learning.status === "unavailable"
                            ? "Learning memory is unavailable."
                            : "Retrieval failed. Try again."}
                    </p>
                    {learning.records.map((r, i) => (
                      <span key={i} className="fact-chip mr-2">
                        {r.category.replaceAll("_", " ")}{" "}
                        <strong>{r.reasonCode.toUpperCase()}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
          <footer className="bay-footer space-y-3">
            {receipt && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-micro">
                  <span className="text-bull">✓ Committed</span>
                  <span
                    className={
                      receipt.status === "confirmed"
                        ? "text-bull"
                        : "text-ink-muted"
                    }
                  >
                    {receipt.status === "confirmed"
                      ? "✓ Confirmed on devnet"
                      : receipt.status === "sent"
                        ? "Sent to devnet"
                        : receipt.status === "pending"
                          ? "Sending to devnet"
                          : receipt.status === "failed"
                            ? "Not confirmed"
                            : "Receipt unavailable"}
                  </span>
                  {receipt.signature && (
                    <a
                      className="max-w-[9rem] truncate text-ink-faint"
                      href={`https://explorer.solana.com/tx/${encodeURIComponent(receipt.signature)}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {receipt.signature}
                    </a>
                  )}
                </div>
                {receipt.status !== "confirmed" && (
                  <>
                    {receipt.status !== "unavailable" && (
                      <p className="text-tiny text-ink-muted">
                        {receipt.status === "failed"
                          ? "Devnet did not confirm the transaction. Your saved commitment cannot change."
                          : "Reveal is locked until the receipt is confirmed."}
                      </p>
                    )}
                    <Button
                      className="w-full text-tiny"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          setReceipt(
                            await request("refreshReceipt", {
                              params: { sessionId },
                            }),
                          );
                        } catch {
                          setError("Could not refresh the receipt.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy
                        ? "Checking receipt…"
                        : receipt.status === "failed" ||
                            receipt.status === "unavailable"
                          ? "Retry receipt"
                          : "Refresh receipt"}
                    </Button>
                  </>
                )}
              </>
            )}
            <Button
              variant="primary"
              className="w-full"
              disabled={!revealed && receipt?.status !== "confirmed"}
              onClick={() => router.push(`/replay/${sessionId}/reveal`)}
            >
              {revealed
                ? "Open revealed chart"
                : `Reveal the hidden ${history?.session.predictionHorizon === "1h" ? "hour" : (history?.session.predictionHorizon ?? "horizon")}`}
            </Button>
          </footer>
        </aside>
      </main>
    </div>
  );
}
