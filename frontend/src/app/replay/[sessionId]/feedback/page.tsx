"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import type * as C from "@hackrice/contracts";
import { ReplayHeader } from "@/components/layout/ReplayHeader";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import { Button, Card, ErrorBanner, Skeleton } from "@/components/ui";
import { request, isApiError } from "@/services/api-client";
import { toChartCandles, type ChartCandle } from "@/adapters/chart";

const TradingViewChart = dynamic(() => import("@/components/chart/TradingViewChart").then(m => m.TradingViewChart), { ssr: false });
export default function AnalysisFeedbackPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [history, setHistory] = useState<z.infer<typeof C.History> | null>(null);
  const [receipt, setReceipt] = useState<z.infer<typeof C.Receipt> | null>(null);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState<z.infer<typeof C.Learning> | null>(null);
  const [learningBusy, setLearningBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const h = await request("getHistory", { params: { sessionId } }); setHistory(h);
      if (!h.submissions.length) return;
      const bars = await request("getBars", { params: { sessionId }, query: { timeframe: h.session.timeframe, from: h.session.chartRange.from, to: 0 } });
      setCandles(toChartCandles(bars.bars));
      setReceipt(await request("getReceipt", { params: { sessionId } }));
    } catch (e) { if (isApiError(e, "unauthenticated")) router.replace(`/sign-in?next=${encodeURIComponent(`/replay/${sessionId}/feedback`)}`); else setError(e instanceof Error ? e.message : "Could not load feedback."); }
    finally { setBusy(false); }
  }, [sessionId, router]);
  useEffect(() => { void load(); }, [load]);
  const evaluation = history?.evaluations[0];
  return <div className="flex h-dvh flex-col overflow-hidden bg-ground">
    <ReplayHeader symbol={history?.session.symbol} timeframe={history?.session.timeframe} phase="feedback" />
    <header className="bg-panel px-4 py-3"><h1 className="text-lead font-semibold text-ink">Analysis feedback</h1><p className="text-tiny text-ink-muted">{evaluation?.overallScore == null ? "Uncalibrated rubric — no overall score" : `${evaluation.overallScore} / 100`}</p></header>
    <main className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-workspace">
      <section className="min-h-[35vh] flex-1" aria-label="Chart at submission">{candles.length ? <TradingViewChart initialCandles={candles} /> : <Skeleton className="h-full w-full" />}</section>
      <aside className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {error && <ErrorBanner title="Feedback unavailable" message={error} onRetry={load} />}
        {busy && !history && <p role="status">Loading feedback…</p>}
        {history && !history.submissions.length && <Card title="No analysis submitted"><p>Return to the chart and submit your analysis first.</p></Card>}
        {evaluation && <FeedbackPanel evaluation={evaluation} />}
        {evaluation && <Card title="Backboard learning memory">
          <p className="text-tiny text-ink-muted">Retrieve saved learning categories and evidence-check reasons. These are not trading recommendations.</p>
          <Button disabled={learningBusy} onClick={async () => {
            setLearningBusy(true);
            try { setLearning(await request('getLearning', { params: { sessionId } })); }
            catch { setError('Could not retrieve Backboard learning records.'); }
            finally { setLearningBusy(false); }
          }}>{learningBusy ? 'Retrieving…' : 'Retrieve learning records'}</Button>
          {learning && <div aria-live="polite" className="mt-2 space-y-2">
            <p>Retrieval: {learning.status} · {learning.records.length} records</p>
            {learning.records.map(record => <p key={JSON.stringify(record)} className="text-tiny text-ink-muted">{record.category.replaceAll('_', ' ')}: {record.reasonCode.replaceAll('_', ' ')}</p>)}
          </div>}
        </Card>}
        {receipt && <Card title="Solana devnet receipt"><p className="text-ink">{receipt.status}</p><p className="mt-2 text-tiny text-ink-muted">{receipt.status === "unavailable" ? "Solana is not configured. Your analysis is saved, but reveal stays locked." : "A confirmed receipt is required before the future candles can be shown."}</p><Button disabled={busy} onClick={async () => { setBusy(true); try { setReceipt(await request("refreshReceipt", { params: { sessionId } })); } catch { setError("Could not refresh the receipt."); } finally { setBusy(false); } }}>Refresh receipt</Button></Card>}
        <div className="flex flex-wrap gap-2"><Link href={`/replay/${sessionId}`} className="inline-flex min-h-touch items-center px-4">Back to chart</Link><Button disabled={receipt?.status !== "confirmed"} onClick={() => router.push(`/replay/${sessionId}/reveal`)}>Reveal next candles</Button></div>
      </aside>
    </main>
  </div>;
}
