"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { MARKETS } from "@/view-models";
import { createSession } from "@/hooks/useReplaySession";
import { isApiError } from "@/services/api-client";
import { ErrorBanner } from "@/components/ui";
import { cn } from "@/utilities/cn";

/**
 * Starting a session is a real API call: sessions are server-owned UUIDs, so a
 * market card creates one and then routes to `/replay/<uuid>`.
 */
export function MarketPicker() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const sessionId = await createSession("15m", "1h");
      router.push(`/replay/${sessionId}`);
    } catch (e) {
      if (isApiError(e, "unauthenticated")) {
        router.push("/sign-in?next=%2F%23markets");
        return;
      }
      setError(
        isApiError(e, "insufficient_data")
          ? "The API has no candle history imported yet. Run the import command, then try again."
          : e instanceof Error
            ? e.message
            : "Could not start a session.",
      );
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {error && <ErrorBanner title="Could not start a session" message={error} />}

      <div className="grid gap-3 sm:grid-cols-3">
        {MARKETS.map((market) => (
          <button
            key={market.id}
            onClick={() => market.available && void start(market.id)}
            disabled={!market.available || busy !== null}
            aria-label={
              market.available ? `Start a ${market.label} session` : `${market.label} — coming soon`
            }
            className={cn(
              "surface motion-card group rounded-xl2 bg-panel p-5 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
              market.available
                ? "hover:border-accent-500/45 hover:bg-raised"
                : "cursor-not-allowed opacity-45",
              "motion-reduce:transition-none",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lead font-semibold text-ink">{market.label}</span>
              {market.available && (
                <ArrowRight
                  size={16}
                  className="text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              )}
            </div>
            <p className="mt-1.5 text-base text-ink-muted">{market.blurb}</p>
            <p className="nums mt-4 text-micro text-accent-300">
              {busy === market.id ? "Starting…" : market.symbol}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
