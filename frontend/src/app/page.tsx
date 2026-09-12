import Link from "next/link";
import { HeroChart } from "@/components/landing/HeroChart";
import { MarketPicker } from "@/components/landing/MarketPicker";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#coach", label: "The coach" },
  { href: "/history", label: "Your record" },
  { href: "#faq", label: "FAQ" },
];

const STEPS = [
  {
    n: "01",
    title: "The right side is hidden",
    body: "You get a real historical chart cut off at a moment in time. What happened next is withheld until you commit.",
  },
  {
    n: "02",
    title: "Explain it out loud",
    body: "Hold to talk. Ask the coach about anything visible, then record your read — the thesis, the evidence, what would prove you wrong.",
  },
  {
    n: "03",
    title: "Graded on reasoning",
    body: "Then the chart plays forward. You are scored on how you thought, not on whether the candle went your way.",
  },
];

const FAQ = [
  {
    q: "Is this real money or a broker?",
    a: "Neither. Nothing is executed and no account is connected. It is a reading exercise built around historical data.",
  },
  {
    q: "Where does the chart data come from?",
    a: "Historical OHLC data for real instruments, replayed from a fixed point. Live prices are never shown.",
  },
  {
    q: "Why grade reasoning instead of the prediction?",
    a: "A correct call from bad reasoning is luck, and it repeats badly. The score tracks the part you actually control.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-ground">
      {/* ------------------------------- Nav ------------------------------- */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ground/85 backdrop-blur">
        <nav className="mx-auto flex h-16 w-full max-w-[88rem] items-center gap-8 px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            <span aria-hidden="true" className="h-4 w-1.5 rounded-sm bg-accent-400" />
            <span className="text-lead font-semibold tracking-tight text-ink">Chartroom</span>
          </Link>

          <ul className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="text-base text-ink-muted transition-colors hover:text-ink motion-reduce:transition-none"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/history"
              className="hidden min-h-touch items-center px-2 text-base text-ink-muted transition-colors hover:text-ink motion-reduce:transition-none sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/sign-in?next=%2F"
              className="inline-flex min-h-touch items-center rounded-lg bg-ink px-4 text-base font-semibold text-[#0a0a0a] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ground motion-reduce:transition-none"
            >
              Start a session
            </Link>
          </div>
        </nav>
      </header>

      {/* ------------------------------- Hero ------------------------------ */}
      <main>
        <section className="mx-auto grid w-full max-w-[88rem] items-center gap-12 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-24">
          <div>
            <span className="inline-flex items-center rounded-full border border-accent-500/45 px-4 py-1.5 text-base text-accent-300">
              Historical replay · no live markets
            </span>

            <h1 className="mt-7 text-display font-semibold leading-[1.05] tracking-tight sm:text-hero">
              <span className="text-ink">Learn to read a chart.</span>
              <br />
              <span className="text-ink-muted">Not to guess one.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lead leading-relaxed text-ink-muted">
              Chartroom hides the right-hand side of a real chart and asks you to explain what you
              see, out loud. Then it shows you what happened — and grades your reasoning, not your
              luck.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/sign-in?next=%2F"
                className="inline-flex min-h-touch items-center rounded-lg bg-ink px-6 text-lead font-semibold text-[#0a0a0a] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ground motion-reduce:transition-none"
              >
                Start a session
              </Link>
              <Link
                href="#how"
                className="inline-flex min-h-touch items-center rounded-lg border border-line px-6 text-lead font-medium text-ink transition-colors hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
              >
                See how it works
              </Link>
            </div>

            <p className="mt-6 max-w-md text-base text-ink-faint">
              Free while in beta · Built for finance students and first-year analysts
            </p>
          </div>

          <HeroChart />
        </section>

        {/* ---------------------------- Markets ---------------------------- */}
        <section className="mx-auto w-full max-w-[88rem] px-6 pb-20" aria-labelledby="markets">
          <h2 id="markets" className="text-micro uppercase tracking-[0.18em] text-ink-faint">
            Pick a market
          </h2>
          <div className="mt-5">
            <MarketPicker />
          </div>
        </section>

        {/* --------------------------- How it works ------------------------ */}
        <section id="how" className="border-t border-line/70 bg-panel/40">
          <div className="mx-auto w-full max-w-[88rem] px-6 py-20">
            <h2 className="text-title font-semibold tracking-tight text-ink">How it works</h2>
            <div className="mt-10 grid gap-10 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.n}>
                  <span className="nums text-micro font-semibold tracking-[0.18em] text-accent-400">
                    {step.n}
                  </span>
                  <h3 className="mt-3 text-lead font-semibold text-ink">{step.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-ink-muted">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------ Coach ---------------------------- */}
        <section id="coach" className="mx-auto w-full max-w-[88rem] px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <span className="inline-flex items-center gap-2 text-micro uppercase tracking-[0.18em] text-coach-300">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-coach-400" />
                The coach
              </span>
              <h2 className="mt-4 text-title font-semibold tracking-tight text-ink">
                It answers from the chart in front of you — and nothing else.
              </h2>
              <p className="mt-4 text-lead leading-relaxed text-ink-muted">
                Ask what the volume is doing or where the last swing high sits, and you get an
                answer grounded in the visible range. Ask what happens next and it will decline —
                that is the whole exercise.
              </p>
            </div>

            <div className="space-y-3">
              {[
                { role: "You", text: "Is volume rising into this move?", blocked: false },
                {
                  role: "Coach",
                  text: "The last three bars sit above the visible average, and the most recent has the widest range of the group.",
                  blocked: false,
                },
                { role: "You", text: "So will it break out from here?", blocked: false },
                {
                  role: "Coach",
                  text: "I can only discuss what is visible. The candles after the cutoff stay hidden until you commit.",
                  blocked: true,
                },
              ].map((turn, i) => (
                <div
                  key={i}
                  className={`rounded-xl2 border p-4 ${
                    turn.blocked
                      ? "border-accent-500/40 bg-accent-500/[0.07]"
                      : "border-line bg-panel"
                  }`}
                >
                  <p
                    className={`text-micro font-semibold uppercase tracking-wider ${
                      turn.role === "Coach" ? "text-coach-300" : "text-ink-faint"
                    }`}
                  >
                    {turn.role}
                  </p>
                  <p className="mt-1.5 text-base leading-relaxed text-ink">{turn.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------- FAQ ----------------------------- */}
        <section id="faq" className="border-t border-line/70">
          <div className="mx-auto w-full max-w-[88rem] px-6 py-20">
            <h2 className="text-title font-semibold tracking-tight text-ink">FAQ</h2>
            <dl className="mt-8 grid gap-8 sm:grid-cols-3">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <dt className="text-lead font-medium text-ink">{item.q}</dt>
                  <dd className="mt-2 text-base leading-relaxed text-ink-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ------------------------------- CTA ----------------------------- */}
        <section className="border-t border-line/70 bg-panel/40">
          <div className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center justify-between gap-6 px-6 py-16">
            <div>
              <h2 className="text-title font-semibold tracking-tight text-ink">
                Find out whether you can actually read one.
              </h2>
              <p className="mt-2 text-base text-ink-muted">
                One chart, one read, one honest answer. Takes about five minutes.
              </p>
            </div>
            <Link
              href="/sign-in?next=%2F"
              className="inline-flex min-h-touch items-center rounded-lg bg-ink px-6 text-lead font-semibold text-[#0a0a0a] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ground motion-reduce:transition-none"
            >
              Start a session
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70">
        <div className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-base text-ink-faint">
          <span className="flex items-center gap-2 text-ink-muted">
            <span aria-hidden="true" className="h-3.5 w-1 rounded-sm bg-accent-400" />
            Chartroom
          </span>
          <Link href="/history" className="hover:text-ink">
            Dashboard
          </Link>
          <Link href="/history" className="hover:text-ink">
            Your record
          </Link>
          <span className="ml-auto">Educational tool. Not trade advice.</span>
        </div>
      </footer>
    </div>
  );
}
