import { z } from "zod";

export const Id = z.uuid();
export const Text = z.string().trim().min(1);
export const Decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const NonnegativeDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const Timeframe = z.enum(["5m", "15m", "1h"]);
export const timeframeMinutes = { "5m": 5, "15m": 15, "1h": 60 } as const;
export const Revision = z.number().int().nonnegative();
export const Offset = z.number().int();
export const PastOffset = Offset.max(0);
export const Percentage = z.number().min(0).max(100);
export const Range = z.strictObject({ from: Offset, to: Offset })
  .refine((r) => r.from < r.to, "Range must be nonempty and half-open.");
export const VisibleRange = z.strictObject({ from: PastOffset, to: PastOffset })
  .refine((r) => r.from < r.to, "Range must be nonempty and half-open.");

export const Indicator = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("ema"), period: z.number().int().positive() }),
  z.strictObject({ name: z.literal("rsi"), period: z.number().int().positive() }),
  z.strictObject({ name: z.literal("relative_volume"), period: z.number().int().positive() }),
]);
// TradingView's published EMA/RSI defaults and ordinary relative-volume definition; see backend-design.md.
export const demoIndicators = [
  { name: "ema", period: 9 },
  { name: "rsi", period: 14 },
  { name: "relative_volume", period: 10 },
] as const;
export const Anchor = z.strictObject({ offsetMinutes: PastOffset, price: NonnegativeDecimal });
export const Drawing = z.discriminatedUnion("type", [
  z.strictObject({ id: Id, type: z.literal("horizontal_line"), price: NonnegativeDecimal, label: Text.optional() }),
  z.strictObject({ id: Id, type: z.literal("trendline"), start: Anchor, end: Anchor, label: Text.optional() })
    .refine((d) => d.start.offsetMinutes !== d.end.offsetMinutes, "Trendline anchors need different times."),
]);
export const ChartContextInput = z.strictObject({
  expectedRevision: Revision,
  timeframe: Timeframe,
  visibleRange: VisibleRange,
  selectedCandleOffsetMinutes: PastOffset.optional(),
  indicators: z.array(Indicator),
  drawings: z.array(Drawing),
});
export const ChartSnapshot = z.strictObject({
  id: Id,
  sessionId: Id,
  revision: Revision,
  timeframe: Timeframe,
  visibleRange: VisibleRange,
  selectedCandleOffsetMinutes: PastOffset.optional(),
  indicators: z.array(Indicator),
  drawings: z.array(Drawing),
});
export const SessionStatus = z.enum(["exploring", "submitted", "revealed", "completed"]);
export const PublicSession = z.strictObject({
  id: Id,
  symbol: z.literal("SOL/USDT"),
  status: SessionStatus,
  timeframe: Timeframe,
  chartRange: Range,
  predictionHorizon: Timeframe,
  latestChartRevision: Revision,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
}).refine((s) => ["revealed", "completed"].includes(s.status) || s.chartRange.to <= 0,
  "Future range is unavailable before reveal.");
export const CreateSession = z.strictObject({
  timeframe: Timeframe,
  predictionHorizon: Timeframe,
});
export const Candle = z.strictObject({
  openOffsetMinutes: Offset,
  closeOffsetMinutes: Offset,
  open: NonnegativeDecimal,
  high: NonnegativeDecimal,
  low: NonnegativeDecimal,
  close: NonnegativeDecimal,
  volume: NonnegativeDecimal,
}).refine((c) => c.openOffsetMinutes < c.closeOffsetMinutes, "Candle must have positive duration.");
export const BarsQuery = z.strictObject({ timeframe: Timeframe, from: Offset, to: Offset })
  .refine((r) => r.from < r.to, "Range must be nonempty and half-open.");
export const Bars = z.strictObject({
  timeframe: Timeframe,
  allowedRange: Range,
  bars: z.array(Candle),
  noMoreHistory: z.boolean(),
}).refine((result) => result.bars.every((bar, i, bars) =>
  bar.openOffsetMinutes >= result.allowedRange.from &&
  bar.closeOffsetMinutes <= result.allowedRange.to &&
  bar.closeOffsetMinutes - bar.openOffsetMinutes === timeframeMinutes[result.timeframe] &&
  bar.openOffsetMinutes % timeframeMinutes[result.timeframe] === 0 &&
  (i === 0 || bars[i - 1]!.closeOffsetMinutes === bar.openOffsetMinutes)),
  "Bars must be ordered, consecutive, aligned, and wholly inside the allowed range.");

