"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { use } from "react";
import { ArrowRight } from "lucide-react";
import { ReplayHeader } from "@/components/layout/ReplayHeader";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import { Skeleton } from "@/components/ui";
import { useReplaySession } from "@/hooks/useReplaySession";

const TradingViewChart = dynamic(
  () => import("@/components/chart/TradingViewChart").then((m) => m.TradingViewChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

export default function AnalysisFeedbackPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { session, candles } = useReplaySession(sessionId);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ground">
      <ReplayHeader symbol={session?.symbol ?? "SOL/USDT"} timeframe={session?.timeframe} phase="feedback" />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-panel px-4 py-3">
        <div>
          <h1 className="text-lead font-semibold text-ink">Analysis Feedback</h1>
          <p className="text-tiny text-ink-faint">Reasoning quality · evaluation complete</p>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="nums text-title font-semibold text-ink">74</span>
          <span className="text-tiny text-ink-faint">/ 100</span>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col gap-px lg:grid lg:grid-cols-workspace">
        <section className="min-h-0 flex-1" aria-label="Chart at time of submission">
          {/* The chart is frozen at the submitted state; drawings stay visible. */}
          <TradingViewChart initialCandles={candles} />
        </section>

        <aside className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-ground p-3">
          <FeedbackPanel />

          <div className="flex flex-wrap justify-between gap-2 pb-1">
            <Link
              href={`/replay/${sessionId}`}
              className="inline-flex min-h-touch items-center rounded-lg px-4 text-base font-medium text-ink-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
            >
              Back to chart
            </Link>
            {/* Reveal stays visually apart from routine navigation (spec §3). */}
            <Link
              href={`/replay/${sessionId}/reveal`}
              className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-replay-500/15 px-4 text-base font-medium text-replay-200 transition-colors hover:bg-replay-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-replay-400 motion-reduce:transition-none"
            >
              Reveal next candles
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </main>
    </div>
  );
}
