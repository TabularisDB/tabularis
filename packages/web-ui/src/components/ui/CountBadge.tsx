import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { NEUTRAL_CHIP_CLASS, toneStyle, type Tone } from "../../utils/tones";

export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  tone?: Tone;
  icon?: ReactNode;
}

/**
 * Compact numeric pill used wherever a count decorates a navigation target:
 * sidebar rail, settings navigation and plugin filter tabs. Renders nothing
 * for zero so callers do not have to guard.
 */
export function CountBadge({ count, tone = "neutral", icon, className, style, ...props }: CountBadgeProps) {
  if (count === 0) return null;
  return (
    <span
      {...props}
      className={clsx(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center gap-0.5 rounded-full border px-1 text-[10px] font-semibold leading-none tabular-nums",
        tone === "neutral" && NEUTRAL_CHIP_CLASS,
        className,
      )}
      style={{ ...toneStyle(tone, { border: 28, text: 35 }), ...style }}
    >
      {icon}
      {count}
    </span>
  );
}
