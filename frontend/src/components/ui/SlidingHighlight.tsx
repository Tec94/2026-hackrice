"use client";
import { useEffect, useState, type CSSProperties } from "react";

const positions = new Map<string, number>();

export function SlidingHighlight({
  index,
  count,
  transitionKey,
}: {
  index: number;
  count: number;
  transitionKey?: string;
}) {
  const [position, setPosition] = useState(() =>
    transitionKey ? (positions.get(transitionKey) ?? index) : index,
  );
  useEffect(() => {
    if (transitionKey) positions.set(transitionKey, index);
    const frame = requestAnimationFrame(() => setPosition(index));
    return () => cancelAnimationFrame(frame);
  }, [index, transitionKey]);
  return (
    <span
      aria-hidden="true"
      className="sliding-highlight"
      style={
        {
          "--track-count": count,
          "--active-index": position,
        } as CSSProperties
      }
    />
  );
}
