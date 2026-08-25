import { useTranslation } from "react-i18next";
import { CheckCircle2, Monitor } from "lucide-react";
import clsx from "clsx";
import type { Theme } from "../../types/theme";

interface ThemePickerProps {
  value: string;
  onChange: (themeId: string) => void;
  themes: Theme[];
  showSameAsApp?: boolean;
}

export function ThemePicker({
  value,
  onChange,
  themes,
  showSameAsApp,
}: ThemePickerProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {showSameAsApp && (
        <button
          onClick={() => onChange("")}
          className={clsx(
            "p-3 rounded-xl border transition-all text-left",
            !value
              ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
              : "bg-base border-default hover:border-strong",
          )}
        >
          <div className="flex items-center gap-2 mb-3">
            <Monitor size={16} className="text-muted" />
            <span className="text-sm font-medium text-primary">
              {t("settings.appearance_sameAsApp")}
            </span>
          </div>
          {!value && <CheckCircle2 size={14} className="text-blue-500" />}
        </button>
      )}

      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onChange(theme.id)}
          className={clsx(
            "p-3 rounded-xl border transition-all text-left",
            value === theme.id
              ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
              : "bg-base border-default hover:border-strong",
          )}
        >
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-6 h-6 rounded-full border border-strong"
              style={{
                background: `linear-gradient(135deg, ${theme.colors.accent.primary} 50%, ${theme.colors.accent.secondary} 50%)`,
              }}
            />
            <span className="text-sm font-medium text-primary">
              {theme.name}
            </span>
          </div>
          <div className="flex gap-1">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: theme.colors.bg.base }}
            />
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: theme.colors.surface.primary }}
            />
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: theme.colors.accent.primary }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}
