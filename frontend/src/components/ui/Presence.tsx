"use client";
import { useEffect, useState, type ReactNode } from "react";

export function Presence({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) setPresent(true);
    else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      setPresent(false);
  }, [open]);
  if (!open && !present) return null;
  return (
    <div
      className={`presence ${className}`}
      data-state={open ? "open" : "closed"}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !open) setPresent(false);
      }}
    >
      {children}
    </div>
  );
}
