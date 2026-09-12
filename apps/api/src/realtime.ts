import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import * as C from "@hackrice/contracts";
import { z } from "zod";
import { createVoiceProvider, type VoiceBinding, type VoiceConfig, type VoiceRelay, type VoiceProviderEvent } from "./providers/voice.js";
import { ReplayService } from "./service.js";
import { appendEvent, ApiFailure, RETENTION_MS } from "./domain.js";
import { Recordings } from "./recordings.js";

type Live = { binding: VoiceBinding; socket: WebSocket; relay?: VoiceRelay; recordingId: string; active: boolean; sentAudio: boolean };
export class Realtime {
  readonly wss = new WebSocketServer({ noServer: true });
  readonly provider: ReturnType<typeof createVoiceProvider>;
  private active = new Map<string, Live>();
  private clients = new Map<WebSocket, { userId: string; sessionId: string; sequence: number }>();
  private queues = new Map<string, Promise<void>>();
  constructor(public service: ReplayService, private recordings: Recordings, public format: z.infer<typeof C.AudioFormat>, config?: VoiceConfig) {
    this.provider = createVoiceProvider({ config,
      answer: (b, text) => service.calculate(b.userId, b.sessionId, b.chartSnapshotId, text),
      isTurnActive: async (b) => {
        if (!this.active.get(b.turnId)?.active) return false;
        try { const state = await service.store.read(b.userId, b.sessionId); service.assertBlind(state); return true; } catch { return false; }
      },
      onEvent: (binding, event) => this.onProviderEvent(binding, event),
    });
  }

  async emit(userId: string, sessionId: string, event: Record<string, unknown>) {
    await this.service.store.update(userId, sessionId, (state) => appendEvent(state, event));
    await this.broadcast(userId, sessionId);
  }

  async broadcast(userId: string, sessionId: string) {
    let state;
    try { state = await this.service.store.read(userId, sessionId); } catch { return; }
    for (const [socket, client] of this.clients) {
      if (client.userId !== userId || client.sessionId !== sessionId || socket.readyState !== WebSocket.OPEN) continue;
      for (const event of state.events) if (event.sequence > client.sequence) {
        socket.send(JSON.stringify(C.ServerEvent.parse(event)));
        client.sequence = event.sequence;
      }
    }
  }

  async onProviderEvent(binding: VoiceBinding, event: VoiceProviderEvent) {
    const live = this.active.get(binding.turnId);
    if (!live?.active && event.type !== "cancelled") return;
    if (event.type === "audio") {
      if (live?.active && live.socket.readyState === WebSocket.OPEN) {
        live.sentAudio = true;
        live.socket.send(C.encodeAudioFrame(binding.turnId, event.pcm));
      }
      return;
    }
    const base = { turnId: binding.turnId, chartSnapshotId: binding.chartSnapshotId };
    try {
      await this.service.store.update(binding.userId, binding.sessionId, (state) => {
        if (event.type !== "cancelled" && (!live?.active || this.active.get(binding.turnId) !== live)) return;
        const turn = state.turns.find((t) => t.id === binding.turnId);
        if (!turn) return;
        if (event.type === "final_transcript") {
          turn.finalTranscript = event.text;
          appendEvent(state, { type: "voice.transcript.final", ...base, text: event.text });
        } else if (event.type === "response") {
          turn.reply = event.reply;
          if (event.reply.kind === "calculation") state.facts.push(...event.reply.facts);
          appendEvent(state, { type: "assistant.response", ...base, reply: event.reply });
        } else if (event.type === "audio_start") {
          appendEvent(state, { type: "assistant.audio.start", turnId: binding.turnId, format: event.format });
        } else if (event.type === "generated") {
          turn.status = turn.finalTranscript ? "completed" : "failed";
          turn.audioDelivery = live?.sentAudio ? "partial" : "none";
          appendEvent(state, { type: "assistant.completed", turnId: binding.turnId, delivery: turn.audioDelivery });
        } else if (event.type === "draft") {
          appendEvent(state, { type: "analysis.draft", draft: event.draft });
        } else if (event.type === "unavailable") {
          turn.status = "failed";
          appendEvent(state, { type: "session.error", turnId: binding.turnId, error: { code: "provider_unavailable", requestId: randomUUID() } });
        } else if (event.type === "cancelled") {
          turn.status = "cancelled";
          turn.audioDelivery = live?.sentAudio ? "partial" : "none";
          appendEvent(state, { type: "assistant.cancelled", turnId: binding.turnId });
        }
      });
      await this.broadcast(binding.userId, binding.sessionId);
    } catch { /* A deleted/expired session cannot receive late provider output. */ }
    if (["generated", "cancelled", "unavailable"].includes(event.type) && live) {
      live.active = false;
      this.active.delete(binding.turnId);
      await this.recordings.finish(live.recordingId);
    }
  }

