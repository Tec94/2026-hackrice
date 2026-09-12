import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as C from "@hackrice/contracts";
import { buildApp } from "../dist/server.js";
import { connectDatabase, migrate } from "../dist/database.js";
import { Recordings } from "../dist/recordings.js";
import { RETENTION_MS } from "../dist/domain.js";
import { candleDigest } from "../dist/market.js";
import { createBackboardProvider } from "../dist/providers/backboard.js";

const origin = "http://localhost:3000";

function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function heldBackboard(heldOperation) {
  const acknowledgment = gate();
  const entered = gate();
  const cleanupEntered = gate();
  const cleanupAcknowledgment = gate();
  const assistantId = randomUUID();
  const threadId = randomUUID();
  const memories = new Map();
  const writes = [];
  const deletions = [];
  let acknowledgmentReleased = false;
  let threadDeleted = false;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const provider = createBackboardProvider({
    apiKey: "test-only-never-sent-to-a-network",
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      const method = options.method;
      if (method === "POST" && path === "/api/assistants") return json({ assistant_id: assistantId });
      if (method === "POST" && path === `/api/assistants/${assistantId}/memories`) {
        const record = JSON.parse(JSON.parse(options.body).content);
        const id = randomUUID();
        writes.push({ id, record });
        if (heldOperation === "remember" && writes.length === 1) {
          entered.resolve();
          await acknowledgment.promise;
        }
        memories.set(id, record);
        return json({ memory_id: id });
      }
      if (method === "POST" && path === "/api/threads/messages") {
        assert.equal(JSON.parse(options.body).memory, "Readonly");
        entered.resolve();
        await acknowledgment.promise;
        return json({ thread_id: threadId, retrieved_memories: [...memories].map(([id, record]) => ({ id, content: JSON.stringify(record) })) });
      }
      const memoryPrefix = `/api/assistants/${assistantId}/memories/`;
      if (path.startsWith(memoryPrefix)) {
        const id = path.slice(memoryPrefix.length);
        if (method === "DELETE") {
          deletions.push(path);
          if (heldOperation === "remember") {
            cleanupEntered.resolve();
            await cleanupAcknowledgment.promise;
          }
          memories.delete(id);
          return json({ success: true });
        }
        if (method === "GET") return json({}, memories.has(id) ? 200 : 404);
      }
      if (path === `/api/threads/${threadId}`) {
        if (method === "DELETE") {
          deletions.push(path);
          cleanupEntered.resolve();
          await cleanupAcknowledgment.promise;
          threadDeleted = true;
          return json({});
        }
        if (method === "GET") return json({}, threadDeleted ? 404 : 200);
      }
      throw new Error(`Unexpected test HTTP request: ${method} ${path}`);
    },
  });
  return {
    provider, entered: entered.promise, cleanupEntered: cleanupEntered.promise,
    assistantId, threadId, memories, writes, deletions,
    get acknowledgmentReleased() { return acknowledgmentReleased; },
    releaseAcknowledgment() { acknowledgmentReleased = true; acknowledgment.resolve(); },
    releaseCleanup() { cleanupAcknowledgment.resolve(); },
  };
}

