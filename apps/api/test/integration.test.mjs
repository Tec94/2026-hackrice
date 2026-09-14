import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { registerFrontend } from "../../../scripts/frontend-proxy.mjs";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import WebSocket from "ws";
import * as C from "@hackrice/contracts";
import { buildApp } from "../dist/server.js";
import { isReceiptBypassEnabled } from "../dist/service.js";
import { connectDatabase, migrate } from "../dist/database.js";
import { Recordings } from "../dist/recordings.js";
import { RETENTION_MS } from "../dist/domain.js";
import { LearningRecord } from "../dist/providers/backboard.js";
import { createSolanaReceiptProvider, DEVNET_GENESIS_HASH, verifyCommitment } from "../dist/providers/solana.js";

const origin = "http://localhost:3000";
const minute = 60_000;
const sourceStart = Date.UTC(2024, 0, 1);
// RSI requires period + 1 closes. Add the explicit one-hour reveal horizon;
// this yields exactly one eligible hour cutoff, without a random test outcome.
const historyHours = Math.max(...C.demoIndicators.map((indicator) => indicator.period + 1));
const cutoff = sourceStart + historyHours * C.timeframeMinutes["1h"] * minute;
const candles = Array.from({ length: (historyHours + 1) * C.timeframeMinutes["1h"] / C.timeframeMinutes["5m"] }, (_, index) => ({
  openTimeMs: sourceStart + index * C.timeframeMinutes["5m"] * minute,
  closeTimeMs: sourceStart + (index + 1) * C.timeframeMinutes["5m"] * minute,
  open: String(100 + index), high: String(102 + index), low: String(99 + index),
  close: String(101 + index), volume: String(10 + index),
}));
const digest = createHash("sha256").update(JSON.stringify(candles)).digest("hex");

function providers() {
  const control = { confirmed: false, deletionConfirmed: false, sentTransactions: [], memories: [], removals: [] };
  const signer = Keypair.generate();
  const rpc = {
    getGenesisHash: async () => DEVNET_GENESIS_HASH,
    getLatestBlockhash: async () => ({ blockhash: new PublicKey(new Uint8Array(32).fill(9)).toBase58(), lastValidBlockHeight: 10 }),
    sendRawTransaction: async (bytes) => {
      control.sentTransactions.push(Transaction.from(bytes));
      // An accepted send with a lost response is ambiguous, never success.
      throw new Error("Mock RPC response lost after send");
    },
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [control.confirmed
      ? { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }
      : null] }),
    getBlockHeight: async () => 1,
  };
  const solanaProvider = createSolanaReceiptProvider({ network: "devnet", rpcUrl: "https://api.devnet.solana.com", secretKey: signer.secretKey, rpc });
  const backboardProvider = {
    createAssistant: async (userId) => ({ status: "completed", owner: { userId, assistantId: randomUUID() } }),
    remember: async (owner, input) => {
      const record = LearningRecord.parse(input);
      const link = { ...owner, sourceSessionIds: record.sourceSessionIds, memoryIds: [randomUUID()], threadIds: [], status: "stored" };
      control.memories.push({ record, link });
      return { status: "completed", link };
    },
    retrieve: async () => ({ status: "completed", records: [], links: [], threadIds: [randomUUID()] }),
    operation: async (_owner, operationId) => ({ status: "pending", operationId, memoryIds: [] }),
    deleteLinked: async (owner, links) => {
      control.removals.push({ owner, links: structuredClone(links) });
      return { status: control.deletionConfirmed ? "completed" : "pending", links: links.map((link) => ({
        ...link, status: control.deletionConfirmed ? "deleted" : "deletion_pending",
      })) };
    },
  };
  return { control, solanaProvider, backboardProvider };
}

function assertBlind(value) {
  const forbidden = new Set(["cutoffTimeMs", "datasetId", "datasetDigest", "source", "openTimeMs", "closeTimeMs", "salt", "payload", "proof", "horizonClose", "observedDirection"]);
  function visit(item) {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      assert.equal(forbidden.has(key), false, `Private historical field leaked: ${key}`);
      if (key.endsWith("OffsetMinutes")) assert.ok(child <= 0, `${key} must remain pre-cutoff`);
      visit(child);
    }
  }
  visit(value);
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("2024-01-01"), false);
  assert.equal(serialized.includes(String(sourceStart)), false);
  assert.equal(serialized.includes(String(cutoff)), false);
  assert.equal(serialized.includes(digest), false);
}

