import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MigrationBannerVariant } from "../../hooks/useBuiltinDriverMigration";

interface PostgresPluginMigrationBannerProps {
  /** "nudge" → the "try the plugin" message; "offline" → the "couldn't be
   * downloaded" message. Driven by the connectivity gate in the hook. */
  variant: MigrationBannerVariant;
  /** Called when the user dismisses the banner (persists the dismissal). */
  onDismiss: () => void;
  /** Called when the user clicks "Review connections" (nudge variant only). */
  onReview?: () => void;
}

/**
 * Inline (non-modal) dismissible banner nudging the user toward the
 * PostgreSQL plugin. Rendered inside the Connections page, not stacked in
 * App.tsx's launch-time modals — a non-blocking recommendation, not a
 * required confirmation.
 *
 * Two variants: the nudge (plugin ready, registry reachable) and the honest
 * offline message (plugin not downloaded / registry unreachable). The
 * offline variant never offers a "Switch to plugin" action it can't back up.
 */
export const PostgresPluginMigrationBanner = ({
  variant,
  onDismiss,
  onReview,
}: PostgresPluginMigrationBannerProps) => {
  const { t } = useTranslation();

  return (
    <div className="mx-6 mt-4 p-3.5 bg-blue-900/20 border border-blue-900/40 rounded-xl flex items-start gap-3 text-blue-400 shrink-0">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        {variant === "nudge" ? (
          <span className="text-sm whitespace-pre-wrap leading-relaxed block">
            {t("migration.banner.nudge")}
          </span>
        ) : (
          <span className="text-sm whitespace-pre-wrap leading-relaxed block">
            {t("migration.banner.offline")}
          </span>
        )}
        {variant === "nudge" && onReview && (
          <button
            onClick={onReview}
            className="mt-2 text-xs text-blue-400/90 hover:text-blue-300 transition-colors underline underline-offset-2"
          >
            {t("migration.banner.reviewConnections")}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-blue-400/50 hover:text-blue-400 transition-colors shrink-0 mt-0.5"
        aria-label={t("common.dismiss")}
      >
        <X size={14} />
      </button>
    </div>
  );
};
