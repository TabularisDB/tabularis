import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "../../i18n/config";
import { SettingSection, SettingRow } from "./SettingControls";
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
  const { t, i18n } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const langOptions = useMemo(() => ["auto", ...SUPPORTED_LANGUAGES.map((l) => l.id)], []);
  // Native name first, plus the name in the current UI language so both are searchable.
  const langLabels = useMemo(() => {
    let displayNames: Intl.DisplayNames | undefined;
    try {
      displayNames = new Intl.DisplayNames([i18n.language], { type: "language" });
    } catch {
      displayNames = undefined;
    }
    const labels: Record<string, string> = { auto: t("settings.auto") };
    for (const { id, label } of SUPPORTED_LANGUAGES) {
      const localized = displayNames?.of(id);
      labels[id] =
        localized && localized.toLowerCase() !== label.toLowerCase()
          ? `${label} (${localized})`
          : label;
    }
    return labels;
  }, [t, i18n.language]);

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
    // dayBucket is intentionally a dependency: it changes once per calendar day
    // so a long-running window refreshes DST/offset labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, t, dayBucket]);

  return (
    <div>
      <SettingSection title={t("settings.localization")}>
        <SettingRow
          label={t("settings.language")}
          description={t("settings.languageDesc")}
          vertical
        >
          <Select
            value={settings.language ?? "auto"}
            options={langOptions}
            labels={langLabels}
            onChange={(v) => updateSetting("language", v as AppLanguage)}
            searchable
            searchPlaceholder={t("settings.languageSearch")}
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