test("authenticated replay lifecycle, receipt gating, and retained-data deletion", async (t) => {
  const db = await connectDatabase({ local: true, localPath: "memory://" });
  const directory = await mkdtemp(join(tmpdir(), "hackrice-integration-"));
  const fixtures = new Recordings(directory);
  let now = Date.now();
  const mocks = providers();
  const app = await buildApp({ db, recordingsDirectory: directory, baseURL: origin,
    authSecret: "integration-only-auth-secret-not-for-deployment", now: () => now,
    solanaProvider: mocks.solanaProvider, backboardProvider: mocks.backboardProvider });
  const frontend = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<html>Frontend fixture</html>");
  });
  frontend.listen(0, "127.0.0.1");
  await once(frontend, "listening");
  registerFrontend(app, `http://127.0.0.1:${frontend.address().port}`);
  t.after(async () => {
    await app.close();
    await new Promise((resolve, reject) => frontend.close((error) => error ? reject(error) : resolve()));
    await fixtures.close();
    await db.close();
    // mkdtemp returns this test's dedicated absolute directory, not a workspace.
    await rm(directory, { recursive: true, force: true });
  });
  await migrate(db);
  await app.replayService.store.importDataset({ candles, digest, source: "Synthetic integration fixture; not market data" });
  const homepage = await app.inject({ method: "GET", url: "/" });
  assert.equal(homepage.statusCode, 200);
  assert.equal(homepage.body, "<html>Frontend fixture</html>");
  assert.equal((await app.inject({ method: "GET", url: "/health" })).json().status, "ok");

  async function request(cookie, method, url, payload, key = randomUUID()) {
    return app.inject({ method, url, headers: { origin, ...(cookie ? { cookie } : {}),
      ...(!["GET", "HEAD"].includes(method) ? { "idempotency-key": key } : {}) },
      ...(payload === undefined ? {} : { payload }) });
  }
  function status(response, expected) {
    assert.equal(response.statusCode, expected, response.body);
    return response.json();
  }
  async function signup(name) {
    const response = await request(undefined, "POST", "/api/auth/sign-up/email", {
      name, email: `${name}@integration.example`, password: "Integration-only-passphrase!",
    });
    const body = status(response, 200);
    const raw = response.headers["set-cookie"];
    assert.ok(raw, "Better Auth must issue a real session cookie");
    return { userId: body.user.id, cookie: (Array.isArray(raw) ? raw : [raw]).map((value) => value.split(";")[0]).join("; ") };
  }
  async function create(account, key = randomUUID(), predictionHorizon = "1h") {
    return status(await request(account.cookie, "POST", "/api/sessions", { timeframe: "5m", predictionHorizon }, key), 201);
  }
  async function context(account, session) {
    return status(await request(account.cookie, "GET", `/api/sessions/${session.id}/chart-context`), 200);
  }
  async function recording(account, session, snapshot) {
    const id = randomUUID();
    const turnId = randomUUID();
    const pcm = new Uint8Array([0, 0]); // One complete signed 16-bit PCM sample.
    await fixtures.start(id);
    await fixtures.append(id, pcm);
    await fixtures.finish(id);
    await app.replayService.store.update(account.userId, session.id, (state) => {
      state.turns.push({ id: turnId, chartSnapshotId: snapshot.id, inputMode: "voice",
        finalTranscript: "Fixture recording", status: "completed", audioDelivery: "none" });
      state.recordings.push({ id, turnId, format: { encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1 },
        expiresAt: new Date(now + RETENTION_MS).toISOString() });
    });
    return { id, path: join(directory, `${id}.pcm`), url: `/api/sessions/${session.id}/recordings/${id}`, pcm };
  }

  const alice = await signup("alice");
  const bob = await signup("bob");
  let session, snapshot, recorded, submittedKey, submission, savedRecording;

  await t.test("cookie ownership, idempotent creation, stale context, and immutable snapshot links", async () => {
    status(await request(undefined, "GET", "/api/sessions"), 401);
    const createKey = randomUUID();
    session = await create(alice, createKey);
    assert.deepEqual(await create(alice, createKey), session);
    assert.equal(status(await request(alice.cookie, "POST", "/api/sessions", { timeframe: "5m", predictionHorizon: "15m" }, createKey), 409).code, "idempotency_conflict");
    assert.equal(status(await request(bob.cookie, "GET", `/api/sessions/${session.id}`), 404).code, "not_found");
    const forbiddenOrigin = await app.inject({ method: "POST", url: "/api/sessions", headers: { cookie: alice.cookie,
      origin: "https://untrusted.example", "idempotency-key": randomUUID() }, payload: { timeframe: "5m", predictionHorizon: "1h" } });
    status(forbiddenOrigin, 403);
    const oldSnapshot = await context(alice, session);
    const update = { expectedRevision: oldSnapshot.revision, timeframe: "15m", visibleRange: oldSnapshot.visibleRange,
      indicators: oldSnapshot.indicators, drawings: [] };
    snapshot = status(await request(alice.cookie, "PATCH", `/api/sessions/${session.id}/chart-context`, update), 200);
    assert.equal(snapshot.revision, oldSnapshot.revision + 1);
    assert.equal(status(await request(alice.cookie, "PATCH", `/api/sessions/${session.id}/chart-context`, update), 409).code, "revision_conflict");
    const otherSession = await create(bob);
    const otherSnapshot = await context(bob, otherSession);
    status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/questions`, { chartSnapshotId: otherSnapshot.id, text: "close" }), 404);
    const accepted = status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/questions`, { chartSnapshotId: oldSnapshot.id, text: "close" }), 202);
    const history = C.History.parse(status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/history`), 200));
    const turn = history.turns.find((item) => item.id === accepted.turnId);
    assert.equal(turn.chartSnapshotId, oldSnapshot.id, "An older owned snapshot stays immutable and usable");
    assert.equal(turn.reply.kind, "calculation");
    assert.ok(turn.reply.facts.every((fact) => fact.chartSnapshotId === oldSnapshot.id));
    const expectedClose = candles.find((candle) => candle.closeTimeMs === cutoff).close;
    assert.equal(turn.reply.facts[0].value, expectedClose);
    assertBlind(history);
  });

  await t.test("archive is reversible, owned, idempotent, and preserves the replay and expiry", async () => {
    const original = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}`), 200);
    const archiveKey = randomUUID();
    status(await request(bob.cookie, "PUT", `/api/sessions/${session.id}/archive`, { archived: true }), 404);
    const archived = status(await request(alice.cookie, "PUT", `/api/sessions/${session.id}/archive`, { archived: true }, archiveKey), 200);
    assert.equal(archived.archived, true);
    assert.equal(archived.status, original.status);
    assert.equal(archived.expiresAt, original.expiresAt);
    assert.deepEqual(status(await request(alice.cookie, "PUT", `/api/sessions/${session.id}/archive`, { archived: true }, archiveKey), 200), archived);
    status(await request(alice.cookie, "PUT", `/api/sessions/${session.id}/archive`, { archived: false }, archiveKey), 409);
    assert.equal(status(await request(alice.cookie, "GET", "/api/sessions"), 200).find(s => s.id === session.id).archived, true);
    const restored = status(await request(alice.cookie, "PUT", `/api/sessions/${session.id}/archive`, { archived: false }), 200);
    assert.equal(restored.archived, false);
    assert.equal(restored.latestChartRevision, original.latestChartRevision);
    assert.equal(restored.expiresAt, original.expiresAt);
    const history = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/history`), 200);
    assert.ok(history.snapshots.some(s => s.id === snapshot.id));
    assert.ok(history.facts.every(f => history.snapshots.some(s => s.id === f.chartSnapshotId)));
    assertBlind(history);
  });

  await t.test("pre-reveal bars, calculations, and errors cannot disclose the future or source dates", async () => {
    for (const timeframe of C.Timeframe.options) {
      const result = C.Bars.parse(status(await request(alice.cookie, "GET",
        `/api/sessions/${session.id}/chart/bars?timeframe=${timeframe}&from=${session.chartRange.from}&to=60`), 200));
      assert.equal(result.allowedRange.to, 0);
      assert.ok(result.bars.length > 0);
      assert.ok(result.bars.every((bar) => bar.closeOffsetMinutes <= 0 && bar.openOffsetMinutes < 0));
      assert.equal(result.bars.at(-1).closeOffsetMinutes, 0);
      assertBlind(result);
    }
    const future = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/chart/bars?timeframe=5m&from=0&to=60`), 200);
    assert.deepEqual(future.bars, []);
    const invalid = status(await request(alice.cookie, "PATCH", `/api/sessions/${session.id}/chart-context`, {
      expectedRevision: snapshot.revision, timeframe: "5m", visibleRange: { from: -60, to: 5 }, indicators: [], drawings: [],
    }), 400);
    assertBlind(invalid);
    const accepted = status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/questions`, {
      chartSnapshotId: snapshot.id, text: "What is the future outcome?",
    }), 202);
    const history = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/history`), 200);
    assert.deepEqual(history.turns.find((turn) => turn.id === accepted.turnId).reply, { kind: "refusal", reason: "future" });
    assertBlind(history);
    status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/reveal`), 409);
  });

  await t.test("WebSocket upgrades enforce cookie ownership and text events retain snapshot identity", async () => {
    // Port zero asks the operating system to allocate an available test port.
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const url = `${address.replace("http:", "ws:")}/api/sessions/${session.id}/events`;
    async function rejectedUpgrade(cookie, suppliedOrigin = origin) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { headers: { origin: suppliedOrigin, ...(cookie ? { cookie } : {}) } });
        let rejected = false;
        socket.once("unexpected-response", (request, response) => {
          rejected = true;
          response.resume();
          request.destroy();
          resolve(response.statusCode);
        });
        socket.once("open", () => { socket.terminate(); reject(new Error("Unauthorized upgrade succeeded")); });
        socket.on("error", (error) => { if (!rejected) reject(error); });
      });
    }
    assert.equal(await rejectedUpgrade(), 401);
    assert.equal(await rejectedUpgrade(bob.cookie), 404);
    assert.equal(await rejectedUpgrade(alice.cookie, "https://untrusted.example"), 403);
    const socket = new WebSocket(url, { headers: { cookie: alice.cookie, origin } });
    const messages = [];
    const waiting = [];
    socket.on("message", (bytes, binary) => {
      if (binary) return;
      const event = C.ServerEvent.parse(JSON.parse(bytes.toString()));
      messages.push(event);
      for (const waiter of waiting) if (waiter.predicate(event)) waiter.resolve(event);
    });
    const waitFor = (predicate) => {
      const existing = messages.find(predicate);
      return existing ? Promise.resolve(existing) : new Promise((resolve, reject) => {
        waiting.push({ predicate, resolve });
        socket.once("error", reject);
      });
    };
    try {
      const ready = await waitFor((event) => event.type === "session.ready");
      assert.equal(ready.sessionId, session.id);
      const turnId = randomUUID();
      socket.send(JSON.stringify({ protocolVersion: 1, eventId: randomUUID(), sessionId: session.id,
        type: "question.text", turnId, chartSnapshotId: snapshot.id, text: "close" }));
      const response = await waitFor((event) => event.type === "assistant.response" && event.turnId === turnId);
      const completed = await waitFor((event) => event.type === "assistant.completed" && event.turnId === turnId);
      assert.equal(response.chartSnapshotId, snapshot.id);
      assert.equal(response.reply.kind, "calculation");
      assert.ok(response.reply.facts.every((fact) => fact.chartSnapshotId === snapshot.id));
      assert.equal(completed.delivery, "none");
      assert.ok(completed.sequence > response.sequence);
      assertBlind(response);
      const history = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/history`), 200);
      assert.deepEqual(history.turns.find((turn) => turn.id === turnId).reply, response.reply);
    } finally {
      socket.terminate();
    }
  });

  await t.test("same-session voice connections isolate audio, command errors, cancellation, and playback acknowledgements", async (t) => {
    const voiceSession = await create(alice);
    const voiceSnapshot = await context(alice, voiceSession);
    const address = app.server.address();
    const url = `ws://127.0.0.1:${address.port}/api/sessions/${voiceSession.id}/events`;
    const turns = new Map();
    t.mock.method(app.realtime.provider, "start", (binding) => {
      const turn = { binding, input: [], stopped: false, cancelled: false };
      turns.set(binding.turnId, turn);
      return { status: "connecting", ready: Promise.resolve(true),
        sendAudio: (pcm) => { turn.input.push(Buffer.from(pcm)); return true; },
        stop: () => { turn.stopped = true; },
        cancel: () => app.realtime.provider.cancel(binding.turnId),
      };
    });
    t.mock.method(app.realtime.provider, "cancel", (turnId) => {
      const turn = turns.get(turnId);
      if (!turn || turn.cancelled) return;
      turn.cancelled = true;
      void app.realtime.onProviderEvent(turn.binding, { type: "cancelled" });
    });
    function connect() {
      const socket = new WebSocket(url, { headers: { cookie: alice.cookie, origin } });
      const messages = [];
      const waiting = new Set();
      socket.on("message", (bytes, binary) => {
        const event = binary ? { type: "audio", ...C.decodeAudioFrame(bytes) }
          : C.ServerEvent.parse(JSON.parse(bytes.toString()));
        messages.push(event);
        for (const waiter of waiting) if (waiter.predicate(event)) {
          waiting.delete(waiter);
          waiter.resolve(event);
        }
      });
      socket.on("error", (error) => { for (const waiter of waiting) waiter.reject(error); });
      socket.on("close", () => { for (const waiter of waiting) waiter.reject(new Error("Voice test socket closed before its event")); });
      const waitFor = (predicate, after = 0) => {
        const existing = messages.slice(after).find(predicate);
        return existing ? Promise.resolve(existing) : new Promise((resolve, reject) => waiting.add({ predicate, resolve, reject }));
      };
      const send = (event) => socket.send(JSON.stringify({ protocolVersion: 1, eventId: randomUUID(), sessionId: voiceSession.id, ...event }));
      // A resume response proves preceding commands have passed through the server's command queue.
      const flush = async () => {
        const marker = messages.find((event) => event.type === "session.ready");
        const after = messages.length;
        send({ type: "session.resume", afterSequence: 0 });
        await waitFor((event) => event.eventId === marker.eventId, after);
      };
      return { socket, messages, waitFor, send, flush };
    }
    const first = connect();
    const second = connect();
    try {
      const ready = await Promise.all([first, second].map((client) => client.waitFor((event) => event.type === "session.ready")));
      assert.ok(ready.every((event) => event.sessionId === voiceSession.id));
      const firstTurnId = randomUUID();
      const secondTurnId = randomUUID();
      for (const [client, turnId] of [[first, firstTurnId], [second, secondTurnId]]) {
        client.send({ type: "voice.start", turnId, chartSnapshotId: voiceSnapshot.id, format: ready[0].inputFormat });
      }
      const started = await Promise.all([[first, firstTurnId], [second, secondTurnId]].map(([client, turnId]) =>
        client.waitFor((event) => event.type === "voice.ready" && event.turnId === turnId || event.type === "session.error")));
      assert.ok(started.every((event) => event.type === "voice.ready"), JSON.stringify(started));
      assert.equal(turns.size, 2);
      assert.ok([...turns.values()].every((turn) => turn.binding.sessionId === voiceSession.id && turn.binding.chartSnapshotId === voiceSnapshot.id));

      let after = first.messages.length;
      first.send({ type: "voice.start", turnId: randomUUID(), chartSnapshotId: voiceSnapshot.id, format: ready[0].inputFormat });
      assert.equal((await first.waitFor((event) => event.type === "session.error", after)).error.code, "state_conflict");
      assert.equal(turns.size, 2, "Each connection still owns at most one active turn");
      after = first.messages.length;
      first.socket.send("malformed JSON");
      assert.equal((await first.waitFor((event) => event.type === "session.error", after)).error.code, "invalid_request");

      const firstPcm = Buffer.from([1, 0]);
      const secondPcm = Buffer.from([2, 0]);
      first.socket.send(C.encodeAudioFrame(firstTurnId, firstPcm));
      second.socket.send(C.encodeAudioFrame(secondTurnId, secondPcm));
      await Promise.all([first.flush(), second.flush()]);
      assert.deepEqual(turns.get(firstTurnId).input, [firstPcm]);
      assert.deepEqual(turns.get(secondTurnId).input, [secondPcm]);
      after = first.messages.length;
      first.socket.send(C.encodeAudioFrame(secondTurnId, firstPcm));
      assert.equal((await first.waitFor((event) => event.type === "session.error", after)).error.code, "state_conflict");
      assert.deepEqual(turns.get(secondTurnId).input, [secondPcm]);

      for (const [turnId, pcm] of [[firstTurnId, firstPcm], [secondTurnId, secondPcm]]) {
        await app.realtime.onProviderEvent(turns.get(turnId).binding, { type: "audio_start", format: ready[0].outputFormat });
        await app.realtime.onProviderEvent(turns.get(turnId).binding, { type: "audio", pcm });
      }
      assert.deepEqual(Buffer.from((await first.waitFor((event) => event.type === "audio")).pcm), firstPcm);
      assert.deepEqual(Buffer.from((await second.waitFor((event) => event.type === "audio")).pcm), secondPcm);
      first.send({ type: "voice.cancel", turnId: secondTurnId });
      await first.flush();
      assert.equal(turns.get(secondTurnId).cancelled, false, "Another connection cannot cancel this turn");
      first.send({ type: "voice.cancel", turnId: firstTurnId });
      await first.waitFor((event) => event.type === "assistant.cancelled" && event.turnId === firstTurnId);
      assert.equal(turns.get(firstTurnId).cancelled, true);
      assert.equal(turns.get(secondTurnId).cancelled, false);
      await app.realtime.onProviderEvent(turns.get(firstTurnId).binding, { type: "audio", pcm: firstPcm });
      second.send({ type: "voice.stop", turnId: secondTurnId });
      await second.flush();
      assert.equal(turns.get(firstTurnId).stopped, false);
      assert.equal(turns.get(secondTurnId).stopped, true);
      assert.deepEqual(first.messages.filter((event) => event.type === "audio").map((event) => event.turnId), [firstTurnId]);
      assert.deepEqual(second.messages.filter((event) => event.type === "audio").map((event) => event.turnId), [secondTurnId]);
      assert.equal(second.messages.some((event) => event.type === "session.error"), false, "Another connection's command errors cannot fail this turn, even on resume");

      const binding = turns.get(secondTurnId).binding;
      await app.realtime.onProviderEvent(binding, { type: "final_transcript", text: "close" });
      await app.realtime.onProviderEvent(binding, { type: "response", reply: { kind: "refusal", reason: "unsupported" } });
      await app.realtime.onProviderEvent(binding, { type: "generated" });
      await second.waitFor((event) => event.type === "assistant.completed" && event.turnId === secondTurnId && event.delivery === "partial");
      first.send({ type: "assistant.playback.completed", turnId: secondTurnId });
      await first.flush();
      let history = C.History.parse(status(await request(alice.cookie, "GET", `/api/sessions/${voiceSession.id}/history`), 200));
      assert.equal(history.turns.find((turn) => turn.id === secondTurnId).audioDelivery, "partial");
      second.send({ type: "assistant.playback.completed", turnId: secondTurnId });
      await second.waitFor((event) => event.type === "assistant.completed" && event.turnId === secondTurnId && event.delivery === "completed");
      history = C.History.parse(status(await request(alice.cookie, "GET", `/api/sessions/${voiceSession.id}/history`), 200));
      assert.equal(history.turns.find((turn) => turn.id === secondTurnId).audioDelivery, "completed");
      assert.equal(history.turns.find((turn) => turn.id === firstTurnId).status, "cancelled");
      assert.ok(history.turns.every((turn) => turn.chartSnapshotId === voiceSnapshot.id));
      assertBlind(history);
    } finally {
      first.socket.terminate();
      second.socket.terminate();
    }
  });

  await t.test("only provider-confirmed devnet state unlocks immutable submission reveal", async () => {
    submittedKey = randomUUID();
    submission = { chartSnapshotId: snapshot.id, thesis: "A synthetic chart exercise", prediction: "higher",
      hypotheticalAction: "wait", confidencePercent: 50, claimedEvidence: ["close > 1"],
      invalidation: "A lower completed close", riskReasoning: "No funds are traded" };
    recorded = C.RecordedSubmission.parse(status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/submissions`, submission, submittedKey), 201));
    assert.deepEqual(status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/submissions`, submission, submittedKey), 201), recorded);
    status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/submissions`, { ...submission, prediction: "lower" }, submittedKey), 409);
    status(await request(bob.cookie, "GET", `/api/evaluations/${recorded.evaluationId}`), 404);
    const evaluation = C.Evaluation.parse(status(await request(alice.cookie, "GET", `/api/evaluations/${recorded.evaluationId}`), 200));
    assert.equal(evaluation.scoreMeaning, "educational_rubric_not_validated_prediction_probability");
    const pending = status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/receipt/refresh`), 200);
    assert.equal(pending.status, "pending");
    assert.ok(pending.signature);
    assertBlind(pending);
    assert.ok(mocks.control.sentTransactions.length > 0);
    const revealKey = randomUUID();
    status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/reveal`, undefined, revealKey), 409);
    const hidden = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/chart/bars?timeframe=5m&from=0&to=60`), 200);
    assert.deepEqual(hidden.bars, []);
    mocks.control.confirmed = true;
    const confirmed = status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/receipt/refresh`), 200);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.signature, pending.signature);
    assertBlind(confirmed);
    const reveal = C.Reveal.parse(status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/reveal`, undefined, revealKey), 200));
    assert.equal(reveal.session.status, "revealed");
    assert.equal(reveal.session.chartRange.to, C.timeframeMinutes["1h"]);
    assert.equal(reveal.observedDirection, "higher");
    assert.equal(reveal.referenceClose, candles.find((candle) => candle.closeTimeMs === cutoff).close);
    assert.equal(reveal.horizonClose, candles.at(-1).close);
    assert.deepEqual(status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/reveal`, undefined, revealKey), 200), reveal);
    assert.deepEqual(status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/reveal`), 200), reveal);
    const receipt = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/receipt`), 200);
    assert.equal(verifyCommitment(receipt.proof.payload, receipt.proof.salt, receipt.commitment), true);
    const revealedBars = status(await request(alice.cookie, "GET", `/api/sessions/${session.id}/chart/bars?timeframe=5m&from=0&to=120`), 200);
    assert.equal(revealedBars.bars.at(-1).closeOffsetMinutes, C.timeframeMinutes["1h"]);
    const reflection = { text: "I compared the completed bars." };
    assert.deepEqual(status(await request(alice.cookie, "PUT", `/api/sessions/${session.id}/reflection`, reflection), 200), reflection);
    assert.equal(status(await request(alice.cookie, "POST", `/api/sessions/${session.id}/complete`), 200).status, "completed");
  });

  await t.test("deletion denies reads and removes local artifacts while remote deletion is pending", async () => {
    await app.jobs.syncLearning(alice.userId, session.id);
    assert.ok(mocks.control.memories.length > 0);
    for (const { record } of mocks.control.memories) {
      assert.deepEqual(Object.keys(record).sort(), ["category", "reasonCode", "sourceSessionIds"]);
      assert.deepEqual(record.sourceSessionIds, [session.id]);
    }
    savedRecording = await recording(alice, session, snapshot);
    const download = await request(alice.cookie, "GET", savedRecording.url);
    assert.equal(download.statusCode, 200);
    assert.deepEqual(download.rawPayload, Buffer.from(savedRecording.pcm));
    status(await request(bob.cookie, "GET", savedRecording.url), 404);
    const deletion = C.Deletion.parse(status(await request(alice.cookie, "DELETE", `/api/sessions/${session.id}`), 202));
    assert.equal(deletion.status, "pending");
    assert.equal(deletion.backboard, "pending");
    assert.equal(deletion.localRecords, "deleted");
    assert.equal(deletion.recordings, "deleted");
    for (const url of [`/api/sessions/${session.id}`, `/api/sessions/${session.id}/history`, savedRecording.url]) {
      assert.ok([404, 410].includes((await request(alice.cookie, "GET", url)).statusCode));
    }
    assert.ok([404, 410].includes((await request(alice.cookie, "POST", `/api/sessions/${session.id}/submissions`, submission, submittedKey)).statusCode));
    status(await request(bob.cookie, "GET", `/api/deletions/${deletion.id}`), 404);
    await assert.rejects(stat(savedRecording.path), { code: "ENOENT" });
    const writes = mocks.control.memories.length;
    mocks.control.deletionConfirmed = true;
    await app.jobs.run();
    const completed = C.Deletion.parse(status(await request(alice.cookie, "GET", `/api/deletions/${deletion.id}`), 200));
    assert.equal(completed.status, "completed");
    assert.equal(completed.backboard, "deleted");
    assert.equal(mocks.control.memories.length, writes, "Cleanup cannot recreate deleted learning memories");
    assert.ok(mocks.control.removals.every((removal) => removal.owner.userId === alice.userId));
  });

  await t.test("a revealed five-minute horizon never exposes an incomplete coarser candle", async () => {
    const shortSession = await create(alice, randomUUID(), "5m");
    const shortSnapshot = await context(alice, shortSession);
    status(await request(alice.cookie, "POST", `/api/sessions/${shortSession.id}/submissions`, {
      ...submission, chartSnapshotId: shortSnapshot.id,
    }), 201);
    const receipt = status(await request(alice.cookie, "POST", `/api/sessions/${shortSession.id}/receipt/refresh`), 200);
    assert.equal(receipt.status, "confirmed");
    const reveal = status(await request(alice.cookie, "POST", `/api/sessions/${shortSession.id}/reveal`), 200);
    assert.equal(reveal.session.chartRange.to, C.timeframeMinutes["5m"]);
    for (const timeframe of ["15m", "1h"]) {
      const result = C.Bars.parse(status(await request(alice.cookie, "GET",
        `/api/sessions/${shortSession.id}/chart/bars?timeframe=${timeframe}&from=${shortSession.chartRange.from}&to=60`), 200));
      assert.equal(result.allowedRange.to, C.timeframeMinutes["5m"]);
      assert.ok(result.bars.length > 0);
      assert.equal(result.bars.at(-1).closeOffsetMinutes, 0);
      assert.ok(result.bars.every((bar) => bar.closeOffsetMinutes <= 0));
    }
  });

  await t.test("expiry denies reads and idempotent replay before the cleanup job runs", async () => {
    const createKey = randomUUID();
    const expiring = await create(alice, createKey);
    const expiringSnapshot = await context(alice, expiring);
    const artifact = await recording(alice, expiring, expiringSnapshot);
    now = Date.parse(expiring.expiresAt);
    assert.equal(now - Date.parse(expiring.createdAt), RETENTION_MS);
    for (const url of [`/api/sessions/${expiring.id}`, `/api/sessions/${expiring.id}/history`, artifact.url]) {
      assert.equal(status(await request(alice.cookie, "GET", url), 410).code, "session_expired");
    }
    assert.equal(status(await request(alice.cookie, "POST", "/api/sessions", { timeframe: "5m", predictionHorizon: "1h" }, createKey), 410).code, "session_expired");
    assert.equal(status(await request(alice.cookie, "GET", "/api/sessions"), 200).some((item) => item.id === expiring.id), false);
    await stat(artifact.path);
    await app.jobs.run();
    await assert.rejects(stat(artifact.path), { code: "ENOENT" });
    const row = (await db.query("SELECT public FROM deletions WHERE session_id=$1", [expiring.id])).rows[0];
    const deletion = C.Deletion.parse(status(await request(alice.cookie, "GET", `/api/deletions/${row.public.id}`), 200));
    assert.equal(deletion.status, "completed");
    assert.equal(deletion.backboard, "not_used");
  });
  await t.test("testing bypass permits owned submitted replays without confirming a receipt", async () => {
    assert.equal(isReceiptBypassEnabled({}), false);
    assert.equal(isReceiptBypassEnabled({ NODE_ENV: "production", HACKRICE_BYPASS_RECEIPT: "true" }), false);
    const previous = process.env.HACKRICE_BYPASS_RECEIPT;
    try {
      process.env.HACKRICE_BYPASS_RECEIPT = "false";
      const replay = await create(alice);
      const snap = await context(alice, replay);
      const path = `/api/sessions/${replay.id}`;
      assert.equal(status(await request(undefined, "GET", "/health"), 200).receiptBypassEnabled, false);
      process.env.HACKRICE_BYPASS_RECEIPT = "true";
      assert.equal(status(await request(undefined, "GET", "/health"), 200).receiptBypassEnabled, true);
      status(await request(alice.cookie, "POST", `${path}/reveal`), 409);
      await app.replayService.submit(alice.userId, replay.id, {
        chartSnapshotId: snap.id, thesis: "Testing without a receipt", prediction: "higher",
        hypotheticalAction: "wait", confidencePercent: 50, claimedEvidence: [],
      }, randomUUID());
      process.env.HACKRICE_BYPASS_RECEIPT = "false";
      status(await request(alice.cookie, "POST", `${path}/reveal`), 409);
      process.env.HACKRICE_BYPASS_RECEIPT = "true";
      status(await request(bob.cookie, "POST", `${path}/reveal`), 404);
      const revealed = status(await request(alice.cookie, "POST", `${path}/reveal`), 200);
      assert.equal(revealed.session.status, "revealed");
      assert.equal(status(await request(alice.cookie, "GET", `${path}/receipt`), 200).status, "unavailable");
    } finally {
      if (previous === undefined) delete process.env.HACKRICE_BYPASS_RECEIPT;
      else process.env.HACKRICE_BYPASS_RECEIPT = previous;
    }
  });

});

test("a pinned demo cutoff fixes the chart, and without one it stays random", async (t) => {
  const { ReplayService } = await import("../dist/service.js");
  const { Store } = await import("../dist/store.js");
  const { connectDatabase: connect, migrate: run } = await import("../dist/database.js");

  // Enough history for several eligible cutoffs, so pinning has something to choose between.
  const hours = historyHours + 6;
  const bars = Array.from({ length: (hours + 1) * C.timeframeMinutes["1h"] / C.timeframeMinutes["5m"] }, (_, index) => ({
    openTimeMs: sourceStart + index * C.timeframeMinutes["5m"] * minute,
    closeTimeMs: sourceStart + (index + 1) * C.timeframeMinutes["5m"] * minute,
    open: String(100 + index), high: String(102 + index), low: String(99 + index),
    close: String(101 + index), volume: String(10 + index),
  }));

  const db = await connect({ local: true, localPath: "memory://" });
  t.after(async () => { await db.close(); });
  await run(db);
  // Sessions and idempotency keys reference a real user row.
  const at = new Date(sourceStart).toISOString();
  await db.query(
    'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1,$2,$3,false,$4,$4)',
    ["demo-user", "Demo", "demo@example.test", at],
  );
  const store = new Store(db);
  await store.importDataset({
    candles: bars,
    digest: createHash("sha256").update(JSON.stringify(bars)).digest("hex"),
    source: "Synthetic integration fixture; not market data",
  });

  const open = (service) => service.create("demo-user", { timeframe: "1h", predictionHorizon: "1h" }, randomUUID());

  // Pinned: every session cuts in the same place.
  const pin = sourceStart + (historyHours + 2) * C.timeframeMinutes["1h"] * minute;
  const pinned = new ReplayService(store, pin);
  const first = await open(pinned);
  const second = await open(pinned);
  const cutOf = async (session) => (await store.read("demo-user", session.id)).cutoffTimeMs;
  assert.equal(await cutOf(first), pin);
  assert.equal(await cutOf(second), pin, "the demo chart does not move between runs");

  // Unpinned: the app behaves as it always did. Over many sessions at least one
  // lands somewhere else, which a fixed cutoff could never do.
  const normal = new ReplayService(store);
  const seen = new Set();
  for (let attempt = 0; attempt < 30; attempt++) seen.add(await cutOf(await open(normal)));
  assert.ok(seen.size > 1, "without the flag the cutoff is still chosen at random");

  // An unusable pin falls back rather than breaking session creation.
  const stray = new ReplayService(store, sourceStart + 17 * minute);
  assert.ok(await cutOf(await open(stray)), "a cutoff that is not a candidate still opens a session");
});
