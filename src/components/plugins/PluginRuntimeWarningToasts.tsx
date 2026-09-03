import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../hooks/useSettings";
import { useToast } from "../../hooks/useToast";

interface PluginRuntimeWarning {
  plugin_id: string;
  message: string;
}

/** How long a runtime warning toast stays visible, in ms. */
const WARNING_TOAST_DURATION = 12000;
/** Startup plugin loading overlaps the first render; look again after this delay. */
const STARTUP_RECHECK_DELAY = 5000;

/**
 * Surfaces non-fatal plugin warnings queued by the backend as toasts, for
 * example a development build loading a plugin whose `min_runtime_version`
 * is newer than the host. Renders nothing.
 *
 * The queue is drained on mount and whenever the enabled plugin set changes,
 * which is when plugins are (re)loaded through install or enable.
 */
export const PluginRuntimeWarningToasts = () => {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const { t } = useTranslation();
  const enabledKey = [...(settings.activeExternalDrivers ?? [])].sort().join(",");

  useEffect(() => {
    const drain = async () => {
      let warnings: PluginRuntimeWarning[];
      try {
        warnings = await invoke<PluginRuntimeWarning[]>("get_plugin_runtime_warnings");
      } catch {
        // Not running inside Tauri (tests, browser preview).
        return;
      }
      for (const warning of warnings) {
        showToast(warning.message, {
          kind: "warning",
          title: t("settings.plugins.devRuntimeWarning.title", { plugin: warning.plugin_id }),
          duration: WARNING_TOAST_DURATION,
        });
      }
    };

    void drain();
    const timer = window.setTimeout(() => void drain(), STARTUP_RECHECK_DELAY);
    return () => window.clearTimeout(timer);
  }, [enabledKey, showToast, t]);

  return null;
};
