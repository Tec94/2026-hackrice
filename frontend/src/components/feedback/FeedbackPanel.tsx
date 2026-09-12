import type { AnalysisEvaluation } from "@hackrice/contracts";
import { Card } from "@/components/ui";

export function FeedbackPanel({ evaluation }: { evaluation: AnalysisEvaluation }) {
  return <div className="space-y-3">
    <Card title="Evidence review"><p className="text-base text-ink-muted">Only explicit numerical comparisons are checked. Unassessable claims remain unscored; this is not a prediction probability.</p></Card>
    {evaluation.findings.map((finding, i) => <Card key={`${finding.category}-${i}`} title={finding.category.replaceAll("_", " ")}>
      <p className="text-base text-ink">{finding.status.replaceAll("_", " ")}</p>
      <p className="mt-2 text-tiny text-ink-muted">{finding.reasonCode.replaceAll("_", " ")}</p>
      <p className="mt-2 text-tiny text-ink-faint">{finding.score === null ? "Not scored" : `${finding.score} / 100`}</p>
    </Card>)}
  </div>;
}
