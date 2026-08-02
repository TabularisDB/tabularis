import React from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface AccordionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export const Accordion = ({
  title,
  isOpen,
  onToggle,
  children,
  actions,
}: AccordionProps) => (
  <div className="flex flex-col mb-2">
    <div className="flex items-center justify-between pl-2 pr-3 py-1 group/acc">
      <button
        onClick={onToggle}
        className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted uppercase tracking-wider hover:text-secondary transition-colors select-none flex-1"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="truncate">{title}</span>
      </button>
      {actions && <div className="ml-2 shrink-0 pr-3">{actions}</div>}
    </div>
    {isOpen && <div>{children}</div>}
  </div>
);
