import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Settings, X, FolderOpen, RotateCcw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "../ui/Modal";
import { Select } from "../ui/Select";
import { SlotAnchor } from "../ui/SlotAnchor";
import { resolvePluginConfig, getDisplayInterpreter, resolveSettingsWithDefaults, validateSettings } from "../../utils/pluginConfig";
import type { PluginConfig } from "../../contexts/SettingsContext";
import type { PluginManifest, PluginSettingDefinition } from "../../types/plugins";

interface PluginSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginId: string;
  pluginName: string;
  currentConfig?: PluginConfig;
  manifest?: PluginManifest;
  onSave: (config: PluginConfig) => void;
}

export const PluginSettingsModal = ({
  isOpen,
  onClose,
  pluginId,
  currentConfig,
  manifest,
  onSave,
}: PluginSettingsModalProps) => {
  const { t } = useTranslation();
  const [interpreter, setInterpreter] = useState(getDisplayInterpreter(currentConfig));

  const definitions = manifest?.settings ?? [];

  const [dynamicValues, setDynamicValues] = useState<Record<string, unknown>>(() =>
    resolveSettingsWithDefaults(definitions, currentConfig?.settings),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const getSettingLabel = useCallback(
    (def: PluginSettingDefinition) =>
      t(
        `settings.plugins.pluginSettings.builtin.${pluginId}.${def.key}.label`,
        { defaultValue: def.label },
      ),
    [pluginId, t],
  );

  const getSettingDescription = useCallback(
    (def: PluginSettingDefinition) =>
      def.description
        ? t(
            `settings.plugins.pluginSettings.builtin.${pluginId}.${def.key}.description`,
            { defaultValue: def.description },
          )
        : undefined,
    [pluginId, t],
  );

  const handleBrowse = async () => {
    const selected = await open({ multiple: false, directory: false });
    if (selected) setInterpreter(selected);
  };

  const handleDynamicChange = useCallback((key: string, value: unknown) => {
    setDynamicValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleResetField = useCallback(
    (def: PluginSettingDefinition) => {
      if (def.default === undefined) return;
      handleDynamicChange(def.key, def.default);
    },
    [handleDynamicChange],
  );

  const handleSave = () => {
    const validationErrors = validateSettings(definitions, dynamicValues);
    if (Object.keys(validationErrors).length > 0) {
      const errorMessages: Record<string, string> = {};
      for (const [key, label] of Object.entries(validationErrors)) {
        errorMessages[key] = t("settings.plugins.pluginSettings.fieldRequired", { label });
      }
      setErrors(errorMessages);
      return;
    }

    const baseConfig = resolvePluginConfig(currentConfig, interpreter);
    const mergedSettings =
      definitions.length > 0
        ? { ...(baseConfig.settings ?? {}), ...dynamicValues }
        : baseConfig.settings;

    onSave({ ...baseConfig, settings: mergedSettings });
    onClose();
  };

  const renderField = (def: PluginSettingDefinition) => {
    const value = dynamicValues[def.key];
    const inputClass =
      "bg-base border-default text-primary placeholder:text-muted focus:border-blue-500/50 focus:outline-none";
    const canReset = def.default !== undefined;
    const isDefaultValue = canReset && Object.is(value, def.default);

    const resetButton = canReset ? (
      <button
        type="button"
        onClick={() => handleResetField(def)}
        disabled={isDefaultValue}
        className="inline-flex items-center justify-center w-8 h-8 border border-default rounded-md text-muted hover:text-primary hover:border-strong disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        title={t("settings.plugins.pluginSettings.resetToDefault")}
        aria-label={t("settings.plugins.pluginSettings.resetToDefault")}
      >
        <RotateCcw size={12} />
      </button>
    ) : null;

    if (def.type === "boolean") {
      return (
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={typeof value === "boolean" ? value : false}
            onChange={(e) => handleDynamicChange(def.key, e.target.checked)}
            className="w-4 h-4 accent-blue-500"
          />
          {resetButton}
        </div>
      );
    }

    if (def.type === "select" && def.options && def.options.length > 0) {
      return (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <Select
              value={typeof value === "string" ? value : null}
              options={def.options}
              onChange={(v) => handleDynamicChange(def.key, v)}
              hasError={!!errors[def.key]}
            />
          </div>
          {resetButton}
        </div>
      );
    }

    if (def.type === "number") {
      return (
        <div className="flex items-start gap-2">
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            type="number"
            value={typeof value === "number" ? value : ""}
            onChange={(e) => handleDynamicChange(def.key, e.target.value === "" ? undefined : Number(e.target.value))}
            className={`w-full border rounded-lg px-3 py-2 text-sm ${inputClass}`}
          />
          {resetButton}
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2">
        <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => handleDynamicChange(def.key, e.target.value)}
          className={`w-full border rounded-lg px-3 py-2 text-sm ${inputClass}`}
        />
        {resetButton}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Settings size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("settings.plugins.pluginSettings.title")}
              </h2>
              <p className="text-xs text-secondary font-mono">{pluginId}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Interpreter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">
              {t("settings.plugins.pluginSettings.interpreter")}
            </label>
            <p className="text-xs text-secondary">
              {t("settings.plugins.pluginSettings.interpreterDesc")}
            </p>
            <div className="flex gap-2">
              <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                type="text"
                value={interpreter}
                placeholder={t("settings.plugins.pluginSettings.interpreterPlaceholder")}
                onChange={(e) => setInterpreter(e.target.value)}
                className="flex-1 bg-base border border-default rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-blue-500/50"
                autoFocus
              />
              <button
                onClick={handleBrowse}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface-secondary hover:bg-surface-tertiary border border-default rounded-lg text-sm text-secondary hover:text-primary transition-colors"
              >
                <FolderOpen size={15} />
                {t("settings.plugins.pluginSettings.browse")}
              </button>
            </div>
          </div>

          {/* Plugin UI extension slot - before settings */}
          <SlotAnchor
            name="settings.plugin.before_settings"
            context={{ targetPluginId: pluginId }}
            className="flex flex-col gap-2"
          />

          {/* Dynamic plugin settings */}
          {definitions.map((def) => (
            <div key={def.key} className="space-y-1.5">
              <label className="text-sm font-medium text-primary flex items-center gap-1">
                {getSettingLabel(def)}
                {def.required && <span className="text-red-400">*</span>}
              </label>
              {getSettingDescription(def) && (
                <p className="text-xs text-secondary">{getSettingDescription(def)}</p>
              )}
              {renderField(def)}
              {errors[def.key] && (
                <p className="text-xs text-red-400">{errors[def.key]}</p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
