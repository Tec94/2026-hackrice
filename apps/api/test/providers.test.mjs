import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createVoiceProvider } from "../dist/providers/voice.js";
import { createAnalysisRater, ratingBrief } from "../dist/providers/rater.js";
import { createBackboardProvider } from "../dist/providers/backboard.js";
import { renderSafeReply } from "@hackrice/contracts";

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const assistantId = "44444444-4444-4444-8444-444444444444";
const memoryId = "55555555-5555-4555-8555-555555555555";
const threadId = "66666666-6666-4666-8666-666666666666";
const operationId = "77777777-7777-4777-8777-777777777777";
const binding = { userId: "auth-user", sessionId, turnId, chartSnapshotId: snapshotId };
const format = { encoding: "pcm_s16le", sampleRateHz: 24000, channels: 1 };
const concept = { kind: "concept", concept: "ema" };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const config = {
  deepgramApiKey: "test-deepgram", elevenLabsApiKey: "test-eleven", elevenLabsVoiceId: "test-voice",
  thinkEndpointUrl: "https://backend.example/api/providers/deepgram/think", playbackValidated: true,
};

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit("close"); }
  json(data) { this.emit("message", Buffer.from(JSON.stringify(data)), false); }
}

async function voiceHarness(overrides = {}) {
  const events = [];
  const socket = new FakeSocket();
  const provider = createVoiceProvider({
    config, answer: async () => concept, isTurnActive: async () => true,
    onEvent: (_binding, event) => events.push(event), socketFactory: () => socket, ...overrides,
  });
  const relay = provider.start(binding, format);
  assert.equal(relay.status, "connecting");
  assert.equal(relay.sendAudio(new Uint8Array([0, 0])), false);
  socket.json({ type: "Welcome" });
  await tick();
  socket.json({ type: "SettingsApplied" });
  assert.equal(await relay.ready, true);
  const settings = JSON.parse(socket.sent[0]);
  const authorization = settings.agent.think.endpoint.headers.authorization;
  const request = { model: settings.agent.think.provider.model, messages: [{ role: "user", content: "Explain EMA" }] };
  return { provider, relay, socket, settings, authorization, request, events };
}

test("voice config has exactly the controlled Think path and explicit ElevenLabs Speak", async () => {
  const h = await voiceHarness();
  assert.equal(Array.isArray(h.settings.agent.think), false);
  assert.equal(h.settings.agent.think.endpoint.url, config.thinkEndpointUrl);
  assert.equal(h.settings.agent.speak.provider.type, "eleven_labs");
  assert.equal(h.settings.mip_opt_out, true);
  assert.deepEqual(h.settings.flags, { history: false });
  assert.equal("greeting" in h.settings.agent, false);
  assert.equal("eot_threshold" in h.settings.agent.listen.provider, false);
  assert.equal(h.relay.sendAudio(new Uint8Array([0])), false);
  assert.equal(h.relay.sendAudio(new Uint8Array([0, 0])), true);
  h.relay.stop();
  assert.equal(h.relay.sendAudio(new Uint8Array([0, 0])), false);
  assert.deepEqual(JSON.parse(h.socket.sent.at(-1)), { type: "ForceEndTurn" });
  h.relay.cancel();
});

test("Think callback rejects forged binding, returns only rendered prose, and consumes its token once", async () => {
  let answered = 0;
  const h = await voiceHarness({ answer: async (actualBinding) => { assert.deepEqual(actualBinding, binding); answered++; return concept; } });
  assert.equal((await h.provider.handleThink("Bearer forged", h.request)).statusCode, 401);
  assert.equal((await h.provider.handleThink(h.authorization, { ...h.request, model: "another-turn" })).statusCode, 400);
  const responses = await Promise.all([h.provider.handleThink(h.authorization, h.request), h.provider.handleThink(h.authorization, h.request)]);
  assert.deepEqual(responses.map((response) => response.statusCode), [200, 401]);
  assert.equal(answered, 1);
  assert.equal(JSON.parse(responses[0].body).choices[0].message.content, renderSafeReply(concept));
  h.relay.cancel();
});

