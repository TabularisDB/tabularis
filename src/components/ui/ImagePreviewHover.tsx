import {
  cloneElement,
  useId,
  useState,
  useEffect,
  type ReactElement,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface ImagePreviewHoverProps {
  src?: string | null;
  getSrc?: () => string | null;
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
  getSrc,
  alt,
  children,
  disabled = false,
  className = "inline-flex w-full items-center",
}: ImagePreviewHoverProps) {
  const { t } = useTranslation();
  const id = useId();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);

  const resolvedAlt = alt ?? t("blobInput.imagePreview", { defaultValue: "Image preview" });

  const show = (element: HTMLElement) => {
    if (disabled) return;
    const resolvedUrl = src ?? getSrc?.() ?? null;
    if (!resolvedUrl) return;

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

    setActiveSrc(resolvedUrl);
    setPosition({
      left,
      ...(showAbove
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  };

  const hide = () => {
    setPosition(null);
    setActiveSrc(null);
  };

  useEffect(() => {
    if (!position) return;

    const handleScrollOrResize = () => {
      hide();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [position]);

  return (
    <span
      className={className}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={hide}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={hide}
    >
      {cloneElement(children, {
        "aria-describedby": position && !disabled ? id : undefined,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          children.props.onKeyDown?.(event);
          if (event.key === "Escape" && position) {
            event.stopPropagation();
            hide();
          }
        },
      })}
      {position &&
        activeSrc &&
        !disabled &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-[200] rounded-md border border-strong bg-elevated p-1.5 shadow-xl pointer-events-none flex items-center justify-center max-w-[200px] max-h-[200px]"
            style={position}
          >
            <img
              src={activeSrc}
              alt={resolvedAlt}
              className="max-w-[180px] max-h-[180px] object-contain rounded"
              draggable={false}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
