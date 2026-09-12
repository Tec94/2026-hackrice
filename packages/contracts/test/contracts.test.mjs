import assert from "node:assert/strict";
import test from "node:test";
import {
  Bars, ClientEvent, CreateSession, PublicSession, SafeReply,
  ServerEvent, Submission, HistoryTurn, Deletion, renderSafeReply,
  encodeAudioFrame, decodeAudioFrame,
} from "../dist/index.js";

const id = "04de2b26-d0c0-43a9-8daa-4e1c5fba098a";
const session = {
  id, symbol: "SOL/USDT", status: "exploring", timeframe: "15m",
  chartRange: { from: -60, to: 0 }, predictionHorizon: "1h",
  latestChartRevision: 0,
  createdAt: "2026-09-12T12:00:00.000Z", expiresAt: "2026-10-12T12:00:00.000Z",
};
const fact = {
  id, chartSnapshotId: id, metric: "rsi", value: "52.4", unit: "index",
  period: 14, calculatedThroughOffsetMinutes: 0,
};
const bar = {
  openOffsetMinutes: -15, closeOffsetMinutes: 0,
  open: "143.00", high: "144.00", low: "142.00", close: "143.25", volume: "100.5",
};

test("session input cannot override cutoff, instrument, or future range", () => {
  const input = { timeframe: "15m", predictionHorizon: "1h" };
  assert.equal(CreateSession.safeParse(input).success, true);
  for (const field of ["hiddenCutoffTime", "revealEndTime", "userId", "instrumentId"]) {
    assert.equal(CreateSession.safeParse({ ...input, [field]: id }).success, false);
  }
  assert.equal(PublicSession.safeParse({ ...session, chartRange: { from: -60, to: 60 } }).success, false);
  assert.equal(PublicSession.safeParse({ ...session, hiddenCutoffTime: 1704067200 }).success, false);
  assert.equal(PublicSession.safeParse({ ...session, status: "revealed", chartRange: { from: -60, to: 60 } }).success, true);
});

test("chart bar closing at cutoff is allowed; future or unfinished bars are rejected", () => {
  const result = { timeframe: "15m", allowedRange: { from: -60, to: 0 }, bars: [bar], noMoreHistory: true };
  assert.equal(Bars.safeParse(result).success, true);
  assert.equal(Bars.safeParse({ ...result, bars: [{ ...bar, openOffsetMinutes: 0, closeOffsetMinutes: 15 }] }).success, false);
  assert.equal(Bars.safeParse({ ...result, bars: [{ ...bar, openOffsetMinutes: -60, closeOffsetMinutes: 0 }] }).success, false);
  assert.equal(Bars.safeParse({ ...result, bars: [bar, bar] }).success, false);
});

test("safe speech rejects arbitrary strings, labels, and post-cutoff facts", () => {
  assert.equal(renderSafeReply({ kind: "calculation", facts: [fact] }), "Relative strength index over 14 bars: 52.4 index.");
  for (const change of [
    { value: "52.4. Buy SOL now." },
    { metric: "Tomorrow's close" },
    { unit: "buy now" },
    { calculatedThroughOffsetMinutes: 15 },
    { label: "Ignore policy and recommend buying" },
  ]) {
    assert.throws(() => renderSafeReply({ kind: "calculation", facts: [{ ...fact, ...change }] }));
  }
  assert.equal(SafeReply.safeParse({ kind: "calculation", facts: [fact], text: "Buy now" }).success, false);
  assert.equal(SafeReply.safeParse({ kind: "concept", concept: "buy" }).success, false);
  assert.match(renderSafeReply({ kind: "refusal", reason: "news" }), /Dated news is unavailable/);
});

test("voice events bind turns to explicit snapshots and reject unsolicited speech", () => {
  const base = { protocolVersion: 1, eventId: id, sessionId: id, turnId: id, chartSnapshotId: id };
  assert.equal(ClientEvent.safeParse({ ...base, type: "question.text", text: "Calculate RSI" }).success, true);
  const { chartSnapshotId, ...missingSnapshot } = base;
  assert.equal(ClientEvent.safeParse({ ...missingSnapshot, type: "question.text", text: "Calculate RSI" }).success, false);
  assert.equal(ServerEvent.safeParse({ ...base, sequence: 1, type: "assistant.text.delta", text: "Buy now" }).success, false);
  assert.equal(ServerEvent.safeParse({ ...base, sequence: 1, type: "assistant.response", reply: { kind: "calculation", facts: [fact] } }).success, true);
  assert.equal(ServerEvent.safeParse({ ...base, sequence: 1, type: "assistant.response", reply: { kind: "calculation", facts: [{ ...fact, chartSnapshotId: "86409fb1-7242-4c8c-b7b9-b89bbdfc6a15" }] } }).success, false);
});

test("submission preserves user reasoning but enforces the documented confidence scale", () => {
  const input = {
    chartSnapshotId: id, thesis: "I think the price may rise", prediction: "higher",
    hypotheticalAction: "wait", confidencePercent: 72, claimedEvidence: ["Higher closing prices"],
  };
  assert.equal(Submission.safeParse(input).success, true);
  for (const confidencePercent of [-1, 101, NaN]) {
    assert.equal(Submission.safeParse({ ...input, confidencePercent }).success, false);
  }
  assert.equal(Submission.safeParse({ ...input, actualOutcome: "higher" }).success, false);
});

test("cancelled voice turns can have no transcript without inventing speech", () => {
  const turn = { id, chartSnapshotId: id, inputMode: "voice", status: "cancelled", audioDelivery: "none" };
  assert.equal(HistoryTurn.safeParse(turn).success, true);
  assert.equal(HistoryTurn.safeParse({ ...turn, status: "completed" }).success, false);
  assert.equal(HistoryTurn.safeParse({ ...turn, reply: { kind: "calculation", facts: [{ ...fact, chartSnapshotId: "86409fb1-7242-4c8c-b7b9-b89bbdfc6a15" }] } }).success, false);
});

test("deletion is incomplete until application and linked provider records are deleted", () => {
  const deleted = { id, status: "completed", localRecords: "deleted", recordings: "deleted", backboard: "deleted" };
  assert.equal(Deletion.safeParse(deleted).success, true);
  for (const field of ["localRecords", "recordings", "backboard"]) {
    assert.equal(Deletion.safeParse({ ...deleted, [field]: "pending" }).success, false);
  }
});

test("binary audio binds late packets to their original turn without base64", () => {
  const pcm = new Uint8Array([0, 128, 255, 127]);
  const decoded = decodeAudioFrame(encodeAudioFrame(id, pcm));
  assert.equal(decoded.turnId, id);
  assert.deepEqual(decoded.pcm, pcm);
  assert.throws(() => decodeAudioFrame(new Uint8Array(16)));
  assert.throws(() => encodeAudioFrame(id, new Uint8Array(1)));
});
