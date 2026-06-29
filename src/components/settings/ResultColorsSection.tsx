import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { RotateCcw, Check, X } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { SettingSection, SettingRow, SettingToggle } from "./SettingControls";
import type { ResultValueType } from "../../utils/dataGrid";

const TYPES: { key: ResultValueType; sample: string }[] = [
  { key: "number", sample: "12345" },
  { key: "string", sample: "hello world" },
  { key: "date", sample: "2026-06-22" },
  { key: "boolean", sample: "true" },
];

export function ResultColorsSection() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { currentTheme } = useTheme();
  const [openType, setOpenType] = useState<ResultValueType | null>(null);
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined);

  const enabled = settings.resultColorByType ?? false;
  const overrides = settings.resultTypeColors ?? {};

  const effectiveColor = (type: ResultValueType) =>
    overrides[type] || currentTheme.colors.semantic[type];

  const setColor = (type: ResultValueType, color: string | undefined) => {
    const next = { ...overrides };
    if (color) next[type] = color.toLowerCase();
    else delete next[type];
    updateSetting("resultTypeColors", next);
  };

  const toggleOpen = (type: ResultValueType) => {
    if (openType === type) {
      setOpenType(null);
      return;
    }
    setSnapshot(overrides[type]);
    setOpenType(type);
  };

  const confirm = () => setOpenType(null);

  const cancel = (type: ResultValueType) => {
    setColor(type, snapshot);
    setOpenType(null);
  };

  return (
    <SettingSection
      title={t("settings.resultColors.title", { defaultValue: "Result Colors" })}
    >
      <SettingRow
        label={t("settings.resultColors.enable", {
          defaultValue: "Colorize values by type",
        })}
        description={t("settings.resultColors.enableDesc", {
          defaultValue: "Color query result cells based on their data type.",
        })}
      >
        <SettingToggle
          checked={enabled}
          onChange={(v) => updateSetting("resultColorByType", v)}
        />
      </SettingRow>

      {enabled && (
        <div className="mt-2 space-y-2">
          <div className="bg-base border border-default rounded-lg p-3 font-mono text-sm flex flex-wrap gap-x-6 gap-y-1">
            {TYPES.map(({ key, sample }) => (
              <span key={key} style={{ color: effectiveColor(key) }}>
                {sample}
              </span>
            ))}
          </div>

          {TYPES.map(({ key }) => {
            const color = effectiveColor(key);
            const isOverridden = !!overrides[key];
            const open = openType === key;
            return (
              <div key={key} className="rounded-lg border border-default bg-base">
                <div className="flex items-center justify-between px-3 py-2 gap-3">
                  <button
                    type="button"
                    onClick={() => toggleOpen(key)}
                    className="flex items-center gap-2.5 min-w-0"
                  >
                    <span
                      className="w-5 h-5 rounded-md ring-1 ring-white/10 shrink-0"
                      style={{ background: color }}
                    />
                    <span className="text-sm text-primary">
                      {t(`settings.resultColors.${key}`, { defaultValue: key })}
                    </span>
                    <span className="text-xs text-muted font-mono uppercase">
                      {color}
                    </span>
                  </button>
                  {isOverridden && (
                    <button
                      type="button"
                      onClick={() => setColor(key, undefined)}
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors shrink-0"
                    >
                      <RotateCcw size={12} />
                      {t("settings.resultColors.reset", {
                        defaultValue: "Reset to theme",
                      })}
                    </button>
                  )}
                </div>
                {open && (
                  <div className="px-3 pb-3 space-y-3">
                    <HexColorPicker
                      color={color}
                      onChange={(c) => setColor(key, c)}
                      style={{ width: "100%", maxWidth: 240, height: 140 }}
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-muted text-sm font-mono">#</span>
                      <HexColorInput
                        color={color}
                        onChange={(c) => setColor(key, c || undefined)}
                        prefixed={false}
                        aria-label={`${key} hex input`}
                        className="px-3 py-1.5 bg-elevated border border-strong rounded-md text-sm text-primary focus:border-blue-500 focus:outline-none font-mono w-28 uppercase"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => cancel(key)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-secondary hover:text-primary hover:bg-surface-secondary border border-strong transition-colors"
                      >
                        <X size={13} />
                        {t("settings.resultColors.cancel", {
                          defaultValue: "Cancel",
                        })}
                      </button>
                      <button
                        type="button"
                        onClick={confirm}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                      >
                        <Check size={13} />
                        {t("settings.resultColors.confirm", {
                          defaultValue: "Confirm",
                        })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingSection>
  );
}
