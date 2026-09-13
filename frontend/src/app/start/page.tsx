"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSession } from "@/hooks/useReplaySession";
import { isApiError } from "@/services/api-client";
import { Brand } from "@/components/layout/AppHeader";
import { Button, ErrorBanner } from "@/components/ui";
export default function StartReplay() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");
  async function start() {
    setError("");
    try {
      const id = await createSession("15m", "1h");
      router.replace(`/replay/${id}`);
    } catch (e) {
      if (isApiError(e, "unauthenticated"))
        router.replace("/sign-in?mode=sign-up&next=%2Fstart");
      else
        setError(
          "Could not create a replay. Market history may be unavailable.",
        );
    }
  }
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void start();
    }
  }, []);
  return (
    <main className="grid min-h-dvh place-content-center gap-6 p-6">
      <Brand />
      {error ? (
        <ErrorBanner
          title="Replay unavailable"
          message={error}
          onRetry={start}
        />
      ) : (
        <p role="status">Preparing your replay…</p>
      )}
      <Button variant="ghost" onClick={() => router.push("/#markets")}>
        Back to markets
      </Button>
    </main>
  );
}
