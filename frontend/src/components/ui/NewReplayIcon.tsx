import { Play, Plus } from "lucide-react";

export function NewReplayIcon() {
  return (
    <span className="new-replay-icon" aria-hidden="true">
      <Play size={24} />
      <Plus className="new-replay-plus" />
    </span>
  );
}
