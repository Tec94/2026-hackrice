"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { z } from "zod";
import type * as C from "@hackrice/contracts";
import { ReplayHeader } from "@/components/layout/ReplayHeader";
import { Badge, Button, Card, ErrorBanner, Skeleton, Textarea } from "@/components/ui";
import { request, isApiError } from "@/services/api-client";
import { useCoachRating } from "@/hooks/useCoachRating";
import { toChartCandles, type ChartCandle } from "@/adapters/chart";

const TradingViewChart = dynamic(
  () => import("@/components/chart/TradingViewChart").then((m) => m.TradingViewChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Reveal = z.infer<typeof C.Reveal>;

const DIRECTION = {
  higher: { label: "Resolved higher", Icon: ArrowUp, tone: "bull" as const },
  lower: { label: "Resolved lower", Icon: ArrowDown, tone: "bear" as const },
  unchanged: { label: "Resolved flat", Icon: Minus, tone: "neutral" as const },
};

export default function OutcomeRevealPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [reflection, setReflection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluation, setEvaluation] = useState<C.AnalysisEvaluation | null>(null);
  // The outcome rating starts when the reveal is granted and lands a moment
  // later, so wait for it briefly before offering to ask for it.
  const coach = useCoachRating(sessionId, evaluation, { waitFor: "outcome_judgment", patience: 8 });

  /**
   * Reveal is a server-authorized transition. Once it succeeds the session's
   * `chartRange` extends past the cutoff, so bars are refetched to pick up the
   * newly permitted future candles.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await request("reveal", { params: { sessionId } });
      setReveal(result);

      const bars = await request("getBars", {
        params: { sessionId },
        query: {
          timeframe: result.session.timeframe,
          from: result.session.chartRange.from,
          to: result.session.chartRange.to,
        },
      });
      setCandles(toChartCandles(bars.bars));
      const history = await request("getHistory", { params: { sessionId } });
      setEvaluation(history.evaluations[0] ?? null);
    } catch (e) {
      setError(
        isApiError(e, "state_conflict")
          ? "Reveal requires a submitted analysis and a confirmed Solana devnet receipt. Check the receipt on the feedback page."
          : e instanceof Error
            ? e.message
            : "Could not reveal the outcome.",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveReflection = async () => {
    if (!reflection.trim()) return;
    try {
      await request("reflect", { params: { sessionId }, body: { text: reflection.trim() } });
    } catch {
      setError("Could not save your reflection.");
    }
  };

  const direction = reveal ? DIRECTION[reveal.observedDirection] : null;
  const outcomeFindings = (coach.evaluation?.findings ?? []).filter(
    (finding) => finding.reasonCode === "outcome_judgment" && finding.score !== null,
  );
  const outcomeNote = coach.evaluation?.coachNotes?.find((note) => note.stage === "reveal")?.text;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ground">
      <ReplayHeader
        symbol={reveal?.session.symbol ?? "SOL/USDT"}
        timeframe={reveal?.session.timeframe}
        phase="reveal"
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-panel px-4 py-3">
        <div>
          <h1 className="text-lead font-semibold text-ink">Outcome Reveal</h1>
          <p className="text-tiny text-ink-faint">
            The cutoff stays marked so you can separate what you knew from what came after.
          </p>
        </div>
        <Badge tone="replay">Cutoff marked on chart</Badge>
      </div>

      <main className="flex min-h-0 flex-1 flex-col gap-px lg:grid lg:grid-cols-workspace">
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Revealed chart">
          <div className="min-h-0 flex-1">
            {/* Boundary overlay is off here: the hidden region has been revealed. */}
            {candles.length ? (
              <TradingViewChart initialCandles={candles} showBoundary={false} />
            ) : (
              <div className="h-full w-full p-4">
                <Skeleton className="h-full w-full" />
                <span className="sr-only">Loading revealed candles…</span>
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-ground p-3">
          {error && <ErrorBanner title="Reveal unavailable" message={error} onRetry={load} />}

          {loading && !reveal && <Skeleton className="h-32 w-full" />}

          {reveal && direction && (
            <>
              <Card title="What actually happened">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge tone={direction.tone}>
                    <direction.Icon size={12} strokeWidth={2.5} aria-hidden="true" />{" "}
                    {direction.label}
                  </Badge>
                  <span
                    className={`nums text-title font-semibold ${
                      reveal.observedDirection === "higher"
                        ? "text-bull"
                        : reveal.observedDirection === "lower"
                          ? "text-bear"
                          : "text-ink"
                    }`}
                  >
                    {reveal.percentChange}%
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-micro text-ink-faint">At the cutoff</dt>
                    <dd className="nums mt-0.5 text-lead text-ink">{reveal.referenceClose}</dd>
                  </div>
                  <div>
                    <dt className="text-micro text-ink-faint">At the horizon</dt>
                    <dd className="nums mt-0.5 text-lead text-ink">{reveal.horizonClose}</dd>
                  </div>
                </dl>
              </Card>

              <Card
                title="Reasoning versus outcome"
                className="ring-1 ring-inset ring-accent-500/25"
              >
                <p className="text-base leading-relaxed text-ink">
                  A wrong prediction does not mean weak reasoning, and a correct one does not prove
                  it was sound. Your reasoning score is unchanged by this outcome.
                </p>
              </Card>

              <Card title="Coach on the outcome">
                {coach.pending && (
                  <p role="status" className="text-base text-ink-muted">
                    The coach is comparing your call with what happened…
                  </p>
                )}
                {!coach.pending && outcomeFindings.length > 0 && (
                  <dl className="grid grid-cols-2 gap-3">
                    {outcomeFindings.map((finding) => (
                      <div key={finding.category}>
                        <dt className="text-micro text-ink-faint">
                          {finding.category === "confirmation" ? "Did the market agree" : "Was your confidence justified"}
                        </dt>
                        <dd className="nums mt-0.5 text-lead text-ink">{finding.score} / 100</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!coach.pending && outcomeFindings.length === 0 && (
                  <p className="text-base text-ink-muted">The coach has not rated this outcome yet.</p>
                )}
                {outcomeNote && <p className="mt-3 text-base leading-relaxed text-ink">{outcomeNote}</p>}
                {!coach.pending && (
                  <div className="mt-3">
                    <Button
                      disabled={coach.rating}
                      onClick={() => void coach.rateNow().catch(() => setError("The coach could not rate this outcome right now."))}
                    >
                      {coach.rating ? "Rating…" : outcomeFindings.length ? "Rate again" : "Rate against the outcome"}
                    </Button>
                  </div>
                )}
              </Card>

              <Card title="Reflection">
                <label className="sr-only" htmlFor="reflection">
                  What would you examine differently next time?
                </label>
                <Textarea
                  id="reflection"
                  rows={4}
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder="What would you look at differently next time?"
                />
              </Card>

              <div className="flex justify-end gap-2 pb-1">
                <Button
                  variant="primary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true); setError(null);
                    try {
                      if (reflection.trim()) await request("reflect", { params: { sessionId }, body: { text: reflection.trim() } });
                      await request("complete", { params: { sessionId } });
                      router.push("/history");
                    } catch { setError("Could not save and complete the session. Please try again."); }
                    finally { setSaving(false); }
                  }}
                >
                  {saving ? "Saving…" : "Save and complete session"}
                </Button>
              </div>
            </>
          )}

          <Link
            href="/"
            className="inline-flex min-h-touch items-center px-1 text-base text-ink-muted hover:text-ink"
          >
            Back to markets
          </Link>
        </aside>
      </main>
    </div>
  );
}
