import type { ReactNode } from "react";
import clsx from "clsx";

export type InlineBannerTone = "amber" | "red" | "green" | "neutral";

const TONE_CLASS: Record<InlineBannerTone, string> = {
  amber: "bg-accent-warning/10 border-accent-warning/20 text-accent-warning",
  red: "bg-accent-error/10 border-accent-error/20 text-accent-error",
  green: "bg-accent-success/10 border-accent-success/20 text-accent-success",
  neutral: "bg-base border-default text-secondary",
};

/** Compact notice row used inside install dialogs: icon on the left, text on the right. */
export function InlineBanner({
  tone,
  icon,
  role,
  children,
}: {
  tone: InlineBannerTone;
  icon: ReactNode;
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <div role={role} className={clsx("rounded-lg border p-3 flex gap-2 text-xs", TONE_CLASS[tone])}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
