"use client";
import { useId, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

export function FaqItem({
  question,
  children,
}: {
  question: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="faq-item" data-open={open}>
      <h3>
        <button
          className="faq-trigger"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {question}
          <Plus size={16} aria-hidden="true" />
        </button>
      </h3>
      <div id={id} className="faq-content" aria-hidden={!open} inert={!open}>
        <div>
          <p className="pt-3 text-tiny leading-relaxed text-ink-muted">
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}
