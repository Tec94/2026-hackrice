import type {
  AnalysisEvaluation,
  AnalysisSubmission,
} from "@hackrice/contracts";
import type { z } from "zod";
import type { Fact } from "@hackrice/contracts";
import type { CSSProperties } from "react";
const statusText = {
  supported: "Supported",
  contradicted: "Contradicted",
  not_assessable: "Not assessable",
  insufficient_evidence: "Insufficient data",
};
/** The reasoning, judged blind at submission. */
const RUBRIC = [
  ["evidence", "Evidence"],
  ["structure", "Thesis"],
  ["confirmation", "Confirmation"],
  ["invalidation", "Invalidation"],
  ["risk_reasoning", "Risk reasoning"],
  ["confidence_calibration", "Confidence calibration"],
] as const;

/** The call itself, judged once the outcome is known. Shown only then. */
const OUTCOME_RUBRIC = [
  ["thesis_outcome", "Thesis vs outcome"],
  ["choice_quality", "Prediction and action"],
  ["confidence_fit", "Confidence level"],
] as const;

export function FeedbackPanel({
  evaluation,
  submission,
  facts = [],
}: {
  evaluation: AnalysisEvaluation;
  submission: AnalysisSubmission;
  facts?: z.infer<typeof Fact>[];
}) {
  const evidence = evaluation.findings.filter((f) => f.category === "evidence");
  const supported = evidence.filter((f) => f.status === "supported").length;
  const assessable = evidence.filter((f) =>
    ["supported", "contradicted"].includes(f.status),
  ).length;
  // A blank field reads as missing rather than unrated, which the learner can act on.
  const written: Partial<Record<string, boolean>> = {
    structure: Boolean(submission.thesis),
    invalidation: Boolean(submission.invalidation),
    risk_reasoning: Boolean(submission.riskReasoning),
  };
  const notes = evaluation.coachNotes ?? [];
  // The outcome rows stay hidden until the reveal has actually rated them.
  const outcomeRated = OUTCOME_RUBRIC.some(([category]) =>
    typeof evaluation.findings.find((f) => f.category === category)?.score === "number",
  );
  return (
    <div className="space-y-4">
      {typeof evaluation.overallScore === "number" && (
        <div className="surface-inset flex items-baseline justify-between gap-4 rounded-xl px-3 py-3">
          <span className="text-tiny text-ink-muted">Overall</span>
          <span className="nums text-lead font-semibold text-ink">{evaluation.overallScore} / 100</span>
        </div>
      )}
      <div className="space-y-2">
        {evidence.map((finding, i) => (
          <article
            className="finding stagger-item"
            key={i}
            style={{ "--i": i } as CSSProperties}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words font-mono text-tiny">
                {submission.claimedEvidence[i] ?? "No evidence claims supplied"}
              </p>
              <span
                className={`shrink-0 text-micro ${finding.status === "supported" ? "text-bull" : finding.status === "contradicted" ? "text-bear" : "text-ink-muted"}`}
              >
                {statusText[finding.status]}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="nums text-tiny text-ink-muted">
                {finding.factIds
                  .map((id) => facts.find((f) => f.id === id))
                  .filter(Boolean)
                  .map(
                    (f) =>
                      `${Number(f!.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${f!.unit}`,
                  )
                  .join(" vs ") ||
                  (finding.status === "not_assessable"
                    ? "Prose or an unsupported comparison is not scored"
                    : "No computable comparison")}
              </p>
              <code className="text-[9px] text-ink-faint">
                {finding.reasonCode.toUpperCase()}
              </code>
            </div>
          </article>
        ))}
      </div>
      <dl className="surface-inset space-y-0 rounded-xl px-3">
        {RUBRIC.map(([category, label]) => {
          const finding = evaluation.findings.find((f) => f.category === category);
          const score = category === "evidence"
            ? (assessable ? `${supported} of ${assessable} supported` : "No assessable claims")
            : typeof finding?.score === "number"
              ? `${finding.score} / 100`
              : written[category] === false
                ? "Missing"
                : "Not yet rated";
          return (
            <div
              key={category}
              className="flex justify-between gap-4 border-b border-line/35 py-3 text-tiny last:border-0"
            >
              <dt>{label}</dt>
              <dd className={score === "Missing" ? "text-replay-300" : "text-ink-muted"}>
                {score}
              </dd>
            </div>
          );
        })}
      </dl>
      {outcomeRated && (
        <div>
          <p className="mb-2 text-micro uppercase tracking-wide text-ink-faint">
            Judged against what the price did
          </p>
          <dl className="surface-inset space-y-0 rounded-xl px-3">
            {OUTCOME_RUBRIC.map(([category, label]) => {
              const finding = evaluation.findings.find((f) => f.category === category);
              return (
                <div
                  key={category}
                  className="flex justify-between gap-4 border-b border-line/35 py-3 text-tiny last:border-0"
                >
                  <dt>{label}</dt>
                  <dd className="text-ink-muted">
                    {typeof finding?.score === "number" ? `${finding.score} / 100` : "Not yet rated"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note) => (
            <article key={note.stage} className="surface-inset rounded-xl px-3 py-3">
              <p className="text-micro uppercase tracking-wide text-ink-faint">
                {note.stage === "reveal" ? "After the outcome" : "On the reasoning"}
              </p>
              <p className="mt-1 text-tiny text-ink-muted">{note.text}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
