"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { SessionHistoryCard } from "@/components/history/SessionHistoryCard";
import type { SessionRow } from "@/components/history/sample-sessions";
import { request, isApiError } from "@/services/api-client";

export default function SessionHistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setSessions(await request("listSessions"));
    } catch (e) {
      if (isApiError(e, "unauthenticated")) {
        router.push("/sign-in?next=%2Fhistory");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load your sessions.");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold tracking-tight text-ink">Your record</h1>
          <p className="mt-1 text-base text-ink-muted">Every replay session on your account.</p>
        </div>
        <Link
          href="/"
          className="inline-flex min-h-touch items-center rounded-lg px-4 text-base text-ink-muted transition-colors hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
        >
          Start a session
        </Link>
      </header>

      {error && <ErrorBanner title="Could not load sessions" message={error} onRetry={load} />}

      {!sessions && !error && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {sessions?.length === 0 && (
        <EmptyState
          title="No sessions yet"
          message="Start a replay from the home page and your record will appear here."
        />
      )}

      {sessions && sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => (
            <SessionHistoryCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
