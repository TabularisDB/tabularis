import { useTranslation } from "react-i18next";
import { useUpdate } from "./useUpdate";
import { usePluginRegistry } from "./usePluginRegistry";

export function useAvailableUpdates() {
  const { t } = useTranslation();
  const { availableUpdate } = useUpdate();
  const { updates } = usePluginRegistry();
  const coreCount = availableUpdate?.hasUpdate ? 1 : 0;
  const pluginCount = updates.length;
  const summary = [
    coreCount > 0 ? t("update.badges.core", { count: coreCount }) : null,
    pluginCount > 0 ? t("update.badges.plugins", { count: pluginCount }) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    coreCount,
    pluginCount,
    totalCount: coreCount + pluginCount,
    summary,
    coreTooltip: availableUpdate
      ? t("update.badges.coreDetails", {
          version: availableUpdate.latestVersion,
        })
      : "",
    pluginsTooltip: t("update.badges.plugins", { count: pluginCount }),
    pluginDetails: [
      ...updates.slice(0, 5).map(
        (plugin) => `${plugin.name} ${plugin.installed_version} → ${plugin.latest_version}`,
      ),
      ...(pluginCount > 5 ? [t("update.badges.morePlugins", { count: pluginCount - 5 })] : []),
    ],
  };
}
