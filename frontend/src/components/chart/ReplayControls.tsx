"use client";

import { Pause, Play, SkipForward } from "lucide-react";
import { IconButton } from "@/components/ui";

export interface ReplayControlsProps {
  onNextBar: () => void;
  onTogglePlay: () => void;
  isPlaying: boolean;
  revealed: number;
  remaining: number;
  disabled?: boolean;
}

/**
 * Candle-by-candle replay controls: the chart is advanced one bar at a time
 * rather than scrubbed along a timeline.
 */
export function ReplayControls({
  onNextBar,
  onTogglePlay,
  isPlaying,
  revealed,
  remaining,
  disabled = false,
}: ReplayControlsProps) {
  const exhausted = remaining <= 0;

  return (
    <div className="flex flex-wrap items-center gap-2 bg-panel px-3 py-2">
      <button
        onClick={onNextBar}
        disabled={disabled || exhausted}
        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-accent-600 px-4 text-base font-medium text-white
                   transition-colors duration-150 hover:bg-accent-500 motion-reduce:transition-none
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ground
                   disabled:pointer-events-none disabled:opacity-40"
      >
        <SkipForward size={16} strokeWidth={2} aria-hidden="true" />
        Next Bar
      </button>

      <IconButton
        label={isPlaying ? "Pause replay" : "Play replay"}
        aria-pressed={isPlaying}
        onClick={onTogglePlay}
        disabled={disabled || exhausted}
      >
        {isPlaying ? (
          <Pause size={16} strokeWidth={1.75} />
        ) : (
          <Play size={16} strokeWidth={1.75} />
        )}
      </IconButton>

      <span className="ml-1 text-micro text-ink-faint" aria-live="polite">
        {exhausted ? (
          <span className="text-replay-200">All available bars revealed</span>
        ) : (
          <>
            Revealed <span className="nums text-tiny text-ink-muted">{revealed}</span>
            {/* `remaining` is unknown until the hidden bars are lazily loaded. */}
            {Number.isFinite(remaining) && (
              <>
                {" · "}
                <span className="nums">{remaining}</span> left
              </>
            )}
          </>
        )}
      </span>

      <span className="ml-auto hidden text-micro text-ink-faint sm:inline">
        One candle per step
      </span>
    </div>
  );
}
