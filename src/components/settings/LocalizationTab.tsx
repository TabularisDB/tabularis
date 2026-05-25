import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "../../i18n/config";
import { SettingSection, SettingRow, SettingButtonGroup } from "./SettingControls";
import { Select } from "../ui/Select";

/** All IANA timezone names supported by the runtime, or [] if unavailable. */
function supportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/** Current UTC offset of a zone as "UTC+09:00" / "UTC-05:00" / "UTC+05:30". */
function zoneOffset(zone: string, at: Date): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    // "GMT" for UTC, otherwise "GMT+09:00" / "GMT-05:00".
    return !name || name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");
  } catch {
    return "UTC+00:00";
  }
}

export function LocalizationTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const options: Array<{ value: AppLanguage; label: string }> = [
    { value: "auto", label: t("settings.auto") },
    ...SUPPORTED_LANGUAGES.map(({ id, label }) => ({ value: id, label })),
  ];

  const zones = useMemo(() => supportedTimezones(), []);
  const tzOptions = useMemo(() => ["auto", ...zones], [zones]);
  // Recompute offset labels when the calendar day changes so a long-running
  // window picks up DST transitions (the labels show the *current* offset).
  const dayBucket = new Date().toISOString().slice(0, 10);
  const tzLabels = useMemo(() => {
    const now = new Date();
    const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const labels: Record<string, string> = {
      auto: `${t("settings.auto")} (${zoneOffset(systemZone, now)})`,
    };
    for (const zone of zones) {
      labels[zone] = `${zone} (${zoneOffset(zone, now)})`;
    }
    return labels;
  }, [zones, t, dayBucket]);

  return (
    <div>
      <SettingSection title={t("settings.localization")}>
        <SettingRow
          label={t("settings.language")}
          description={t("settings.languageDesc")}
          vertical
        >
          <SettingButtonGroup
            value={settings.language ?? "auto"}
            onChange={(v) => updateSetting("language", v)}
            options={options}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.timezone")}
          description={t("settings.timezoneDesc")}
          vertical
        >
          <Select
            value={settings.displayTimezone ?? "auto"}
            options={tzOptions}
            labels={tzLabels}
            onChange={(v) => updateSetting("displayTimezone", v)}
            searchable
            searchPlaceholder={t("settings.timezoneSearch")}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
