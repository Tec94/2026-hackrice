export function ReplayBoundary({
  left,
  right,
  horizon,
  revealed = false,
}: {
  left: number;
  right: number;
  horizon: string;
  revealed?: boolean;
}) {
  return (
    <div
      style={{ left, right, bottom: 28 }}
      className={`pointer-events-none absolute top-0 z-[4] border-l border-dashed border-replay-400 ${revealed ? "" : "hatch-hidden"}`}
    >
      <div className="flex justify-end gap-2 whitespace-nowrap px-2 pt-3 text-micro">
        <span className="hidden rounded-lg bg-[#241a13] px-2 py-1 text-replay-300 sm:block">
          {revealed ? "Cutoff · 0" : "Replay boundary · 0"}
        </span>
        <span className="rounded-lg bg-ground/90 px-2 py-1 text-ink-muted">
          {revealed ? "Revealed" : "Hidden"} · +{horizon}
        </span>
      </div>
    </div>
  );
}
