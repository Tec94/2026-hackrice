import { ClientEvent, ServerEvent, decodeAudioFrame, encodeAudioFrame, renderSafeReply, type AnalysisDraft, type ChartContext, type ServerMessage } from '@hackrice/contracts';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';
type Callbacks = {
  state(value: VoiceState): void;
  transcript(value: string): void;
  answer(value: string): void;
  draft(value: AnalysisDraft): void;
  error(value: string): void;
  complete(): void;
};

export function floatToPcm(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}

export function pcmToFloat(bytes: Uint8Array): Float32Array {
  if (!bytes.length || bytes.length % 2) throw new Error('Incomplete PCM audio.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true) / 32768);
}

type Turn = {
  id: string; snapshotId?: string; socket?: WebSocket; stream?: MediaStream;
  context: AudioContext; input?: MediaStreamAudioSourceNode; worklet?: AudioWorkletNode;
  sources: Set<AudioBufferSourceNode>; nextStart: number; generated: boolean;
  approved: boolean; audioStarted: boolean; outputRate?: number; listening: boolean;
  lastSequence: number; sentStart: boolean;
  pendingSamples: number[]; frameSamples: number;
};

/**
 * One captured chart snapshot and one disposable socket per voice turn.
 *
 * The audio context and the microphone stream are not per turn. Both are
 * acquired in the click that opens the conversation and kept until it ends:
 * a turn that begins from a callback cannot ask for either again without a
 * gesture in some browsers, and releasing a Bluetooth microphone between
 * turns makes the headset switch profiles, which is slow and sometimes fails.
 */
export class VoiceClient {
  private turn?: Turn;
  private context?: AudioContext;
  private stream?: MediaStream;
  private worklet?: Promise<void>;
  private sessionId: string;
  private callbacks: Callbacks;
  constructor(sessionId: string, callbacks: Callbacks) { this.sessionId = sessionId; this.callbacks = callbacks; }

  private send(turn: Turn, command: Record<string, unknown>) {
    if (turn.socket?.readyState !== WebSocket.OPEN) throw new Error('Voice connection closed.');
    turn.socket.send(JSON.stringify(ClientEvent.parse({ protocolVersion: 1, eventId: crypto.randomUUID(), sessionId: this.sessionId, ...command })));
  }

  /**
   * Turns a microphone failure into something the listener can act on.
   *
   * Browsers surface these as the operating system's own wording, so a missing
   * input device reads as "The object can not be found here", which says
   * nothing about microphones.
   */
  private static microphoneMessage(error: unknown): string | null {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No microphone found. Connect one, check Sound settings shows it under Input, then reload.';
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone access was blocked. Allow it for this site in your browser, then reload.';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return 'The microphone is in use by another app. Close it, then start the conversation again.';
    }
    return null;
  }

  async start(capture: () => Promise<ChartContext>) {
    if (this.turn) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      this.callbacks.error('Microphone capture needs a supported browser on localhost or HTTPS.');
      return;
    }
    // Created in the user's click gesture on the first turn and reused after;
    // never rely on autoplay permission.
    const context = this.context ?? (this.context = new AudioContext());
    const turn: Turn = { id: crypto.randomUUID(), context, sources: new Set(), nextStart: 0,
      generated: false, approved: false, audioStarted: false, listening: false, lastSequence: -1, sentStart: false, pendingSamples: [], frameSamples: 0 };
    this.turn = turn;
    this.callbacks.state('connecting');
    try {
      const resumed = context.resume();
      void resumed.catch(() => {}); // Awaited below, including browsers that reject autoplay.
      const stream = this.stream?.active
        ? this.stream
        : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      // Always reclaim a late permission grant after cancellation/unmount.
      if (this.turn !== turn) { if (stream !== this.stream) stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      turn.stream = stream;
      await resumed;
      const snapshot = await capture();
      if (this.turn !== turn) return;
      turn.snapshotId = snapshot.id;
      const url = new URL(`/api/sessions/${this.sessionId}/events`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      turn.socket = socket;
      socket.binaryType = 'arraybuffer';
      let messages = Promise.resolve();
      socket.onmessage = event => {
        messages = messages.then(async () => {
          if (this.turn !== turn) return;
          if (event.data instanceof ArrayBuffer) {
            const frame = decodeAudioFrame(new Uint8Array(event.data));
            if (frame.turnId !== turn.id) return;
            if (!turn.approved || !turn.audioStarted || !turn.outputRate) throw new Error('Unapproved voice output was blocked.');
            const samples = pcmToFloat(frame.pcm);
            const buffer = context.createBuffer(1, samples.length, turn.outputRate);
            buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            turn.sources.add(source);
            source.onended = () => { source.disconnect(); turn.sources.delete(source); this.finishPlayback(turn); };
            const start = Math.max(context.currentTime, turn.nextStart);
            turn.nextStart = start + buffer.duration;
            source.start(start);
            this.callbacks.state('speaking');
          } else {
            const message = ServerEvent.parse(JSON.parse(event.data));
            await this.event(turn, message);
          }
        }).catch(error => this.fail(turn, error));
      };
      socket.onerror = () => this.fail(turn, new Error('Could not connect to voice. Check the API and WebSocket proxy.'));
      socket.onclose = () => { if (this.turn === turn) this.fail(turn, new Error('Voice disconnected. Start a new turn to retry.')); };
    } catch (error) {
      const message = VoiceClient.microphoneMessage(error);
      if (message) { this.dispose(turn); this.callbacks.error(message); return; }
      this.fail(turn, error);
    }
  }

  private async event(turn: Turn, message: ServerMessage) {
    if (message.sessionId !== this.sessionId || message.sequence <= turn.lastSequence) return;
    turn.lastSequence = message.sequence;
    if (message.type === 'session.ready') {
      if (turn.sentStart) return;
      turn.sentStart = true;
      // Deepgram recommends 20–100 ms buffers. Use its upper bound to amortize
      // this MVP's per-frame database authorization and recording work.
      // https://developers.deepgram.com/docs/measuring-streaming-latency
      turn.frameSamples = message.inputFormat.sampleRateHz / 10;
      await this.captureWorklet(turn.context);
      if (this.turn !== turn) return;
      const worklet = new AudioWorkletNode(turn.context, 'chart-capture', {
        processorOptions: { targetRate: message.inputFormat.sampleRateHz },
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      turn.worklet = worklet;
      worklet.port.onmessage = event => {
        if (this.turn !== turn || !turn.listening) return;
        try {
          if (turn.socket?.readyState !== WebSocket.OPEN) throw new Error('Voice connection closed.');
          turn.pendingSamples.push(...event.data);
          while (turn.pendingSamples.length >= turn.frameSamples) {
            const samples = turn.pendingSamples.splice(0, turn.frameSamples);
            turn.socket.send(encodeAudioFrame(turn.id, floatToPcm(Float32Array.from(samples))).slice().buffer);
          }
        } catch (error) { this.fail(turn, error); }
      };
      const input = turn.context.createMediaStreamSource(turn.stream!);
      turn.input = input;
      input.connect(worklet);
      // Processor output is silence; connecting it keeps capture processing active.
      worklet.connect(turn.context.destination);
      this.send(turn, { type: 'voice.start', turnId: turn.id, chartSnapshotId: turn.snapshotId, format: message.inputFormat });
      return;
    }
    if (message.type === 'session.error' && (!message.turnId || message.turnId === turn.id)) {
      throw new Error(`Voice unavailable (${message.error.code}). Check provider setup and playback validation.`);
    }
    if (message.type === 'analysis.draft') {
      // Every turn opens a new socket and is replayed the whole session, so a
      // draft from an earlier turn arrives again here. Applying it would undo
      // any edit the learner has since made by hand, and would approve this
      // turn's playback before it has produced anything.
      if (message.turnId !== turn.id) return;
      // The server computed this from the learner's own words, so the turn
      // has an approved reply even though no calculation was spoken.
      turn.approved = true;
      this.callbacks.draft(message.draft);
      return;
    }
    // A rating is likewise the server's own work, and a turn that only rated
    // the analysis would otherwise have nothing to approve its speech. Ratings
    // also arrive from submission and background jobs, which belong to no turn
    // and must never approve one.
    if (message.type === 'evaluation.updated') {
      if (message.turnId === turn.id) turn.approved = true;
      return;
    }
    if (!('turnId' in message) || message.turnId !== turn.id) return;
    if ('chartSnapshotId' in message && message.chartSnapshotId !== turn.snapshotId) throw new Error('Voice snapshot mismatch.');
    if (message.type === 'voice.ready') { turn.listening = true; this.callbacks.state('listening'); }
    if (message.type === 'voice.transcript.final') { this.stopMicrophone(turn); this.callbacks.transcript(message.text); this.callbacks.state('thinking'); }
    if (message.type === 'assistant.response') { turn.approved = true; this.callbacks.answer(renderSafeReply(message.reply)); }
    if (message.type === 'assistant.audio.start') {
      if (!turn.approved) throw new Error('Unapproved voice output was blocked.');
      turn.audioStarted = true; turn.outputRate = message.format.sampleRateHz;
    }
    if (message.type === 'assistant.completed') { turn.generated = true; this.finishPlayback(turn); }
    if (message.type === 'assistant.cancelled') {
      // Usually a barge-in: the learner talked over the coach. The turn is
      // over but the conversation is not, so finish like any other turn and
      // let the sidebar open the microphone for what they are saying. Calling
      // cancel() alone would leave the stream live with nothing listening.
      this.cancel();
      this.callbacks.complete();
    }
  }

  stop() {
    const turn = this.turn;
    if (!turn?.listening) return;
    try {
      if (turn.pendingSamples.length && turn.socket?.readyState === WebSocket.OPEN) {
        turn.socket.send(encodeAudioFrame(turn.id, floatToPcm(Float32Array.from(turn.pendingSamples))).slice().buffer);
        turn.pendingSamples = [];
      }
      this.stopMicrophone(turn);
      this.send(turn, { type: 'voice.stop', turnId: turn.id }); this.callbacks.state('thinking');
    }
    catch (error) { this.fail(turn, error); }
  }

  /** Loaded once per audio context; registering the processor twice would throw. */
  private captureWorklet(context: AudioContext): Promise<void> {
    return this.worklet ??= context.audioWorklet.addModule('/audio-capture.js');
  }

  /** Stops sending audio for this turn. The stream stays open for the next one. */
  private stopMicrophone(turn: Turn) {
    turn.listening = false;
    turn.input?.disconnect(); turn.worklet?.disconnect();
    if (turn.worklet) { turn.worklet.port.onmessage = null; turn.worklet.port.close(); }
  }

  /** Ends the conversation: cancels any turn and releases the microphone and audio output. */
  close() {
    this.cancel();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.worklet = undefined;
    const context = this.context;
    this.context = undefined;
    void context?.close().catch(() => {});
  }

  private finishPlayback(turn: Turn) {
    if (this.turn !== turn || !turn.generated || turn.sources.size) return;
    if (turn.audioStarted) {
      try { this.send(turn, { type: 'assistant.playback.completed', turnId: turn.id }); }
      catch (error) { this.fail(turn, error); return; }
    }
    this.dispose(turn);
    this.callbacks.complete();
  }

  cancel() {
    const turn = this.turn;
    if (!turn) return;
    if (turn.sentStart && turn.socket?.readyState === WebSocket.OPEN) {
      try { this.send(turn, { type: 'voice.cancel', turnId: turn.id }); } catch { /* Local cleanup still applies. */ }
    }
    this.dispose(turn);
  }

  private fail(turn: Turn, error: unknown) {
    if (this.turn !== turn) return;
    this.cancel();
    this.callbacks.error(error instanceof Error ? error.message : 'Voice failed. Try again.');
  }

  private dispose(turn: Turn) {
    if (this.turn !== turn) return;
    this.turn = undefined;
    this.stopMicrophone(turn);
    for (const source of turn.sources) { source.onended = null; source.stop(); source.disconnect(); }
    turn.sources.clear();
    if (turn.socket) { turn.socket.onclose = null; turn.socket.onerror = null; turn.socket.onmessage = null; turn.socket.close(); }
    this.callbacks.state('idle');
  }
}
