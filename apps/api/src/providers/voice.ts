import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { AudioFormat, Id, SafeReply, renderSafeReply } from "@hackrice/contracts";

export type VoiceBinding = { userId: string; sessionId: string; turnId: string; chartSnapshotId: string };
export type VoiceConfig = {
  deepgramApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  thinkEndpointUrl: string;
  playbackValidated: boolean;
};
type Format = z.infer<typeof AudioFormat>;
type Reply = z.infer<typeof SafeReply>;
export type VoiceProviderEvent =
  | { type: "final_transcript"; text: string }
  | { type: "response"; reply: Reply }
  | { type: "audio_start"; format: Format }
  | { type: "audio"; pcm: Uint8Array }
  | { type: "generated" }
  | { type: "cancelled" }
  | { type: "unavailable"; reason: "configuration_missing" | "playback_unverified" | "provider_failure" };
export type VoiceRelay = {
  status: "connecting";
  ready: Promise<boolean>;
  sendAudio(pcm: Uint8Array): boolean;
  stop(): void;
  cancel(): void;
};
export type ThinkResponse = { statusCode: number; contentType: string; body: string };
type Options = {
  config?: VoiceConfig;
  answer(binding: VoiceBinding, text: string): Promise<unknown>;
  isTurnActive(binding: VoiceBinding): Promise<boolean>;
  onEvent(binding: VoiceBinding, event: VoiceProviderEvent): void | Promise<void>;
  socketFactory?: (url: string, options: { headers: Record<string, string> }) => WebSocket;
};
type ActiveTurn = {
  binding: VoiceBinding; token: string; model: string; socket: WebSocket; format: Format;
  active: boolean; ready: boolean; inputStopped: boolean; approved: boolean; audioStarted: boolean;
  resolveReady(value: boolean): void;
};
const bindingSchema = z.strictObject({ userId: z.string().min(1), sessionId: Id, turnId: Id, chartSnapshotId: Id });
const providerEndpoint = "wss://agent.deepgram.com/v1/agent/converse";
const unsupported = { kind: "refusal", reason: "unsupported" } as const;

function jsonResponse(statusCode: number, body: unknown): ThinkResponse {
  return { statusCode, contentType: "application/json", body: JSON.stringify(body) };
}