test("unvalidated prose and mismatched snapshot values become a fixed refusal", async () => {
  for (const candidate of [
    { ...concept, text: "BUY NOW in 2024" },
    { kind: "calculation", facts: [{ id: memoryId, chartSnapshotId: sessionId, metric: "close", value: "20240101", unit: "USDT", calculatedThroughOffsetMinutes: 0 }] },
  ]) {
    const h = await voiceHarness({ answer: async () => candidate });
    const response = await h.provider.handleThink(h.authorization, { ...h.request, stream: true });
    assert.equal(response.statusCode, 200);
    assert.equal(response.contentType, "text/event-stream");
    const chunk = JSON.parse(response.body.split("\n\n")[0].slice(6));
    assert.equal(chunk.choices[0].delta.content, renderSafeReply({ kind: "refusal", reason: "unsupported" }));
    assert.equal(response.body.includes("20240101"), false);
    assert.equal(response.body.includes("BUY NOW"), false);
    assert.ok(response.body.endsWith("data: [DONE]\n\n"));
    h.relay.cancel();
  }
});

test("cancellation invalidates an in-flight callback and suppresses late audio", async () => {
  let finish;
  const answer = new Promise((resolve) => { finish = resolve; });
  const h = await voiceHarness({ answer: () => answer });
  const pending = h.provider.handleThink(h.authorization, h.request);
  await tick();
  h.relay.cancel();
  finish(concept);
  assert.equal((await pending).statusCode, 409);
  h.socket.emit("message", Buffer.from([0, 0]), true);
  await tick();
  assert.equal(h.events.some((event) => event.type === "response" || event.type === "audio"), false);
  assert.equal((await h.provider.handleThink(h.authorization, h.request)).statusCode, 401);
});

test("audio cannot leave before the controlled response is committed", async () => {
  const blocked = await voiceHarness();
  blocked.socket.emit("message", Buffer.from([0, 0]), true);
  await tick();
  assert.equal(blocked.events.some((event) => event.type === "audio"), false);
  assert.equal(blocked.events.at(-1).type, "unavailable");
  const allowed = await voiceHarness();
  await allowed.provider.handleThink(allowed.authorization, allowed.request);
  allowed.socket.emit("message", Buffer.from([0, 0]), true);
  allowed.socket.json({ type: "AgentAudioDone" });
  await tick();
  assert.deepEqual(allowed.events.map((event) => event.type), ["final_transcript", "response", "audio_start", "audio", "generated"]);
});

test("missing credentials or unverified playback never opens a provider socket", () => {
  for (const supplied of [undefined, { ...config, playbackValidated: false }]) {
    let connections = 0;
    const provider = createVoiceProvider({ config: supplied, answer: async () => concept, isTurnActive: async () => true, onEvent() {}, socketFactory() { connections++; return new FakeSocket(); } });
    assert.deepEqual(provider.start(binding, format), { status: "unavailable" });
    assert.equal(connections, 0);
  }
});

const owner = { userId: "auth-user", assistantId };
const record = { sourceSessionIds: [sessionId], category: "evidence", reasonCode: "missing_comparison" };
const link = { ...owner, sourceSessionIds: [sessionId], memoryIds: [memoryId], threadIds: [threadId], status: "stored" };
const reply = (status, data = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

test("Backboard isolates assistants per user and deduplicates concurrent creation", async () => {
  let calls = 0;
  const provider = createBackboardProvider({ apiKey: "test-key", fetch: async () => reply(201, { assistant_id: ++calls === 1 ? assistantId : memoryId }) });
  const [a, same, b] = await Promise.all([provider.createAssistant("alice"), provider.createAssistant("alice"), provider.createAssistant("bob")]);
  assert.deepEqual(a, same);
  assert.notEqual(a.owner.assistantId, b.owner.assistantId);
  assert.equal(calls, 2);
});

test("Backboard accepts only code records and tracks confirmed memory/source identity", async () => {
  const requests = [];
  const provider = createBackboardProvider({ apiKey: "test-key", fetch: async (url, init) => { requests.push({ url, ...init }); return init.method === "POST" ? reply(201, { memory_id: memoryId }) : reply(200, { id: memoryId }); } });
  await assert.rejects(provider.remember(owner, { ...record, transcript: "Buy now" }));
  assert.equal(requests.length, 0);
  const result = await provider.remember(owner, record);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.link.memoryIds, [memoryId]);
  assert.deepEqual(JSON.parse(requests[0].body).content, JSON.stringify(record));
  assert.deepEqual(result.link.sourceSessionIds, [sessionId]);
});

