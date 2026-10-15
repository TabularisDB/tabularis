import { cloneElement, useId, useState, type ReactElement, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

interface UpdateTooltipProps {
  label: string;
  details?: string[];
  children: ReactElement<{
    "aria-describedby"?: string;
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  }>;
  disabled?: boolean;
  className?: string;
}

/** Portalled so the Settings navigation's scroll container cannot clip it. */
export function UpdateTooltip({ label, details = [], children, disabled = false, className = "inline-flex" }: UpdateTooltipProps) {
  const id = useId();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const show = (element: HTMLSpanElement) => {
    if (disabled) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
      ...(rect.bottom > window.innerHeight / 2
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  };

  return (
    <span
      className={className}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setPosition(null)}
    >
      {cloneElement(children, {
        "aria-describedby": position && !disabled ? id : undefined,
        // Escape dismisses the tooltip; handled on the focusable trigger itself.
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          children.props.onKeyDown?.(event);
          if (event.key === "Escape" && position) {
            event.stopPropagation();
            setPosition(null);
          }
        },
      })}
      {position && !disabled && createPortal(
        <div
          id={id}
          role="tooltip"
          className="fixed z-[200] w-80 max-w-[calc(100vw-16px)] rounded-lg border border-strong bg-elevated p-3 text-xs text-primary shadow-xl pointer-events-none"
          style={position}
        >
          <span className="block font-medium break-words">{label}</span>
          {details.length > 0 && (
            <ul className="mt-2 space-y-1 text-secondary">
              {details.map((detail, index) => <li key={index} className="break-words">{detail}</li>)}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
