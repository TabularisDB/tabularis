import type { ComponentPropsWithRef, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import clsx from "clsx";

interface ThemeDialogButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  icon?: ReactNode;
}

/** Shared action styling for theme workflows, including pending and destructive states. */
export function ThemeDialogButton({ variant = "secondary", busy = false, disabled, icon, children, className, ...props }: ThemeDialogButtonProps) {
  return <button {...props} type={props.type ?? "button"} disabled={disabled || busy} aria-busy={busy || undefined}
    className={clsx("inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 disabled:cursor-not-allowed", {
      "bg-accent-primary border-transparent text-inverse enabled:hover:opacity-90": variant === "primary",
      "bg-base border-strong text-secondary enabled:hover:bg-surface-secondary enabled:hover:text-primary": variant === "secondary",
      "bg-accent-error border-transparent text-on-accent-error enabled:hover:opacity-90": variant === "danger",
    }, className)}>
    {busy ? <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" /> : icon}
    {children}
  </button>;
}