export const Question = z.strictObject({ chartSnapshotId: Id, text: Text });
export const AcceptedQuestion = z.strictObject({ turnId: Id, chartSnapshotId: Id });
export const Prediction = z.enum(["higher", "lower", "unchanged"]);
export const Submission = z.strictObject({
  chartSnapshotId: Id,
  thesis: Text,
  prediction: Prediction,
  hypotheticalAction: z.enum(["long", "short", "wait"]),
  confidencePercent: Percentage,
  claimedEvidence: z.array(Text),
  invalidation: Text.optional(),
  riskReasoning: Text.optional(),
});
/**
 * A spoken analysis, as understood so far.
 *
 * Every field is optional because someone talking through a chart supplies
 * them in whatever order they think of them. Nothing here is submitted; it
 * populates the form the learner reviews and commits themselves.
 */
export const SubmissionDraft = z.strictObject({
  thesis: Text.optional(),
  prediction: Prediction.optional(),
  hypotheticalAction: z.enum(["long", "short", "wait"]).optional(),
  confidencePercent: Percentage.optional(),
  claimedEvidence: z.array(Text).optional(),
  invalidation: Text.optional(),
  riskReasoning: Text.optional(),
});

/**
 * The coach's read of the parts of an analysis that arithmetic cannot settle.
 *
 * Scores are a model's opinion, kept apart from the computed findings and
 * never allowed to change whether an evidence claim held up.
 */
/** Before the reveal the coach rates reasoning; after it, the call against the outcome. */
export const RatingStage = z.enum(["submission", "reveal"]);
export const AnalysisRating = z.strictObject({
  thesisScore: Percentage.optional(),
  invalidationScore: Percentage.optional(),
  riskScore: Percentage.optional(),
  confirmationScore: Percentage.optional(),
  calibrationScore: Percentage.optional(),
  comment: Text.optional(),
});

export const RecordedSubmission = z.strictObject({
  id: Id,
  sessionId: Id,
  evaluationId: Id,
  submission: Submission,
  createdAt: z.iso.datetime(),
});
export const EvidenceStatus = z.enum(["supported", "contradicted", "insufficient_evidence", "not_assessable"]);
export const RubricCategory = z.enum([
  "evidence", "structure", "confirmation", "invalidation", "risk_reasoning", "confidence_calibration",
]);
export const rubricWeights = {
  evidence: 25, structure: 20, confirmation: 15,
  invalidation: 15, risk_reasoning: 15, confidence_calibration: 10,
} as const;
export const EvaluationFinding = z.strictObject({
  category: RubricCategory,
  status: EvidenceStatus,
  score: Percentage.nullable(),
  factIds: z.array(Id),
  reasonCode: z.enum([
    "claim_supported", "claim_contradicted", "missing_comparison", "missing_invalidation",
    "missing_risk_reasoning", "insufficient_data", "subjective_judgment", "uncalibrated_rubric",
    "model_judgment", "outcome_judgment",
  ]),
});
export const Evaluation = z.strictObject({
  id: Id,
  submissionId: Id,
  status: z.enum(["queued", "processing", "completed", "failed"]),
  rubricVersion: Text,
  formulaVersion: Text,
  overallScore: Percentage.nullable(),
  findings: z.array(EvaluationFinding),
  scoreMeaning: z.literal("educational_rubric_not_validated_prediction_probability"),
  /** The coach's sentence for each stage it has rated, kept apart from the findings. */
  coachNotes: z.array(z.strictObject({ stage: RatingStage, text: Text })).optional(),
});
export const Metric = z.enum([
  "open", "high", "low", "close", "volume", "price_change", "percent_change",
  "ema", "rsi", "relative_volume", "visible_high", "visible_low", "distance_to_drawing",
]);
export const Fact = z.strictObject({
  id: Id,
  chartSnapshotId: Id,
  metric: Metric,
  value: Decimal,
  unit: z.enum(["USDT", "SOL", "percent", "ratio", "index"]),
  period: z.number().int().positive().optional(),
  calculatedThroughOffsetMinutes: PastOffset,
});
export const SafeReply = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("calculation"), facts: z.array(Fact).min(1) }),
  z.strictObject({ kind: z.literal("concept"), concept: z.enum(["ema", "rsi", "relative_volume", "invalidation"]) }),
  z.strictObject({ kind: z.literal("refusal"), reason: z.enum(["advice", "future", "news", "unsupported", "insufficient_data"]) }),
]);
const metricLabels: Record<z.infer<typeof Metric>, string> = {
  open: "Opening price", high: "High price", low: "Low price", close: "Closing price",
  volume: "Volume", price_change: "Price change", percent_change: "Percentage change",
  ema: "Exponential moving average", rsi: "Relative strength index",
  relative_volume: "Relative volume", visible_high: "Visible high", visible_low: "Visible low",
  distance_to_drawing: "Distance to the drawing",
};
const conceptText = {
  ema: "An exponential moving average gives more weight to recent closing prices.",
  rsi: "The relative strength index compares smoothed gains and losses in closing prices.",
  relative_volume: "Relative volume divides a completed candle's volume by the mean volume of the preceding comparison candles.",
  invalidation: "An invalidation condition describes an observation that would contradict your stated thesis.",
};
const refusalText = {
  advice: "I can calculate values from the visible chart. You choose your own conclusion and hypothetical action.",
  future: "Future candles are unavailable before reveal. I can calculate values from the visible chart.",
  news: "Dated news is unavailable during a blind replay.",
  unsupported: "I can answer supported calculation and chart-concept questions. Please name the calculation you want.",
  insufficient_data: "The available completed candles are insufficient for that calculation.",
};

