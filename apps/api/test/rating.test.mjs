import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "decimal.js";
import { Jobs } from "../dist/jobs.js";
import { createAnalysisRater } from "../dist/providers/rater.js";

const minute = 60_000;
const hour = 60 * minute;
const policy = { precision: Decimal.precision, rounding: Decimal.rounding };
const sessionId = "22222222-2222-4222-8222-222222222222";
const snapshot = {
  id: "33333333-3333-4333-8333-333333333333", sessionId, revision: 0, timeframe: "5m",
  visibleRange: { from: -60, to: 0 }, indicators: [], drawings: [],
};
const evaluationId = "44444444-4444-4444-8444-444444444444";
const submissionId = "55555555-5555-4555-8555-555555555555";

function bars(count) {
  const start = hour - count * 5 * minute;
  return Array.from({ length: count }, (_, i) => ({
    openTimeMs: start + i * 5 * minute, closeTimeMs: start + (i + 1) * 5 * minute,
    open: "100", high: String(101 + i), low: "99", close: String(100 + i), volume: "0.1",
  }));
}

function finding(category, status, reasonCode) {
  return { category, status, score: null, factIds: [], reasonCode };
}

/** The evaluator's output for an analysis with one checked claim and nothing written for risk. */
function evaluation() {
  return {
    id: evaluationId, submissionId, status: "completed", rubricVersion: "explicit-comparison-v1",
    formulaVersion: "x", overallScore: null, scoreMeaning: "educational_rubric_not_validated_prediction_probability",
    findings: [
      finding("evidence", "supported", "claim_supported"),
      finding("structure", "not_assessable", "subjective_judgment"),
      finding("confirmation", "not_assessable", "subjective_judgment"),
      finding("invalidation", "not_assessable", "subjective_judgment"),
      finding("risk_reasoning", "insufficient_evidence", "missing_risk_reasoning"),
      finding("confidence_calibration", "not_assessable", "uncalibrated_rubric"),
    ],
  };
}

function state(extra = {}) {
  return {
    public: { id: sessionId }, datasetId: "dataset", cutoffTimeMs: hour, policy,
    snapshots: [snapshot], events: [], evaluations: [evaluation()],
    submissions: [{
      id: submissionId, sessionId, evaluationId, createdAt: new Date(0).toISOString(),
      submission: {
        chartSnapshotId: snapshot.id, thesis: "Higher lows are holding", prediction: "higher",
        hypotheticalAction: "long", confidencePercent: 70, claimedEvidence: ["close > 100"],
        invalidation: "a close below 99",
      },
    }],
    ...extra,
  };
}

const revealed = {
  type: "session.revealed",
  result: { referenceClose: "111", horizonClose: "115", change: "4", percentChange: "3.6", observedDirection: "higher" },
};

function harness(current, rater) {
  const calls = [];
  const service = {
    store: {
      read: async () => current,
      update: async (_userId, _sessionId, fn) => fn(current),
      candles: async () => bars(12),
      now: () => Date.now(),
      db: {},
    },
  };
  const wrapped = rater && {
    enabled: rater.enabled,
    rate: async (request) => { calls.push(request); return rater.rate(request); },
  };
  const jobs = new Jobs(service, { close: async () => {} }, undefined, undefined, () => {}, wrapped);
  return { jobs, calls };
}

const byCategory = (rated) => Object.fromEntries(rated.findings.map((f) => [f.category, f]));

test("rating after submission scores the judged categories from what the learner could see", async () => {
  const current = state();
  const { jobs, calls } = harness(current, {
    enabled: true, rate: async () => ({ thesisScore: 80, invalidationScore: 65, comment: "Name the level." }),
  });
  const rated = await jobs.rate("owner", sessionId, "submission");
  const findings = byCategory(rated);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, "submission");
  assert.equal(calls[0].submission.thesis, "Higher lows are holding");
  // The brief carries the calculator's rendering of the visible chart and nothing about the future.
  assert.ok(calls[0].chart.includes("Closing price: 111 USDT."));
  assert.equal(calls[0].outcome, undefined);

  assert.equal(rated.status, "completed");
  assert.equal(findings.structure.score, 80);
  assert.equal(findings.structure.reasonCode, "model_judgment");
  assert.equal(findings.invalidation.score, 65);
  assert.equal(findings.risk_reasoning.score, null, "nothing written, nothing judged");
  assert.equal(findings.evidence.score, null, "measured claims are never re-judged");
  assert.equal(findings.confirmation.score, null, "outcome categories wait for reveal");
  assert.deepEqual(rated.coachNotes, [{ stage: "submission", text: "Name the level." }]);
  assert.equal(current.events.at(-1).type, "evaluation.updated");
});

test("the outcome is rated only once it exists, only once, and again only when asked", async () => {
  const current = state();
  const { jobs, calls } = harness(current, {
    enabled: true, rate: async () => ({ confirmationScore: 85, calibrationScore: 70, comment: "Right, and sized right." }),
  });

  const early = await jobs.rate("owner", sessionId, "reveal");
  assert.equal(calls.length, 0, "no outcome yet, so nothing to rate against");
  assert.equal(early.status, "completed");

  current.events.push(revealed);
  const rated = await jobs.rate("owner", sessionId, "reveal");
  const findings = byCategory(rated);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].outcome, { referenceClose: "111", horizonClose: "115", percentChange: "3.6", observedDirection: "higher" });
  assert.equal(findings.confirmation.score, 85);
  assert.equal(findings.confirmation.reasonCode, "outcome_judgment");
  assert.equal(findings.confidence_calibration.score, 70);
  assert.equal(findings.structure.score, null, "the outcome does not re-score the reasoning");
  // Weighted by the rubric over what was rated: (15*85 + 10*70) / 25.
  assert.equal(rated.overallScore, 79);

  // The reveal page asks for the reveal on every load; that must not re-rate.
  await jobs.rate("owner", sessionId, "reveal");
  assert.equal(calls.length, 1);
  await jobs.rate("owner", sessionId, "reveal", true);
  assert.equal(calls.length, 2);
  assert.equal(rated.coachNotes.filter((note) => note.stage === "reveal").length, 1, "a re-rating replaces its note");
});

test("a rating that never arrives still releases the placeholder", async () => {
  const current = state();
  current.evaluations[0].status = "processing";
  const { jobs } = harness(current, { enabled: true, rate: async () => null });
  const rated = await jobs.rate("owner", sessionId, "submission");
  assert.equal(rated.status, "completed");
  assert.equal(rated.overallScore, null);
  assert.equal(rated.coachNotes ?? undefined, undefined);
  assert.equal(current.events.at(-1).type, "evaluation.updated", "pages waiting on the rating are told to stop");
});

test("without a configured model nothing is marked pending and nothing is rated", async () => {
  const current = state();
  const { jobs } = harness(current, createAnalysisRater({}));
  await jobs.markRating("owner", sessionId);
  assert.equal(current.evaluations[0].status, "completed");
  const rated = await jobs.rate("owner", sessionId, "submission");
  assert.equal(rated.status, "completed");
  assert.equal(byCategory(rated).structure.score, null);
  assert.equal(current.events.length, 0);
});
