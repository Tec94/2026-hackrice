import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { Realtime } from "../dist/realtime.js";

test("cancellation while a provider completion waits for storage prevents late completion", async (t) => {
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const turnId = "33333333-3333-4333-8333-333333333333";
  const chartSnapshotId = "44444444-4444-4444-8444-444444444444";
  const state = {
    public: { id: sessionId }, events: [], facts: [],
    turns: [{ id: turnId, chartSnapshotId, inputMode: "voice", status: "cancelled",
      audioDelivery: "none", finalTranscript: "Calculate close" }],
  };
  let releaseStorage;
  let signalStorageEntry;
  const storageBlocked = new Promise((resolve) => { releaseStorage = resolve; });
  const storageEntered = new Promise((resolve) => { signalStorageEntry = resolve; });
  let updateFinished = false;
  const service = {
    store: {
      update: async (_userId, _sessionId, mutate) => {
        signalStorageEntry();
        await storageBlocked;
        const result = mutate(state);
        updateFinished = true;
        return result;
      },
      read: async () => state,
    },
    assertBlind: () => {},
    calculate: async () => ({ kind: "refusal", reason: "unsupported" }),
  };
  const recordings = { finish: async () => {}, close: async () => {} };
  const realtime = new Realtime(service, recordings,
    { encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1 });
  t.after(async () => { releaseStorage(); await realtime.close(); });

  const binding = { userId: "owner", sessionId, turnId, chartSnapshotId };
  const live = { binding, socket: { readyState: WebSocket.CLOSED }, recordingId: "recording",
    active: true, sentAudio: false };
  // Isolate the existing provider callback interleaving without opening a socket or provider connection.
  realtime.active.set(turnId, live);
  const pendingCompletion = realtime.onProviderEvent(binding, { type: "generated" });
  await storageEntered;
  assert.equal(updateFinished, false);
  assert.equal(live.active, true);

  realtime.cancel(turnId);
  assert.equal(live.active, false);
  releaseStorage();
  await pendingCompletion;

  assert.equal(updateFinished, true);
  assert.equal(state.turns[0].status, "cancelled");
  assert.equal(state.turns[0].audioDelivery, "none");
  assert.equal(state.events.some((event) => event.type === "assistant.completed"), false);
});


test("drafts merge across turns and the next turn is handed the conversation and the form", async () => {
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const turnId = "33333333-3333-4333-8333-333333333333";
  const chartSnapshotId = "44444444-4444-4444-8444-444444444444";
  const state = {
    public: { id: sessionId }, events: [], facts: [],
    turns: [
      { id: "55555555-5555-4555-8555-555555555555", chartSnapshotId, inputMode: "voice", status: "completed", audioDelivery: "completed",
        finalTranscript: "what is the closing price",
        reply: { kind: "calculation", facts: [{ id: "66666666-6666-4666-8666-666666666666", chartSnapshotId, metric: "close", value: "111", unit: "USDT", calculatedThroughOffsetMinutes: 0 }] } },
      { id: turnId, chartSnapshotId, inputMode: "voice", status: "completed", audioDelivery: "none", finalTranscript: "I think it goes higher" },
    ],
  };
  const service = {
    store: { update: async (_u, _s, mutate) => mutate(state), read: async () => state },
    assertBlind: () => {}, calculate: async () => ({ kind: "refusal", reason: "unsupported" }),
  };
  const realtime = new Realtime(service, { finish: async () => {}, close: async () => {} },
    { encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1 });
  const binding = { userId: "owner", sessionId, turnId, chartSnapshotId };
  realtime.active.set(turnId, { binding, socket: { readyState: WebSocket.CLOSED }, recordingId: "recording", active: true, sentAudio: false });

  await realtime.onProviderEvent(binding, { type: "draft", draft: { prediction: "higher", thesis: "higher lows" } });
  await realtime.onProviderEvent(binding, { type: "draft", draft: { confidencePercent: 70 } });
  assert.deepEqual(state.draft, { prediction: "higher", thesis: "higher lows", confidencePercent: 70 });
  assert.equal(state.events.filter((event) => event.type === "analysis.draft").length, 2);

  const context = await realtime.turnContext(binding);
  assert.deepEqual(context.turns, [
    { learner: "what is the closing price", coach: "Closing price: 111 USDT." },
    { learner: "I think it goes higher" },
  ]);
  assert.deepEqual(context.draft, { prediction: "higher", thesis: "higher lows", confidencePercent: 70 });
  await realtime.close();
});
