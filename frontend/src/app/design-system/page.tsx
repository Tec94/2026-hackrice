"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge, Button, Card, Dialog, Input, ProgressBar } from "@/components/ui";

const COLORS = [
  { name: "Ground", value: "#0a0a0a", style: "bg-ground" },
  { name: "Panel", value: "#121212", style: "bg-panel" },
  { name: "Raised", value: "#1c1c1c", style: "bg-raised" },
  { name: "Ink", value: "#f2f2f2", style: "bg-ink" },
  { name: "Accent", value: "#d4a24b", style: "bg-accent-400" },
  { name: "Coach", value: "#9184ee", style: "bg-coach-400" },
];

export default function DesignSystemPage() {
  const [entrance, setEntrance] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [progress, setProgress] = useState(50);

  return (
    <div className="min-h-screen bg-ground">
      <header className="border-b border-line">
        <nav className="page-shell flex min-h-16 flex-wrap items-center justify-between gap-3 py-3" aria-label="Design system navigation">
          <Link href="/" className="motion-control rounded-lg py-2 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">Chartroom</Link>
          <span className="text-tiny text-ink-muted">Design + motion / working reference</span>
        </nav>
      </header>
      <main className="page-shell pb-20">
        <section className="section-space grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <p className="text-micro uppercase tracking-wider text-accent-300">The foundation</p>
            <h1 className="mt-4 text-display font-semibold tracking-tight sm:text-hero">Quiet surfaces.<br />Clear intent.</h1>
            <p className="mt-5 max-w-xl text-lead leading-relaxed text-ink-muted">A tactile layer for chart analysis. Fine edges and soft depth separate controls from content. Motion confirms an action; it never interprets the market.</p>
          </div>
          <div className="surface rounded-xl2 bg-panel p-6">
            <p className="text-micro uppercase tracking-wider text-ink-muted">Surface recipe</p>
            <p className="mt-3 text-title font-semibold">0.5px border</p>
            <p className="mt-2 text-base text-ink-muted">Soft inner white shadow</p>
            <p className="mt-1 text-base text-ink-muted">Double drop shadow: contact + ambient</p>
            <div className="mt-6 flex flex-wrap gap-3"><Button variant="primary">Primary control <ArrowRight size={16} aria-hidden="true" /></Button><Button>Secondary</Button></div>
          </div>
        </section>

        <section className="border-t border-line py-12" aria-labelledby="palette-title">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2"><h2 id="palette-title" className="text-title font-semibold">01 / Color roles</h2><p className="text-base text-ink-muted">Existing palette, purposeful emphasis.</p></div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {COLORS.map(color => <div key={color.name}><div className={`h-20 rounded-lg border border-line ${color.style}`} /><p className="mt-3 text-base font-medium">{color.name}</p><p className="nums text-tiny text-ink-muted">{color.value}</p></div>)}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3"><Badge tone="replay">Historical replay</Badge><Badge tone="coach">Listening</Badge><Badge tone="bull">Higher</Badge><Badge tone="bear">Lower</Badge><span className="text-tiny text-ink-muted">Color always has a text label.</span></div>
        </section>

        <section className="grid gap-10 border-t border-line py-12 lg:grid-cols-2" aria-labelledby="type-title">
          <div><h2 id="type-title" className="text-title font-semibold">02 / Type & spacing</h2><p className="mt-3 max-w-lg text-base text-ink-muted">Keep the current typeface. Let size, weight, and proximity establish hierarchy. Use tabular figures for prices and counts.</p><p className="mt-6 text-display font-semibold tracking-tight">Chart first.</p><p className="mt-3 text-lead">Group related controls. Separate decisions.</p><p className="nums mt-3 text-title text-accent-300">102.51 · 120 candles</p></div>
          <div className="space-y-6"><p className="text-micro uppercase tracking-wider text-ink-muted">Spacing relationships</p>{[{label:"Related elements",value:"8px",width:"w-2"},{label:"Control groups",value:"16px",width:"w-4"},{label:"Panel sections",value:"24px",width:"w-6"}].map(space=><div key={space.label} className="flex items-center gap-4"><span aria-hidden="true" className={`h-4 shrink-0 rounded-sm bg-accent-400 ${space.width}`} /><p className="flex-1 text-base">{space.label}</p><span className="nums text-tiny text-ink-muted">{space.value}</span></div>)}<p className="text-base text-ink-muted">Landing pages breathe. The replay workspace stays compact, with a separately scrolling coach panel.</p></div>
        </section>

        <section className="border-t border-line py-12" aria-labelledby="controls-title">
          <h2 id="controls-title" className="mb-6 text-title font-semibold">03 / Controls & states</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Action hierarchy"><div className="flex flex-wrap gap-3"><Button variant="primary" onClick={()=>setDialog(true)}>Open preview dialog</Button><Button variant="accent">Accent</Button><Button variant="ghost">Ghost</Button><Button disabled>Unavailable</Button></div><p className="mt-4 text-base text-ink-muted">Tab through controls to inspect focus. Press a button to feel the subtle depth change.</p></Card>
            <Card title="Field anatomy"><label htmlFor="sample-thesis" className="mb-2 block text-base font-medium">Your thesis</label><Input id="sample-thesis" placeholder="Write what you observe" aria-describedby="sample-hint" /><p id="sample-hint" className="mt-2 text-tiny text-ink-muted">Labels stay visible. This sample is not saved.</p></Card>
          </div>
        </section>

        <section className="border-t border-line py-12" aria-labelledby="motion-title">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2"><h2 id="motion-title" className="text-title font-semibold">04 / Motion language</h2><p className="text-base text-ink-muted motion-reduce:hidden">System motion preference: standard</p><p className="hidden text-base text-ink-muted motion-reduce:block">System motion preference: reduced — movement disabled</p></div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div><div className="mb-5 flex flex-wrap gap-3"><Button onClick={()=>setEntrance(value=>value+1)}>Replay entrance</Button><span className="self-center text-tiny text-ink-muted">350ms · 6px settle · no bounce</span></div><div key={entrance} className="surface animate-rise-in rounded-xl2 bg-panel p-6"><p className="text-lead font-medium">Content arrives. Data stays still.</p><p className="mt-2 text-base text-ink-muted">Use this entrance for dialogs, menus, and the landing preview. Do not animate live chart geometry.</p></div></div>
            <div className="space-y-4"><p className="text-lead font-medium">150ms feedback / 200ms state change</p><p className="text-base text-ink-muted">Hover actionable cards for a small lift. Progress uses a transform instead of changing layout width.</p><label htmlFor="sample-progress" className="block text-base">Sample progress: {progress}%</label><input id="sample-progress" type="range" min="0" max="100" value={progress} onChange={event=>setProgress(Number(event.target.value))} className="min-h-touch w-full accent-accent-400" /><ProgressBar value={progress} label="Sample progress" /></div>
          </div>
        </section>
        <footer className="border-t border-line pt-6 text-base text-ink-muted">Both-axis overscroll is disabled. Normal scrolling, chart pan and zoom, and keyboard navigation remain available.</footer>
      </main>
      <Dialog open={dialog} onClose={()=>setDialog(false)} title="A focused decision" description="This is a design preview. No analysis is submitted." actions={<Button variant="primary" onClick={()=>setDialog(false)}>Done</Button>}><p>Soft depth, a fine edge, and a short entrance. Escape closes the dialog and returns focus to its trigger.</p></Dialog>
    </div>
  );
}