/** Render only validated template inputs. The backend still verifies every fact against the frozen snapshot. */
export function renderSafeReply(input: unknown): string {
  const reply = SafeReply.parse(input);
  if (reply.kind === "concept") return conceptText[reply.concept];
  if (reply.kind === "refusal") return refusalText[reply.reason];
  return reply.facts.map((fact) => `${metricLabels[fact.metric]}${fact.period ? ` over ${fact.period} bars` : ""}: ${fact.value} ${fact.unit}.`).join(" ");
}

export const ErrorCode = z.enum([
  "unauthenticated", "not_found", "invalid_request", "revision_conflict", "state_conflict",
  "idempotency_conflict", "future_data_forbidden", "insufficient_data", "provider_unavailable",
  "session_expired", "deletion_pending", "resync_required",
]);
export const ApiError = z.strictObject({ code: ErrorCode, requestId: Id });
export const Deletion = z.strictObject({
  id: Id,
  status: z.enum(["pending", "completed", "failed"]),
  localRecords: z.enum(["pending", "deleted"]),
  recordings: z.enum(["pending", "deleted"]),
  backboard: z.enum(["not_used", "pending", "deleted"]),
}).refine((d) => d.status !== "completed" ||
  (d.localRecords === "deleted" && d.recordings === "deleted" && d.backboard !== "pending"),
  "Deletion cannot complete while a tracked copy remains pending.");
export const Reflection = z.strictObject({ text: Text });
export const AudioFormat = z.strictObject({
  encoding: z.literal("pcm_s16le"), sampleRateHz: z.number().int().positive(), channels: z.literal(1),
});
export const Recording = z.strictObject({ id: Id, turnId: Id, format: AudioFormat, expiresAt: z.iso.datetime() });
export const HistoryTurn = z.strictObject({
  id: Id,
  chartSnapshotId: Id,
  inputMode: z.enum(["voice", "text"]),
  finalTranscript: Text.optional(),
  reply: SafeReply.optional(),
  status: z.enum(["completed", "cancelled", "failed"]),
  audioDelivery: z.enum(["none", "partial", "completed"]),
}).refine((t) => t.status !== "completed" || t.finalTranscript !== undefined,
  "Completed turns require a final transcript.")
  .refine((t) => t.reply?.kind !== "calculation" ||
    t.reply.facts.every((fact) => fact.chartSnapshotId === t.chartSnapshotId),
    "History facts must reference the turn's frozen chart snapshot.");
