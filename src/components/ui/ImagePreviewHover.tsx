import { cloneElement, useId, useState, type ReactElement, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

interface ImagePreviewHoverProps {
  src: string;
  alt?: string;
  children: ReactElement<{
    "aria-describedby"?: string;
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  }>;
  disabled?: boolean;
  className?: string;
}

/**
 * Portalled image preview hover popover for data grid cells.
 */
export function ImagePreviewHover({
  src,
  alt = "Image preview",
  children,
  disabled = false,
  className = "inline-flex w-full items-center",
}: ImagePreviewHoverProps) {
  const id = useId();
  const [position, setPosition] = useState<CSSProperties | null>(null);

  const show = (element: HTMLElement) => {
    if (disabled || !src) return;
    const rect = element.getBoundingClientRect();
    const previewSize = 160;
    const padding = 8;

    let left = rect.left;
    if (left + previewSize > window.innerWidth - padding) {
      left = window.innerWidth - previewSize - padding;
    }
    if (left < padding) {
      left = padding;
    }

    const showAbove = rect.bottom + previewSize + padding > window.innerHeight;

    setPosition({
      left,
      ...(showAbove
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
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          children.props.onKeyDown?.(event);
          if (event.key === "Escape" && position) {
            event.stopPropagation();
            setPosition(null);
          }
        },
      })}
      {position &&
        !disabled &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-[200] rounded-md border border-strong bg-elevated p-1.5 shadow-xl pointer-events-none flex items-center justify-center max-w-[200px] max-h-[200px]"
            style={position}
          >
            <img
              src={src}
              alt={alt}
              className="max-w-[180px] max-h-[180px] object-contain rounded"
              draggable={false}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
