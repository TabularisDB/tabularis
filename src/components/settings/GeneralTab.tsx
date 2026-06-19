import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const { settings, updateSetting } = useSettings();

  return (
    <div>
      <SettingSection title={t`Startup`}>
        <SettingRow
          label={t`Show Welcome Screen`}
          description={t`Display the welcome screen when the application starts.`}
        >
          <SettingToggle
            checked={settings.showWelcome !== false}
            onChange={(v) => updateSetting("showWelcome", v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t`Data Editor`}>
        <SettingRow
          label={t`Result Page Size (Limit)`}
          description={t`Limits the number of rows fetched per query to prevent performance issues. Set to 0 to disable (not recommended).`}
        >
          <SettingNumberInput
            value={settings.resultPageSize ?? DEFAULT_SETTINGS.resultPageSize}
            onChange={(v) =>
              updateSetting("resultPageSize", v || DEFAULT_SETTINGS.resultPageSize)
            }
            min={0}
            suffix={t({ message: "rows", context: "settings" })}
            fallback={DEFAULT_SETTINGS.resultPageSize}
          />
        </SettingRow>

        <SettingRow
          label={t`Default Copy Format`}
          description={t`Choose the default format when copying rows with Ctrl+C / Cmd+C.`}
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
          label={t`CSV Delimiter`}
          description={t`Choose the default delimiter character used when copying or exporting rows as CSV.`}
        >
          <SettingButtonGroup
            value={settings.csvDelimiter ?? ","}
            onChange={(v) => updateSetting("csvDelimiter", v)}
            options={[
              { value: ",", label: t`Comma (,)` },
              { value: ";", label: t`Semicolon (;)` },
              { value: "\t", label: t`Tab` },
              { value: "|", label: t`Pipe (|)` },
            ]}
          />
        </SettingRow>

      </SettingSection>

      <SettingSection title={t`Connection Health Check`}>
        <SettingRow
          label={t`Ping Interval`}
          description={t`How often to check if active connections are still alive. Set to 0 to disable.`}
        >
          <SettingNumberInput
            value={settings.pingInterval ?? DEFAULT_SETTINGS.pingInterval ?? 30}
            onChange={(v) =>
              updateSetting("pingInterval", v ?? DEFAULT_SETTINGS.pingInterval ?? 30)
            }
            min={0}
            max={120}
            suffix={t`seconds`}
            fallback={DEFAULT_SETTINGS.pingInterval ?? 30}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t`Query History`}>
        <SettingRow
          label={t`Max History Entries`}
          description={t`Maximum number of query history entries stored per connection.`}
        >
          <SettingNumberInput
            value={settings.queryHistoryMaxEntries ?? DEFAULT_SETTINGS.queryHistoryMaxEntries ?? 500}
            onChange={(v) =>
              updateSetting("queryHistoryMaxEntries", v ?? DEFAULT_SETTINGS.queryHistoryMaxEntries ?? 500)
            }
            min={50}
            max={5000}
            suffix={t`entries`}
            fallback={DEFAULT_SETTINGS.queryHistoryMaxEntries ?? 500}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t`ER Diagram`}>
        <SettingRow
          label={t`Default Layout`}
          description={t`Choose the default layout direction for ER diagrams`}
        >
          <SettingButtonGroup<ERDiagramLayout>
            value={(settings.erDiagramDefaultLayout ?? DEFAULT_SETTINGS.erDiagramDefaultLayout) as ERDiagramLayout}
            onChange={(v) => updateSetting("erDiagramDefaultLayout", v)}
            options={[
              { value: "LR", label: t`Horizontal` },
              { value: "TB", label: t`Vertical` },
            ]}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
