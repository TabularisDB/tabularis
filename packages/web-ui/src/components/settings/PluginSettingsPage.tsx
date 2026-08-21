import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Check, RotateCcw } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { useDatabase } from "../../hooks/useDatabase";
import { useDrivers } from "../../hooks/useDrivers";
import { SettingSection, SettingRow } from "./SettingControls";
import { Select } from "../ui/Select";
import { SlotAnchor } from "../ui/SlotAnchor";
import {
  resolvePluginConfig,
  getDisplayInterpreter,
  resolveSettingsWithDefaults,
  validateSettings,
} from "../../utils/pluginConfig";
import { findConnectionsForDrivers } from "../../utils/connectionManager";
import type {
  PluginManifest,
  PluginSettingDefinition,
} from "../../types/plugins";

interface PluginSettingsPageProps {
  pluginId: string;
}

export function PluginSettingsPage({ pluginId }: PluginSettingsPageProps) {
  const { allDrivers } = useDrivers();
  const [manifest, setManifest] = useState<PluginManifest | undefined>(() =>
    allDrivers.find((d) => d.id === pluginId),
  );
  const [loading, setLoading] = useState(!manifest);

  useEffect(() => {
    if (manifest) return;
    invoke<PluginManifest>("get_plugin_manifest", { pluginId })
      .then((m) => setManifest(m))
      .catch(() => setManifest(undefined))
      .finally(() => setLoading(false));
  }, [pluginId, manifest]);

  if (loading) {
    return <div className="text-sm text-muted py-4">Loading...</div>;
  }

  return <PluginSettingsForm pluginId={pluginId} manifest={manifest} />;
}

/* ── Inner form (mounted fresh via key={pluginId} from parent) ── */

interface PluginSettingsFormProps {
  pluginId: string;
  manifest: PluginManifest | undefined;
}

function PluginSettingsForm({ pluginId, manifest }: PluginSettingsFormProps) {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { openConnectionIds, connectionDataMap, disconnect } = useDatabase();
  const { allDrivers, refresh: refreshDrivers } = useDrivers();

  const isBuiltin = manifest?.is_builtin === true;
  const currentConfig = settings.plugins?.[pluginId];
  const [interpreter, setInterpreter] = useState(
    getDisplayInterpreter(currentConfig),
  );
  const definitions = useMemo(() => manifest?.settings ?? [], [manifest]);
  const [dynamicValues, setDynamicValues] = useState<
    Record<string, unknown>
  >(() => resolveSettingsWithDefaults(definitions, currentConfig?.settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

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

  const handleDynamicChange = useCallback(
    (key: string, value: unknown) => {
      setDynamicValues((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSaved(false);
    },
    [],
  );

  const handleResetField = useCallback(
    (def: PluginSettingDefinition) => {
      if (def.default === undefined) return;
      handleDynamicChange(def.key, def.default);
    },
    [handleDynamicChange],
  );

  const handleSave = useCallback(async () => {
    const validationErrors = validateSettings(definitions, dynamicValues);
    if (Object.keys(validationErrors).length > 0) {
      const errorMessages: Record<string, string> = {};
      for (const [key, label] of Object.entries(validationErrors)) {
        errorMessages[key] = t(
          "settings.plugins.pluginSettings.fieldRequired",
          { label },
        );
      }
      setErrors(errorMessages);
      return;
    }

    const baseConfig = resolvePluginConfig(currentConfig, interpreter);
    const mergedSettings =
      definitions.length > 0
        ? { ...(baseConfig.settings ?? {}), ...dynamicValues }
        : baseConfig.settings;

    const config = { ...baseConfig, settings: mergedSettings };
    const current = settings.plugins ?? {};
    const nextPlugins = { ...current, [pluginId]: config };
    await updateSetting("plugins", nextPlugins);

    const isRunning = allDrivers.some((d) => d.id === pluginId);
    if (isBuiltin) {
      const toDisconnect = findConnectionsForDrivers(
        openConnectionIds,
        connectionDataMap,
        [pluginId],
      );
      await Promise.all(toDisconnect.map((connectionId) => disconnect(connectionId)));
    } else if (isRunning) {
      try {
        await invoke("disable_plugin", { pluginId });
        await invoke("enable_plugin", { pluginId });
        refreshDrivers();
      } catch {
        /* settings saved, restart failed – user can retry via Plugins tab */
      }
    }

    setSaved(true);
  }, [
    definitions,
    dynamicValues,
    interpreter,
    currentConfig,
    settings.plugins,
    updateSetting,
    pluginId,
    allDrivers,
    refreshDrivers,
    t,
    isBuiltin,
    openConnectionIds,
    connectionDataMap,
    disconnect,
  ]);

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
            onChange={(e) =>
              handleDynamicChange(def.key, e.target.checked)
            }
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
            onChange={(e) =>
              handleDynamicChange(
                def.key,
                e.target.value === ""
                  ? undefined
                  : Number(e.target.value),
              )
            }
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
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-primary">
          {manifest?.name ?? pluginId}
        </h2>
        <p className="text-xs text-muted font-mono mt-0.5">{pluginId}</p>
      </div>

      {!isBuiltin && (
        <SettingSection
          title={t("settings.plugins.pluginSettings.interpreter")}
          description={t(
            "settings.plugins.pluginSettings.interpreterDesc",
          )}
        >
          <div className="py-3">
            <div className="flex gap-2">
              <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                type="text"
                value={interpreter}
                placeholder={t(
                  "settings.plugins.pluginSettings.interpreterPlaceholder",
                )}
                onChange={(e) => {
                  setInterpreter(e.target.value);
                  setSaved(false);
                }}
                className="flex-1 bg-base border border-default rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-blue-500/50"
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
        </SettingSection>
      )}

      {/* Plugin UI extension slot */}
      <SlotAnchor
        name="settings.plugin.before_settings"
        context={{ targetPluginId: pluginId }}
        className="flex flex-col gap-2 mb-6"
      />

      {/* Dynamic settings */}
      {definitions.length > 0 && (
        <SettingSection
          title={t("settings.plugins.pluginSettings.title")}
        >
          {definitions.map((def) => (
            <div key={def.key}>
              <SettingRow
                label={`${getSettingLabel(def)}${def.required ? " *" : ""}`}
                description={getSettingDescription(def)}
                vertical={def.type !== "boolean"}
              >
                {renderField(def)}
              </SettingRow>
              {errors[def.key] && (
                <p className="text-xs text-red-400 -mt-2 mb-2 pl-0.5">
                  {errors[def.key]}
                </p>
              )}
            </div>
          ))}
        </SettingSection>
      )}

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {t("common.save")}
        </button>
        {saved && (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check size={12} />
            {t("settings.plugins.pluginSettings.saved")}
          </span>
        )}
      </div>
    </div>
  );
}
