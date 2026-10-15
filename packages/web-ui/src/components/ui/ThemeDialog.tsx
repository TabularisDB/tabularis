import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { Modal } from "./Modal";

interface ThemeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Second header line, same slot as the plugin modals' subtitle. */
  subtitle?: string;
  /** Header icon; rendered in the theme-tinted tile the plugin modals use. */
  icon?: ReactNode;
  children: ReactNode;
  /** Sticky action row under the scrollable body. */
  footer?: ReactNode;
  /** Width utility; the install dialog matches the plugin install modal. */
  widthClass?: string;
  busy?: boolean;
}

/** Theme workflows share focus containment and restore the invoking control. */
export function ThemeDialog({ isOpen, onClose, title, subtitle, icon, children, footer, widthClass = "w-[600px]", busy = false }: ThemeDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const subtitleId = useId();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const initial = container.current?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)");
    (initial ?? container.current)?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }}>
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the dialog owns its Tab focus trap; the rule exempts <dialog> but not role="dialog" */}
    <div ref={container} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined} aria-busy={busy || undefined} tabIndex={-1}
      className={`bg-elevated text-primary border border-strong rounded-xl shadow-2xl ${widthClass} max-w-[calc(100vw-32px)] max-h-[90dvh] overflow-hidden flex flex-col outline-none`}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(container.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]') ?? []).filter((element) =>
          element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
        const first = controls[0]; const last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === container.current)) { event.preventDefault(); first.focus(); }
      }}>
      <div className="flex shrink-0 items-start justify-between gap-4 p-4 border-b border-default bg-base">
        <div className="flex items-center gap-3 min-w-0">
          {icon && <div className="p-2 rounded-lg bg-accent-secondary/15 text-accent-secondary shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-primary break-words">{title}</h2>
            {subtitle && <p id={subtitleId} className="mt-1 text-xs text-secondary break-words">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && <Loader2 size={16} className="animate-spin text-accent" role="status" aria-label={t("themePackages.loading")} />}
          <button type="button" disabled={busy} onClick={onClose} aria-label={t("common.close")} className="p-2 -mr-1 rounded-lg text-secondary hover:text-primary hover:bg-surface-secondary transition-colors focus-visible:outline focus-visible:outline-focus disabled:opacity-50 disabled:cursor-not-allowed"><X size={20} /></button>
        </div>
      </div>
      <div className="min-h-0 p-6 space-y-5 overflow-y-auto overscroll-contain">{children}</div>
      {footer && <div className="shrink-0 p-4 border-t border-default bg-base/50 flex flex-wrap items-center justify-end gap-3">{footer}</div>}
    </div>
  </Modal>;
}
