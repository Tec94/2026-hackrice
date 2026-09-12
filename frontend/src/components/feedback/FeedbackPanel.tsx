import type { AnalysisEvaluation } from "@hackrice/contracts";
import { Button, Card } from "@/components/ui";

type Finding = AnalysisEvaluation["findings"][number];

/** What each reason code means to the person reading it. */
const REASON: Partial<Record<Finding["reasonCode"], string>> = {
  claim_supported: "Claim supported by the candles",
  claim_contradicted: "Claim contradicted by the candles",
  missing_comparison: "No numeric claim to check",
  missing_invalidation: "Nothing written",
  missing_risk_reasoning: "Nothing written",
  insufficient_data: "Not enough chart data to check",
  subjective_judgment: "A judgement call; the coach can rate it",
  uncalibrated_rubric: "Rated only after the reveal",
  model_judgment: "Rated by the coach",
  outcome_judgment: "Rated against the outcome",
};

const STAGE_TITLE = { submission: "On your reasoning", reveal: "Against the outcome" } as const;

export function FeedbackPanel({ evaluation, pending = false, rating = false, onRate }: {
  evaluation: AnalysisEvaluation;
  /** The coach is still rating; the page is polling for the result. */
  pending?: boolean;
  /** A rating was requested by the button below and has not returned yet. */
  rating?: boolean;
  onRate?: () => void;
}) {
  const coachRated = evaluation.findings.some((finding) => finding.reasonCode === "model_judgment");
  return <div className="space-y-3">
    <Card title="How this is scored">
      <p className="text-base text-ink-muted">Numeric evidence claims are checked against the candles and are never re-judged. Thesis, invalidation, and risk are rated by the coach from what was on the chart; confirmation and confidence only after the reveal. None of this is a prediction probability.</p>
      {pending && <p role="status" className="mt-2 text-base text-coach">Coach is rating your reasoning…</p>}
      {!pending && onRate && <div className="mt-3"><Button disabled={rating} onClick={onRate}>{rating ? "Rating…" : coachRated ? "Ask the coach to rate again" : "Ask the coach to rate this"}</Button></div>}
    </Card>
    {evaluation.coachNotes?.length ? <Card title="Coach's notes">
      <div className="space-y-3">
        {evaluation.coachNotes.map((note) => <div key={note.stage}>
          <p className="text-tiny uppercase tracking-wide text-ink-faint">{STAGE_TITLE[note.stage]}</p>
          <p className="mt-1 text-base leading-relaxed text-ink">{note.text}</p>
        </div>)}
      </div>
    </Card> : null}
    {evaluation.findings.map((finding, i) => <Card key={`${finding.category}-${i}`} title={finding.category.replaceAll("_", " ")}>
      <p className="text-base text-ink">{finding.status.replaceAll("_", " ")}</p>
      <p className="mt-2 text-tiny text-ink-muted">{REASON[finding.reasonCode] ?? finding.reasonCode.replaceAll("_", " ")}</p>
      <p className="mt-2 text-tiny text-ink-faint">{finding.score === null ? "Not scored" : `${finding.score} / 100`}</p>
    </Card>)}
  </div>;
}
