import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { AnalysisRating, AudioFormat, Id, SafeReply, SubmissionDraft, renderSafeReply, type AnalysisDraft } from "@hackrice/contracts";

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
/** What the previous turns left behind, for the model to pick the thread up. */
export type TurnContext = {
  turns: { learner: string; coach?: string }[];
  draft?: AnalysisDraft;
};
type Options = {
  config?: VoiceConfig;
  answer(binding: VoiceBinding, text: string): Promise<unknown>;
  context?(binding: VoiceBinding): Promise<TurnContext | undefined>;
  isTurnActive(binding: VoiceBinding): Promise<boolean>;
  onEvent(binding: VoiceBinding, event: VoiceProviderEvent): void | Promise<void>;
  socketFactory?: (url: string, options: { headers: Record<string, string> }) => WebSocket;
};
type ActiveTurn = {
  binding: VoiceBinding; token: string; model: string; socket: WebSocket; format: Format;
  active: boolean; ready: boolean; inputStopped: boolean; approved: boolean; audioStarted: boolean;
  /** How the turn earned the right to speak; speech-approved turns stay under number checks. */
  approvedBy?: "function" | "speech";
  /** Audio that arrived before the sentence it belongs to was approved. */
  heldAudio: Buffer[];
  /** Numbers the learner said or wrote; the only ones a conversational reply may repeat. */
  allowed: Set<string>;
  spoken: string[];
  /** Set once the learner's words for this turn have been reported downstream. */
  transcribed: boolean;
  /** The reported transcript is the model's paraphrase, still awaiting the real words. */
  provisional: boolean;
  resolveReady(value: boolean): void;
};
/** About ten seconds at Deepgram's 30 ms frames: longer than any sentence the text could lag. */
const HELD_AUDIO_LIMIT = 400;

/** Every number in a piece of text, normalised so "137.40" and "137.4" compare equal. */
export function numbersIn(text: string): string[] {
  return Array.from(text.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g), (match) => String(Number(match[0])));
}

/** Coach lines carry chart values; masked, they still tell the model what was discussed. */
export function maskNumbers(text: string): string {
  return text.replace(/\d[\d,]*(?:\.\d+)?/g, "[value]");
}

const DRAFT_LABEL: Record<keyof AnalysisDraft, string> = {
  thesis: "Thesis", prediction: "Prediction", hypotheticalAction: "Hypothetical action",
  confidencePercent: "Confidence (%)", claimedEvidence: "Evidence", invalidation: "Invalidation", riskReasoning: "Risk reasoning",
};

function draftLines(draft: AnalysisDraft | undefined): string[] {
  if (!draft) return ["(nothing recorded yet)"];
  const lines = (Object.keys(DRAFT_LABEL) as (keyof AnalysisDraft)[]).flatMap((key) => {
    const value = draft[key];
    if (value === undefined) return [];
    return [`- ${DRAFT_LABEL[key]}: ${Array.isArray(value) ? value.join("; ") : String(value)}`];
  });
  return lines.length ? lines : ["(nothing recorded yet)"];
}

/** The standing instructions plus everything this session has already said and recorded. */
export function coachPrompt(context: TurnContext | undefined): string {
  const turns = context?.turns ?? [];
  const conversation = turns.length
    ? turns.flatMap((turn) => [`Learner: ${turn.learner}`, ...(turn.coach ? [`Coach: ${maskNumbers(turn.coach)}`] : [])])
    : ["(this is the first thing the learner has said)"];
  return [
    COACH_PROMPT,
    "",
    "Conversation so far, oldest first. Chart values in it are masked; if the learner asks about one again, call get_chart_metric again.",
    ...conversation,
    "",
    "The analysis form so far:",
    ...draftLines(context?.draft),
    "",
    "Use the conversation above to resolve follow-ups such as \"and the volume?\" or \"what about the low?\".",
    "If the learner revises something already on the form, call record_analysis with only the fields that changed.",
    "If they ask what you have so far, read the form back in one or two sentences.",
    "Anything not on the form and not a chart value, answer briefly in your own words without inventing numbers.",
  ].join("\n");
}

