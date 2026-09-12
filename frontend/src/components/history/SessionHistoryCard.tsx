import Link from "next/link";
import { Badge } from "@/components/ui";
import type { SessionRow } from "./sample-sessions";

const STATUS_TONE = {
  exploring: "accent",
  submitted: "replay",
  revealed: "bull",
  completed: "neutral",
} as const;

const STATUS_LABEL = {
  exploring: "In progress",
  submitted: "Awaiting reveal",
  revealed: "Revealed",
  completed: "Completed",
} as const;

/** Where a session should resume, based on how far it has progressed. */
function destination(session: SessionRow): string {
  if (session.status === "exploring") return `/replay/${session.id}`;
  if (session.status === "submitted") return `/replay/${session.id}/feedback`;
  return `/replay/${session.id}/reveal`;
}

export function SessionHistoryCard({ session }: { session: SessionRow }) {
  return (
    <Link
      href={destination(session)}
      className="surface motion-card group block rounded-xl2 bg-panel p-4 hover:bg-raised
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lead font-semibold text-ink">{session.symbol}</span>
          <span className="text-micro text-ink-faint">{session.timeframe}</span>
        </div>
        <Badge tone={STATUS_TONE[session.status]}>{STATUS_LABEL[session.status]}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-micro text-ink-faint">
        <span>Horizon {session.predictionHorizon}</span>
        <span className="ml-auto nums">
          {new Date(session.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
    </Link>
  );
}
