"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { SessionHistoryCard } from "@/components/history/SessionHistoryCard";
import type { Session } from "@hackrice/contracts";
import { request, isApiError } from "@/services/api-client";
import { Archive, History as HistoryIcon } from "lucide-react";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { NewReplayIcon } from "@/components/ui/NewReplayIcon";

const filters = [
  ["all", "All"],
  ["progress", "In progress"],
  ["completed", "Completed"],
];
export default function HistoryPage() {
  return (
    <Suspense fallback={<p role="status">Loading your record…</p>}>
      <SessionHistoryPage />
    </Suspense>
  );
}
function SessionHistoryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const archived = params.get("view") === "archived";
  const [filter, setFilter] = useState("all");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setSessions(await request("listSessions"));
    } catch (e) {
      if (isApiError(e, "unauthenticated"))
        router.replace(
          `/sign-in?next=${encodeURIComponent(archived ? "/history?view=archived" : "/history")}`,
        );
      else setError("Could not load your sessions.");
    }
  }, [router, archived]);
  useEffect(() => {
    void load();
  }, [load]);
  const inView = sessions?.filter((s) => !!s.archived === archived) ?? [];
  const shown = inView.filter(
    (s) =>
      filter === "all" ||
      (filter === "completed"
        ? s.status === "completed"
        : s.status !== "completed"),
  );
  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="page-shell py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-[30px] font-semibold tracking-tight">
              {archived ? "Archived sessions" : "Your record"}
            </h1>
            <p className="mt-2 text-tiny text-ink-muted">
              {sessions ? `${inView.length} sessions · ` : ""}kept for 30 days
              from creation
              {archived ? " · restore at any time before expiry" : ""}
            </p>
          </div>
          <div className="record-controls">
            <div
              className="segmented session-filters sliding-track"
              role="group"
              aria-label="Filter sessions"
            >
              <SlidingHighlight
                index={filters.findIndex(([id]) => id === filter)}
                count={filters.length}
              />
              {filters.map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="record-page-actions">
              <Link
                href={archived ? "/history" : "/history?view=archived"}
                className="record-icon-action control-surface motion-control text-ink-muted"
                aria-label={archived ? "Your record" : "Archived sessions"}
                title={archived ? "Your record" : "Archived sessions"}
              >
                {archived ? (
                  <HistoryIcon size={18} aria-hidden="true" />
                ) : (
                  <Archive size={18} aria-hidden="true" />
                )}
              </Link>
              <Link
                href="/start"
                className="record-icon-action button-primary motion-control"
                aria-label="New replay"
                title="New replay"
              >
                <NewReplayIcon />
              </Link>
            </div>
          </div>
        </div>
        {error && (
          <div className="mb-4">
            <ErrorBanner
              title="Could not update your record"
              message={error}
              onRetry={load}
            />
          </div>
        )}
        {!sessions && !error && <Skeleton className="h-64 w-full" />}
        {sessions && shown.length === 0 && (
          <EmptyState
            title={
              archived
                ? "No archived sessions"
                : inView.length
                  ? "No sessions in this view"
                  : "Your first read starts here"
            }
            message={
              archived
                ? "Archived sessions will appear here. Archiving does not extend their expiry."
                : inView.length
                  ? "Choose another filter to see your sessions."
                  : "Start a replay and your record will grow with every session."
            }
            action={
              !archived && (
                <Link className="mt-3 text-accent-300" href="/start">
                  Start a replay →
                </Link>
              )
            }
          />
        )}
        <div className="record-grid">
          {shown.map((session, i) => (
            <div
              className="stagger-item"
              style={{ "--i": i } as React.CSSProperties}
              key={session.id}
            >
              <SessionHistoryCard
                session={session}
                onArchive={async (selected) => {
                  try {
                    const updated = await request("setArchived", {
                      params: { sessionId: selected.id },
                      body: { archived: !selected.archived },
                    });
                    setSessions(
                      (current) =>
                        current?.map((s) =>
                          s.id === updated.id ? updated : s,
                        ) ?? null,
                    );
                  } catch {
                    setError(
                      selected.archived
                        ? "Could not restore this session. Please try again."
                        : "Could not archive this session. Please try again.",
                    );
                  }
                }}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
