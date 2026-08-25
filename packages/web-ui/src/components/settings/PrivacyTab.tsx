import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { useDatabase } from "../../hooks/useDatabase";
import {
  DEFAULT_MASKING_PATTERNS,
  normalizeMaskingPatterns,
} from "../../utils/columnMasking";
import { Select } from "../ui/Select";
import { MaskingOverridesEditor } from "./MaskingOverridesEditor";
import { SettingSection, SettingRow, SettingToggle } from "./SettingControls";

const TEXTAREA_CLASS =
  "w-full h-28 bg-base border border-strong rounded-lg p-3 text-primary text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors resize-y";

/** Privacy settings: sensitive-column masking in the results grid (#485). */
export function PrivacyTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { connections } = useDatabase();

  const maskingEnabled = settings.columnMaskingEnabled ?? true;
  const patterns = settings.columnMaskingPatterns ?? DEFAULT_MASKING_PATTERNS;

  // The patterns textarea edits a draft and commits normalized values on
  // blur so typing trailing newlines doesn't fight the controlled value.
  const [patternsDraft, setPatternsDraft] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string>("");

  const connId = selectedConnId || connections[0]?.id || "";

  return (
    <div>
      <SettingSection
        title={t("settings.columnMasking")}
        description={t("settings.columnMaskingDesc")}
      >
        <SettingRow
          label={t("settings.columnMaskingEnabled")}
          description={t("settings.columnMaskingEnabledDesc")}
        >
          <SettingToggle
            checked={maskingEnabled}
            onChange={(v) => updateSetting("columnMaskingEnabled", v)}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.maskingPatterns")}
          description={t("settings.maskingPatternsDesc")}
          vertical
        >
          <textarea autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            value={patternsDraft ?? patterns.join("\n")}
            disabled={!maskingEnabled}
            onChange={(e) => setPatternsDraft(e.target.value)}
            onBlur={() => {
              if (patternsDraft !== null) {
                updateSetting(
                  "columnMaskingPatterns",
                  normalizeMaskingPatterns(patternsDraft.split("\n")),
                );
                setPatternsDraft(null);
              }
            }}
            className={TEXTAREA_CLASS}
            placeholder={DEFAULT_MASKING_PATTERNS.join("\n")}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title={t("settings.maskingOverrides")}
        description={t("settings.maskingOverridesDesc")}
      >
        <SettingRow
          label={t("settings.maskingConnection")}
          description={t("settings.maskingConnectionDesc")}
        >
          <Select
            value={connId || null}
            options={connections.map((c) => c.id)}
            labels={Object.fromEntries(connections.map((c) => [c.id, c.name]))}
            onChange={setSelectedConnId}
            disabled={!maskingEnabled || connections.length === 0}
            searchable={connections.length > 8}
            className="w-56"
          />
        </SettingRow>

        {connId && (
          <MaskingOverridesEditor key={connId} connectionId={connId} />
        )}
      </SettingSection>
    </div>
  );
}