/** Numbers the learner has stated, from the context the model is given. */
function contextNumbers(context: TurnContext | undefined): string[] {
  if (!context) return [];
  const learner = context.turns.map((turn) => turn.learner).join(" ");
  return numbersIn(`${learner} ${draftLines(context.draft).join(" ")}`);
}
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

  const conversational = !!config?.conversationModel;

  async function deliver(turn: ActiveTurn, bytes: Buffer) {
    if (!turn.audioStarted) {
      await options.onEvent(turn.binding, { type: "audio_start", format: turn.format });
      turn.audioStarted = true;
    }
    if (turn.active) await options.onEvent(turn.binding, { type: "audio", pcm: bytes });
  }

  /** Lets the turn speak, and releases any audio that arrived ahead of its approval. */
  async function approve(turn: ActiveTurn, by: "function" | "speech") {
    if (!turn.approved) turn.approvedBy = by;
    turn.approved = true;
    const held = turn.heldAudio.splice(0);
    for (const bytes of held) { if (!turn.active) return; await deliver(turn, bytes); }
  }

  /**
   * Reports what the learner said, once per turn.
   *
   * `provisional` marks the model's paraphrase of the question, taken from a
   * function call. It stands in only until speech recognition reports the
   * learner's actual words, which are what the session should record, and it
   * does not end the turn: the learner may still be talking when the model
   * calls a function.
   */
  async function transcript(turn: ActiveTurn, text: string, provisional = false) {
    if (!text.trim()) return;
    if (turn.transcribed && !(turn.provisional && !provisional)) return;
    turn.transcribed = true;
    turn.provisional = provisional;
    if (provisional) { await options.onEvent(turn.binding, { type: "final_transcript", text: text.trim() }); return; }
    // The browser stops its microphone once it sees the transcript, so tell the
    // provider the input is finished too. Without this it waits for audio that
    // is never coming and ends the turn with CLIENT_MESSAGE_TIMEOUT while the
    // model is still answering.
    if (turn.ready && !turn.inputStopped && turn.socket.readyState === WebSocket.OPEN) {
      turn.inputStopped = true;
      turn.socket.send(JSON.stringify({ type: "ForceEndTurn" }));
    }
    await options.onEvent(turn.binding, { type: "final_transcript", text: text.trim() });
  }

  /**
   * Approves a conversational sentence, or stops one that speaks a number
   * nobody gave it. A turn approved by a function call spoke a value this
   * server computed and is trusted to repeat it; a turn that only talked may
   * use the learner's own numbers and no others.
   */
  async function heard(turn: ActiveTurn, role: string | undefined, content: string) {
    if (role === "user") {
      for (const value of numbersIn(content)) turn.allowed.add(value);
      await transcript(turn, content);
      return;
    }
    const sentence = content.trim();
    if (role !== "assistant" || !sentence) return;
    turn.spoken.push(sentence);
    if (turn.approvedBy === "function") return;
    if (!numbersIn(sentence).every((value) => turn.allowed.has(value))) {
      await fail(turn, `spoke a number nobody gave it: "${sentence.slice(0, 120)}"`);
      return;
    }
    if (!turn.approved) {
      await options.onEvent(turn.binding, { type: "response", reply: { kind: "conversation", text: sentence } });
      await approve(turn, "speech");
    }
  }

  async function fail(turn: ActiveTurn, reason: string) {
    if (!turn.active) return;
    // The browser only ever learns "provider_unavailable"; this line is the
    // one place the actual cause is kept. Never includes audio or credentials.
    console.warn(`[voice] turn ${turn.binding.turnId} failed: ${reason}`);
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
    // Fetched now so it is ready by the time the provider says Welcome.
    const context: Promise<TurnContext | undefined> = options.context
      ? options.context(binding).catch(() => undefined)
      : Promise.resolve(undefined);
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
      heldAudio: [], allowed: new Set(), spoken: [], transcribed: false, provisional: false,
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
          const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
          if (!bytes.byteLength || bytes.byteLength % 2) { await fail(turn, `malformed audio frame of ${bytes.byteLength} bytes`); return; }
          if (!turn.approved) {
            // The controlled path never has audio before its reply. The
            // conversational one does: the provider streams the first frame
            // of a sentence before the sentence itself, so hold it until the
            // text arrives and passes.
            if (!conversational) { await fail(turn, "audio before the controlled reply"); return; }
            turn.heldAudio.push(bytes);
            if (turn.heldAudio.length > HELD_AUDIO_LIMIT) await fail(turn, `held ${turn.heldAudio.length} audio frames with no approved sentence`);
            return;
          }
          await deliver(turn, bytes);
          return;
        }
        const event = JSON.parse(data.toString()) as { type?: string; role?: string; content?: unknown };
        if (event.type === "Welcome") {
          const remembered = await context;
          if (!turn.active) return;
          for (const value of contextNumbers(remembered)) turn.allowed.add(value);
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
                prompt: coachPrompt(remembered),
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
        } else if (event.type === "ConversationText") {
          await heard(turn, event.role, String(event.content ?? ""));
        } else if (event.type === "AgentAudioDone" && turn.approved) {
          if (turn.approvedBy === "speech" && turn.spoken.length > 1) {
            // The first sentence approved the turn; the record should hold all of them.
            await options.onEvent(binding, { type: "response", reply: { kind: "conversation", text: turn.spoken.join(" ") } });
          }
          terminal(turn);
          await options.onEvent(binding, { type: "generated" });
        } else if (event.type === "AgentAudioDone") {
          // Finished speaking without ever producing a reply this server approved.
          await fail(turn, `agent finished with no approved reply; spoke ${turn.spoken.length} sentences`);
        } else if (event.type === "FunctionCallRequest") {
          await functionCall(turn, event as unknown as FunctionCallEvent);
        } else if (event.type === "Error") {
          await fail(turn, `provider error ${JSON.stringify(event).slice(0, 300)}`);
        } else if (event.type === "Warning") {
          // Not fatal on its own, but usually the explanation for the Error that follows.
          console.warn(`[voice] turn ${turn.binding.turnId} provider warning: ${JSON.stringify(event).slice(0, 300)}`);
        }
      }).catch(async (error: unknown) => {
        try { await fail(turn, `handler threw: ${error instanceof Error ? error.message : String(error)}`); }
        catch { /* The turn was already closed before notification failed. */ }
      });
    });
    socket.on("error", (error?: Error) => { void fail(turn, `provider socket error: ${error?.message ?? "unknown"}`).catch(() => {}); });
    socket.on("close", (code?: number, reason?: Buffer) => { void fail(turn, `provider socket closed ${code ?? ""} ${reason?.toString().slice(0, 120) ?? ""}`.trim()).catch(() => {}); });
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
        await approve(turn, "function");
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
        await approve(turn, "function");
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
            await transcript(turn, asked.data.question, true);
            await options.onEvent(turn.binding, { type: "response", reply });
            // Only a reply this server computed unlocks playback.
            await approve(turn, "function");
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
      await fail(turn, "controlled reply could not be delivered");
      return jsonResponse(400, { error: { code: "invalid_request" } });
    }
    let reply: Reply = unsupported;
    try { await options.onEvent(turn.binding, { type: "final_transcript", text: userMessage.content }); }
    catch { await fail(turn, "controlled reply could not be delivered"); return jsonResponse(503, { error: { code: "provider_unavailable" } }); }
    try {
      const candidate = SafeReply.parse(await options.answer(turn.binding, userMessage.content));
      if (candidate.kind !== "calculation" || candidate.facts.every((fact) => fact.chartSnapshotId === turn.binding.chartSnapshotId)) reply = candidate;
    } catch { /* Only the fixed refusal below can cross the provider boundary. */ }
    if (!turn.active || !(await options.isTurnActive(turn.binding))) {
      cancel(turn.binding.turnId);
      return jsonResponse(409, { error: { code: "state_conflict" } });
    }
    try { await options.onEvent(turn.binding, { type: "response", reply }); }
    catch { await fail(turn, "controlled reply could not be delivered"); return jsonResponse(503, { error: { code: "provider_unavailable" } }); }
    if (!turn.active) return jsonResponse(409, { error: { code: "state_conflict" } });
    const content = renderSafeReply(reply);
    await approve(turn, "function");
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
