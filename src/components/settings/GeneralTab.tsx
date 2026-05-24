import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { DEFAULT_SETTINGS, type CopyFormat, type ERDiagramLayout } from "../../contexts/SettingsContext";
import {
  SettingSection,
  SettingRow,
  SettingToggle,
  SettingButtonGroup,
  SettingNumberInput,
} from "./SettingControls";

export function GeneralTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  return (
    <div>
      <SettingSection title={t("settings.startup")}>
        <SettingRow
          label={t("settings.showWelcome")}
          description={t("settings.showWelcomeDesc")}
        >
          <SettingToggle
            checked={settings.showWelcome !== false}
            onChange={(v) => updateSetting("showWelcome", v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t("settings.dataEditor")}>
        <SettingRow
          label={t("settings.pageSize")}
          description={t("settings.pageSizeDesc")}
        >
          <SettingNumberInput
            value={settings.resultPageSize ?? DEFAULT_SETTINGS.resultPageSize}
            onChange={(v) =>
              updateSetting("resultPageSize", v || DEFAULT_SETTINGS.resultPageSize)
            }
            min={0}
            suffix={t("settings.rows")}
            fallback={DEFAULT_SETTINGS.resultPageSize}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.copyFormat")}
          description={t("settings.copyFormatDesc")}
        >
          <SettingButtonGroup<CopyFormat>
            value={(settings.copyFormat ?? DEFAULT_SETTINGS.copyFormat) as CopyFormat}
            onChange={(v) => updateSetting("copyFormat", v)}
            options={[
              { value: "csv", label: "CSV" },
              { value: "json", label: "JSON" },
              { value: "sql-insert", label: "SQL INSERT" },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.csvDelimiter")}
          description={t("settings.csvDelimiterDesc")}
        >
          <SettingButtonGroup
            value={settings.csvDelimiter ?? ","}
            onChange={(v) => updateSetting("csvDelimiter", v)}
            options={[
              { value: ",", label: t("settings.delimiterComma") },
              { value: ";", label: t("settings.delimiterSemicolon") },
              { value: "\t", label: t("settings.delimiterTab") },
              { value: "|", label: t("settings.delimiterPipe") },
            ]}
          />
        </SettingRow>

      </SettingSection>

      <SettingSection title={t("settings.connectionHealthCheck")}>
        <SettingRow
          label={t("settings.pingInterval")}
          description={t("settings.pingIntervalDesc")}
        >
          <SettingNumberInput
            value={settings.pingInterval ?? DEFAULT_SETTINGS.pingInterval ?? 30}
            onChange={(v) =>
              updateSetting("pingInterval", v ?? DEFAULT_SETTINGS.pingInterval ?? 30)
            }
            min={0}
            max={120}
            suffix={t("settings.seconds")}
            fallback={DEFAULT_SETTINGS.pingInterval ?? 30}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t("settings.queryHistory")}>
        <SettingRow
          label={t("settings.queryHistoryMaxEntries")}
          description={t("settings.queryHistoryMaxEntriesDesc")}
        >
          <SettingNumberInput
            value={settings.queryHistoryMaxEntries ?? DEFAULT_SETTINGS.queryHistoryMaxEntries ?? 500}
            onChange={(v) =>
              updateSetting("queryHistoryMaxEntries", v ?? DEFAULT_SETTINGS.queryHistoryMaxEntries ?? 500)
            }
            min={50}
            max={5000}
            suffix={t("settings.entries")}
            fallback={DEFAULT_SETTINGS.queryHistoryMaxEntries ?? 500}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t("settings.erDiagram")}>
        <SettingRow
          label={t("settings.erDiagramDefaultLayout")}
          description={t("settings.erDiagramDefaultLayoutDesc")}
        >
          <SettingButtonGroup<ERDiagramLayout>
            value={(settings.erDiagramDefaultLayout ?? DEFAULT_SETTINGS.erDiagramDefaultLayout) as ERDiagramLayout}
            onChange={(v) => updateSetting("erDiagramDefaultLayout", v)}
            options={[
              { value: "LR", label: t("erDiagram.horizontal") },
              { value: "TB", label: t("erDiagram.vertical") },
            ]}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