  async attach(socket: WebSocket, userId: string, sessionId: string) {
    this.clients.set(socket, { userId, sessionId, sequence: 0 });
    const session = (await this.service.store.read(userId, sessionId)).public;
    await this.emit(userId, sessionId, { type: "session.ready", session, inputFormat: this.format, outputFormat: this.format });
    socket.on("message", (data: RawData, binary: boolean) => {
      const queue = (this.queues.get(sessionId) ?? Promise.resolve()).then(() => this.handle(socket, userId, sessionId, data, binary)).catch(async (error) => {
        const code = error instanceof ApiFailure ? error.code : "invalid_request";
        await this.emit(userId, sessionId, { type: "session.error", error: { code, requestId: randomUUID() } }).catch(() => {});
      });
      this.queues.set(sessionId, queue);
      void queue.finally(() => { if (this.queues.get(sessionId) === queue) this.queues.delete(sessionId); });
    });
    socket.on("close", () => {
      this.clients.delete(socket);
      for (const live of this.active.values()) if (live.socket === socket) this.cancel(live.binding.turnId);
    });
  }

  private async handle(socket: WebSocket, userId: string, sessionId: string, data: RawData, binary: boolean) {
    const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (binary) {
      const { turnId, pcm } = C.decodeAudioFrame(bytes);
      const live = this.active.get(turnId);
      if (!live?.active || live.socket !== socket || live.binding.sessionId !== sessionId) throw new ApiFailure("state_conflict", 409);
      this.service.assertBlind(await this.service.store.read(userId, sessionId));
      if (!live.relay?.sendAudio(pcm)) throw new ApiFailure("provider_unavailable", 503);
      await this.recordings.append(live.recordingId, pcm);
      return;
    }
    const event = C.ClientEvent.parse(JSON.parse(bytes.toString()));
    if (event.sessionId !== sessionId) throw new ApiFailure("not_found", 404);
    const state = await this.service.store.read(userId, sessionId);
    if (event.type === "session.resume") {
      if (event.afterSequence > state.events.length) throw new ApiFailure("resync_required", 409);
      this.clients.get(socket)!.sequence = event.afterSequence;
      await this.broadcast(userId, sessionId);
      return;
    }
    if (event.type === "question.text") {
      await this.service.question(userId, sessionId, { chartSnapshotId: event.chartSnapshotId, text: event.text }, event.eventId, event.turnId);
      await this.broadcast(userId, sessionId); return;
    }
    const duplicate = await this.service.store.update(userId, sessionId, (s) => {
      if (s.clientCommands.includes(event.eventId)) return true;
      s.clientCommands.push(event.eventId); return false;
    });
    if (duplicate) return;
    if (event.type === "assistant.playback.completed") {
      await this.service.store.update(userId, sessionId, (s) => {
        const turn = s.turns.find((t) => t.id === event.turnId);
        if (!turn || turn.status !== "completed" || turn.audioDelivery !== "partial") return;
        turn.audioDelivery = "completed";
        appendEvent(s, { type: "assistant.completed", turnId: turn.id, delivery: "completed" });
      });
      await this.broadcast(userId, sessionId); return;
    }
    if (event.type === "voice.start") {
      this.service.assertBlind(state);
      this.service.snapshot(state, event.chartSnapshotId);
      if (event.format.sampleRateHz !== this.format.sampleRateHz) throw new ApiFailure("invalid_request", 400);
      if ([...this.active.values()].some((l) => l.binding.sessionId === sessionId && l.active)) throw new ApiFailure("state_conflict", 409);
      if (state.turns.some((t) => t.id === event.turnId)) throw new ApiFailure("idempotency_conflict", 409);
      const recordingId = randomUUID();
      const binding = { userId, sessionId, turnId: event.turnId, chartSnapshotId: event.chartSnapshotId };
      await this.service.store.update(userId, sessionId, (s) => {
        s.turns.push({ id: event.turnId, chartSnapshotId: event.chartSnapshotId, inputMode: "voice", status: "cancelled", audioDelivery: "none" });
        s.recordings.push({ id: recordingId, turnId: event.turnId, format: event.format, expiresAt: new Date(this.service.store.now() + RETENTION_MS).toISOString() });
      });
      await this.recordings.start(recordingId);
      const live: Live = { binding, socket, recordingId, active: true, sentAudio: false };
      this.active.set(event.turnId, live);
      const relay = this.provider.start(binding, event.format);
      if (relay.status !== "unavailable") {
        live.relay = relay;
        void relay.ready.then(async (ready) => {
          if (ready && live.active) await this.emit(userId, sessionId, { type: "voice.ready", turnId: event.turnId, format: this.format });
        }).catch(() => this.cancel(event.turnId));
      }
      return;
    }
    const live = this.active.get(event.turnId);
    if (!live || live.socket !== socket) return;
    if (event.type === "voice.stop") { live.relay?.stop(); await this.recordings.finish(live.recordingId); }
    else this.cancel(event.turnId);
  }

  cancel(turnId: string) {
    const live = this.active.get(turnId);
    if (live) live.active = false;
    this.provider.cancel(turnId);
  }
  cancelSession(sessionId: string) {
    for (const live of this.active.values()) if (live.binding.sessionId === sessionId) this.cancel(live.binding.turnId);
  }
  async close() {
    for (const live of this.active.values()) this.cancel(live.binding.turnId);
    for (const socket of this.clients.keys()) socket.terminate();
    this.wss.close();
    await this.recordings.close();
  }
}
