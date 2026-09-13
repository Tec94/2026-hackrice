"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Session, History, Receipt } from "@hackrice/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui";
import { Archive, ArchiveRestore, Check, LoaderCircle } from "lucide-react";
import { request } from "@/services/api-client";
export function SessionHistoryCard({
  session,
  onArchive,
}: {
  session: Session;
  onArchive: (session: Session) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<z.infer<typeof History> | null>(null);
  const [receipt, setReceipt] = useState<z.infer<typeof Receipt> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void request("getHistory", {
      params: { sessionId: session.id },
      signal: abort.signal,
    })
      .then(setHistory)
      .catch(() => {});
    if (session.status === "submitted")
      void request("getReceipt", {
        params: { sessionId: session.id },
        signal: abort.signal,
      })
        .then(setReceipt)
        .catch(() => {});
    return () => {
      abort.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [session.id, session.status]);
  const destination = `/replay/${session.id}${session.status === "exploring" ? "" : session.status === "submitted" ? "/feedback" : "/reveal"}`;
  const evidence = history?.evaluations[0]?.findings.filter(
    (f) => f.category === "evidence",
  );
  const expiry = new Date(session.expiresAt);
  const expired = expiry.getTime() <= Date.now();
  const reset = () => {
    setConfirm(false);
    if (timer.current) clearTimeout(timer.current);
  };
  async function archive() {
    if (session.archived || confirm) {
      setBusy(true);
      try {
        await onArchive(session);
      } finally {
        setBusy(false);
        reset();
      }
    } else {
      setConfirm(true);
      timer.current = setTimeout(reset, 3000);
    }
  }
  return (
    <article className="record-card surface motion-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">SOL / USDT</h2>
          <p className="mt-1 text-tiny text-ink-muted">
            {session.timeframe} · {session.predictionHorizon} horizon
          </p>
        </div>
        <div
          className="record-action"
          onMouseLeave={reset}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) reset();
          }}
        >
          <span className="status-pill">
            <Badge
              tone={
                session.status === "exploring"
                  ? "accent"
                  : session.status === "submitted"
                    ? "replay"
                    : session.status === "revealed"
                      ? "bull"
                      : "neutral"
              }
            >
              {session.status[0].toUpperCase() + session.status.slice(1)}
            </Badge>
          </span>
          <button
            className={`archive-button ${confirm ? "text-accent-300" : "text-ink-muted"}`}
            aria-label={
              session.archived
                ? "Restore session"
                : confirm
                  ? "Confirm archive"
                  : "Archive session"
            }
            title={
              session.archived
                ? "Restore session"
                : confirm
                  ? "Confirm archive"
                  : "Archive session"
            }
            disabled={busy}
            onClick={() => void archive()}
          >
            {busy ? (
              <LoaderCircle
                size={16}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : session.archived ? (
              <ArchiveRestore size={16} aria-hidden="true" />
            ) : confirm ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Archive size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <dl className="mt-6 space-y-3 text-tiny">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Created</dt>
          <dd className="nums">
            {new Date(session.createdAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">
            {session.status === "exploring"
              ? "Snapshot"
              : session.status === "submitted"
                ? "Receipt"
                : "Evidence"}
          </dt>
          <dd>
            {session.status === "exploring"
              ? `r${session.latestChartRevision} · ${history?.snapshots?.at(-1)?.appearance?.drawings.length ?? history?.snapshots?.at(-1)?.drawings.length ?? 0} drawings`
              : session.status === "submitted"
                ? (receipt?.status ?? "Checking…")
                : evidence
                  ? `${evidence.filter((f) => f.status === "supported").length} supported · ${evidence.filter((f) => f.status === "contradicted").length} contradicted`
                  : "Loading…"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">{expired ? "Expired" : "Expires"}</dt>
          <dd>
            {expiry.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </dd>
        </div>
      </dl>
      <Link
        className="record-link mt-6 flex min-h-touch items-center justify-between border-t border-line/50 pt-4 text-tiny text-ink-muted hover:text-ink"
        href={destination}
      >
        {session.status === "exploring"
          ? "Resume on the chart"
          : session.status === "submitted"
            ? receipt?.status === "confirmed"
              ? "Open feedback · reveal ready"
              : "Open feedback"
            : session.status === "revealed"
              ? "Write your reflection"
              : "Review"}
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
