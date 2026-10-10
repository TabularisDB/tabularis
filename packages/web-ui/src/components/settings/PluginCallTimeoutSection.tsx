import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { SettingSection, SettingRow } from "./SettingControls";
import {
  DEFAULT_PLUGIN_CALL_TIMEOUT_SECONDS,
  MAX_PLUGIN_CALL_TIMEOUT_SECONDS,
  parseCallTimeoutSeconds,
} from "../../utils/pluginConfig";

/** Global default for how long the host waits on a single plugin call. */
export function PluginCallTimeoutSection() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const current =
    settings.pluginCallTimeoutSeconds ?? DEFAULT_PLUGIN_CALL_TIMEOUT_SECONDS;
  const [draft, setDraft] = useState(String(current));

  const commit = () => {
    const seconds =
      parseCallTimeoutSeconds(draft) ?? DEFAULT_PLUGIN_CALL_TIMEOUT_SECONDS;
    setDraft(String(seconds));
    if (seconds !== current) {
      void updateSetting("pluginCallTimeoutSeconds", seconds);
    }
  };

  return (
    <SettingSection
      title={t("settings.plugins.runtimeTitle")}
      icon={<Timer size={12} className="text-muted" />}
    >
      <SettingRow
        label={t("settings.plugins.callTimeout")}
        description={t("settings.plugins.callTimeoutDesc")}
      >
        <div className="flex items-center gap-2">
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            type="number"
            min={0}
            max={MAX_PLUGIN_CALL_TIMEOUT_SECONDS}
            step={1}
            value={draft}
            aria-label={t("settings.plugins.callTimeout")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="bg-base border border-strong rounded px-3 py-2 text-primary w-24 focus:outline-none focus:border-focus transition-colors"
          />
          <span className="text-sm text-muted">{t("settings.seconds")}</span>
        </div>
      </SettingRow>
    </SettingSection>
  );
}
