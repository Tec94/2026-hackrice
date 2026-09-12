"use client";

import Link from "next/link";
import { useState } from "react";
import { History, LayoutDashboard, User } from "lucide-react";
import { Select } from "@/components/ui";
import { SESSION_PHASES, type SessionPhase } from "@/view-models";
import { SUPPORTED_TIMEFRAMES, type Timeframe } from "@/adapters/chart";
import { cn } from "@/utilities/cn";

/** The API supports exactly these intervals; nothing else is offered (spec §6). */
const TIMEFRAMES = SUPPORTED_TIMEFRAMES;

const PHASE_LABELS: Record<SessionPhase, string> = {
  explore: "Explore",
  analyze: "Analyze",
  feedback: "Feedback",
  reveal: "Reveal",
};

export interface ReplayHeaderProps {
  symbol?: string;
  timeframe?: Timeframe;
  /** Omit to render the selector read-only (feedback and reveal pages). */
  onTimeframeChange?: (timeframe: Timeframe) => void;
  elapsed?: string;
  connected?: boolean;
  phase?: SessionPhase;
}

export function ReplayHeader({
  symbol = "SOL/USDT",
  timeframe = "15m" as Timeframe,
  onTimeframeChange,
  elapsed,
  connected,
  phase = "explore",
}: ReplayHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const currentIndex = SESSION_PHASES.indexOf(phase);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-panel px-3 sm:h-16 sm:px-4">
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
      >
        <span aria-hidden="true" className="h-4 w-1.5 rounded-sm bg-accent-400" />
        <span className="hidden text-base font-semibold tracking-tight sm:inline">Chartroom</span>
      </Link>

      <span className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-base font-semibold text-ink">{symbol}</span>
        <label>
          <span className="sr-only">Timeframe</span>
          <Select
            value={timeframe}
            disabled={!onTimeframeChange}
            onChange={(e) => onTimeframeChange?.(e.target.value as Timeframe)}
            className="w-[4.5rem] py-1 text-tiny"
          >
            {TIMEFRAMES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </label>
        {/* "Historical Replay" must read unmistakably — never a live market (spec §6). */}
        <span className="hidden items-center gap-1.5 rounded-full bg-replay-500/12 px-2.5 py-1 text-micro font-medium text-replay-200 md:inline-flex">
          Historical Replay
        </span>
      </div>

      {/* Phase indicator lives inline now that the page has no bottom bar. */}
      <nav aria-label="Session progress" className="ml-4 hidden items-center gap-1.5 lg:flex">
        {SESSION_PHASES.map((p, i) => (
          <span key={p} className="flex items-center gap-1.5">
            <span
              aria-current={i === currentIndex ? "step" : undefined}
              className={cn(
                "text-micro font-medium",
                i === currentIndex && "text-accent-300",
                i < currentIndex && "text-ink-muted",
                i > currentIndex && "text-ink-faint",
              )}
            >
              {PHASE_LABELS[p]}
            </span>
            {i < SESSION_PHASES.length - 1 && (
              <span aria-hidden="true" className="h-px w-4 bg-line" />
            )}
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {elapsed && <span className="nums hidden text-tiny text-ink-muted sm:inline" aria-label="Session time">
          {elapsed}
        </span>}

        {connected !== undefined && <span className="flex items-center gap-1.5 text-micro text-ink-muted">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-bull" : "bg-bear")}
          />
          <span className="hidden sm:inline">{connected ? "Session loaded" : "Loading session"}</span>
        </span>}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-label="User menu"
            className="grid h-touch w-touch shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 motion-reduce:transition-none"
          >
            <User size={18} strokeWidth={1.75} />
          </button>
          {menuOpen && (
            <div className="surface absolute right-0 top-full z-30 mt-1 w-48 animate-rise-in rounded-xl2 bg-panel p-1">
              {[
                { href: "/", label: "Markets", Icon: LayoutDashboard },
                { href: "/history", label: "Session history", Icon: History },
              ].map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-touch items-center gap-2.5 rounded-lg px-3 text-base text-ink-muted hover:bg-raised hover:text-ink"
                >
                  <Icon size={16} strokeWidth={1.75} />
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
