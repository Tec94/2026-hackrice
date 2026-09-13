import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { ChartIllustration } from "@/components/landing/ChartIllustration";
import { MarketPicker } from "@/components/landing/MarketPicker";
import { Logo } from "@/components/brand/Logo";
import { FaqItem } from "@/components/landing/FaqItem";
const steps = [
  [
    "The future is hidden",
    "A random cutoff, aligned to the hour. The server never sends what comes after it until your analysis is committed and the receipt is confirmed.",
  ],
  [
    "You explain your reasoning",
    "Indicators, drawings, a coach that answers with verified numbers. Then a thesis, a call, and your evidence.",
  ],
  [
    "Claims are checked, then revealed",
    "Explicit numerical claims are recomputed before the outcome shows. Being right is not the same as reasoning well.",
  ],
];
const questions = [
  [
    "Is this real market data?",
    "Replays use imported historical SOL/USDT candles from Binance spot. The chart above is an illustration; session charts use the stored market data.",
  ],
  [
    "What does the Solana receipt prove?",
    "It records a salted hash of your committed analysis on devnet before reveal. It proves the commitment, not that your reasoning or prediction was correct.",
  ],
  [
    "Why isn’t my reasoning given a score?",
    "Numerical evidence is checked against the frozen chart. Other writing is described, not presented as a validated overall score or prediction probability.",
  ],
  [
    "How long are sessions kept?",
    "Sessions expire 30 days after creation. Archiving hides a session from your main record and is reversible until expiry. Archiving does not extend the expiry date.",
  ],
];
export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen">
      <AppHeader landing />
      <main>
        <section className="page-shell section-space grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="stagger-item">
            <p className="eyebrow">Historical replay · hidden outcome</p>
            <h1 className="mt-6 text-display font-semibold leading-[1.08] tracking-[-.035em] sm:text-hero">
              Learn to read a chart.
              <br />
              <span className="text-ink-muted">Not to guess one.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lead leading-relaxed text-ink-muted">
              A real SOL/USDT chart is cut off at a point you don’t get to
              choose. Study what’s visible, explain your reasoning, and only
              then see what happened. Your evidence is checked; your prediction
              isn’t graded.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                className="button-primary motion-control inline-flex min-h-touch items-center rounded-xl px-5"
                href="#markets"
              >
                Start a replay
              </Link>
              <Link
                className="button-ghost motion-control inline-flex min-h-touch items-center rounded-xl px-4"
                href="#coach"
              >
                See how the coach answers
              </Link>
            </div>
            <p className="mt-5 text-tiny text-ink-faint">
              Not a broker. Not live prices. No financial advice.
            </p>
          </div>
          <ChartIllustration />
        </section>
        <section
          id="how"
          className="page-shell grid scroll-mt-6 gap-4 sm:grid-cols-3"
        >
          {steps.map(([title, body], i) => (
            <article
              key={title}
              className="surface stagger-item rounded-2xl p-5"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="icon-well mb-4">{i + 1}</span>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-tiny leading-relaxed text-ink-muted">
                {body}
              </p>
            </article>
          ))}
        </section>
        <section id="markets" className="page-shell section-space scroll-mt-4">
          <div className="mb-5 flex flex-wrap items-baseline gap-3">
            <h2 className="text-title font-semibold">Pick a market</h2>
            <p className="text-tiny text-ink-muted">
              Each replay is a fresh 15-minute chart with a one-hour horizon
            </p>
          </div>
          <MarketPicker />
        </section>
        <section className="border-t border-line/50">
          <div className="page-shell section-space grid gap-14 lg:grid-cols-2">
            <div id="coach">
              <h2 className="text-title font-semibold">
                A coach that refuses to guess
              </h2>
              <div className="mt-5 max-w-lg space-y-3">
                <p className="question-bubble">
                  What’s the visible high and low?
                </p>
                <div className="flex gap-2">
                  <span className="fact-chip">
                    High <strong>143.85</strong>
                  </span>
                  <span className="fact-chip">
                    Low <strong>138.20</strong>
                  </span>
                </div>
                <p className="question-bubble">Should I go long here?</p>
                <span className="fact-chip refusal-chip">
                  Recommendations · refused
                </span>
              </div>
            </div>
            <div id="faq">
              <h2 className="mb-5 text-title font-semibold">Questions</h2>
              <div className="space-y-3">
                {questions.map(([q, a]) => (
                  <FaqItem key={q} question={q}>
                    {a}
                  </FaqItem>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="page-shell flex flex-wrap justify-between gap-3 border-t border-line/50 py-6 text-tiny text-ink-faint">
        <span className="flex items-center gap-2">
          <Logo size={20} decorative />
          Chartroom · a room for better reasoning
        </span>
        <Link href="/design-system">Design & motion system</Link>
      </footer>
    </div>
  );
}
