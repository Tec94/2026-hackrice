"use client";

import React, { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/utilities/cn";

/* ---------------------------------- Button --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-[#0a0a0a] hover:bg-white shadow-panel",
  secondary: "bg-raised text-ink hover:bg-line",
  ghost: "bg-transparent text-ink-muted hover:bg-raised hover:text-ink",
  danger: "bg-bear text-white hover:brightness-110",
  accent: "bg-accent-500 text-[#0a0a0a] hover:bg-accent-400",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-touch items-center justify-center gap-2 rounded-lg px-4 text-base font-medium",
        "transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
        "disabled:pointer-events-none disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-lg",
        "text-ink-muted transition-colors duration-150 hover:bg-raised hover:text-ink motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Fields --------------------------------- */

const fieldBase =
  "w-full rounded-lg bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-faint " +
  "ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-accent-400";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} {...props} className={cn(fieldBase, "min-h-touch", className)} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} {...props} className={cn(fieldBase, "resize-y", className)} />;
});

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(fieldBase, "min-h-touch cursor-pointer", className)}>
      {children}
    </select>
  );
}

/* ---------------------------------- Badge ---------------------------------- */

type BadgeTone = "neutral" | "replay" | "accent" | "coach" | "bull" | "bear";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-raised text-ink-muted",
  replay: "bg-replay-500/12 text-replay-200",
  accent: "bg-accent-500/12 text-accent-300",
  coach: "bg-coach-500/12 text-coach-300",
  bull: "bg-bull/12 text-bull",
  bear: "bg-bear/12 text-bear",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl2 bg-panel p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-micro font-semibold uppercase tracking-wider text-ink-faint">
              {title}
            </h3>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* -------------------------------- ProgressBar ------------------------------- */

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = "accent",
}: {
  value: number;
  max?: number;
  label?: string;
  tone?: "accent" | "replay";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
          tone === "accent" ? "bg-accent-500" : "bg-replay-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* --------------------------------- Skeleton -------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-raised motion-reduce:animate-none", className)}
      aria-hidden="true"
    />
  );
}

/* -------------------------------- ErrorBanner ------------------------------- */

export function ErrorBanner({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl2 bg-bear/10 px-4 py-3 ring-1 ring-inset ring-bear/30"
    >
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="text-tiny text-ink-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* --------------------------------- EmptyState ------------------------------- */

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl2 border border-dashed border-line px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-sm text-tiny text-ink-faint">{message}</p>
      {action}
    </div>
  );
}

/* ----------------------------- Focus management ----------------------------- */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Traps focus inside an overlay and restores it to the previously focused
 * element on close (spec §18: preserve focus when drawers and dialogs close).
 */
export function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const node = ref.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreTo.current?.focus?.();
    };
  }, [active, onClose]);

  return ref;
}

/* ---------------------------------- Dialog --------------------------------- */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  actions: React.ReactNode;
}) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md animate-rise-in rounded-xl2 bg-panel p-5 shadow-lift ring-1 ring-inset ring-line"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lead font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-tiny text-ink-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-2">
            <X size={18} />
          </IconButton>
        </div>
        {children && <div className="mt-4 space-y-3 text-base text-ink-muted">{children}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

/* ----------------------------------- Tabs ---------------------------------- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const index = tabs.findIndex((t) => t.id === active);
      if (event.key === "ArrowRight") onChange(tabs[(index + 1) % tabs.length].id);
      if (event.key === "ArrowLeft") onChange(tabs[(index - 1 + tabs.length) % tabs.length].id);
    },
    [tabs, active, onChange],
  );

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 rounded-lg bg-panel p-1", className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          className={cn(
            "min-h-touch flex-1 rounded-md px-3 text-base font-medium transition-colors duration-150 motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
            active === tab.id ? "bg-raised text-ink shadow-panel" : "text-ink-faint hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ NotificationRegion -------------------------- */

export interface ToastMessage {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  text: string;
}

const TOAST_TONES: Record<ToastMessage["tone"], string> = {
  info: "bg-panel text-ink ring-line",
  success: "bg-bull/10 text-ink ring-bull/30",
  warning: "bg-replay-500/10 text-replay-200 ring-replay-500/30",
  error: "bg-bear/10 text-ink ring-bear/30",
};

/** Polite live region for transient status messages (spec §5). */
export function NotificationRegion({ messages }: { messages: ToastMessage[] }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "animate-rise-in rounded-lg px-3 py-2 text-tiny shadow-lift ring-1 ring-inset",
            TOAST_TONES[m.tone],
          )}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}
