"use client";
import { useState, type CSSProperties } from "react";
import { AppHeader, SessionTrack } from "@/components/layout/AppHeader";
import { Button, Dialog, ProgressBar } from "@/components/ui";
const colors = [
  ["Ground", "#0e0e10"],
  ["Inset", "#101012"],
  ["Panel", "#171719"],
  ["Raised", "#252529"],
  ["Accent", "#e2b45c"],
  ["Replay", "#c47a3a"],
  ["Coach", "#9184ee"],
  ["Bull", "#34c77b"],
  ["Bear", "#f0524f"],
];
export default function DesignSystemPage() {
  const [dialog, setDialog] = useState(false);
  const [entrance, setEntrance] = useState(0);
  const [voice, setVoice] = useState("listening");
  const [progress, setProgress] = useState(60);
  const [status, setStatus] = useState<
    "exploring" | "submitted" | "revealed" | "completed"
  >("exploring");
  const [curtain, setCurtain] = useState(0);
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="page-shell py-14">
        <p className="eyebrow">FIanal.sim · design and motion system</p>
        <h1 className="mt-5 text-display font-semibold tracking-tight">
          Same identity, more depth.
        </h1>
        <p className="mt-4 max-w-2xl text-lead leading-relaxed text-ink-muted">
          A study room with an instrument in it. Lit surfaces establish
          hierarchy. Motion makes state changes legible; candles, axes,
          drawings, and prices stay still.
        </p>
        <section className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            ["surface-hero", "Hero plane", "Chart and primary content"],
            ["surface-inset", "Inset plane", "Coach and fields"],
            [
              "control-surface",
              "Control plane",
              "Raised actions and selections",
            ],
          ].map(([style, title, body]) => (
            <article key={title} className={`${style} rounded-2xl p-6`}>
              <span className="icon-well mb-5">↗</span>
              <h2 className="text-title font-semibold">{title}</h2>
              <p className="mt-2 text-tiny text-ink-muted">{body}</p>
              <p className="mt-4 text-micro text-ink-faint">
                Hairline ring · top light · contact + ambient shadows
              </p>
            </article>
          ))}
        </section>
        <section className="mt-12">
          <h2 className="mb-5 text-title font-semibold">Color roles</h2>
          <div className="grid grid-cols-3 gap-4 md:grid-cols-9">
            {colors.map(([label, value]) => (
              <div key={label}>
                <div
                  className="h-16 rounded-xl ring-1 ring-white/10"
                  style={{ background: value }}
                />
                <p className="mt-3 text-tiny">{label}</p>
                <p className="nums mt-1 text-micro text-ink-faint">{value}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <div className="surface rounded-2xl p-6">
            <h2 className="text-title font-semibold">
              Three control materials
            </h2>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => setDialog(true)}>
                Commit analysis
              </Button>
              <Button onClick={() => setProgress(0)}>Reset view</Button>
              <Button variant="ghost" onClick={() => setProgress(60)}>
                Cancel
              </Button>
            </div>
            <p className="mt-5 text-tiny text-ink-muted">
              150ms press · soft release. Dialogs enter in 350ms and leave in
              120ms.
            </p>
          </div>
          <div className="surface rounded-2xl p-6">
            <h2 className="mb-5 text-title font-semibold">Session states</h2>
            <SessionTrack
              status={status}
              revealReady={status === "revealed" || status === "completed"}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {(
                ["exploring", "submitted", "revealed", "completed"] as const
              ).map((s) => (
                <Button key={s} variant="ghost" onClick={() => setStatus(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </section>
        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <div className="surface rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-title font-semibold">Ordered entrances</h2>
              <Button variant="ghost" onClick={() => setEntrance((v) => v + 1)}>
                Replay entrance
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-3" key={entrance}>
              {["EMA 21", "RSI 14", "SMA 50", "MACD"].map((text, i) => (
                <span
                  className="fact-chip stagger-item"
                  style={{ "--i": i } as CSSProperties}
                  key={text}
                >
                  {text}
                </span>
              ))}
            </div>
            <p className="mt-5 text-tiny text-ink-muted">
              350ms expo-out · 40ms stagger, capped at six siblings.
            </p>
          </div>
          <div className="surface rounded-2xl p-6">
            <h2 className="text-title font-semibold">One voice orb</h2>
            <div className="mt-6 flex items-center gap-4">
              <span className="voice-orb" data-state={voice} />
              <span className="capitalize">{voice}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {["listening", "thinking", "speaking", "idle"].map((state) => (
                <Button
                  key={state}
                  variant="ghost"
                  onClick={() => setVoice(state)}
                >
                  {state === "idle" ? "Paused" : state}
                </Button>
              ))}
            </div>
          </div>
        </section>
        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-5 text-title font-semibold">Confidence fill</h2>
            <label className="block text-tiny">
              Sample confidence · {progress}%
              <input
                className="confidence-slider my-5 block w-full"
                style={
                  { "--range-fill": `${progress}%` } as React.CSSProperties
                }
                type="range"
                min={0}
                max={100}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
              />
            </label>
            <ProgressBar value={progress} label="Sample confidence" />
            <p className="mt-4 text-tiny text-ink-muted">
              A scale transform with 200ms settle; no change in layout.
            </p>
          </div>
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-title font-semibold">Reveal curtain</h2>
              <Button variant="ghost" onClick={() => setCurtain((c) => c + 1)}>
                Replay curtain
              </Button>
            </div>
            <div className="surface-hero relative grid h-32 place-items-center text-ink-muted">
              The chart stays still
              <div key={curtain} className="reveal-curtain hatch-hidden" />
            </div>
            <p className="mt-4 text-tiny text-ink-muted">
              500ms expo-out. The curtain moves; the outcome does not.
            </p>
          </div>
        </section>
        <p className="mt-12 border-t border-line pt-6 text-tiny text-ink-muted">
          Reduced motion disables all movement. Keyboard focus, state labels,
          and chart navigation remain available.
        </p>
      </main>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="A focused decision"
        description="Design preview only. No analysis is submitted."
        actions={
          <Button variant="primary" onClick={() => setDialog(false)}>
            Done
          </Button>
        }
      >
        <p>Escape dismisses this dialog and returns focus to its trigger.</p>
      </Dialog>
    </div>
  );
}
