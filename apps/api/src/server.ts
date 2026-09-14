import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import * as C from "@hackrice/contracts";
import type { Database } from "./database.js";
import { createAuth } from "./auth.js";
import { Store } from "./store.js";
import { ReplayService } from "./service.js";
import { Recordings, type RecordingStore } from "./recordings.js";
import { Realtime } from "./realtime.js";
import { Jobs } from "./jobs.js";
import { ApiFailure, fail, type State } from "./domain.js";
import type { VoiceConfig } from "./providers/voice.js";
import type { SolanaReceiptProvider } from "./providers/solana.js";
import type { createBackboardProvider } from "./providers/backboard.js";
import type { AnalysisRater } from "./providers/rater.js";

export type AppOptions = { db: Database; service?: ReplayService; recordingsDirectory: string; recordings?: RecordingStore; baseURL: string;
  authSecret: string; voiceConfig?: VoiceConfig; solanaProvider?: SolanaReceiptProvider; demoCutoffTimeMs?: number;
  backboardProvider?: ReturnType<typeof createBackboardProvider>; rater?: AnalysisRater; now?: () => number };

declare module "fastify" {
  interface FastifyInstance { replayService: ReplayService; jobs: Jobs; realtime: Realtime }
}

function headers(input: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) for (const item of value) result.append(name, item);
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  const service = options.service ?? new ReplayService(new Store(options.db, options.now), options.demoCutoffTimeMs);
  const auth = createAuth(options.db, options.baseURL, options.authSecret);
  const recordings = options.recordings ?? new Recordings(options.recordingsDirectory);
  // 16kHz linear PCM is Deepgram's documented default sample rate, explicitly negotiated in each session.
  const realtime = new Realtime(service, recordings, { encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1 }, options.voiceConfig);
  const jobs = new Jobs(service, recordings, options.solanaProvider, options.backboardProvider, (id) => realtime.cancelSession(id), options.rater);
  const origin = new URL(options.baseURL).origin;
  const users = new WeakMap<FastifyRequest, string>();
  const user = (request: FastifyRequest) => users.get(request) ?? fail("unauthenticated", 401);
  const sid = (request: FastifyRequest) => C.Id.parse((request.params as any).sessionId);
  const key = (request: FastifyRequest) => C.Id.parse(request.headers["idempotency-key"]);
  const changed = async (request: FastifyRequest) => realtime.broadcast(user(request), sid(request));
  const authenticated = async (input: Record<string, string | string[] | undefined>) => {
    const session = await auth.api.getSession({ headers: headers(input) });
    if (!session) return fail("unauthenticated", 401);
    return session.user.id;
  };

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const path = request.url.split("?")[0]!;
    if (!path.startsWith("/api/") || path.startsWith("/api/auth/")) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== origin) fail("invalid_request", 403);
    users.set(request, await authenticated(request.headers));
  });
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiFailure;
    const invalid = error instanceof z.ZodError || (error as any).statusCode === 400;
    reply.code(known ? error.status : invalid ? 400 : 500).send(C.ApiError.parse({
      code: known ? error.code : invalid ? "invalid_request" : "provider_unavailable", requestId: request.id,
    }));
  });
  app.get("/health", async () => ({
    status: "ok",
    databaseMode: options.db.mode,
    voiceEnabled: !!options.voiceConfig?.playbackValidated,
    receiptBypassEnabled: service.receiptBypassEnabled,
    ...(options.demoCutoffTimeMs === undefined
      ? {}
      : { demoCutoff: new Date(options.demoCutoffTimeMs).toISOString() }),
  }));
  app.route({ method: ["GET", "POST"], url: "/api/auth/*", handler: async (request, reply) => {
    const result = await auth.handler(new Request(new URL(request.url, options.baseURL), {
      method: request.method, headers: headers(request.headers),
      ...(["GET", "HEAD"].includes(request.method) ? {} : { body: JSON.stringify(request.body) }),
    }));
    reply.code(result.status);
    result.headers.forEach((value, name) => { if (name !== "set-cookie") reply.header(name, value); });
    const cookies = result.headers.getSetCookie();
    if (cookies.length) reply.header("Set-Cookie", cookies);
    return reply.send(await result.text());
  } });
  app.post("/internal/think", async (request, reply) => {
    const result = await realtime.provider.handleThink(request.headers.authorization, request.body);
    return reply.code(result.statusCode).type(result.contentType).send(result.body);
  });

  app.post("/api/sessions", async (r, reply) => {
    const result = await service.create(user(r), C.CreateSession.parse(r.body), key(r));
    await jobs.scheduleExpiry(); reply.code(201); return result;
  });
  app.get("/api/sessions", (r) => service.list(user(r)));
  app.put("/api/sessions/:sessionId/archive", (r) => {
    const body = C.httpContracts.setArchived.body.parse(r.body);
    return service.setArchived(user(r), sid(r), body.archived, key(r));
  });
  app.get("/api/sessions/:sessionId", async (r) => C.PublicSession.parse((await service.store.read(user(r), sid(r))).public));
  app.get("/api/sessions/:sessionId/chart-context", async (r) => {
    const query = z.strictObject({ chartSnapshotId: C.Id.optional() }).parse(r.query);
    return service.snapshot(await service.store.read(user(r), sid(r)), query.chartSnapshotId);
  });
  app.patch("/api/sessions/:sessionId/chart-context", async (r) => {
    const result = await service.updateChart(user(r), sid(r), C.ChartContextInput.parse(r.body), key(r));
    await changed(r); return result;
  });
  app.get("/api/sessions/:sessionId/chart/bars", (r) => {
    const query = z.strictObject({ timeframe: C.Timeframe, from: z.coerce.number().int(), to: z.coerce.number().int() }).parse(r.query);
    return service.bars(user(r), sid(r), C.BarsQuery.parse(query));
  });
  app.get("/api/sessions/:sessionId/chart/indicators", async (r) => {
    const query = z.strictObject({ chartSnapshotId: C.Id }).parse(r.query);
    return C.IndicatorValues.parse(await service.indicatorValues(user(r), sid(r), query.chartSnapshotId));
  });
  app.post("/api/sessions/:sessionId/questions", async (r, reply) => {
    const result = await service.question(user(r), sid(r), C.Question.parse(r.body), key(r));
    await changed(r); reply.code(202); return result;
  });
  app.post("/api/sessions/:sessionId/submissions", async (r, reply) => {
    const result = await service.submit(user(r), sid(r), C.Submission.parse(r.body), key(r));
    realtime.cancelSession(sid(r));
    await changed(r);
    // Receipt/memory work is durable and explicitly refreshable; no timer polling or hidden retry budget.
    // Tell the open page when the receipt lands, the same way the rating does.
    // Without this the reveal button stays locked until the learner reloads,
    // even though the confirmation arrived seconds after they submitted.
    void jobs.receipt(user(r), sid(r))
      .then(() => changed(r))
      .then(() => jobs.syncLearning(user(r), sid(r)))
      .then(() => changed(r))
      .catch(() => {});
    // The coach's rating is likewise durable and refreshable. The placeholder is
    // set before responding so the feedback page knows to wait for it.
    await jobs.markRating(user(r), sid(r));
    void jobs.rate(user(r), sid(r), "submission").then(() => changed(r)).catch(() => {});
    reply.code(201); return result;
  });
  app.get("/api/evaluations/:evaluationId", async (r) => {
    const id = C.Id.parse((r.params as any).evaluationId);
    const rows = (await options.db.query("SELECT id,state FROM replay_sessions WHERE user_id=$1 AND deleting=false AND expires_at>$2", [user(r), new Date(service.store.now())])).rows;
    for (const row of rows) {
      const evaluation = (row.state as State).evaluations.find((e) => e.id === id);
      if (evaluation) return C.Evaluation.parse(evaluation);
    }
    return fail("not_found", 404);
  });
  app.get("/api/sessions/:sessionId/receipt", async (r) => C.Receipt.parse(await service.receipt(user(r), sid(r))));
  app.post("/api/sessions/:sessionId/receipt/refresh", async (r) => {
    await jobs.receipt(user(r), sid(r)); return C.Receipt.parse(await service.receipt(user(r), sid(r)));
  });
  app.post("/api/sessions/:sessionId/learning", async (r) => C.Learning.parse(await jobs.learning(user(r), sid(r))));
  app.post("/api/sessions/:sessionId/reveal", async (r) => {
    const result = await service.reveal(user(r), sid(r), key(r));
    realtime.cancelSession(sid(r)); await changed(r);
    void jobs.rate(user(r), sid(r), "reveal").then(() => changed(r)).catch(() => {});
    return result;
  });
  app.post("/api/sessions/:sessionId/rating", async (r) => {
    const revealed = (await service.store.read(user(r), sid(r))).events.some((event) => event.type === "session.revealed");
    const evaluation = await jobs.rate(user(r), sid(r), revealed ? "reveal" : "submission", true);
    if (!evaluation) return fail("state_conflict", 409);
    await changed(r);
    return C.Evaluation.parse(evaluation);
  });
  app.put("/api/sessions/:sessionId/reflection", (r) => service.transition(user(r), sid(r), key(r), "reflection", C.Reflection.parse(r.body)));
  app.post("/api/sessions/:sessionId/complete", (r) => service.transition(user(r), sid(r), key(r), "complete", {}));
  app.get("/api/sessions/:sessionId/history", (r) => service.history(user(r), sid(r)));
  app.get("/api/sessions/:sessionId/recordings/:recordingId", async (r, reply) => {
    const state = await service.store.read(user(r), sid(r));
    const id = C.Id.parse((r.params as any).recordingId);
    if (!state.recordings.some((item) => item.id === id && Date.parse(item.expiresAt) > service.store.now())) return fail("not_found", 404);
    return reply.type("application/octet-stream").send(await recordings.read(id));
  });
  app.delete("/api/sessions/:sessionId", async (r, reply) => { reply.code(202); return jobs.deleteSession(user(r), sid(r)); });
  app.get("/api/deletions/:deletionId", (r) => service.deletion(user(r), C.Id.parse((r.params as any).deletionId)));

  app.server.on("upgrade", (request, socket, head) => {
    void (async () => {
      if (request.headers.origin !== origin) return fail("invalid_request", 403);
      const url = new URL(request.url!, options.baseURL);
      const match = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
      if (!match) return fail("not_found", 404);
      const sessionId = C.Id.parse(match[1]);
      const userId = await authenticated(request.headers);
      await service.store.read(userId, sessionId);
      realtime.wss.handleUpgrade(request, socket, head, (ws) => {
        void realtime.attach(ws, userId, sessionId).catch(() => ws.terminate());
      });
    })().catch((error) => {
      const status = error instanceof ApiFailure ? error.status : 400;
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    });
  });
  app.addHook("onClose", async () => { await realtime.close(); await jobs.close(); });
  return Object.assign(app, { replayService: service, jobs, realtime });
}
