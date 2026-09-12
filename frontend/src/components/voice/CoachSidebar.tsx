"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderSafeReply, type AnalysisDraft, type ChartContext, type AnalysisSubmission } from "@hackrice/contracts";
import { request } from "@/services/api-client";
import { Badge, Button, Dialog, ErrorBanner, Input, Select, Textarea } from "@/components/ui";
import { VoiceClient, type VoiceState } from "@/services/voice-client";

const FIELD_LABEL = (field: keyof AnalysisDraft) => ({
  thesis: "thesis", prediction: "prediction", hypotheticalAction: "action",
  confidencePercent: "confidence", claimedEvidence: "evidence",
  invalidation: "invalidation", riskReasoning: "risk",
}[field]);

const STATUS: Record<VoiceState, string> = {
  idle: "Paused",
  connecting: "Connecting…",
  listening: "Listening — just talk",
  thinking: "Thinking…",
  speaking: "Speaking",
};

export function CoachSidebar({ sessionId, captureContext, disabled = false }: {
  sessionId: string; captureContext: () => Promise<ChartContext>; disabled?: boolean;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<{ id: string; question?: string; answer?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Kept apart from `error`: a voice failure is not a failed submission. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [thesis, setThesis] = useState("");
  const [prediction, setPrediction] = useState<AnalysisSubmission["prediction"]>("unchanged");
  const [action, setAction] = useState<AnalysisSubmission["hypotheticalAction"]>("wait");
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
    if (value.hypotheticalAction !== undefined) setAction(value.hypotheticalAction);
    if (value.confidencePercent !== undefined) setConfidence(String(value.confidencePercent));
    if (value.claimedEvidence?.length) setEvidence(value.claimedEvidence.join("\n"));
    if (value.invalidation !== undefined) setInvalidation(value.invalidation);
    if (value.riskReasoning !== undefined) setRisk(value.riskReasoning);
    setHeard(Object.keys(value).filter(key => value[key as keyof AnalysisDraft] !== undefined) as (keyof AnalysisDraft)[]);
  }, []);
  const voice = useRef<VoiceClient | null>(null);
  const mounted = useRef(true);
  /** Read inside the `complete` callback, which closes over its first render. */
  const latest = useRef({ conversing: false, disabled, capture: captureContext });
  latest.current = { conversing, disabled, capture: captureContext };

  const loadHistory = useCallback(async () => {
    const history = await request("getHistory", { params: { sessionId } });
    setTurns(history.turns.map(t => ({ id: t.id, question: t.finalTranscript, answer: t.reply ? renderSafeReply(t.reply) : undefined })));
    if (history.draft && !restored.current) { restored.current = true; applyDraft(history.draft); }
  }, [sessionId, applyDraft]);
  useEffect(() => { void loadHistory().catch(() => setError("Could not load the conversation.")); }, [loadHistory]);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void fetch("/health", { signal: abort.signal }).then(r => { if (!r.ok) throw new Error("Health unavailable"); return r.json(); }).then(data => setVoiceEnabled(data.voiceEnabled === true)).catch(() => {});
    const client = new VoiceClient(sessionId, {
      state: setVoiceState,
      transcript: setVoiceTranscript,
      answer: setVoiceAnswer,
      draft: applyDraft,
      // A failed turn must not re-arm: that would hammer getUserMedia.
      error: message => {
        setError(message);
        // The client disposes the turn on failure, so nothing is listening;
        // end the conversation rather than leaving a dead "open" state.
        setConversing(false);
      },
      complete: () => {
        void loadHistory().then(() => { setVoiceTranscript(""); setVoiceAnswer(""); }).catch(() => setError("Could not refresh voice history."));
        // The coach has finished speaking; open the microphone for the reply.
        // `dispose()` already cleared the previous turn, so `start()` is free.
        const { conversing: on, disabled: off, capture } = latest.current;
        if (mounted.current && on && !off) void client.start(capture);
      },
    });
    voice.current = client;
    return () => { mounted.current = false; abort.abort(); client.cancel(); voice.current = null; };
  }, [sessionId, loadHistory, applyDraft]);

  /** A submitted session ends the conversation rather than re-arming into it. */
  useEffect(() => {
    if (disabled && conversing) { setConversing(false); voice.current?.cancel(); }
  }, [disabled, conversing]);

  const begin = () => {
    setError(null);
    setVoiceTranscript(""); setVoiceAnswer("");
    setConversing(true);
    // The first turn starts inside this click so the AudioContext is allowed to
    // play audio; every later turn inherits that permission.
    void voice.current?.start(captureContext);
  };
  const end = () => { setConversing(false); voice.current?.cancel(); };

  const voiceActive = voiceState !== "idle";
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setSubmitError(null);
    try { await work(); } catch (e) { setSubmitError(e instanceof Error ? e.message : "Request failed. Please try again."); }
    finally { setBusy(false); }
  };
  return <aside className="flex h-full min-h-0 flex-col overflow-y-auto bg-panel p-5">
    <header className="mb-4">
      <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold text-ink">Chart coach</h2><Badge>{conversing ? STATUS[voiceState] : voiceEnabled ? "Ready" : "Voice unavailable"}</Badge></div>
      <p className="mt-2 text-tiny text-ink-muted">Talk through the chart out loud. Ask for calculations from what is visible; you draw your own conclusions.</p>
      <p className="mt-2 text-tiny text-ink-faint">The coach receives EMA 21, RSI 14, horizontal lines, and trend lines. Other overlays are visual-only.</p>
    </header>
    <section className="mb-4 space-y-2" aria-label="Coach conversation">
      {!voiceEnabled
        ? <div className="rounded-lg bg-raised p-3">
            <p className="text-base text-ink">Voice unavailable</p>
            <p className="mt-1 text-tiny text-ink-muted">The backend reports that playback validation has not passed, so the coach cannot listen or speak. Set <code>VOICE_PLAYBACK_VALIDATED=true</code> and point <code>DEEPGRAM_THINK_URL</code> at a live tunnel, then reload.</p>
          </div>
        : <>
            <p role="status" className="text-base text-ink">{conversing ? STATUS[voiceState] : "Not started"}</p>
            {conversing
              ? <Button onClick={end}>End conversation</Button>
              : <Button variant="primary" disabled={busy || disabled} onClick={begin}>Start conversation</Button>}
            {conversing && <p className="text-tiny text-ink-faint">Speak, then pause. The coach replies and listens again automatically.</p>}
          </>}
      <p className="text-tiny text-ink-faint">Answers are spoken, not written, so turn your sound on. Deepgram transcribes your audio; ElevenLabs speaks the approved reply. This app retains raw audio and final transcripts for 30 days or until deletion. Provider retention may differ.</p>
      {voiceTranscript && <p className="text-base text-ink-muted">You: {voiceTranscript}</p>}
      {voiceAnswer && <p className="text-base text-ink-muted">Coach is answering aloud…</p>}
    </section>
    <div className="space-y-3" aria-live="polite">
      {turns.map(t => <div key={t.id} className="rounded-lg bg-raised p-3 text-base">
        <p className="text-ink-muted">You: {t.question ?? "Cancelled voice turn"}</p>
        {t.answer && <p className="mt-2 text-tiny text-ink-faint">Answered aloud</p>}
      </div>)}
    </div>
    {error && <div className="mt-3"><ErrorBanner title="Could not continue" message={error} /></div>}
    <form className="mt-6 space-y-3 border-t border-line pt-4" onSubmit={e => { e.preventDefault(); setSubmitError(null); setConfirming(true); }}>
      <h3 className="text-lead font-semibold text-ink">Your analysis</h3>
      {heard.length > 0 && <p className="text-tiny text-coach">Filled in from what you said: {heard.map(FIELD_LABEL).join(", ")}. Check it, edit anything, then submit.</p>}
      <label className="block text-base text-ink">Thesis<Textarea value={thesis} onChange={e => setThesis(e.target.value)} required /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-base text-ink">Prediction<Select value={prediction} onChange={e => setPrediction(e.target.value as typeof prediction)}><option value="higher">Higher</option><option value="lower">Lower</option><option value="unchanged">Unchanged</option></Select></label>
        <label className="text-base text-ink">Hypothetical action<Select value={action} onChange={e => setAction(e.target.value as typeof action)}><option value="long">Long</option><option value="short">Short</option><option value="wait">Wait</option></Select></label>
      </div>
      <label className="block text-base text-ink">Your confidence (%)<Input type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(e.target.value)} required /></label>
      <label className="block text-base text-ink">Evidence (one claim per line)<Textarea value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="For example: close above EMA 9" /></label>
      <label className="block text-base text-ink">What would invalidate your thesis?<Textarea value={invalidation} onChange={e => setInvalidation(e.target.value)} /></label>
      <label className="block text-base text-ink">Risk reasoning<Textarea value={risk} onChange={e => setRisk(e.target.value)} /></label>
      <Button type="submit" variant="primary" disabled={busy || voiceActive || disabled}>Review analysis</Button>
    </form>
    <Dialog open={confirming} onClose={() => { if (!busy) setConfirming(false); }} title="Commit this analysis?" description="Submission is final. Reveal still requires a confirmed Solana devnet receipt." actions={<>
      <Button disabled={busy} onClick={() => setConfirming(false)}>Keep editing</Button>
      <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
        const snapshot = await captureContext();
        await request("submitAnalysis", { params: { sessionId }, body: { chartSnapshotId: snapshot.id, thesis: thesis.trim(), prediction, hypotheticalAction: action, confidencePercent: Number(confidence), claimedEvidence: evidence.split("\n").map(s => s.trim()).filter(Boolean), ...(invalidation.trim() ? { invalidation: invalidation.trim() } : {}), ...(risk.trim() ? { riskReasoning: risk.trim() } : {}) } });
        router.push(`/replay/${sessionId}/feedback`);
      })}>{busy ? "Submitting…" : "Submit analysis"}</Button>
    </>}><p className="whitespace-pre-wrap">{thesis}</p><p>{prediction} · {action} · {confidence}% confidence</p>{submitError && <ErrorBanner title="Submission failed" message={submitError} />}</Dialog>
  </aside>;
}
