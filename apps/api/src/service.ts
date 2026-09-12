import { randomInt, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";
import * as C from "@hackrice/contracts";
import { aggregateCandles, indicatorSeries, toPublicCandles, answerQuestion, evaluateSubmission } from "./market.js";
import { createCommitment, createSubmissionSalt, receiptAllowsReveal } from "./providers/solana.js";
import { Store } from "./store.js";
import { appendEvent, fail, RETENTION_MS, type State } from "./domain.js";
import type { Queryable } from "./database.js";

const minute = 60_000;
const hour = C.timeframeMinutes["1h"] * minute;
export const decimalPolicy = { precision: Decimal.precision, rounding: Decimal.rounding };

export class ReplayService {
  constructor(public store: Store) {}

  async create(userId: string, input: z.infer<typeof C.CreateSession>, key: string) {
    return this.store.mutate(userId, "create", key, input, undefined, async (tx) => {
      const datasets = (await tx.query("SELECT id FROM datasets ORDER BY id")).rows;
      const candidates: { datasetId: string; cutoffTimeMs: number; startTimeMs: number }[] = [];
      for (const dataset of datasets) {
        const candles = await this.store.candles(dataset.id, tx);
        if (!candles.length) continue;
        for (let cutoff = Math.ceil(candles[0]!.openTimeMs / hour) * hour; cutoff + C.timeframeMinutes[input.predictionHorizon] * minute <= candles.at(-1)!.closeTimeMs; cutoff += hour) {
          const hourly = aggregateCandles(candles, "1h", cutoff);
          if (C.demoIndicators.every((indicator) => indicatorSeries(hourly, indicator, decimalPolicy).at(-1)?.value != null))
            candidates.push({ datasetId: dataset.id, cutoffTimeMs: cutoff, startTimeMs: candles[0]!.openTimeMs });
        }
      }
      if (!candidates.length) return fail("insufficient_data", 409);
      const candidate = candidates[randomInt(candidates.length)]!;
      const now = this.store.now();
      const session = C.PublicSession.parse({
        id: randomUUID(), symbol: "SOL/USDT", status: "exploring", timeframe: input.timeframe,
        chartRange: { from: (candidate.startTimeMs - candidate.cutoffTimeMs) / minute, to: 0 },
        predictionHorizon: input.predictionHorizon, latestChartRevision: 0,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + RETENTION_MS).toISOString(),
      });
      const snapshot = C.ChartSnapshot.parse({ id: randomUUID(), sessionId: session.id, revision: 0,
        timeframe: input.timeframe, visibleRange: session.chartRange, indicators: [...C.demoIndicators], drawings: [] });
      const state: State = { public: session, datasetId: candidate.datasetId, cutoffTimeMs: candidate.cutoffTimeMs,
        policy: decimalPolicy, snapshots: [snapshot], turns: [], submissions: [], evaluations: [],
        facts: [], recordings: [], events: [], clientCommands: [] };
      await tx.query("INSERT INTO replay_sessions(id,user_id,state,expires_at) VALUES($1,$2,$3,$4)", [session.id, userId, JSON.stringify(state), new Date(session.expiresAt)]);
      return session;
    });
  }

  async list(userId: string) {
    const result = await this.store.db.query("SELECT state FROM replay_sessions WHERE user_id=$1 AND deleting=false AND expires_at>$2 ORDER BY state->'public'->>'createdAt' DESC", [userId, new Date(this.store.now())]);
    return result.rows.map((r) => C.PublicSession.parse(r.state.public));
  }

  snapshot(state: State, id?: string) {
    const snapshot = id ? state.snapshots.find((s) => s.id === id) : state.snapshots.at(-1);
    if (!snapshot) return fail("not_found", 404);
    return snapshot;
  }

  assertBlind(state: State) {
    if (!["exploring", "submitted"].includes(state.public.status)) fail("state_conflict", 409);
  }

  async updateChart(userId: string, sessionId: string, body: z.infer<typeof C.ChartContextInput>, key: string) {
    return this.store.mutate(userId, "context", key, body, sessionId, async (tx) => {
      const state = await this.store.read(userId, sessionId, tx);
      this.assertBlind(state);
      if (body.expectedRevision !== state.public.latestChartRevision) return fail("revision_conflict", 409);
      if (body.visibleRange.from < state.public.chartRange.from) return fail("invalid_request");
      const candles = aggregateCandles(await this.store.candles(state.datasetId, tx), body.timeframe, state.cutoffTimeMs);
      const allowed = new Set(candles.map((c) => (c.openTimeMs - state.cutoffTimeMs) / minute));
      if (body.selectedCandleOffsetMinutes !== undefined &&
        (!allowed.has(body.selectedCandleOffsetMinutes) || body.selectedCandleOffsetMinutes < body.visibleRange.from || body.selectedCandleOffsetMinutes >= body.visibleRange.to)) return fail("invalid_request");
      if (new Set(body.drawings.map((d) => d.id)).size !== body.drawings.length) return fail("invalid_request");
      for (const drawing of body.drawings) if (drawing.type === "trendline" &&
        (!allowed.has(drawing.start.offsetMinutes) || !allowed.has(drawing.end.offsetMinutes))) return fail("invalid_request");
      const { expectedRevision, ...context } = body;
      const snapshot = C.ChartSnapshot.parse({ ...context, id: randomUUID(), sessionId,
        revision: expectedRevision + 1 });
      state.snapshots.push(snapshot);
      state.public.timeframe = snapshot.timeframe;
      state.public.latestChartRevision = snapshot.revision;
      appendEvent(state, { type: "chart.context.updated", snapshot });
      await this.store.save(tx, state);
      return snapshot;
    });
  }

  async bars(userId: string, sessionId: string, query: z.infer<typeof C.BarsQuery>) {
    const state = await this.store.read(userId, sessionId);
    const horizon = ["revealed", "completed"].includes(state.public.status) ? C.timeframeMinutes[state.public.predictionHorizon] : 0;
    // Aggregate with the immutable hour cutoff first. Revealed data is aggregated
    // separately using the same base rows so a 5m horizon cannot expose a full hour.
    const source = await this.store.candles(state.datasetId);
    const completeHorizon = Math.floor(horizon / C.timeframeMinutes[query.timeframe]) * C.timeframeMinutes[query.timeframe];
    const visible = source.filter((c) => c.closeTimeMs <= state.cutoffTimeMs + completeHorizon * minute);
    const all = aggregateCandles(visible, query.timeframe, Math.ceil((state.cutoffTimeMs + horizon * minute) / hour) * hour);
    const bars = toPublicCandles(all, state.cutoffTimeMs).filter((c) => c.openOffsetMinutes >= query.from && c.closeOffsetMinutes <= Math.min(query.to, horizon));
    return C.Bars.parse({ timeframe: query.timeframe, allowedRange: { from: state.public.chartRange.from, to: horizon }, bars, noMoreHistory: query.from <= state.public.chartRange.from });
  }

  async indicatorValues(userId: string, sessionId: string, snapshotId: string) {
    const state = await this.store.read(userId, sessionId);
    const snapshot = this.snapshot(state, snapshotId);
    const candles = aggregateCandles(await this.store.candles(state.datasetId), snapshot.timeframe, state.cutoffTimeMs);
    return snapshot.indicators.map((indicator) => ({ indicator,
      values: indicatorSeries(candles, indicator, state.policy).map((point) => ({ offsetMinutes: (point.openTimeMs - state.cutoffTimeMs) / minute, value: point.value })) }));
  }

  async calculate(userId: string, sessionId: string, snapshotId: string, text: string) {
    const state = await this.store.read(userId, sessionId);
    this.assertBlind(state);
    return C.SafeReply.parse(answerQuestion({ text, snapshot: this.snapshot(state, snapshotId),
      candles: await this.store.candles(state.datasetId), cutoffTimeMs: state.cutoffTimeMs, decimalPolicy: state.policy }));
  }

  async question(userId: string, sessionId: string, body: z.infer<typeof C.Question>, key: string, turnId: string = randomUUID()) {
    return this.store.mutate(userId, "question", key, body, sessionId, async (tx) => {
      const state = await this.store.read(userId, sessionId, tx);
      this.assertBlind(state);
      const snapshot = this.snapshot(state, body.chartSnapshotId);
      const reply = C.SafeReply.parse(answerQuestion({ text: body.text, snapshot,
        candles: await this.store.candles(state.datasetId, tx), cutoffTimeMs: state.cutoffTimeMs, decimalPolicy: state.policy }));
      if (state.turns.some((t) => t.id === turnId)) return fail("idempotency_conflict", 409);
      state.turns.push({ id: turnId, chartSnapshotId: snapshot.id, inputMode: "text", finalTranscript: body.text, reply, status: "completed", audioDelivery: "none" });
      if (reply.kind === "calculation") state.facts.push(...reply.facts);
      appendEvent(state, { type: "voice.transcript.final", turnId, chartSnapshotId: snapshot.id, text: body.text });
      appendEvent(state, { type: "assistant.response", turnId, chartSnapshotId: snapshot.id, reply });
      appendEvent(state, { type: "assistant.completed", turnId, delivery: "none" });
      await this.store.save(tx, state);
      return C.AcceptedQuestion.parse({ turnId, chartSnapshotId: snapshot.id });
    });
  }

  async submit(userId: string, sessionId: string, body: z.infer<typeof C.Submission>, key: string) {
    return this.store.mutate(userId, "submit", key, body, sessionId, async (tx) => {
      const state = await this.store.read(userId, sessionId, tx);
      if (state.public.status !== "exploring") return fail("state_conflict", 409);
      const snapshot = this.snapshot(state, body.chartSnapshotId);
      const recorded = C.RecordedSubmission.parse({ id: randomUUID(), sessionId, evaluationId: randomUUID(), submission: body, createdAt: new Date(this.store.now()).toISOString() });
      const { evaluation, facts } = evaluateSubmission({ id: recorded.evaluationId, submissionId: recorded.id,
        submission: body, snapshot, candles: await this.store.candles(state.datasetId, tx),
        cutoffTimeMs: state.cutoffTimeMs, decimalPolicy: state.policy });
      state.submissions.push(recorded);
      state.evaluations.push(C.Evaluation.parse(evaluation));
      state.facts.push(...facts);
      state.public.status = "submitted";
      const payload = { version: 1, sessionId, submissionId: recorded.id, submission: body, datasetDigest: state.datasetId,
        cutoffTimeMs: state.cutoffTimeMs, predictionHorizon: state.public.predictionHorizon };
      const salt = createSubmissionSalt();
      state.commitment = { salt, hash: createCommitment(payload, salt), payload };
      state.receipt = { network: "devnet", commitment: state.commitment.hash, status: "unavailable", errorCode: "not_configured" };
      appendEvent(state, { type: "evaluation.updated", evaluation });
      await this.store.save(tx, state);
      return recorded;
    });
  }

  async reveal(userId: string, sessionId: string, key: string) {
    return this.store.mutate(userId, "reveal", key, {}, sessionId, async (tx) => {
      const state = await this.store.read(userId, sessionId, tx);
      if (["revealed", "completed"].includes(state.public.status)) {
        const previous = state.events.find(event => event.type === "session.revealed");
        if (previous?.type === "session.revealed") return C.Reveal.parse({ ...previous.result, session: state.public });
      }
      if (state.public.status !== "submitted" || !receiptAllowsReveal(state.receipt) || state.receipt?.commitment !== state.commitment?.hash) return fail("state_conflict", 409);
      const candles = await this.store.candles(state.datasetId, tx);
      const reference = candles.find((c) => c.closeTimeMs === state.cutoffTimeMs);
      const horizon = candles.find((c) => c.closeTimeMs === state.cutoffTimeMs + C.timeframeMinutes[state.public.predictionHorizon] * minute);
      if (!reference || !horizon) return fail("insufficient_data", 409);
      const D = Decimal.clone(state.policy);
      const difference = new D(horizon.close).minus(reference.close);
      state.public.status = "revealed";
      state.public.chartRange.to = C.timeframeMinutes[state.public.predictionHorizon];
      const result = C.Reveal.parse({ session: state.public, referenceClose: reference.close, horizonClose: horizon.close,
        change: difference.toFixed(), percentChange: difference.div(reference.close).times(100).toFixed(),
        observedDirection: difference.isZero() ? "unchanged" : difference.isPositive() ? "higher" : "lower" });
      appendEvent(state, { type: "session.revealed", result });
      await this.store.save(tx, state);
      return result;
    });
  }

  async transition(userId: string, sessionId: string, key: string, action: "complete" | "reflection", body: unknown) {
    return this.store.mutate(userId, action, key, body, sessionId, async (tx) => {
      const state = await this.store.read(userId, sessionId, tx);
      if (!["revealed", "completed"].includes(state.public.status)) return fail("state_conflict", 409);
      if (action === "reflection") state.reflection = C.Reflection.parse(body);
      else state.public.status = "completed";
      await this.store.save(tx, state);
      return action === "reflection" ? state.reflection! : state.public;
    });
  }

  async history(userId: string, sessionId: string) {
    const state = await this.store.read(userId, sessionId);
    return C.History.parse({ session: state.public, turns: state.turns, submissions: state.submissions,
      evaluations: state.evaluations, recordings: state.recordings, ...(state.reflection ? { reflection: state.reflection } : {}) });
  }

  async receipt(userId: string, sessionId: string) {
    const state = await this.store.read(userId, sessionId);
    if (!state.commitment) return fail("state_conflict", 409);
    const result = { status: state.receipt?.status ?? "unavailable", commitment: state.commitment.hash,
      signature: state.receipt?.signature, cluster: "devnet" };
    return ["revealed", "completed"].includes(state.public.status) ? { ...result, proof: state.commitment } : result;
  }

  async deletion(userId: string, id: string) {
    const row = (await this.store.db.query("SELECT public FROM deletions WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    if (!row) return fail("not_found", 404);
    return C.Deletion.parse(row.public);
  }

  async startDeletion(userId: string, sessionId: string) {
    return this.store.db.transaction(async (tx) => {
      const previous = (await tx.query("SELECT public FROM deletions WHERE session_id=$1 AND user_id=$2", [sessionId, userId])).rows[0];
      if (previous) return C.Deletion.parse(previous.public);
      const row = (await tx.query("SELECT state FROM replay_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE", [sessionId, userId])).rows[0];
      if (!row) return fail("not_found", 404);
      const state = row.state as State;
      const result = C.Deletion.parse({ id: randomUUID(), status: "pending", localRecords: "pending", recordings: "pending", backboard: state.backboard ? "pending" : "not_used" });
      const cleanup = { recordings: state.recordings.map((r) => r.id), backboard: state.backboard ?? null };
      await tx.query("INSERT INTO deletions(id,user_id,session_id,public,cleanup) VALUES($1,$2,$3,$4,$5)", [result.id, userId, sessionId, JSON.stringify(result), JSON.stringify(cleanup)]);
      await tx.query("UPDATE replay_sessions SET deleting=true WHERE id=$1", [sessionId]);
      return result;
    });
  }
}
