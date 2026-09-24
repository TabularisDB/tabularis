import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { NEUTRAL_CHIP_CLASS, TONE_DOT_CLASS, toneStyle, type Tone } from "../../utils/tones";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** `rounded` for attributes, `pill` for live states (active, open, update). */
  shape?: "rounded" | "pill";
  /** `md` is the standard chip; `sm` fits inline counters such as filter tabs. */
  size?: "sm" | "md";
  /** Leading status dot; `pulse` for live activity. */
  dot?: "static" | "pulse";
  icon?: ReactNode;
  uppercase?: boolean;
  /** `ghost` drops the border and lowers contrast: for taxonomy tokens (kind, tags), never for state. */
  variant?: "solid" | "ghost";
  children?: ReactNode;
}

/**
 * The single chip primitive for connection cards, plugin cards and the settings
 * navigation. Every tag, status and badge in those views goes through here so
 * geometry, typography and colour semantics stay identical across screens.
 */
export function Chip({
  tone = "neutral",
  shape = "rounded",
  size = "md",
  dot,
  icon,
  uppercase = false,
  variant = "solid",
  className,
  style,
  children,
  ...props
}: ChipProps) {
  return (
    <span
      {...props}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap border",
        variant === "ghost" ? "border-transparent font-medium" : "font-semibold",
        size === "sm" ? "px-1.5 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        shape === "pill" ? "rounded-full" : "rounded-md",
        uppercase && "uppercase tracking-wide",
        tone === "neutral" && (variant === "ghost" ? "bg-surface-secondary/50 text-muted" : NEUTRAL_CHIP_CLASS),
        className,
      )}
      style={{ ...toneStyle(tone), ...(variant === "ghost" ? { borderColor: "transparent" } : {}), ...style }}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={clsx(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            TONE_DOT_CLASS[tone],
            dot === "pulse" && "animate-pulse",
          )}
        />
      )}
      {icon}
      {children}
    </span>
  );
}
