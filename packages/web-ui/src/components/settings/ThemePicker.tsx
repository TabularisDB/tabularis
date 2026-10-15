import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Monitor } from "lucide-react";
import clsx from "clsx";
import type { Theme } from "../../types/theme";

interface ThemePickerProps {
  value: string;
  onChange: (themeId: string) => void;
  themes: Theme[];
  showSameAsApp?: boolean;
  disabled?: boolean;
  isUnavailable?: (theme: Theme) => boolean;
  renderActions?: (theme: Theme) => ReactNode;
  renderDetails?: (theme: Theme) => ReactNode;
}

export function ThemePicker({
  value, onChange, themes, showSameAsApp, disabled = false,
  isUnavailable, renderActions, renderDetails,
}: ThemePickerProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {showSameAsApp && (
        <button
          type="button" disabled={disabled} aria-pressed={!value}
          onClick={() => onChange("")}
          className={clsx(
            "p-3 rounded-xl border transition-all text-left disabled:opacity-50",
            !value
              ? "bg-surface-secondary border-accent-primary shadow-sm"
              : "bg-base border-default hover:border-strong",
          )}
        >
          <div className="flex items-center gap-2 mb-3">
            <Monitor size={16} className="text-muted" />
            <span className="text-sm font-medium text-primary">{t("settings.appearance_sameAsApp")}</span>
          </div>
          {!value && <CheckCircle2 size={14} className="text-accent" />}
        </button>
      )}

      {themes.map((theme) => {
        const unavailable = isUnavailable?.(theme) ?? false;
        const selected = value === theme.id && !unavailable;
        const actions = renderActions?.(theme);
        return (
          <div key={theme.id} className={clsx(
            "relative flex min-w-0 flex-col rounded-xl border transition-colors",
            selected ? "bg-surface-secondary border-accent-primary shadow-sm"
              : "bg-base border-default hover:border-strong",
          )}>
            {/* Selection and management are siblings, never nested buttons. */}
            <button
              type="button" disabled={disabled || unavailable} aria-label={theme.name} aria-pressed={selected}
              onClick={() => onChange(theme.id)}
              className={clsx("flex-1 rounded-xl p-3 text-left focus-visible:outline focus-visible:outline-focus disabled:cursor-not-allowed", unavailable && "opacity-45", disabled && "opacity-50")}
            >
              <div className={clsx("flex items-center gap-2 mb-3", actions && "pr-6")}>
                <div aria-hidden="true" className="w-5 h-5 shrink-0 rounded-full border border-strong"
                  style={{ background: `linear-gradient(135deg, ${theme.colors.accent.primary} 50%, ${theme.colors.accent.secondary} 50%)` }} />
                <span className="text-xs font-medium text-primary break-words">{theme.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <span aria-hidden="true" className="w-3.5 h-3.5 rounded" style={{ backgroundColor: theme.colors.bg.base }} />
                <span aria-hidden="true" className="w-3.5 h-3.5 rounded" style={{ backgroundColor: theme.colors.surface.primary }} />
                <span aria-hidden="true" className="w-3.5 h-3.5 rounded" style={{ backgroundColor: theme.colors.accent.primary }} />
                {unavailable && <span className="ml-1 text-[10px] text-muted">{t("themePackages.disabled")}</span>}
                {selected && <CheckCircle2 size={13} className="ml-auto text-accent" />}
              </div>
            </button>
            {actions && <div className="absolute right-1.5 top-1.5">{actions}</div>}
            {renderDetails && <div className="px-3 pb-2.5 text-[10px] text-muted">{renderDetails(theme)}</div>}
          </div>
        );
      })}
    </div>
  );
}
