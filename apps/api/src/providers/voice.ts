import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { AnalysisRating, AudioFormat, Id, SafeReply, SubmissionDraft, renderSafeReply } from "@hackrice/contracts";

export type VoiceBinding = { userId: string; sessionId: string; turnId: string; chartSnapshotId: string };
export type VoiceConfig = {
  deepgramApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  thinkEndpointUrl: string;
  playbackValidated: boolean;
  /** Deepgram-hosted model that talks to the caller. Unset keeps the
   *  controlled endpoint, where the reply text is the calculation itself. */
  conversationModel?: string;
};
type FunctionCallEvent = { functions?: { id: string; name: string; arguments: string }[] };
/** The model may choose words; it may not choose numbers. */
const COACH_PROMPT = [
  "You are a trading chart coach helping someone read a historical chart.",
  "For every question about a price, volume, change, high, low, or indicator you MUST call get_chart_metric",
  "and pass the learner's question through in their own words.",
  "Speak the text it returns. Never invent, estimate, round, or recall a number yourself.",
  "If it returns a refusal, say that and explain you can only describe what is on the chart.",
  "Never predict future prices, never give trading advice, and never say what happens next.",
  "Keep replies to one or two short spoken sentences.",
  "You are also taking down the learner's own analysis as they talk.",
  "Whenever they state a view, a direction, a confidence, a reason, or what would change their mind,",
  "call record_analysis with just the parts they actually said. Do not invent the parts they did not.",
  "Saying it goes up, rises, or is going higher is prediction higher; down or falling is lower; flat is unchanged.",
  "Record prediction whenever they name a direction, even when they also say what they would do about it.",
  "Write evidence as a comparison such as \"close > 137.42\" when they give a number, otherwise in their words.",
  "After recording, tell them briefly what you noted and that it is on screen for them to review and submit.",
  "When they ask how their analysis looks, or say they have finished it, call rate_analysis.",
  "Judge only their reasoning: whether the thesis is specific and follows from the chart, whether the",
  "invalidation names a level that would actually prove them wrong, and whether the risk is thought through.",
  "Never judge whether their prediction will turn out right, and never use a number you were not given.",
].join(" ");
type Format = z.infer<typeof AudioFormat>;
type Reply = z.infer<typeof SafeReply>;
export type VoiceProviderEvent =
  | { type: "final_transcript"; text: string }
  | { type: "response"; reply: Reply }
  | { type: "audio_start"; format: Format }
  | { type: "audio"; pcm: Uint8Array }
  | { type: "generated" }
  | { type: "cancelled" }
  | { type: "draft"; draft: z.infer<typeof SubmissionDraft> }
  | { type: "rating"; rating: z.infer<typeof AnalysisRating> }
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
              think: config.conversationModel ? {
                provider: { type: "open_ai", model: config.conversationModel },
                prompt: COACH_PROMPT,
                functions: [{
                  name: "get_chart_metric",
                  description: "Return one computed value from the chart the learner is looking at. "
                    + "Call this for every question about a price, volume, change, or indicator. "
                    + "Speak the returned text and never state a number that did not come from it.",
                  parameters: {
                    type: "object",
                    properties: {
                      question: {
                        type: "string",
                        description: "The learner's question, in their own words, such as "
                          + "\"what is the closing price\" or \"the high and low in this area\".",
                      },
                    },
                    required: ["question"],
                  },
                }, {
                  name: "record_analysis",
                  description: "Record the learner's own analysis as they say it, to fill in the form they "
                    + "review and submit. Include only fields they actually stated.",
                  parameters: {
                    type: "object",
                    properties: {
                      thesis: { type: "string", description: "Their reading of the chart, in their words." },
                      prediction: { type: "string", enum: ["higher", "lower", "unchanged"] },
                      hypotheticalAction: { type: "string", enum: ["long", "short", "wait"] },
                      confidencePercent: { type: "number", description: "0-100, only if they gave a number." },
                      claimedEvidence: {
                        type: "array", items: { type: "string" },
                        description: "Each reason they gave, one per entry.",
                      },
                      invalidation: { type: "string", description: "What would prove them wrong." },
                      riskReasoning: { type: "string", description: "How they think about the risk." },
                    },
                  },
                }, {
                  name: "rate_analysis",
                  description: "Rate the reasoning in the learner's analysis when they ask how it looks or "
                    + "say they have finished. Scores are 0-100 and judge reasoning quality only, never "
                    + "whether the prediction will prove correct.",
                  parameters: {
                    type: "object",
                    properties: {
                      thesisScore: { type: "number", description: "0-100: is the thesis specific and grounded in the chart?" },
                      invalidationScore: { type: "number", description: "0-100: does it name a level that would prove them wrong?" },
                      riskScore: { type: "number", description: "0-100: is the risk actually reasoned about?" },
                      comment: { type: "string", description: "One sentence on what would make it stronger." },
                    },
                  },
                }],
              } : {
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
        } else if (event.type === "FunctionCallRequest") {
          await functionCall(turn, event as unknown as FunctionCallEvent);
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

  /** One function call from the conversational model, answered from the chart. */
  async function functionCall(turn: ActiveTurn, event: FunctionCallEvent) {
    const calls = event.functions ?? [];
    for (const call of calls) {
      let text = renderSafeReply(unsupported);
      if (call.name === "rate_analysis") {
        try {
          const rating = AnalysisRating.parse(JSON.parse(call.arguments || "{}"));
          if (await options.isTurnActive(turn.binding)) {
            await options.onEvent(turn.binding, { type: "rating", rating });
            text = rating.comment ?? "Rated on the feedback page.";
          } else text = "That session is no longer open.";
        } catch { text = "I could not rate that."; }
        turn.approved = true;
        if (turn.socket.readyState !== WebSocket.OPEN) return;
        turn.socket.send(JSON.stringify({ type: "FunctionCallResponse", id: call.id, name: call.name, content: text }));
        continue;
      }
      if (call.name === "record_analysis") {
        try {
          const draft = SubmissionDraft.parse(JSON.parse(call.arguments || "{}"));
          const stated = Object.values(draft).some((value) => value !== undefined);
          if (stated && await options.isTurnActive(turn.binding)) {
            await options.onEvent(turn.binding, { type: "draft", draft });
            text = "Noted on the analysis form for you to review.";
          } else text = "Nothing new to record yet.";
        } catch { text = "That did not include anything I could record."; }
        // Every branch above answers with text this server wrote, so the turn
        // may speak. Without this a learner who only states their analysis,
        // never asking about the chart, has no approved reply and the audio
        // gate fails the turn.
        turn.approved = true;
        if (turn.socket.readyState !== WebSocket.OPEN) return;
        turn.socket.send(JSON.stringify({ type: "FunctionCallResponse", id: call.id, name: call.name, content: text }));
        continue;
      }
      try {
        const asked = z.object({ question: z.string() }).safeParse(JSON.parse(call.arguments || "{}"));
        if (asked.success && await options.isTurnActive(turn.binding)) {
          // The same calculator the typed path uses, so the refusals and the
          // blind boundary apply to anything the model asks for.
          const reply = SafeReply.parse(await options.answer(turn.binding, asked.data.question));
          const grounded = reply.kind !== "calculation"
            || reply.facts.every((fact) => fact.chartSnapshotId === turn.binding.chartSnapshotId);
          if (grounded) {
            text = renderSafeReply(reply);
            await options.onEvent(turn.binding, { type: "final_transcript", text: asked.data.question });
            await options.onEvent(turn.binding, { type: "response", reply });
            // Only a reply this server computed unlocks playback.
            turn.approved = true;
          }
        }
      } catch { /* The fixed refusal above still answers the model. */ }
      if (turn.socket.readyState !== WebSocket.OPEN) return;
      turn.socket.send(JSON.stringify({
        type: "FunctionCallResponse", id: call.id, name: call.name, content: text,
      }));
    }
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
