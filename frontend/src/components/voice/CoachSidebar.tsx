"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode, CSSProperties } from "react";
import { Mic, Send, LockKeyhole } from "lucide-react";
import type { z } from "zod";
import {
  renderSafeReply,
  History,
  type AnalysisDraft,
  type ChartContext,
  type AnalysisSubmission,
} from "@hackrice/contracts";
import { openFeedback } from "@/utilities/feedback-transition";
import { request } from "@/services/api-client";
import {
  Badge,
  Button,
  Dialog,
  ErrorBanner,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { VoiceClient, type VoiceState } from "@/services/voice-client";

const FIELD_LABEL = (field: keyof AnalysisDraft) =>
  ({
    thesis: "thesis",
    prediction: "prediction",
    hypotheticalAction: "action",
    confidencePercent: "confidence",
    claimedEvidence: "evidence",
    invalidation: "invalidation",
    riskReasoning: "risk",
  })[field];

const STATUS: Record<VoiceState, string> = {
  idle: "Paused",
  connecting: "Connecting…",
  listening: "Listening — just talk",
  thinking: "Thinking…",
  speaking: "Speaking",
};

export function CoachSidebar({
  sessionId,
  captureContext,
  disabled = false,
  readOnly = false,
  revision,
  candlePanel,
}: {
  sessionId: string;
  captureContext: () => Promise<ChartContext>;
  disabled?: boolean;
  readOnly?: boolean;
  revision?: number;
  candlePanel?: ReactNode;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<z.infer<typeof History>["turns"]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState<ChartContext | null>(
    null,
  );
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [detent, setDetent] = useState<"peek" | "half" | "full">("peek");
  const touchY = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Kept apart from `error`: a voice failure is not a failed submission. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [thesis, setThesis] = useState("");
  const [prediction, setPrediction] =
    useState<AnalysisSubmission["prediction"]>("unchanged");
  const [action, setAction] =
    useState<AnalysisSubmission["hypotheticalAction"]>("wait");
  const [confidence, setConfidence] = useState("");
  const [evidence, setEvidence] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [risk, setRisk] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceAnswer, setVoiceAnswer] = useState("");
  /** True once the user has opened the conversation; turns then chain themselves. */
  const [conversing, setConversing] = useState(false);
  /** Fields the coach heard the learner state, for them to check before submitting. */
  const [heard, setHeard] = useState<(keyof AnalysisDraft)[]>([]);
  /** The saved draft is applied once on load, never over edits made since. */
  const restored = useRef(false);
  const applyDraft = useCallback((value: AnalysisDraft) => {
    if (value.thesis !== undefined) setThesis(value.thesis);
    if (value.prediction !== undefined) setPrediction(value.prediction);
    if (value.hypotheticalAction !== undefined)
      setAction(value.hypotheticalAction);
    if (value.confidencePercent !== undefined)
      setConfidence(String(value.confidencePercent));
    if (value.claimedEvidence?.length)
      setEvidence(value.claimedEvidence.join("\n"));
    if (value.invalidation !== undefined) setInvalidation(value.invalidation);
    if (value.riskReasoning !== undefined) setRisk(value.riskReasoning);
    setHeard(
      Object.keys(value).filter(
        (key) => value[key as keyof AnalysisDraft] !== undefined,
      ) as (keyof AnalysisDraft)[],
    );
  }, []);
  const voice = useRef<VoiceClient | null>(null);
  const mounted = useRef(true);
  /** Read inside the `complete` callback, which closes over its first render. */
  const latest = useRef({
    conversing: false,
    disabled,
    capture: captureContext,
  });
  latest.current = { conversing, disabled, capture: captureContext };

  const loadHistory = useCallback(async () => {
    const history = await request("getHistory", { params: { sessionId } });
    setTurns(history.turns);
    setRevisions(
      Object.fromEntries(
        (history.snapshots ?? []).map((snapshot) => [
          snapshot.id,
          snapshot.revision,
        ]),
      ),
    );
    if (!readOnly && history.draft && !restored.current) {
      restored.current = true;
      applyDraft(history.draft);
    }
  }, [sessionId, applyDraft, readOnly]);
  useEffect(() => {
    void loadHistory().catch(() =>
      setError("Could not load the conversation."),
    );
  }, [loadHistory]);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void fetch("/health", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Health unavailable");
        return r.json();
      })
      .then((data) => setVoiceEnabled(data.voiceEnabled === true))
      .catch(() => {});
    const client = new VoiceClient(sessionId, {
      state: setVoiceState,
      transcript: setVoiceTranscript,
      answer: setVoiceAnswer,
      draft: applyDraft,
      // A failed turn must not re-arm: that would hammer getUserMedia.
      error: (message) => {
        setError(message);
        // The client disposes the turn on failure, so nothing is listening;
        // end the conversation rather than leaving a dead "open" state, and
        // give the microphone back.
        setConversing(false);
        client.close();
      },
      complete: () => {
        void loadHistory()
          .then(() => {
            setVoiceTranscript("");
            setVoiceAnswer("");
          })
          .catch(() => setError("Could not refresh voice history."));
        // The coach has finished speaking; open the microphone for the reply.
        // `dispose()` already cleared the previous turn, so `start()` is free.
        const { conversing: on, disabled: off, capture } = latest.current;
        if (mounted.current && on && !off) void client.start(capture);
      },
    });
    voice.current = client;
    return () => {
      mounted.current = false;
      abort.abort();
      client.close();
      voice.current = null;
    };
  }, [sessionId, loadHistory, applyDraft]);

  /** A submitted session ends the conversation rather than re-arming into it. */
  useEffect(() => {
    if (disabled && conversing) {
      setConversing(false);
      voice.current?.close();
    }
  }, [disabled, conversing]);

  const begin = () => {
    setError(null);
    setVoiceTranscript("");
    setVoiceAnswer("");
    setConversing(true);
    // The first turn starts inside this click so the AudioContext is allowed to
    // play audio; every later turn inherits that permission.
    void voice.current?.start(captureContext);
  };
  const end = () => {
    setConversing(false);
    voice.current?.close();
  };

  const voiceActive = voiceState !== "idle";
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setSubmitError(null);
    try {
      await work();
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : "Request failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const completedFields = [
    thesis.trim().length > 0,
    true,
    true,
    confidence !== "",
    evidence.trim().length > 0,
    invalidation.trim().length > 0,
  ];
  const progress = (
    <div className="analysis-progress" aria-label="Analysis fields">
      {["Thesis", "Call", "Action", "Conf.", "Evidence", "Invalid."].map(
        (label, index) => (
          <span key={label} data-filled={completedFields[index]}>
            {label}
            <span className="sr-only">
              {completedFields[index] ? " entered" : " empty"}
            </span>
          </span>
        ),
      )}
    </div>
  );
  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const snapshot = await captureContext();
      await request("askQuestion", {
        params: { sessionId },
        body: { chartSnapshotId: snapshot.id, text: question.trim() },
      });
      setQuestion("");
      await loadHistory();
    } catch {
      setError("Could not answer your question. Try again.");
    } finally {
      setAsking(false);
    }
  };
  const retryVoice = async () => {
    try {
      const response = await fetch("/health");
      if (!response.ok) throw new Error();
      const data = await response.json();
      setVoiceEnabled(data.voiceEnabled === true);
      setError(
        data.voiceEnabled
          ? null
          : "Voice is still unavailable. You can keep typing questions.",
      );
    } catch {
      setError(
        "Could not reconnect. You can retry when the connection returns.",
      );
    }
  };
  return (
    <div className="bench" data-detent={detent}>
      <button
        className="mobile-sheet-control"
        aria-label={`Coach sheet: ${detent}. Change sheet height`}
        onClick={() =>
          setDetent(
            detent === "peek" ? "half" : detent === "half" ? "full" : "peek",
          )
        }
        onPointerDown={(e) => {
          touchY.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (e.clientY < touchY.current)
            setDetent(detent === "peek" ? "half" : "full");
          if (e.clientY > touchY.current)
            setDetent(detent === "full" ? "half" : "peek");
        }}
      >
        {detent === "full"
          ? "Your analysis · tap to return to chart"
          : `Coach · ${conversing ? STATUS[voiceState] : voiceEnabled ? "Paused" : "Type a question"}`}
      </button>
      <section className="bench-bay coach-bay surface-inset" aria-label="Coach">
        <header className="bay-header">
          <div className="flex items-center gap-3">
            <span
              className="voice-orb"
              data-state={voiceState}
              aria-hidden="true"
            />
            <div>
              <h2>Coach</h2>
              <p role="status" className="mt-0.5 text-micro text-ink-muted">
                {conversing
                  ? STATUS[voiceState]
                  : voiceEnabled
                    ? "Paused · facts only"
                    : "Voice unavailable · type"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="px-3 text-tiny"
            disabled={disabled || busy}
            onClick={voiceEnabled ? (conversing ? end : begin) : retryVoice}
          >
            {voiceEnabled ? (conversing ? "Pause" : "Talk") : "Retry voice"}
          </Button>
        </header>
        <div className="bay-scroll conversation" aria-live="polite">
          {turns.length === 0 && (
            <div className="py-2">
              <p className="text-tiny leading-relaxed text-ink-muted">
                A second pair of eyes, grounded in your chart. Ask for a
                calculation. You make the call.
              </p>
              <button
                className="fact-chip mt-3 text-left"
                onClick={() => setQuestion("What is the visible high and low?")}
              >
                Try: What is the visible high and low?
              </button>
            </div>
          )}
          {turns.map((turn, index) => (
            <article
              key={turn.id}
              className="stagger-item space-y-2"
              style={{ "--i": index } as CSSProperties}
            >
              <p className="question-bubble">
                {turn.finalTranscript ??
                  (turn.status === "cancelled"
                    ? "Voice turn cancelled"
                    : "Voice turn failed")}
              </p>
              {turn.reply?.kind === "calculation" ? (
                <div className="flex flex-wrap gap-2">
                  {turn.reply.facts.map((fact) => (
                    <span
                      className="fact-chip nums"
                      key={fact.id}
                      title={`${fact.unit} · frozen snapshot r${revisions[turn.chartSnapshotId] ?? "?"}`}
                    >
                      {fact.metric.replaceAll("_", " ").toUpperCase()}
                      {fact.period ? ` ${fact.period}` : ""}
                      <strong>
                        {Number(fact.value).toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}
                      </strong>
                    </span>
                  ))}
                </div>
              ) : turn.reply?.kind === "refusal" ? (
                <span
                  className="fact-chip refusal-chip"
                  title={renderSafeReply(turn.reply)}
                >
                  {
                    {
                      advice: "Recommendations",
                      future: "Predictions",
                      news: "Dated news",
                      unsupported: "Unsupported question",
                      insufficient_data: "Insufficient data",
                    }[turn.reply.reason]
                  }{" "}
                  · refused
                </span>
              ) : turn.reply ? (
                <p className="text-tiny leading-relaxed text-ink-muted">
                  {renderSafeReply(turn.reply)}
                </p>
              ) : null}
              <p className="text-micro text-ink-faint">
                {turn.inputMode === "text"
                  ? "text"
                  : turn.audioDelivery === "completed"
                    ? "spoke"
                    : turn.audioDelivery === "partial"
                      ? "audio interrupted"
                      : "voice"}{" "}
                ·{" "}
                {revisions[turn.chartSnapshotId] !== undefined
                  ? `snapshot r${revisions[turn.chartSnapshotId]}`
                  : "saved snapshot"}
              </p>
            </article>
          ))}
          {voiceTranscript && (
            <p className="question-bubble">{voiceTranscript}</p>
          )}
          {voiceAnswer && (
            <p className="text-tiny text-coach-300">{voiceAnswer}</p>
          )}
          {error && <ErrorBanner title="Could not continue" message={error} />}
        </div>
        {detent === "half" && !readOnly && (
          <div className="bay-footer lg:hidden">
            {!thesis.trim() ? (
              <label className="block text-tiny text-ink-muted">
                Thesis
                <Textarea
                  className="mt-2"
                  rows={2}
                  value={thesis}
                  onChange={(e) => setThesis(e.target.value)}
                  placeholder="What do you see, and why?"
                />
              </label>
            ) : confidence === "" ? (
              <label className="block text-tiny text-ink-muted">
                Confidence (%)
                <Input
                  className="mt-2"
                  type="number"
                  min={0}
                  max={100}
                  value={confidence}
                  onChange={(e) => setConfidence(e.target.value)}
                />
              </label>
            ) : !evidence.trim() ? (
              <label className="block text-tiny text-ink-muted">
                Evidence claims
                <Textarea
                  className="mt-2"
                  rows={2}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="One numerical claim per line"
                />
              </label>
            ) : (
              <Button className="w-full" onClick={() => setDetent("full")}>
                Review your analysis ↑
              </Button>
            )}
          </div>
        )}
        <footer className="bay-footer">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <Button
              className="px-3"
              aria-label={conversing ? "Pause microphone" : "Start microphone"}
              disabled={!voiceEnabled || disabled || busy}
              onClick={conversing ? end : begin}
            >
              <Mic size={16} />
            </Button>
            <Input
              aria-label="Question for the coach"
              placeholder="Or type a question…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={disabled}
            />
            <Button
              type="submit"
              aria-label="Ask question"
              disabled={asking || busy || disabled || !question.trim()}
              className="px-3"
            >
              <Send size={14} />
            </Button>
          </form>
          <details className="mt-2 text-micro text-ink-faint">
            <summary>Voice & privacy</summary>
            <p className="mt-2">
              Deepgram transcribes your audio; ElevenLabs speaks approved
              replies. Audio and transcripts are kept for 30 days from session
              creation or until deletion. Provider retention may differ.
            </p>
          </details>
          <div className="mt-3 lg:hidden">{progress}</div>
          <button
            className="mt-2 w-full text-tiny text-accent-300 lg:hidden"
            onClick={() => setDetent("full")}
          >
            Continue analysis ↑
          </button>
        </footer>
      </section>
      <section className="bench-bay analysis-bay" aria-label="Your analysis">
        <header className="bay-header">
          <h2>Your analysis</h2>
          <span className="text-micro text-ink-faint">
            {readOnly
              ? `Committed · snapshot r${revision}`
              : "Final once committed"}
          </span>
        </header>
        {readOnly ? (
          <div className="bay-scroll space-y-4">
            <LockKeyhole size={24} className="text-accent-400" />
            <h3 className="font-semibold">
              This analysis is already committed
            </h3>
            <p className="text-tiny leading-relaxed text-ink-muted">
              You’re back on the chart as it was at submission. Drawings and
              indicators are read-only; the coach still answers facts about the
              visible candles.
            </p>
            <Button
              variant="primary"
              onClick={() => router.push(`/replay/${sessionId}/feedback`)}
            >
              Open feedback
            </Button>
            <Button variant="ghost" onClick={() => router.push("/history")}>
              Your record
            </Button>
          </div>
        ) : (
          <>
            <form
              id="analysis-form"
              className="bay-scroll"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  end();
                  setReviewSnapshot(await captureContext());
                  setConfirming(true);
                });
              }}
            >
              {heard.length > 0 && (
                <p className="mb-3 text-micro text-coach-300">
                  Heard from you: {heard.map(FIELD_LABEL).join(", ")}. Check
                  before committing.
                </p>
              )}
              <div className="analysis-grid">
                <label className="analysis-thesis">
                  Thesis
                  <Textarea
                    rows={3}
                    value={thesis}
                    onChange={(e) => setThesis(e.target.value)}
                    required
                    placeholder="What do you see, and why?"
                  />
                </label>
                <fieldset>
                  <legend className="mb-1.5">Prediction</legend>
                  <div className="segmented">
                    {(
                      [
                        ["higher", "Higher"],
                        ["lower", "Lower"],
                        ["unchanged", "Flat"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={prediction === value}
                        onClick={() => setPrediction(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-1.5">Hypothetical action</legend>
                  <div className="segmented">
                    {(["long", "short", "wait"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={action === value}
                        onClick={() => setAction(value)}
                      >
                        {value[0].toUpperCase() + value.slice(1)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="analysis-confidence">
                  <span className="flex justify-between">
                    Confidence{" "}
                    <span className="nums text-ink">
                      {confidence === "" ? "Choose a value" : `${confidence}%`}
                    </span>
                  </span>
                  <input
                    aria-label="Confidence"
                    type="range"
                    min={0}
                    max={100}
                    value={confidence === "" ? 0 : Number(confidence)}
                    onChange={(e) => setConfidence(e.target.value)}
                    onPointerUp={(e) => setConfidence(e.currentTarget.value)}
                    onKeyUp={(e) => setConfidence(e.currentTarget.value)}
                  />
                </label>
                <label className="analysis-evidence">
                  <span className="flex flex-wrap justify-between gap-1">
                    Evidence claims{" "}
                    <span className="text-micro text-ink-faint">
                      one per line · checked before reveal
                    </span>
                  </span>
                  <Textarea
                    rows={2}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder={"close > ema 21\nrsi 14 <= 70"}
                  />
                </label>
                <label>
                  Invalidation · optional
                  <Input
                    value={invalidation}
                    onChange={(e) => setInvalidation(e.target.value)}
                    placeholder="What would change your read?"
                  />
                </label>
                <label className="col-span-full">
                  Risk reasoning · optional
                  <Input
                    value={risk}
                    onChange={(e) => setRisk(e.target.value)}
                    placeholder="What risk have you considered?"
                  />
                </label>
              </div>
              {submitError && (
                <div className="mt-3">
                  <ErrorBanner
                    title="Could not prepare analysis"
                    message={submitError}
                  />
                </div>
              )}
            </form>
            <footer className="bay-footer flex items-center gap-4">
              <div className="min-w-0 flex-1">{progress}</div>
              <Button
                form="analysis-form"
                type="submit"
                variant="primary"
                disabled={busy || asking || disabled || confidence === ""}
              >
                {busy ? "Preparing…" : "Commit analysis"}
              </Button>
            </footer>
          </>
        )}
      </section>
      {candlePanel}
      <Dialog
        open={confirming}
        onClose={() => {
          if (!busy) setConfirming(false);
        }}
        title="Commit this analysis?"
        description={`Submission is final. Chart snapshot r${reviewSnapshot?.revision ?? ""} is frozen, evidence lines are checked, and a hash of your analysis is sent to Solana devnet.`}
        actions={
          <>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button
              variant="primary"
              disabled={busy || !reviewSnapshot}
              onClick={() =>
                void run(async () => {
                  if (!reviewSnapshot) return;
                  end();
                  await request("submitAnalysis", {
                    params: { sessionId },
                    body: {
                      chartSnapshotId: reviewSnapshot.id,
                      thesis: thesis.trim(),
                      prediction,
                      hypotheticalAction: action,
                      confidencePercent: Number(confidence),
                      claimedEvidence: evidence
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      ...(invalidation.trim()
                        ? { invalidation: invalidation.trim() }
                        : {}),
                      ...(risk.trim() ? { riskReasoning: risk.trim() } : {}),
                    },
                  });
                  setConfirming(false);
                  openFeedback(() =>
                    router.push(`/replay/${sessionId}/feedback`),
                  );
                })
              }
            >
              {busy ? "Committing…" : "Commit analysis"}
            </Button>
          </>
        }
      >
        <p className="eyebrow">Thesis</p>
        <p className="whitespace-pre-wrap text-ink">{thesis}</p>
        <dl className="summary-values">
          <div>
            <dt>Prediction</dt>
            <dd>
              {prediction === "unchanged"
                ? "Flat —"
                : prediction === "higher"
                  ? "Higher ▲"
                  : "Lower ▼"}
            </dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd className="capitalize">{action}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{confidence}%</dd>
          </div>
        </dl>
        <p className="text-tiny">
          {evidence.split("\n").filter((s) => s.trim()).length} evidence lines
          will be checked. Prose that cannot be calculated stays not assessable.
          Reveal unlocks after the receipt is confirmed.
        </p>
        {submitError && (
          <ErrorBanner title="Submission failed" message={submitError} />
        )}
      </Dialog>
    </div>
  );
}
