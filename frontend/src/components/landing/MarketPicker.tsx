"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CandlestickChart, ChartNoAxesCombined, Globe } from "lucide-react";
import { createSession } from "@/hooks/useReplaySession";
import { isApiError } from "@/services/api-client";
import { Button, ErrorBanner } from "@/components/ui";
export function MarketPicker() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const id = await createSession("15m", "1h");
      router.push(`/replay/${id}`);
    } catch (e) {
      if (isApiError(e, "unauthenticated")) {
        router.push("/sign-in?mode=sign-up&next=%2Fstart");
        return;
      }
      setError(
        isApiError(e, "insufficient_data")
          ? "No replay is available for this market yet. Please try again after market history is available."
          : "Could not start your replay. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {error && (
        <ErrorBanner
          title="Replay unavailable"
          message={error}
          onRetry={start}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            name: "Crypto",
            detail: "SOL / USDT · Binance spot, 5m source",
            Icon: CandlestickChart,
          },
          {
            name: "Stocks",
            detail: "Equities on a session clock",
            Icon: ChartNoAxesCombined,
          },
          { name: "Forex", detail: "Majors, 24/5", Icon: Globe },
        ].map(({ name, detail, Icon }, i) => (
          <article
            key={name}
            className={`surface rounded-2xl p-5 ${i ? "opacity-55" : ""}`}
          >
            <div className="mb-4 flex items-center gap-3">
              <span className={`icon-well ${i ? "" : "button-primary"}`}>
                <Icon size={19} />
              </span>
              <div>
                <h3 className="font-semibold">{name}</h3>
                <p className="mt-1 text-tiny text-ink-muted">{detail}</p>
              </div>
            </div>
            <Button
              className="w-full"
              variant={i ? "ghost" : "primary"}
              disabled={i > 0 || busy}
              onClick={start}
            >
              {i ? "Coming soon" : busy ? "Starting replay…" : "Start replay"}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
