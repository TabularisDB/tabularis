import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePluginRegistry } from "../../hooks/usePluginRegistry";
import { useToast } from "../../hooks/useToast";
import { useSettings } from "../../hooks/useSettings";

export function PluginUpdateToast() {
  const { updates, loading, error } = usePluginRegistry();
  const { showToast } = useToast();
  const { settings, isLoading: settingsLoading, updateSetting } = useSettings();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const notified = useRef(false);

  useEffect(() => {
    if (
      notified.current || settingsLoading || loading || error || updates.length === 0
    ) return;
    const unseen = updates.filter(
      (plugin) =>
        settings.notifiedPluginVersions?.[plugin.id] !== plugin.latest_version,
    );
    if (unseen.length === 0) return;
    notified.current = true;
    // Remember each shown release, not the batch: updating/removing one plugin
    // must not make the remaining, already-seen releases notify again.
    void updateSetting("notifiedPluginVersions", (previous) => ({
      ...previous,
      ...Object.fromEntries(
        unseen.map((plugin) => [plugin.id, plugin.latest_version]),
      ),
    }));
    const openPlugins = () => navigate("/settings?tab=plugins&filter=updates");
    showToast(t("update.badges.plugins", { count: unseen.length }), {
      kind: "update",
      title: t("update.badges.toastTitle"),
      duration: 12000,
      onClick: openPlugins,
      actions: [
        { label: t("update.badges.openPlugins"), onClick: openPlugins },
      ],
    });
  }, [
    updates, loading, error, settingsLoading, settings.notifiedPluginVersions,
    updateSetting, showToast, navigate, t,
  ]);

  return null;
}
