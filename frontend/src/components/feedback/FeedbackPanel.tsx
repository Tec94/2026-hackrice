import { Check, Circle, TriangleAlert } from "lucide-react";
import { Card, ProgressBar } from "@/components/ui";


interface RubricScore {
  key: string;
  label: string;
  score: number;
  max: number;
  comment: string;
}

const RUBRIC: RubricScore[] = [
  { key: "evidence", label: "Evidence quality", score: 19, max: 25, comment: "You cited three observations drawn from the visible range." },
  { key: "reasoning", label: "Reasoning structure", score: 21, max: 25, comment: "The thesis connects those observations to a conclusion." },
  { key: "invalidation", label: "Invalidation clarity", score: 22, max: 25, comment: "You defined a level that would prove the thesis wrong." },
  { key: "risk", label: "Risk reasoning", score: 12, max: 25, comment: "Risk was acknowledged but not quantified." },
];

const STRENGTHS = [
  "The thesis is specific enough to be evaluated.",
  "Multiple independent observations were cited.",
  "An explicit invalidation level was stated.",
];

const WEAKNESSES = [
  "Stated confidence runs ahead of the evidence presented.",
  "Volume behaviour was described but not compared to the visible average.",
];

const MISSING = [
  "Where the current range sits relative to the prior consolidation.",
  "Whether the most recent candles show expanding or contracting range.",
];

function List({
  items,
  Icon,
  tone,
}: {
  items: string[];
  Icon: typeof Check;
  tone: string;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-base leading-relaxed text-ink-muted">
          <Icon size={14} strokeWidth={2} className={`mt-1 shrink-0 ${tone}`} aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function FeedbackPanel() {
  return (
    <div className="space-y-3">
      <Card title="Summary">
        <p className="text-base leading-relaxed text-ink-muted">
          Your analysis is assessed on reasoning quality only. Whether the prediction turns out
          correct is reported separately and does not change this score.
        </p>
      </Card>

      <Card title="Rubric">
        <div className="space-y-4">
          {RUBRIC.map((r) => (
            <div key={r.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-base font-medium text-ink">{r.label}</span>
                <span className="nums text-tiny text-ink-faint">
                  {r.score}
                  <span className="text-ink-faint">/{r.max}</span>
                </span>
              </div>
              <ProgressBar
                value={r.score}
                max={r.max}
                label={r.label}
                tone={r.score / r.max < 0.6 ? "replay" : "accent"}
              />
              <p className="mt-1.5 text-tiny leading-relaxed text-ink-faint">{r.comment}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Strengths">
        <List items={STRENGTHS} Icon={Check} tone="text-bull" />
      </Card>

      <Card title="Weak points">
        <List items={WEAKNESSES} Icon={TriangleAlert} tone="text-replay-400" />
      </Card>

      <Card title="Missing evidence">
        <List items={MISSING} Icon={Circle} tone="text-ink-faint" />
      </Card>

      <Card title="Confidence calibration">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p className="text-micro text-ink-faint">You stated</p>
            <p className="nums mt-0.5 text-title font-semibold text-ink">80%</p>
          </div>
          <div className="h-8 w-px bg-line" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-micro text-ink-faint">Evidence supports</p>
            <p className="nums mt-0.5 text-title font-semibold text-replay-300">65%</p>
          </div>
        </div>
        <p className="mt-3 text-tiny leading-relaxed text-ink-muted">
          You were more confident than the cited evidence supports. Calibration improves when
          confidence tracks the evidence you can actually point to.
        </p>
      </Card>

      <Card title="Coaching question" className="ring-1 ring-inset ring-accent-500/25">
        <p className="text-base leading-relaxed text-ink">
          If your invalidation level were reached, what would that tell you about the assumption
          behind the thesis?
        </p>
      </Card>

      <p className="px-1 text-micro text-ink-faint">
        Educational feedback on reasoning quality. Not trade advice.
      </p>
    </div>
  );
}
