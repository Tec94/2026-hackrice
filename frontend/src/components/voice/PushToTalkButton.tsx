"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/utilities/cn";

export interface PushToTalkButtonProps {
  label: string;
  hint?: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  tone?: "accent" | "replay";
  size?: "lg" | "sm";
  onStart: () => void;
  onEnd: () => void;
}

/**
 * Hold-to-talk control.
 *
 * Pointer events cover mouse, touch and pen in one pair of handlers. Space and
 * Enter mirror the gesture so the control is never pointer-only (spec §18), and
 * `onPointerLeave` ends the hold if the pointer slides off mid-press.
 */
export function PushToTalkButton({
  label,
  hint,
  icon,
  active,
  disabled = false,
  tone = "accent",
  size = "lg",
  onStart,
  onEnd,
}: PushToTalkButtonProps) {
  // Guards against a keyup or pointerup arriving without a matching down.
  const holding = useRef(false);

  const start = useCallback(() => {
    if (disabled || holding.current) return;
    holding.current = true;
    onStart();
  }, [disabled, onStart]);

  const end = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    onEnd();
  }, [onEnd]);

  const isLarge = size === "lg";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={active}
        aria-label={label}
        onPointerDown={start}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") end();
        }}
        onBlur={end}
        className={cn(
          "relative grid select-none place-items-center rounded-full text-white",
          "transition-transform duration-150 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-ground",
          "disabled:pointer-events-none disabled:opacity-40",
          isLarge ? "h-28 w-28" : "h-touch w-full max-w-[15rem] rounded-lg",
          tone === "accent"
            ? "bg-coach-500 hover:bg-coach-400 focus-visible:ring-coach-300"
            : "bg-raised text-ink hover:bg-line focus-visible:ring-replay-400",
          active && tone === "accent" && "animate-pulse-ring bg-coach-400",
          active && tone === "replay" && "bg-accent-500 text-[#0a0a0a]",
        )}
      >
        <span className={cn("flex items-center gap-2", isLarge && "flex-col gap-1.5")}>
          {icon}
          <span className={cn("font-medium", isLarge ? "text-micro" : "text-base")}>
            {active ? "Listening…" : label}
          </span>
        </span>
      </button>
      {hint && <p className="max-w-[15rem] text-center text-micro text-ink-faint">{hint}</p>}
    </div>
  );
}
