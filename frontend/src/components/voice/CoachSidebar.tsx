"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Send } from "lucide-react";
import { AGENT_STATUS_LABEL, type AgentStatus } from "@/view-models";
import { Badge, Button, Dialog } from "@/components/ui";
import { PushToTalkButton } from "./PushToTalkButton";
import { cn } from "@/utilities/cn";

type Mode = "ask" | "submit";

export function CoachSidebar({ sessionId = "demo" }: { sessionId?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<AgentStatus>("ready");
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** What the submission PTT captured, shown back before it commits. */
  const [spokenAnalysis, setSpokenAnalysis] = useState("");

  const busy = mode !== null;

  /**
   * Deepgram seam.
   *
   * The browser must never hold a raw Deepgram key, so the real implementation
   * fetches a short-lived token from the backend and opens the streaming socket
   * here. Both modes share one connection; they differ in how the final
   * transcript is routed — a question is answered, an analysis is submitted.
   */
  const start = useCallback((next: Mode) => {
    // TODO(deepgram): request a scoped token, open the socket, stream mic audio.
    setMode(next);
    setStatus("listening");
  }, []);

  const end = useCallback(
    (which: Mode) => {
      // TODO(deepgram): close the stream and await the final transcript.
      setMode(null);
      if (which === "ask") {
        setStatus("ready");
        return;
      }
      // Submission is one-way, so it always passes through confirmation.
      setSpokenAnalysis(
        "Price has been compressing into a narrowing range while volume declines, which I read as continuation once the range resolves. I would be wrong on a close below 139.80.",
      );
      setStatus("ready");
      setConfirming(true);
    },
    [],
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel">
      <header className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Voice Coach</h2>
          <Badge tone={status === "listening" ? "coach" : "neutral"}>
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                status === "listening" ? "bg-coach-300" : "bg-bull",
              )}
            />
            {/* Every agent state carries a visible label (spec §18). */}
            {AGENT_STATUS_LABEL[status]}
          </Badge>
        </div>
        <p className="mt-1 text-tiny text-ink-faint">
          Answers come from the visible chart only.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-5">
        <PushToTalkButton
          label="Ask about chart"
          hint="Hold and ask anything you can see on screen."
          icon={<Mic size={26} strokeWidth={1.75} />}
          active={mode === "ask"}
          disabled={busy && mode !== "ask"}
          onStart={() => start("ask")}
          onEnd={() => end("ask")}
        />

        <div className="flex w-full items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-micro uppercase tracking-wider text-ink-faint">when ready</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <PushToTalkButton
          label="Submit analysis"
          hint="Hold and talk through your full read. You'll confirm before it's sent."
          icon={<Send size={16} strokeWidth={1.75} />}
          active={mode === "submit"}
          disabled={busy && mode !== "submit"}
          tone="replay"
          size="sm"
          onStart={() => start("submit")}
          onEnd={() => end("submit")}
        />
      </div>

      <p className="shrink-0 px-5 pb-4 text-center text-micro leading-relaxed text-ink-faint">
        Educational reasoning practice. Not trade advice.
      </p>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Submit this analysis?"
        description="Your chart context and drawings are captured when you submit."
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Record again
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false);
                router.push(`/replay/${sessionId}/feedback`);
              }}
            >
              Submit analysis
            </Button>
          </>
        }
      >
        <div className="rounded-lg bg-raised p-3">
          <p className="mb-1.5 text-micro uppercase tracking-wider text-ink-faint">
            What we heard
          </p>
          <p className="text-base leading-relaxed text-ink">{spokenAnalysis}</p>
        </div>
        <p className="text-tiny">Future candles stay hidden until feedback is ready.</p>
      </Dialog>
    </aside>
  );
}