export const History = z.strictObject({
  session: PublicSession, turns: z.array(HistoryTurn), submissions: z.array(RecordedSubmission),
  evaluations: z.array(Evaluation), recordings: z.array(Recording), reflection: Reflection.optional(),
});
export const Reveal = z.strictObject({
  session: PublicSession.refine((s) => ["revealed", "completed"].includes(s.status), "Reveal requires an authorized revealed session."),
  referenceClose: NonnegativeDecimal,
  horizonClose: NonnegativeDecimal,
  change: Decimal,
  percentChange: Decimal,
  observedDirection: Prediction,
});

const clientBase = { protocolVersion: z.literal(1), eventId: Id, sessionId: Id };
const turnBase = { turnId: Id, chartSnapshotId: Id };
export const ClientEvent = z.discriminatedUnion("type", [
  z.strictObject({ ...clientBase, type: z.literal("session.resume"), afterSequence: Revision }),
  z.strictObject({ ...clientBase, type: z.literal("voice.start"), ...turnBase, format: AudioFormat }),
  z.strictObject({ ...clientBase, type: z.literal("voice.stop"), turnId: Id }),
  z.strictObject({ ...clientBase, type: z.literal("voice.cancel"), turnId: Id }),
  z.strictObject({ ...clientBase, type: z.literal("question.text"), ...turnBase, text: Text }),
  z.strictObject({ ...clientBase, type: z.literal("assistant.interrupt"), turnId: Id }),
  z.strictObject({ ...clientBase, type: z.literal("assistant.playback.completed"), turnId: Id }),
]);
const serverBase = { protocolVersion: z.literal(1), eventId: Id, sessionId: Id, sequence: Revision };
export const ServerEvent = z.discriminatedUnion("type", [
  z.strictObject({ ...serverBase, type: z.literal("session.ready"), session: PublicSession, inputFormat: AudioFormat, outputFormat: AudioFormat }),
  z.strictObject({ ...serverBase, type: z.literal("voice.ready"), turnId: Id, format: AudioFormat }),
  z.strictObject({ ...serverBase, type: z.literal("chart.context.updated"), snapshot: ChartSnapshot }),
  z.strictObject({ ...serverBase, type: z.literal("voice.transcript.final"), ...turnBase, text: Text }),
  z.strictObject({ ...serverBase, type: z.literal("assistant.processing"), ...turnBase }),
  z.strictObject({ ...serverBase, type: z.literal("assistant.response"), ...turnBase, reply: SafeReply }),
  z.strictObject({ ...serverBase, type: z.literal("assistant.audio.start"), turnId: Id, format: AudioFormat }),
  z.strictObject({ ...serverBase, type: z.literal("assistant.completed"), turnId: Id, delivery: z.enum(["none", "partial", "completed"]) }),
  z.strictObject({ ...serverBase, type: z.literal("assistant.cancelled"), turnId: Id }),
  z.strictObject({ ...serverBase, type: z.literal("analysis.draft"), draft: SubmissionDraft }),
  z.strictObject({ ...serverBase, type: z.literal("evaluation.updated"), evaluation: Evaluation }),
  z.strictObject({ ...serverBase, type: z.literal("session.revealed"), result: Reveal }),
  z.strictObject({ ...serverBase, type: z.literal("session.error"), error: ApiError, turnId: Id.optional() }),
]).refine((event) => event.type !== "assistant.response" || event.reply.kind !== "calculation" ||
  event.reply.facts.every((fact) => fact.chartSnapshotId === event.chartSnapshotId),
  "Reply facts must reference the turn's frozen chart snapshot.");

/** Binary WebSocket payload: RFC 9562 UUID bytes for the turn, then mono signed 16-bit little-endian PCM. */
export function encodeAudioFrame(turnId: string, pcm: Uint8Array): Uint8Array {
  const hex = Id.parse(turnId).replaceAll("-", "");
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) throw new Error("PCM requires complete 16-bit samples.");
  const frame = new Uint8Array(16 + pcm.byteLength);
  for (let i = 0; i < 16; i++) frame[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  frame.set(pcm, 16);
  return frame;
}

