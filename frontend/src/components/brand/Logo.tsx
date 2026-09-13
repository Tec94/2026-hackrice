import { useId } from "react";

/**
 * The FIanal.sim mark: three rising bars under a trend arc, ending in a node.
 *
 * Drawn rather than loaded so it stays sharp at any size, inherits the
 * surrounding colour where asked, and costs no extra request. `title` is what
 * a screen reader announces; pass `decorative` beside a visible "FIanal.sim"
 * wordmark so it is not announced twice.
 */
export function Logo({
  size = 28,
  decorative = false,
  title = "FIanal.sim",
  className,
}: {
  size?: number;
  decorative?: boolean;
  title?: string;
  className?: string;
}) {
  // Unique per instance so two logos on one page cannot share gradient ids.
  // useId, not a random value: the server and the browser must agree.
  const id = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-bar`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="55%" stopColor="#1e88e5" />
          <stop offset="100%" stopColor="#14d6b4" />
        </linearGradient>
        <linearGradient id={`${id}-arc`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#14d6b4" />
        </linearGradient>
      </defs>

      {/* The arc sweeps from the low node up past the tall bar to the high one. */}
      <path
        d="M17 45 A 27 27 0 0 1 47 17"
        fill="none"
        stroke={`url(#${id}-arc)`}
        strokeWidth="3.4"
        strokeLinecap="round"
      />

      {/* Three bars, each taller than the last. */}
      <rect x="20" y="38" width="9" height="15" rx="2.5" fill={`url(#${id}-bar)`} />
      <rect x="31.5" y="30" width="9" height="23" rx="2.5" fill={`url(#${id}-bar)`} />
      <rect x="43" y="21" width="9" height="32" rx="2.5" fill={`url(#${id}-bar)`} />

      {/* Nodes anchoring each end of the arc. */}
      <circle cx="16" cy="46" r="5" fill="#1e88e5" />
      <circle cx="48" cy="16" r="5" fill="#14d6b4" />
    </svg>
  );
}
