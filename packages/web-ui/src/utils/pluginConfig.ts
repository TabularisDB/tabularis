import type { PluginConfig } from "../contexts/SettingsContext";
import type { PluginSettingDefinition } from "../types/plugins";

/**
 * Builds a PluginConfig from a raw interpreter string entered by the user.
 * Trims whitespace; an empty string clears the interpreter field.
 */
export function resolvePluginConfig(
  currentConfig: PluginConfig | undefined,
  rawInterpreter: string,
): PluginConfig {
  return {
    ...(currentConfig ?? {}),
    interpreter: rawInterpreter.trim() || undefined,
  };
}

/** Host default for `pluginCallTimeoutSeconds`; mirrors the Rust constant. */
export const DEFAULT_PLUGIN_CALL_TIMEOUT_SECONDS = 120;

/** Upper bound accepted by the timeout inputs (24 hours). */
export const MAX_PLUGIN_CALL_TIMEOUT_SECONDS = 86_400;

/**
 * Parses a timeout typed by the user. Returns undefined for blank or invalid
 * input; otherwise a whole number of seconds clamped to
 * [0, MAX_PLUGIN_CALL_TIMEOUT_SECONDS] (0 disables the timeout).
 */
export function parseCallTimeoutSeconds(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.floor(value), 0), MAX_PLUGIN_CALL_TIMEOUT_SECONDS);
}

/**
 * Returns a copy of `config` with its call timeout override set from raw user
 * input. Blank or invalid input removes the override so the plugin inherits
 * the global value.
 */
export function withCallTimeoutOverride(
  config: PluginConfig,
  rawTimeout: string,
): PluginConfig {
  const next = { ...config };
  const seconds = parseCallTimeoutSeconds(rawTimeout);
  if (seconds === undefined) {
    delete next.callTimeoutSeconds;
  } else {
    next.callTimeoutSeconds = seconds;
  }
  return next;
}

/**
 * Timeout that applies to a plugin: its own override, else the global
 * setting, else the host default. 0 means no timeout.
 */
export function resolveEffectiveCallTimeout(
  globalTimeout: number | undefined,
  config: PluginConfig | undefined,
): number {
  return (
    config?.callTimeoutSeconds ??
    globalTimeout ??
    DEFAULT_PLUGIN_CALL_TIMEOUT_SECONDS
  );
}

/**
 * Returns the interpreter to display in the modal input for a given plugin.
 * Falls back to an empty string when none is configured.
 */
export function getDisplayInterpreter(config: PluginConfig | undefined): string {
  return config?.interpreter ?? "";
}

/**
 * Removes a plugin entry from the persisted plugin configuration map.
 * Returns undefined when the map becomes empty so the config file does not
 * keep an unnecessary plugins object around.
 */
export function removePluginConfig(
  plugins: Record<string, PluginConfig> | null | undefined,
  pluginId: string,
): Record<string, PluginConfig> | undefined {
  if (plugins == null) {
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(plugins, pluginId)) {
    return plugins;
  }

  const next = { ...plugins };
  delete next[pluginId];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Merges saved setting values with defaults declared in the manifest.
 * For each definition: uses the saved value if present, otherwise falls back
 * to the declared default. Returns an object keyed by setting key.
 */
export function resolveSettingsWithDefaults(
  definitions: PluginSettingDefinition[],
  saved: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of definitions) {
    if (saved !== undefined && Object.prototype.hasOwnProperty.call(saved, def.key)) {
      result[def.key] = saved[def.key];
    } else if (def.default !== undefined) {
      result[def.key] = def.default;
    }
  }
  return result;
}

/**
 * Validates setting values against their definitions.
 * Returns a map of key → error message for any field that fails validation.
 * Currently validates only required fields (non-empty value required).
 */
export function validateSettings(
  definitions: PluginSettingDefinition[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const def of definitions) {
    if (!def.required) continue;
    const val = values[def.key];
    const isEmpty =
      val === undefined ||
      val === null ||
      (typeof val === "string" && val.trim() === "");
    if (isEmpty) {
      errors[def.key] = def.label;
    }
  }
  return errors;
}