export function decodeAudioFrame(frame: Uint8Array): { turnId: string; pcm: Uint8Array } {
  if (frame.byteLength <= 16 || (frame.byteLength - 16) % 2 !== 0) throw new Error("Audio frame requires a turn UUID and complete PCM samples.");
  const hex = Array.from(frame.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const turnId = Id.parse(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  return { turnId, pcm: frame.subarray(16) };
}

export const IndicatorValues = z.array(z.strictObject({ indicator: Indicator,
  values: z.array(z.strictObject({ offsetMinutes: PastOffset, value: Decimal.nullable() })) }));
export const Receipt = z.strictObject({
  status: z.enum(["unavailable", "pending", "sent", "confirmed", "failed"]),
  commitment: z.string().regex(/^[0-9a-f]{64}$/), signature: Text.optional(), cluster: z.literal("devnet"),
  proof: z.strictObject({ salt: z.string().regex(/^[0-9a-f]{64}$/), hash: z.string().regex(/^[0-9a-f]{64}$/),
    payload: z.strictObject({ version: z.literal(1), sessionId: Id, submissionId: Id, submission: Submission,
      datasetDigest: z.string().regex(/^[0-9a-f]{64}$/), cutoffTimeMs: z.number().int(), predictionHorizon: Timeframe }) }).optional(),
});
export const Learning = z.strictObject({ status: z.enum(["completed", "pending", "unavailable", "failed"]),
  records: z.array(z.strictObject({ sourceSessionIds: z.array(Id), category: RubricCategory, reasonCode: EvaluationFinding.shape.reasonCode })) });

export const httpContracts = {
  createSession: { method: "POST", path: "/api/sessions", body: CreateSession, response: PublicSession },
  listSessions: { method: "GET", path: "/api/sessions", response: z.array(PublicSession) },
  getSession: { method: "GET", path: "/api/sessions/:sessionId", response: PublicSession },
  updateChartContext: { method: "PATCH", path: "/api/sessions/:sessionId/chart-context", body: ChartContextInput, response: ChartSnapshot },
  getChartContext: { method: "GET", path: "/api/sessions/:sessionId/chart-context", response: ChartSnapshot },
  getBars: { method: "GET", path: "/api/sessions/:sessionId/chart/bars", query: BarsQuery, response: Bars },
  askQuestion: { method: "POST", path: "/api/sessions/:sessionId/questions", body: Question, response: AcceptedQuestion },
  submitAnalysis: { method: "POST", path: "/api/sessions/:sessionId/submissions", body: Submission, response: RecordedSubmission },
  getEvaluation: { method: "GET", path: "/api/evaluations/:evaluationId", response: Evaluation },
  rateAnalysis: { method: "POST", path: "/api/sessions/:sessionId/rating", response: Evaluation },
  reveal: { method: "POST", path: "/api/sessions/:sessionId/reveal", response: Reveal },
  reflect: { method: "PUT", path: "/api/sessions/:sessionId/reflection", body: Reflection, response: Reflection },
  complete: { method: "POST", path: "/api/sessions/:sessionId/complete", response: PublicSession },
  getHistory: { method: "GET", path: "/api/sessions/:sessionId/history", response: History },
  deleteSession: { method: "DELETE", path: "/api/sessions/:sessionId", response: Deletion },
  getDeletion: { method: "GET", path: "/api/deletions/:deletionId", response: Deletion },
  getIndicators: { method: "GET", path: "/api/sessions/:sessionId/chart/indicators", query: z.strictObject({ chartSnapshotId: Id }), response: IndicatorValues },
  getReceipt: { method: "GET", path: "/api/sessions/:sessionId/receipt", response: Receipt },
  refreshReceipt: { method: "POST", path: "/api/sessions/:sessionId/receipt/refresh", response: Receipt },
  getLearning: { method: "POST", path: "/api/sessions/:sessionId/learning", response: Learning },
} as const;

export type Session = z.infer<typeof PublicSession>;
export type ChartContext = z.infer<typeof ChartSnapshot>;
export type AnalysisSubmission = z.infer<typeof Submission>;
export type AnalysisDraft = z.infer<typeof SubmissionDraft>;
export type AnalysisEvaluation = z.infer<typeof Evaluation>;
export type AnalysisCoachRating = z.infer<typeof AnalysisRating>;
export type CoachRatingStage = z.infer<typeof RatingStage>;
export type ClientMessage = z.infer<typeof ClientEvent>;
export type ServerMessage = z.infer<typeof ServerEvent>;
export type HttpOperation = keyof typeof httpContracts;