async function fixture(t, remote) {
  const db = await connectDatabase({ local: true, localPath: "memory://" });
  const directory = await mkdtemp(join(tmpdir(), "hackrice-retention-"));
  const recordings = new Recordings(directory);
  const now = Date.now();
  const app = await buildApp({ db, recordingsDirectory: directory, baseURL: origin,
    authSecret: "retention-regression-only-not-for-deployment", now: () => now, backboardProvider: remote.provider });
  t.after(async () => {
    remote.releaseAcknowledgment();
    remote.releaseCleanup();
    await app.close();
    await recordings.close();
    await db.close();
    // This absolute directory was allocated solely for this test by mkdtemp.
    await rm(directory, { recursive: true, force: true });
  });
  await migrate(db);
  // The fixture covers configured indicator warmup on 1h bars plus the requested 1h horizon.
  const historyHours = Math.max(...C.demoIndicators.map((indicator) => indicator.period + 1));
  const step = C.timeframeMinutes["5m"] * 60_000;
  const candles = Array.from({ length: (historyHours + 1) * C.timeframeMinutes["1h"] / C.timeframeMinutes["5m"] }, (_, index) => ({
    openTimeMs: Date.UTC(2024, 0, 1) + index * step,
    closeTimeMs: Date.UTC(2024, 0, 1) + (index + 1) * step,
    open: String(100 + index), high: String(102 + index), low: String(99 + index),
    close: String(101 + index), volume: String(10 + index),
  }));
  await app.replayService.store.importDataset({ candles, digest: candleDigest(candles), source: "Synthetic retention test fixture; not market data" });
  let cookie;
  async function request(method, url, payload) {
    return app.inject({ method, url, headers: { origin, ...(cookie ? { cookie } : {}),
      ...(!["GET", "HEAD"].includes(method) ? { "idempotency-key": randomUUID() } : {}) },
      ...(payload === undefined ? {} : { payload }) });
  }
  function body(response, status) {
    assert.equal(response.statusCode, status, response.body);
    return response.json();
  }
  const signedUp = await request("POST", "/api/auth/sign-up/email", {
    name: "Retention", email: "retention@example.test", password: "Retention-test-only-passphrase!",
  });
  const userId = body(signedUp, 200).user.id;
  const cookies = signedUp.headers["set-cookie"];
  assert.ok(cookies);
  cookie = (Array.isArray(cookies) ? cookies : [cookies]).map((value) => value.split(";")[0]).join("; ");

  async function create() {
    const session = body(await request("POST", "/api/sessions", { timeframe: "5m", predictionHorizon: "1h" }), 201);
    const snapshot = body(await request("GET", `/api/sessions/${session.id}/chart-context`), 200);
    // Direct submission leaves provider work under the test's explicit synchronization control.
    await app.replayService.submit(userId, session.id, {
      chartSnapshotId: snapshot.id, thesis: "A synthetic retention exercise", prediction: "higher",
      hypotheticalAction: "wait", confidencePercent: 50, claimedEvidence: ["close > 1"],
      invalidation: "A lower completed close", riskReasoning: "No funds are traded",
    }, randomUUID());
    return { session, snapshot };
  }
  async function record(session, snapshot) {
    const id = randomUUID();
    const turnId = randomUUID();
    const pcm = new Uint8Array([0, 0]); // One complete signed 16-bit PCM sample.
    await recordings.start(id);
    await recordings.append(id, pcm);
    await recordings.finish(id);
    await app.replayService.store.update(userId, session.id, (state) => {
      state.turns.push({ id: turnId, chartSnapshotId: snapshot.id, inputMode: "voice",
        finalTranscript: "Private retention test transcript", status: "completed", audioDelivery: "none" });
      state.recordings.push({ id, turnId, format: { encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1 },
        expiresAt: new Date(now + RETENTION_MS).toISOString() });
    });
    return { id, path: join(directory, `${id}.pcm`), url: `/api/sessions/${session.id}/recordings/${id}`, pcm };
  }
  async function assertErased(sessionId, recording) {
    for (const url of [`/api/sessions/${sessionId}`, `/api/sessions/${sessionId}/history`, ...(recording ? [recording.url] : [])]) {
      assert.equal(body(await request("GET", url), 404).code, "not_found");
    }
    assert.deepEqual((await db.query("SELECT id FROM replay_sessions WHERE user_id=$1 AND id=$2", [userId, sessionId])).rows, []);
    assert.deepEqual((await db.query("SELECT key FROM idempotency WHERE user_id=$1 AND resource_id=$2", [userId, sessionId])).rows, []);
    if (recording) {
      await assert.rejects(stat(recording.path), { code: "ENOENT" });
      await assert.rejects(recordings.read(recording.id), { code: "ENOENT" });
    }
  }
  async function deletionRow(id) {
    return (await db.query("SELECT public,cleanup FROM deletions WHERE user_id=$1 AND id=$2", [userId, id])).rows[0];
  }
  return { db, app, userId, request, body, create, record, assertErased, deletionRow };
}

test("local erasure finishes during an in-flight memory write; its late acknowledgment is cleanup-only", async (t) => {
  const remote = heldBackboard("remember");
  const f = await fixture(t, remote);
  const { session, snapshot } = await f.create();
  const recording = await f.record(session, snapshot);
  const before = await f.app.replayService.store.read(f.userId, session.id);
  assert.ok(before.evaluations.flatMap((evaluation) => evaluation.findings).length > 1,
    "The fixture needs an in-flight finding and an unattempted finding to prove placeholder scope");
  f.body(await f.request("GET", `/api/sessions/${session.id}/history`), 200);
  const audio = await f.request("GET", recording.url);
  assert.equal(audio.statusCode, 200);
  assert.deepEqual(audio.rawPayload, Buffer.from(recording.pcm));

  const syncing = f.app.jobs.syncLearning(f.userId, session.id);
  await remote.entered;
  const deletion = C.Deletion.parse(f.body(await f.request("DELETE", `/api/sessions/${session.id}`), 202));
  assert.equal(remote.acknowledgmentReleased, false, "DELETE must return without the outstanding HTTP acknowledgment");
  assert.deepEqual(deletion, { id: deletion.id, status: "pending", localRecords: "deleted", recordings: "deleted", backboard: "pending" });
  await f.assertErased(session.id, recording);
  const pending = await f.deletionRow(deletion.id);
  assert.equal(pending.cleanup.backboard.links.length, remote.writes.length);
  assert.deepEqual(pending.cleanup.backboard.links[0].memoryIds, []);
  assert.equal(JSON.stringify(pending).includes("Private retention test transcript"), false);

  remote.releaseAcknowledgment();
  await remote.cleanupEntered;
  await syncing;
  const acknowledged = await f.deletionRow(deletion.id);
  const memoryId = remote.writes[0].id;
  assert.deepEqual(acknowledged.cleanup.backboard.links.map((link) => link.memoryIds), [[memoryId]]);
  assert.equal(acknowledged.public.status, "pending");
  assert.equal(remote.writes.length, 1, "Deletion prevents unattempted findings from becoming new remote writes");
  await f.assertErased(session.id, recording);

  remote.releaseCleanup();
  await f.app.jobs.serial(f.userId, async () => {});
  const completed = C.Deletion.parse(f.body(await f.request("GET", `/api/deletions/${deletion.id}`), 200));
  assert.equal(completed.status, "completed");
  assert.equal(completed.backboard, "deleted");
  assert.equal((await f.deletionRow(deletion.id)).cleanup.backboard, null);
  assert.deepEqual(remote.deletions, [`/api/assistants/${remote.assistantId}/memories/${memoryId}`]);
  assert.equal(remote.memories.has(memoryId), false);
  await f.assertErased(session.id, recording);
});