/** The injected answer callback must calculate facts from the authorized snapshot; it must never return model values. */
export function createVoiceProvider(options: Options) {
  const config = options.config ? { ...options.config } : undefined;
  const tokens = new Map<string, ActiveTurn>();
  const turns = new Map<string, ActiveTurn>();
  const usedTurns = new Set<string>();
  const connect = options.socketFactory ?? ((url, init) => new WebSocket(url, init));

  function terminal(turn: ActiveTurn) {
    turn.active = false;
    tokens.delete(turn.token);
    turns.delete(turn.binding.turnId);
    turn.resolveReady(false);
    turn.socket.close();
  }

  async function fail(turn: ActiveTurn) {
    if (!turn.active) return;
    terminal(turn);
    await options.onEvent(turn.binding, { type: "unavailable", reason: "provider_failure" });
  }

  function cancel(turnId: string) {
    const turn = turns.get(turnId);
    if (!turn?.active) return;
    terminal(turn);
    void Promise.resolve(options.onEvent(turn.binding, { type: "cancelled" })).catch(() => {});
  }

  function start(input: VoiceBinding, inputFormat: Format): VoiceRelay | { status: "unavailable" } {
    const binding = bindingSchema.parse(input);
    const format = AudioFormat.parse(inputFormat);
    let reason: "configuration_missing" | "playback_unverified" | undefined;
    if (!config?.deepgramApiKey || !config.elevenLabsApiKey || !config.elevenLabsVoiceId || !config.thinkEndpointUrl) {
      reason = "configuration_missing";
    } else if (!config.playbackValidated) reason = "playback_unverified";
    if (reason || !config) {
      void Promise.resolve(options.onEvent(binding, { type: "unavailable", reason: reason ?? "configuration_missing" })).catch(() => {});
      return { status: "unavailable" };
    }
    const endpoint = new URL(config.thinkEndpointUrl);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) {
      throw new Error("Think endpoint must be a server-configured HTTPS URL.");
    }
    if (usedTurns.has(binding.turnId)) throw new Error("Voice turn identifiers cannot be reused.");
    usedTurns.add(binding.turnId);
    const token = randomUUID();
    const model = `controlled-${binding.sessionId}-${binding.turnId}-${binding.chartSnapshotId}`;
    let resolveReady!: (value: boolean) => void;
    const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });
    const socket = connect(providerEndpoint, { headers: { Authorization: `Token ${config.deepgramApiKey}` } });
    const turn: ActiveTurn = {
      binding, token, model, socket, format, active: true, ready: false,
      inputStopped: false, approved: false, audioStarted: false, resolveReady,
    };
    tokens.set(token, turn);
    turns.set(binding.turnId, turn);
    let messages = Promise.resolve();
    socket.on("message", (data: RawData, isBinary: boolean) => {
      messages = messages.then(async () => {
        if (!turn.active) return;
        if (!(await options.isTurnActive(binding))) { cancel(binding.turnId); return; }
        if (!turn.active) return;
        if (isBinary) {
          if (!turn.approved) { await fail(turn); return; }
          const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
          if (!bytes.byteLength || bytes.byteLength % 2) { await fail(turn); return; }
          if (!turn.audioStarted) {
            await options.onEvent(binding, { type: "audio_start", format });
            turn.audioStarted = true;
          }
          if (turn.active) await options.onEvent(binding, { type: "audio", pcm: bytes });
          return;
        }
        const event = JSON.parse(data.toString()) as { type?: string; role?: string };
        if (event.type === "Welcome") {
          socket.send(JSON.stringify({
            type: "Settings", mip_opt_out: true, flags: { history: false },
            audio: {
              input: { encoding: "linear16", sample_rate: format.sampleRateHz },
              output: { encoding: "linear16", sample_rate: format.sampleRateHz, container: "none" },
            },
            agent: {
              listen: { provider: { type: "deepgram", model: "flux-general-en", version: "v2" } },
              think: {
                provider: { type: "open_ai", model },
                endpoint: { url: endpoint.toString(), headers: { authorization: `Bearer ${token}` } },
                prompt: "The configured endpoint supplies the complete approved response.",
              },
              speak: {
                provider: { type: "eleven_labs", model_id: "eleven_turbo_v2_5" },
                endpoint: {
                  url: `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenLabsVoiceId)}/multi-stream-input`,
                  headers: { "xi-api-key": config.elevenLabsApiKey },
                },
              },
            },
          }));
        } else if (event.type === "SettingsApplied") {
          turn.ready = true;
          resolveReady(true);
        } else if (event.type === "UserStartedSpeaking" && turn.approved) {
          cancel(binding.turnId);
        } else if (event.type === "AgentAudioDone" && turn.approved) {
          terminal(turn);
          await options.onEvent(binding, { type: "generated" });
        } else if (event.type === "Error") await fail(turn);
      }).catch(async () => { try { await fail(turn); } catch { /* The turn was already closed before notification failed. */ } });
    });
    socket.on("error", () => { void fail(turn).catch(() => {}); });
    socket.on("close", () => { void fail(turn).catch(() => {}); });
    return {
      status: "connecting", ready,
      sendAudio(pcm) {
        if (!turn.active || !turn.ready || turn.inputStopped || !pcm.byteLength || pcm.byteLength % 2 || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(pcm);
        return true;
      },
      stop() {
        if (!turn.active || !turn.ready || turn.inputStopped) return;
        turn.inputStopped = true;
        socket.send(JSON.stringify({ type: "ForceEndTurn" }));
      },
      cancel() { cancel(binding.turnId); },
    };
  }

  async function handleThink(authorization: string | undefined, input: unknown): Promise<ThinkResponse> {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const turn = tokens.get(token);
    if (!turn?.active || !turn.ready) return jsonResponse(401, { error: { code: "unauthenticated" } });
    const parsed = z.object({
      model: z.literal(turn.model), stream: z.boolean().optional(),
      messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
    }).safeParse(input);
    if (!parsed.success) return jsonResponse(400, { error: { code: "invalid_request" } });
    // Consume before any await so concurrent callbacks cannot create a second response.
    tokens.delete(token);
    if (!(await options.isTurnActive(turn.binding))) {
      cancel(turn.binding.turnId);
      return jsonResponse(409, { error: { code: "state_conflict" } });
    }
    if (!turn.active) return jsonResponse(409, { error: { code: "state_conflict" } });
    const userMessage = parsed.data.messages.filter((message) => message.role === "user").at(-1);
    if (typeof userMessage?.content !== "string" || !userMessage.content.trim()) {
      await fail(turn);
      return jsonResponse(400, { error: { code: "invalid_request" } });
    }
    let reply: Reply = unsupported;
    try { await options.onEvent(turn.binding, { type: "final_transcript", text: userMessage.content }); }
    catch { await fail(turn); return jsonResponse(503, { error: { code: "provider_unavailable" } }); }
    try {
      const candidate = SafeReply.parse(await options.answer(turn.binding, userMessage.content));
      if (candidate.kind !== "calculation" || candidate.facts.every((fact) => fact.chartSnapshotId === turn.binding.chartSnapshotId)) reply = candidate;
    } catch { /* Only the fixed refusal below can cross the provider boundary. */ }
    if (!turn.active || !(await options.isTurnActive(turn.binding))) {
      cancel(turn.binding.turnId);
      return jsonResponse(409, { error: { code: "state_conflict" } });
    }
    try { await options.onEvent(turn.binding, { type: "response", reply }); }
    catch { await fail(turn); return jsonResponse(503, { error: { code: "provider_unavailable" } }); }
    if (!turn.active) return jsonResponse(409, { error: { code: "state_conflict" } });
    const content = renderSafeReply(reply);
    turn.approved = true;
    const base = { id: `chatcmpl-${turn.binding.turnId}`, created: Math.floor(Date.now() / 1000), model: turn.model };
    if (parsed.data.stream) {
      const chunk = { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] };
      const end = { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
      return { statusCode: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n` };
    }
    return jsonResponse(200, { ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
  }

  return { start, handleThink, cancel };
}
