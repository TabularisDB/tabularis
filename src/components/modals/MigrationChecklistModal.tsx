import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X, ArrowLeftRight, Check, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import type { SavedConnection } from "../../contexts/DatabaseContext";
import type { PluginManifest } from "../../types/plugins";
import type { MigrationOutcome } from "../../hooks/useBuiltinDriverMigration";
import { findUnsupportedFeatures, type UnsupportedFeature } from "../../utils/findUnsupportedFeatures";
import { buildPluginIssueUrl } from "../../utils/pluginIssueReport";
import { useSettings } from "../../hooks/useSettings";
import { APP_VERSION } from "../../version";

interface MigrationChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Connections still on the built-in driver — the candidate set. */
  connections: SavedConnection[];
  /** The replacement plugin's manifest, for capability comparison. `undefined`
   * when the plugin isn't installed/loaded yet — every row is then shown with
   * no known gaps (nothing to compare against) but migration is still offered. */
  manifest: PluginManifest | undefined;
  /** Plugin repo URL, for "Report this gap" links. `undefined` disables the
   * report action (e.g. registry offline) rather than building a dead link. */
  repoUrl: string | undefined;
  pluginVersion: string;
  migrateConnection: (connectionId: string) => Promise<MigrationOutcome>;
}

type RowStatus = "pending" | "running" | "ok" | "connection" | "process";

/** One label per `UnsupportedFeature.feature` key, translated. The util
 * itself returns hardcoded English `label` text (it has no i18n access, by
 * design — it's a pure function with no framework dependency), so the modal
 * re-derives the display string from the stable `feature` key instead of
 * rendering `label` directly. */
function useGapLabel() {
  const { t } = useTranslation();
  return (feature: UnsupportedFeature["feature"]): string =>
    t(`migration.checklist.gap.${feature}`);
}

/**
 * Bulk migration review: multi-select the built-in connections to switch,
 * see which ones use a capability the plugin doesn't declare (unchecked by
 * default, per the design's safety property, but still migratable and
 * reportable), and migrate the checked set sequentially.
 *
 * Opened from the migration banner's "Review connections" link.
 */
export const MigrationChecklistModal = ({
  isOpen,
  onClose,
  connections,
  manifest,
  repoUrl,
  pluginVersion,
  migrateConnection,
}: MigrationChecklistModalProps) => {
  const { t } = useTranslation();
  const gapLabel = useGapLabel();
  const { settings, updateSetting } = useSettings();

  const rows = useMemo(
    () =>
      connections.map((conn) => ({
        conn,
        gaps: manifest ? findUnsupportedFeatures(conn.params, manifest) : [],
        isUriBased: conn.params.connection_uri_in_keychain === true,
      })),
    [connections, manifest],
  );

  // Unchecked by default when the connection has any capability gap, or when
  // it's connection-URI-based (its stored secret won't carry over — the same
  // safety property, since the user needs to notice and act before/after
  // migrating either way). Computed once per modal open; this component
  // unmounts/remounts with the parent's conditional render — see onClose.
  const [checked, setChecked] = useState<Set<string>>(
    () =>
      new Set(
        rows.filter((r) => r.gaps.length === 0 && !r.isUriBased).map((r) => r.conn.id),
      ),
  );
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [migrating, setMigrating] = useState(false);

  if (!isOpen) return null;

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const alreadyReported = (pluginId: string, feature: string): boolean =>
    (settings.knownCapabilityGaps?.[pluginId] ?? []).includes(feature);

  const handleReportGap = async (feature: UnsupportedFeature["feature"]) => {
    if (!manifest || !repoUrl) return;
    const url = buildPluginIssueUrl({
      pluginId: manifest.id,
      pluginVersion,
      repoUrl,
      appVersion: APP_VERSION,
      os: navigator.platform,
      template: "capability-gap",
      feature,
    });
    void openUrl(url);
    const existing = settings.knownCapabilityGaps?.[manifest.id] ?? [];
    if (!existing.includes(feature)) {
      await updateSetting("knownCapabilityGaps", {
        ...settings.knownCapabilityGaps,
        [manifest.id]: [...existing, feature],
      });
    }
  };

  const handleMigrateSelected = async () => {
    setMigrating(true);
    // Sequential, not Promise.all: each call writes connections.json via
    // update_connection — concurrent writes would race on the same file.
    for (const id of checked) {
      setRowStatus((prev) => ({ ...prev, [id]: "running" }));
      const outcome = await migrateConnection(id);
      setRowStatus((prev) => ({ ...prev, [id]: outcome.status }));
    }
    setMigrating(false);
  };

  const handleClose = () => {
    setRowStatus({});
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <ArrowLeftRight size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("migration.checklist.title")}
              </h2>
              <p className="text-xs text-secondary">
                {t("migration.checklist.subtitle", { count: rows.length })}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-3 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-secondary">{t("migration.checklist.noGaps")}</p>
          ) : (
            rows.map(({ conn, gaps, isUriBased }) => {
              const status = rowStatus[conn.id];
              return (
                <div
                  key={conn.id}
                  className="flex items-start gap-3 p-4 rounded-lg border border-default bg-base"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(conn.id)}
                    onChange={() => toggleChecked(conn.id)}
                    disabled={migrating}
                    className="mt-1 accent-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-primary text-sm truncate">
                        {conn.name}
                      </span>
                      {status === "running" && (
                        <Loader2 size={13} className="text-blue-400 animate-spin shrink-0" />
                      )}
                      {status === "ok" && (
                        <Check size={13} className="text-green-400 shrink-0" />
                      )}
                      {(status === "connection" || status === "process") && (
                        <AlertTriangle size={13} className="text-red-400 shrink-0" />
                      )}
                    </div>
                    {gaps.length > 0 && manifest && (
                      <div className="mt-1.5 space-y-1">
                        {gaps.map((gap) => {
                          const reported = alreadyReported(manifest.id, gap.feature);
                          return (
                            <div
                              key={gap.feature}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-amber-400">{gapLabel(gap.feature)}</span>
                              {reported ? (
                                <span className="text-muted shrink-0">
                                  {t("migration.checklist.alreadyReported")}
                                </span>
                              ) : (
                                <button
                                  onClick={() => void handleReportGap(gap.feature)}
                                  disabled={!repoUrl}
                                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                                >
                                  <ExternalLink size={11} />
                                  {t("migration.checklist.reportThisGap")}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {isUriBased && (
                      <p className="mt-1.5 text-xs text-amber-400/80">
                        {t("migration.checklist.uriWarning")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("migration.checklist.close")}
          </button>
          <button
            onClick={() => void handleMigrateSelected()}
            disabled={checked.size === 0 || migrating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {migrating && <Loader2 size={16} className="animate-spin" />}
            {t("migration.checklist.migrateSelected", { count: checked.size })}
          </button>
        </div>
      </div>
    </div>
  );
};
