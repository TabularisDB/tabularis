import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { normalizeMaskingPatterns } from "../../utils/columnMasking";
import { SettingRow } from "./SettingControls";

const TEXTAREA_CLASS =
  "w-full h-28 bg-base border border-strong rounded-lg p-3 text-primary text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors resize-y";

interface MaskingOverridesEditorProps {
  /** Saved connection the include/exclude lists apply to. */
  connectionId: string;
}

/**
 * Per-connection masking overrides (#485): "always mask" (include) and
 * "never mask" (exclude) lists, one `table.column` entry per line. Shared by
 * the Settings → Privacy tab and the connection modal's Privacy tab.
 *
 * Pass `key={connectionId}` from the caller so switching connections remounts
 * with fresh drafts.
 */
export function MaskingOverridesEditor({
  connectionId,
}: MaskingOverridesEditorProps) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const maskingEnabled = settings.columnMaskingEnabled ?? true;
  const overrides = settings.columnMaskingOverrides ?? {};
  const connOverride = overrides[connectionId] ?? {};
  const include = connOverride.include ?? [];
  const exclude = connOverride.exclude ?? [];

  // Textareas edit a draft and commit normalized values on blur so typing
  // trailing newlines doesn't fight the controlled value.
  const [includeDraft, setIncludeDraft] = useState<string | null>(null);
  const [excludeDraft, setExcludeDraft] = useState<string | null>(null);

  const commitOverride = (field: "include" | "exclude", raw: string) => {
    const list = normalizeMaskingPatterns(raw.split("\n"));
    const next = { ...overrides };
    const entry = { ...next[connectionId], [field]: list };
    if (!entry.include?.length && !entry.exclude?.length) {
      delete next[connectionId];
    } else {
      next[connectionId] = entry;
    }
    updateSetting("columnMaskingOverrides", next);
  };

  return (
    <>
      <SettingRow
        label={t("settings.maskingInclude")}
        description={t("settings.maskingIncludeDesc")}
        vertical
      >
        <textarea autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
          value={includeDraft ?? include.join("\n")}
          disabled={!maskingEnabled}
          onChange={(e) => setIncludeDraft(e.target.value)}
          onBlur={() => {
            if (includeDraft !== null) {
              commitOverride("include", includeDraft);
              setIncludeDraft(null);
            }
          }}
          className={TEXTAREA_CLASS}
          placeholder={t("settings.maskingOverridePlaceholder")}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.maskingExclude")}
        description={t("settings.maskingExcludeDesc")}
        vertical
      >
        <textarea autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
          value={excludeDraft ?? exclude.join("\n")}
          disabled={!maskingEnabled}
          onChange={(e) => setExcludeDraft(e.target.value)}
          onBlur={() => {
            if (excludeDraft !== null) {
              commitOverride("exclude", excludeDraft);
              setExcludeDraft(null);
            }
          }}
          className={TEXTAREA_CLASS}
          placeholder={t("settings.maskingOverridePlaceholder")}
        />
      </SettingRow>
    </>
  );
}
