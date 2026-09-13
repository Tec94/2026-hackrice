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
  return (
    <div className="space-y-4">
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
        {[
          ["Evidence", `${assessable} assessable · ${supported} supported`],
          ["Structure", submission.thesis ? "Thesis present" : "Missing"],
          ["Confirmation", "Not assessed by this rubric"],
          [
            "Invalidation",
            submission.invalidation ? "Present · not judged" : "Missing",
          ],
          [
            "Risk reasoning",
            submission.riskReasoning ? "Present · not judged" : "Missing",
          ],
          ["Confidence calibration", "Not assessed from one session"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-4 border-b border-line/35 py-3 text-tiny last:border-0"
          >
            <dt>{label}</dt>
            <dd
              className={
                value === "Missing" ? "text-replay-300" : "text-ink-muted"
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
