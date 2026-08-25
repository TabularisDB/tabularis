import { describe, it, expect } from "vitest";
import {
  getDisplayInterpreter,
  removePluginConfig,
  resolvePluginConfig,
  resolveSettingsWithDefaults,
  validateSettings,
} from "../../src/utils/pluginConfig";
import type { PluginConfig } from "../../src/contexts/SettingsContext";
import type { PluginSettingDefinition } from "../../src/types/plugins";

describe("pluginConfig", () => {
  describe("resolvePluginConfig", () => {
    it("sets interpreter when a non-empty string is provided", () => {
      const result = resolvePluginConfig(undefined, "python3");
      expect(result.interpreter).toBe("python3");
    });

    it("trims whitespace from interpreter", () => {
      const result = resolvePluginConfig(undefined, "  python  ");
      expect(result.interpreter).toBe("python");
    });

    it("sets interpreter to undefined when empty string is provided", () => {
      const result = resolvePluginConfig(undefined, "");
      expect(result.interpreter).toBeUndefined();
    });

    it("sets interpreter to undefined when only whitespace is provided", () => {
      const result = resolvePluginConfig(undefined, "   ");
      expect(result.interpreter).toBeUndefined();
    });

    it("preserves existing settings when updating interpreter", () => {
      const current: PluginConfig = {
        interpreter: "old-python",
        settings: { timeout: 30 },
      };
      const result = resolvePluginConfig(current, "python3");
      expect(result.interpreter).toBe("python3");
      expect(result.settings).toEqual({ timeout: 30 });
    });

    it("clears interpreter while preserving other settings", () => {
      const current: PluginConfig = {
        interpreter: "python3",
        settings: { timeout: 30 },
      };
      const result = resolvePluginConfig(current, "");
      expect(result.interpreter).toBeUndefined();
      expect(result.settings).toEqual({ timeout: 30 });
    });

    it("accepts a full path interpreter", () => {
      const result = resolvePluginConfig(undefined, "C:\\Python311\\python.exe");
      expect(result.interpreter).toBe("C:\\Python311\\python.exe");
    });

    it("starts from empty config when currentConfig is undefined", () => {
      const result = resolvePluginConfig(undefined, "python3");
      expect(result).toEqual({ interpreter: "python3" });
    });

    it("starts from empty config when currentConfig has no settings", () => {
      const current: PluginConfig = { interpreter: "python" };
      const result = resolvePluginConfig(current, "python3");
      expect(result.interpreter).toBe("python3");
      expect(result.settings).toBeUndefined();
    });
  });

  describe("getDisplayInterpreter", () => {
    it("returns the configured interpreter", () => {
      const config: PluginConfig = { interpreter: "python3" };
      expect(getDisplayInterpreter(config)).toBe("python3");
    });

    it("returns empty string when config is undefined", () => {
      expect(getDisplayInterpreter(undefined)).toBe("");
    });

    it("returns empty string when interpreter is undefined", () => {
      const config: PluginConfig = { settings: {} };
      expect(getDisplayInterpreter(config)).toBe("");
    });
  });
});

describe("removePluginConfig", () => {
  it("removes only the selected plugin config", () => {
    const plugins: Record<string, PluginConfig> = {
      alpha: { interpreter: "python3", settings: { token: "secret" } },
      beta: { settings: { timeout: 30 } },
    };

    expect(removePluginConfig(plugins, "alpha")).toEqual({
      beta: { settings: { timeout: 30 } },
    });
  });

  it("returns undefined when removing the last plugin config", () => {
    const plugins: Record<string, PluginConfig> = {
      alpha: { settings: { token: "secret" } },
    };

    expect(removePluginConfig(plugins, "alpha")).toBeUndefined();
  });

  it("keeps the original map when the plugin config is not present", () => {
    const plugins: Record<string, PluginConfig> = {
      beta: { settings: { timeout: 30 } },
    };

    expect(removePluginConfig(plugins, "alpha")).toBe(plugins);
  });

  it("returns undefined when there is no plugin config map", () => {
    expect(removePluginConfig(undefined, "alpha")).toBeUndefined();
    expect(removePluginConfig(null, "alpha")).toBeUndefined();
  });
});

describe("resolveSettingsWithDefaults", () => {
  const defs: PluginSettingDefinition[] = [
    { key: "host", label: "Host", type: "string", default: "localhost" },
    { key: "port", label: "Port", type: "number", default: 5432 },
    { key: "verbose", label: "Verbose", type: "boolean" },
  ];

  it("uses default when no saved value exists", () => {
    const result = resolveSettingsWithDefaults(defs, undefined);
    expect(result["host"]).toBe("localhost");
    expect(result["port"]).toBe(5432);
  });

  it("prefers saved value over default", () => {
    const result = resolveSettingsWithDefaults(defs, { host: "myserver", port: 3306 });
    expect(result["host"]).toBe("myserver");
    expect(result["port"]).toBe(3306);
  });

  it("omits key when no default and no saved value", () => {
    const result = resolveSettingsWithDefaults(defs, undefined);
    expect(Object.prototype.hasOwnProperty.call(result, "verbose")).toBe(false);
  });

  it("includes saved value even when no default defined", () => {
    const result = resolveSettingsWithDefaults(defs, { verbose: true });
    expect(result["verbose"]).toBe(true);
  });

  it("returns empty object for empty definitions", () => {
    expect(resolveSettingsWithDefaults([], { host: "x" })).toEqual({});
  });
});

describe("validateSettings", () => {
  const defs: PluginSettingDefinition[] = [
    { key: "api_key", label: "API Key", type: "string", required: true },
    { key: "timeout", label: "Timeout", type: "number", required: false },
    { key: "region", label: "Region", type: "string", required: true },
  ];

  it("returns no errors when all required fields are filled", () => {
    const errors = validateSettings(defs, { api_key: "abc", region: "us-east" });
    expect(errors).toEqual({});
  });

  it("returns error for empty required string field", () => {
    const errors = validateSettings(defs, { api_key: "", region: "us-east" });
    expect(errors["api_key"]).toBe("API Key");
  });

  it("returns error for whitespace-only required string field", () => {
    const errors = validateSettings(defs, { api_key: "   ", region: "us-east" });
    expect(errors["api_key"]).toBe("API Key");
  });

  it("returns error for undefined required field", () => {
    const errors = validateSettings(defs, { region: "us-east" });
    expect(errors["api_key"]).toBe("API Key");
  });

  it("ignores optional fields that are empty", () => {
    const errors = validateSettings(defs, { api_key: "abc", region: "us-east", timeout: undefined });
    expect(Object.prototype.hasOwnProperty.call(errors, "timeout")).toBe(false);
  });

  it("returns errors for multiple missing required fields", () => {
    const errors = validateSettings(defs, {});
    expect(errors["api_key"]).toBe("API Key");
    expect(errors["region"]).toBe("Region");
  });
});