for (const contentField of ["content", "memory"]) test(`Readonly retrieval validates ${contentField} records and preserves provenance`, async () => {
  let request;
  const provider = createBackboardProvider({ apiKey: "test-key", fetch: async (_url, init) => { request = JSON.parse(init.body); return reply(200, { thread_id: threadId, content: "Buy SOL now", retrieved_memories: [{ id: memoryId, [contentField]: JSON.stringify(record) }, { id: turnId, [contentField]: JSON.stringify({ ...record, advice: "buy" }) }] }); } });
  const result = await provider.retrieve(owner);
  assert.equal(request.memory, "Readonly");
  assert.equal(request.web_search, "off");
  assert.deepEqual(result.records, [record]);
  assert.deepEqual(result.threadIds, [threadId]);
  assert.deepEqual(result.links[0].memoryIds, [memoryId]);
  assert.equal(JSON.stringify(result).includes("Buy SOL"), false);
});

test("memory deletion waits for asynchronous writes and confirms every memory and thread absent", async () => {
  let complete = false;
  const requests = [];
  const provider = createBackboardProvider({ apiKey: "test-key", fetch: async (url, init) => {
    requests.push({ url, method: init.method });
    if (url.includes("/operations/")) return reply(200, { operation_id: operationId, status: complete ? "COMPLETED" : "IN_PROGRESS", memory_ids: [memoryId] });
    return init.method === "DELETE" ? reply(200, { success: true }) : reply(404);
  } });
  const pending = { ...link, memoryIds: [], operationId, status: "pending" };
  assert.equal((await provider.deleteLinked(owner, [pending])).status, "pending");
  assert.equal(requests.some((request) => request.method === "DELETE"), false);
  complete = true;
  const result = await provider.deleteLinked(owner, [pending]);
  assert.equal(result.status, "completed");
  assert.equal(result.links[0].status, "deleted");
  assert.ok(requests.some((request) => request.url.endsWith(`/memories/${memoryId}`) && request.method === "GET"));
  assert.ok(requests.some((request) => request.url.endsWith(`/threads/${threadId}`) && request.method === "GET"));
});

test("ambiguous, unavailable, and cross-user memory deletions cannot report completion", async () => {
  const pending = createBackboardProvider({ apiKey: "test-key", fetch: async () => reply(200, { success: true }) });
  assert.equal((await pending.deleteLinked(owner, [link])).status, "pending");
  await assert.rejects(pending.deleteLinked({ ...owner, userId: "different-user" }, [link]));
  const unavailable = createBackboardProvider({});
  assert.equal((await unavailable.remember(owner, record)).status, "unavailable");
  assert.equal((await unavailable.retrieve(owner)).status, "unavailable");
  assert.equal((await unavailable.deleteLinked(owner, [link])).status, "pending");
  assert.equal((await pending.deleteLinked(owner, [{ ...link, memoryIds: [], threadIds: [], status: "pending" }])).status, "pending");
  assert.equal((await pending.deleteLinked(owner, [{ ...link, memoryIds: [], threadIds: [], status: "stored" }])).status, "pending");
  const rejected = createBackboardProvider({ apiKey: "test-key", fetch: async () => reply(403) });
  assert.equal((await rejected.retrieve(owner)).status, "failed");
});


const analysis = {
  chartSnapshotId: snapshotId, thesis: "Higher lows are holding", prediction: "higher", hypotheticalAction: "long",
  confidencePercent: 70, claimedEvidence: ["close > 137"], invalidation: "a close below 135",
};
const chart = ["Closing price: 137.42 USDT.", "Visible high: 138.84 USDT."];
const outcome = { referenceClose: "137.42", horizonClose: "140.10", percentChange: "1.95", observedDirection: "higher" };

function raterHarness(overrides = {}) {
  const socket = new FakeSocket();
  let opened = 0;
  const rater = createAnalysisRater({ deepgramApiKey: "test-deepgram", model: "test-model",
    socketFactory: () => { opened++; return socket; }, ...overrides });
  return { rater, socket, opened: () => opened };
}

test("an unconfigured rater is disabled and never opens a connection", async () => {
  let opened = 0;
  const rater = createAnalysisRater({ deepgramApiKey: "test-deepgram", socketFactory: () => { opened++; return new FakeSocket(); } });
  assert.equal(rater.enabled, false);
  assert.equal(await rater.rate({ stage: "submission", submission: analysis, chart }), null);
  assert.equal(opened, 0);
});

