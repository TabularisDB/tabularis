import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Monitor, Code2 } from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { getFontCSS } from "../../utils/settings";
import {
  SettingSection,
  SettingRow,
  SettingToggle,
  SettingButtonGroup,
  SettingSlider,
} from "./SettingControls";
import { FontPicker } from "./FontPicker";
import { ThemePicker } from "./ThemePicker";

export function AppearanceTab() {
  const { t } = useLingui();
  const { settings, updateSetting } = useSettings();
  const { currentTheme, allThemes, setTheme } = useTheme();
  const [subTab, setSubTab] = useState<"general" | "editor">("general");

  return (
    <div>
      {/* Sub-tab switcher */}
      <div className="flex gap-1 p-1 bg-surface-secondary/40 rounded-xl border border-default w-fit mb-6">
        <button
          onClick={() => setSubTab("general")}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            subTab === "general"
              ? "bg-elevated text-primary shadow-sm"
              : "text-muted hover:text-primary",
          )}
        >
          <Monitor size={15} />
          {t({ message: "General", context: "settings" })}
        </button>
        <button
          onClick={() => setSubTab("editor")}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            subTab === "editor"
              ? "bg-elevated text-primary shadow-sm"
              : "text-muted hover:text-primary",
          )}
        >
          <Code2 size={15} />
          {t`SQL Editor`}
        </button>
      </div>

      {/* General sub-tab */}
      {subTab === "general" && (
        <>
          <SettingSection title={t`Theme Selection`}>
            <div className="py-3">
              <ThemePicker
                value={currentTheme.id}
                onChange={setTheme}
                themes={allThemes}
              />
            </div>
          </SettingSection>

          <SettingSection title={t`Font Family`}>
            <div className="py-3">
              <FontPicker
                value={settings.fontFamily ?? "System"}
                onChange={(f) => updateSetting("fontFamily", f)}
                getPreviewCSS={(name) =>
                  name === "System"
                    ? "system-ui, -apple-system, sans-serif"
                    : `"${name}", ${name}`
                }
                inputId="custom-font-input"
              />
            </div>
          </SettingSection>

          <SettingSection title={t`Font Size`}>
            <SettingRow
              label={t`Font Size`}
              description={t`Adjust the base font size used throughout the application (10-20px).`}
            >
              <SettingSlider
                value={settings.fontSize || 14}
                onChange={(v) => updateSetting("fontSize", v)}
                min={10}
                max={20}
                step={1}
                formatValue={(v) => `${v}px`}
              />
            </SettingRow>
            <div className="bg-base border border-default rounded-lg p-4 mt-2">
              <p className="text-xs text-muted mb-2">
                {t({ message: "Preview", context: "settings" })}:
              </p>
              <p
                className="text-primary"
                style={{ fontSize: `${settings.fontSize || 14}px` }}
              >
                Aa Bb Cc 123 - {t`The quick brown fox jumps over the lazy dog`}
              </p>
            </div>
          </SettingSection>
        </>
      )}

      {/* Editor sub-tab */}
      {subTab === "editor" && (
        <>
          <SettingSection title={t`Editor Theme`}>
            <p className="text-xs text-muted mb-3">
              {t`Choose an independent theme for the SQL editor, or keep it in sync with the app theme.`}
            </p>
            <div className="py-1">
              <ThemePicker
                value={settings.editorTheme ?? ""}
                onChange={(id) => updateSetting("editorTheme", id)}
                themes={allThemes}
                showSameAsApp
              />
            </div>
          </SettingSection>

          <SettingSection title={t`Editor Font Family`}>
            <div className="py-3">
              <FontPicker
                value={settings.editorFontFamily ?? "JetBrains Mono"}
                onChange={(f) => updateSetting("editorFontFamily", f)}
                getPreviewCSS={getFontCSS}
                inputId="custom-editor-font-input"
              />
            </div>
          </SettingSection>

          <SettingSection title={t`Editor Font Size`}>
            <SettingRow label={t`Editor Font Size`}>
              <SettingSlider
                value={settings.editorFontSize ?? 14}
                onChange={(v) => updateSetting("editorFontSize", v)}
                min={10}
                max={20}
                step={1}
                formatValue={(v) => `${v}px`}
              />
            </SettingRow>

            <SettingRow label={t`Line Height`}>
              <SettingSlider
                value={settings.editorLineHeight ?? 1.5}
                onChange={(v) => updateSetting("editorLineHeight", v)}
                min={1.0}
                max={2.5}
                step={0.1}
                formatValue={(v) => v.toFixed(1)}
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t`Tab Size`}>
            <SettingRow label={t`Tab Size`}>
              <SettingButtonGroup
                value={settings.editorTabSize ?? 2}
                onChange={(v) => updateSetting("editorTabSize", v)}
                options={[
                  { value: 2, label: "2" },
                  { value: 4, label: "4" },
                  { value: 8, label: "8" },
                ]}
                mono
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t`Word Wrap`}>
            <SettingRow
              label={t`Word Wrap`}
              description={t`Wrap long lines in the editor instead of scrolling horizontally.`}
            >
              <SettingToggle
                checked={settings.editorWordWrap ?? true}
                onChange={(v) => updateSetting("editorWordWrap", v)}
              />
            </SettingRow>

            <SettingRow
              label={t`Show Line Numbers`}
              description={t`Display line numbers in the editor gutter.`}
            >
              <SettingToggle
                checked={settings.editorShowLineNumbers ?? true}
                onChange={(v) => updateSetting("editorShowLineNumbers", v)}
              />
            </SettingRow>

            <SettingRow
              label={t`Accept Suggestion with Enter`}
              description={t`Allow Enter (in addition to Tab) to accept the active autocomplete suggestion. When off, Enter always inserts a newline.`}
            >
              <SettingToggle
                checked={settings.editorAcceptSuggestionOnEnter ?? true}
                onChange={(v) =>
                  updateSetting("editorAcceptSuggestionOnEnter", v)
                }
              />
            </SettingRow>
          </SettingSection>
        </>
      )}
    </div>
  );
}