test("a late shared retrieval acknowledgment tracks every source while deletion preserves the surviving session", async (t) => {
  const remote = heldBackboard("retrieve");
  const f = await fixture(t, remote);
  const removed = await f.create();
  const surviving = await f.create();
  await f.app.jobs.syncLearning(f.userId, removed.session.id);
  await f.app.jobs.syncLearning(f.userId, surviving.session.id);
  const survivorHistory = f.body(await f.request("GET", `/api/sessions/${surviving.session.id}/history`), 200);
  const survivingMemoryIds = remote.writes.filter(({ record }) => record.sourceSessionIds.includes(surviving.session.id)).map(({ id }) => id);
  assert.ok(survivingMemoryIds.length > 0);

  const retrieving = f.app.jobs.learning(f.userId, surviving.session.id);
  await remote.entered;
  for (const { session } of [removed, surviving]) {
    const state = await f.app.replayService.store.read(f.userId, session.id);
    const placeholder = state.backboard.links.at(-1);
    assert.deepEqual(placeholder.sourceSessionIds, [session.id]);
    assert.deepEqual(placeholder.threadIds, []);
    assert.deepEqual(placeholder.memoryIds, []);
    assert.equal(placeholder.status, "pending", "Every possible source is tracked before retrieval is acknowledged");
  }
  const deletion = C.Deletion.parse(f.body(await f.request("DELETE", `/api/sessions/${removed.session.id}`), 202));
  assert.equal(remote.acknowledgmentReleased, false);
  assert.equal(deletion.localRecords, "deleted");
  await f.assertErased(removed.session.id);
  assert.deepEqual(f.body(await f.request("GET", `/api/sessions/${surviving.session.id}/history`), 200), survivorHistory);

  remote.releaseAcknowledgment();
  const learning = C.Learning.parse(await retrieving);
  assert.equal(learning.status, "completed");
  assert.ok(learning.records.length > 0);
  assert.ok(learning.records.every((record) => record.sourceSessionIds.every((id) => id === surviving.session.id)),
    "A late retrieval response cannot return records from the deleted source");
  await remote.cleanupEntered;
  const cleanup = (await f.deletionRow(deletion.id)).cleanup.backboard;
  const removedLink = cleanup.links.find((link) => link.threadIds.includes(remote.threadId));
  assert.ok(removedLink, "The deleted source's late thread ID is durable in cleanup");
  assert.deepEqual(removedLink.sourceSessionIds, [removed.session.id]);
  const survivor = await f.app.replayService.store.read(f.userId, surviving.session.id);
  const survivingLink = survivor.backboard.links.find((link) => link.threadIds.includes(remote.threadId));
  assert.ok(survivingLink, "The same retrieval thread retains the surviving source's provenance");
  assert.deepEqual(survivingLink.sourceSessionIds, [surviving.session.id]);
  assert.ok(survivingMemoryIds.every((id) => remote.memories.has(id)));
  await f.assertErased(removed.session.id);

  remote.releaseCleanup();
  await f.app.jobs.serial(f.userId, async () => {});
  const completed = C.Deletion.parse(f.body(await f.request("GET", `/api/deletions/${deletion.id}`), 200));
  assert.equal(completed.status, "completed");
  assert.equal(completed.backboard, "deleted");
  assert.equal((await f.deletionRow(deletion.id)).cleanup.backboard, null);
  assert.ok(remote.deletions.includes(`/api/threads/${remote.threadId}`));
  assert.ok(survivingMemoryIds.every((id) => remote.memories.has(id)));
  assert.ok(survivingMemoryIds.every((id) => !remote.deletions.includes(`/api/assistants/${remote.assistantId}/memories/${id}`)));
  assert.deepEqual(f.body(await f.request("GET", `/api/sessions/${surviving.session.id}/history`), 200), survivorHistory);
  await f.assertErased(removed.session.id);
});