test("a submission rating is a text-only agent session whose one function call is the rating", async () => {
  const h = raterHarness();
  const pending = h.rater.rate({ stage: "submission", submission: analysis, chart });
  h.socket.json({ type: "Welcome" });
  const settings = JSON.parse(h.socket.sent[0]);
  assert.equal(settings.mip_opt_out, true);
  assert.deepEqual(settings.flags, { history: false });
  assert.equal(settings.agent.think.provider.model, "test-model");
  assert.equal("endpoint" in settings.agent.think, false, "the hosted model is used directly");
  assert.deepEqual(settings.agent.think.functions.map((f) => f.name), ["rate_analysis"]);
  // Every field the stage rates is required, so the model cannot quietly skip one.
  assert.deepEqual(settings.agent.think.functions[0].parameters.required, ["thesisScore", "invalidationScore", "riskScore", "comment"]);
  assert.equal("confirmationScore" in settings.agent.think.functions[0].parameters.properties, false);
  assert.equal(settings.agent.speak.provider.type, "deepgram");

  h.socket.json({ type: "SettingsApplied" });
  const injected = JSON.parse(h.socket.sent[1]);
  assert.equal(injected.type, "InjectUserMessage");
  assert.ok(injected.content.includes("Higher lows are holding"));
  assert.ok(injected.content.includes("Closing price: 137.42 USDT."));
  assert.equal(injected.content.includes("What the price then did"), false, "no outcome before the reveal");

  // Speech frames arrive on the same socket and are ignored.
  h.socket.emit("message", Buffer.from([0, 0, 0, 0]), true);
  h.socket.json({ type: "FunctionCallRequest", functions: [{ id: "call-1", name: "rate_analysis",
    arguments: JSON.stringify({ thesisScore: 72.4, invalidationScore: 60, riskScore: 55, confirmationScore: 99, comment: "  Name the level.  " }) }] });
  assert.deepEqual(await pending, { thesisScore: 72, invalidationScore: 60, riskScore: 55, comment: "Name the level." });
  const response = JSON.parse(h.socket.sent.at(-1));
  assert.equal(response.type, "FunctionCallResponse");
  assert.equal(response.id, "call-1");
  assert.equal(h.socket.readyState, 3, "the session is closed once the rating is in");
  assert.equal(h.opened(), 1);
});

test("a reveal rating carries the outcome and keeps only outcome scores, clamped to the rubric", async () => {
  const h = raterHarness();
  const pending = h.rater.rate({ stage: "reveal", submission: analysis, chart, outcome });
  h.socket.json({ type: "Welcome" });
  h.socket.json({ type: "SettingsApplied" });
  const injected = JSON.parse(h.socket.sent[1]);
  assert.ok(injected.content.includes("What the price then did"));
  assert.ok(injected.content.includes("Direction: higher"));
  h.socket.json({ type: "FunctionCallRequest", functions: [{ id: "call-2", name: "rate_analysis",
    arguments: JSON.stringify({ confirmationScore: 130, calibrationScore: -5, thesisScore: 10, comment: "Right call." }) }] });
  assert.deepEqual(await pending, { confirmationScore: 100, calibrationScore: 0, comment: "Right call." });
});

test("a rater failure is null, never an exception, and never a partial rating", async () => {
  const errored = raterHarness();
  const failing = errored.rater.rate({ stage: "submission", submission: analysis, chart });
  errored.socket.json({ type: "Welcome" });
  errored.socket.json({ type: "Error", code: "FAILED_TO_THINK" });
  assert.equal(await failing, null);

  const garbled = raterHarness();
  const unusable = garbled.rater.rate({ stage: "submission", submission: analysis, chart });
  garbled.socket.json({ type: "Welcome" });
  garbled.socket.json({ type: "SettingsApplied" });
  garbled.socket.json({ type: "FunctionCallRequest", functions: [{ id: "call-3", name: "rate_analysis", arguments: "{not json" }] });
  assert.equal(await unusable, null);
  assert.equal(JSON.parse(garbled.socket.sent.at(-1)).type, "FunctionCallResponse", "the model is still answered");

  const silent = raterHarness({ timeoutMs: 5 });
  assert.equal(await silent.rater.rate({ stage: "submission", submission: analysis, chart }), null);
});

test("the brief is plain lines with every field the learner wrote and placeholders for the rest", () => {
  const text = ratingBrief({ stage: "submission", submission: { ...analysis, invalidation: undefined }, chart: [] });
  assert.ok(text.includes("- (none available)"));
  assert.ok(text.includes("- Invalidation: (none written)"));
  assert.ok(text.includes("- Confidence: 70%"));
});
