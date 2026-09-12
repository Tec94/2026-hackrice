/**
 * Shaded region at the right edge marking where the replay stops.
 *
 * Visual only — it communicates the constraint. Actual enforcement (refusing to
 * serve post-cutoff bars) belongs to the datafeed, which is not built yet.
 */

/** Width of the chart's right price scale, so the overlay stops at the data edge. */
const PRICE_SCALE_WIDTH = 60;

export function ReplayBoundary() {
  return (
    <div
      style={{ right: PRICE_SCALE_WIDTH }}
      className="pointer-events-none absolute inset-y-0 flex w-24 items-start justify-end
                 border-l border-dashed border-replay-500/40 bg-gradient-to-l
                 from-replay-500/[0.07] to-transparent px-2 pt-3 sm:w-32"
    >
      <p className="text-right text-micro font-medium leading-tight text-replay-200/80" role="note">
        Future candles hidden
      </p>
    </div>
  );
}
