"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderSafeReply, type ChartContext, type AnalysisSubmission } from "@hackrice/contracts";
import { request } from "@/services/api-client";
import { Badge, Button, Dialog, ErrorBanner, Input, Select, Textarea } from "@/components/ui";
import { VoiceClient, type VoiceState } from "@/services/voice-client";

export function CoachSidebar({ sessionId, captureContext, disabled = false }: {
  sessionId: string; captureContext: () => Promise<ChartContext>; disabled?: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<{ id: string; question?: string; answer?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [thesis, setThesis] = useState("");
  const [prediction, setPrediction] = useState<AnalysisSubmission["prediction"]>("unchanged");
  const [action, setAction] = useState<AnalysisSubmission["hypotheticalAction"]>("wait");
  const [confidence, setConfidence] = useState("");
  const [evidence, setEvidence] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [risk, setRisk] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceAnswer, setVoiceAnswer] = useState('');
  const voice = useRef<VoiceClient | null>(null);
  const loadHistory = useCallback(async () => {
    const history = await request("getHistory", { params: { sessionId } });
    setTurns(history.turns.map(t => ({ id: t.id, question: t.finalTranscript, answer: t.reply ? renderSafeReply(t.reply) : undefined })));
  }, [sessionId]);
  useEffect(() => { void loadHistory().catch(() => setError("Could not load the conversation.")); }, [loadHistory]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/health', { signal: abort.signal }).then(r => { if (!r.ok) throw new Error('Health unavailable'); return r.json(); }).then(data => setVoiceEnabled(data.voiceEnabled === true)).catch(() => {});
    const client = new VoiceClient(sessionId, {
      state: setVoiceState, transcript: setVoiceTranscript, answer: setVoiceAnswer, error: setError,
      complete: () => { void loadHistory().then(() => { setVoiceTranscript(''); setVoiceAnswer(''); }).catch(() => setError('Could not refresh voice history.')); },
    });
    voice.current = client;
    return () => { abort.abort(); client.cancel(); voice.current = null; };
  }, [sessionId, loadHistory]);
  const voiceActive = voiceState !== 'idle';
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed. Please try again."); }
    finally { setBusy(false); }
  };
  return <aside className="flex h-full min-h-0 flex-col overflow-y-auto bg-panel p-5">
    <header className="mb-4">
      <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold text-ink">Chart coach</h2><Badge>{busy ? "Working" : "Text ready"}</Badge></div>
      <p className="mt-2 text-tiny text-ink-muted">Ask for calculations from the visible chart. You draw your own conclusions.</p>
      <p className="mt-2 text-tiny text-ink-faint">{voiceEnabled ? 'Start the microphone, wait for Listening, then speak. Stop and send when finished.' : 'Voice integration is installed. Live playback validation must pass on the backend before the microphone is enabled.'}</p>
      <p className="mt-2 text-tiny text-ink-faint">The coach receives EMA 21, RSI 14, horizontal lines, and trend lines. Other overlays are visual-only.</p>
    </header>
    <section className="mb-4 space-y-2" aria-label="Voice question">
      <p role="status" className="text-base text-ink">Voice: {voiceState}</p>
      <div className="flex flex-wrap gap-2">
        {!voiceActive && <Button disabled={!voiceEnabled || busy || disabled} onClick={() => {
          setError(null); setVoiceTranscript(''); setVoiceAnswer(''); void voice.current?.start(captureContext);
        }}>Start microphone</Button>}
        {voiceState === 'listening' && <Button onClick={() => voice.current?.stop()}>Stop and send</Button>}
        {voiceActive && <Button onClick={() => voice.current?.cancel()}>Cancel / stop playback</Button>}
      </div>
      <p className="text-tiny text-ink-faint">Deepgram transcribes your audio; ElevenLabs speaks the approved reply. This app retains raw audio and final transcripts for 30 days or until deletion. Provider retention may differ.</p>
      {voiceTranscript && <p className="text-base text-ink-muted">You: {voiceTranscript}</p>}
      {voiceAnswer && <p className="text-base text-ink">Coach: {voiceAnswer}</p>}
    </section>
    <div className="space-y-3" aria-live="polite">
      {turns.map(t => <div key={t.id} className="rounded-lg bg-raised p-3 text-base">
        <p className="text-ink-muted">You: {t.question ?? "Cancelled voice turn"}</p>
        {t.answer && <p className="mt-2 text-ink">Coach: {t.answer}</p>}
      </div>)}
    </div>
    <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); void run(async () => {
      const snapshot = await captureContext();
      await request("askQuestion", { params: { sessionId }, body: { chartSnapshotId: snapshot.id, text: question.trim() } });
      setQuestion(""); await loadHistory();
    }); }}>
      <label htmlFor="chart-question" className="text-base text-ink">Chart question</label>
      <Textarea id="chart-question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="What is the closing price?" required />
      <Button type="submit" disabled={busy || voiceActive || disabled || !question.trim()}>Ask about chart</Button>
    </form>
    {error && <div className="mt-3"><ErrorBanner title="Could not continue" message={error} /></div>}
    <form className="mt-6 space-y-3 border-t border-line pt-4" onSubmit={e => { e.preventDefault(); setConfirming(true); }}>
      <h3 className="text-lead font-semibold text-ink">Your analysis</h3>
      <label className="block text-base text-ink">Thesis<Textarea value={thesis} onChange={e => setThesis(e.target.value)} required /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-base text-ink">Prediction<Select value={prediction} onChange={e => setPrediction(e.target.value as typeof prediction)}><option value="higher">Higher</option><option value="lower">Lower</option><option value="unchanged">Unchanged</option></Select></label>
        <label className="text-base text-ink">Hypothetical action<Select value={action} onChange={e => setAction(e.target.value as typeof action)}><option value="long">Long</option><option value="short">Short</option><option value="wait">Wait</option></Select></label>
      </div>
      <label className="block text-base text-ink">Your confidence (%)<Input type="number" min={0} max={100} value={confidence} onChange={e => setConfidence(e.target.value)} required /></label>
      <label className="block text-base text-ink">Evidence (one claim per line)<Textarea value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="For example: close > EMA 9" /></label>
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
    </>}><p className="whitespace-pre-wrap">{thesis}</p><p>{prediction} · {action} · {confidence}% confidence</p>{error && <ErrorBanner title="Submission failed" message={error} />}</Dialog>
  </aside>;
}
