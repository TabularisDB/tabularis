import { describe, expect, it } from "vitest";
import { getPluginVersionState } from "../../src/utils/pluginVersions";
import type { RegistryPluginWithStatus, RegistryReleaseWithStatus } from "../../src/types/plugins";

const release = (version: string, overrides: Partial<RegistryReleaseWithStatus> = {}): RegistryReleaseWithStatus => ({
  version, min_tabularis_version: null, platform_supported: true, ...overrides,
});
const plugin: RegistryPluginWithStatus = {
  id: "test", name: "Test", description: "", author: "", homepage: "",
  installed_version: "2.0.0", latest_version: "2.0.0", update_available: false,
  platform_supported: true, releases: [release("2.0.0"), release("1.0.0")],
};
const state = (overrides: Partial<RegistryPluginWithStatus> = {}, selected?: string) =>
  getPluginVersionState({ ...plugin, ...overrides }, selected, "0.24.0");

describe("getPluginVersionState", () => {
  it("keeps the current latest release selected and offers older versions", () => {
    const result = state();
    expect(result.selectedVersion).toBe("2.0.0");
    expect(result.isSelectedInstalled).toBe(true);
    expect(result.options).toEqual([
      { version: "1.0.0", isInstalled: false, isLatest: false },
      { version: "2.0.0", isInstalled: true, isLatest: true },
    ]);
  });

  it("selects the latest update but keeps the installed release selectable", () => {
    const result = state({ installed_version: "1.0.0", update_available: true });
    expect(result.selectedVersion).toBe("2.0.0");
    expect(result.isUpdate).toBe(true);
    expect(result.isDowngrade).toBe(false);
    expect(result.options.find((option) => option.version === "1.0.0")?.isInstalled).toBe(true);
  });

  it("offers a downgrade from the installed latest release", () => {
    expect(state({}, "1.0.0")).toMatchObject({ isDowngrade: true, isUpdate: true, isCompatible: true });
  });

  it("does not offer an install/update for the selected installed release", () => {
    expect(state({ installed_version: "1.0.0" }, "1.0.0")).toMatchObject({ isSelectedInstalled: true, isUpdate: false, isAtLatest: false, isDefaultSelection: false });
    expect(state({ installed_version: "1.0.0" }, undefined)).toMatchObject({ isDefaultSelection: true });
  });

  it("offers a fresh install for uninstalled plugins", () => {
    expect(state({ installed_version: null })).toMatchObject({ selectedVersion: "2.0.0", isUpdate: false, isSelectedInstalled: false });
  });

  it("excludes releases for another platform and falls back from a stale choice", () => {
    const result = state({ installed_version: null, releases: [release("2.0.0", { platform_supported: false }), release("1.0.0")] }, "2.0.0");
    expect(result.selectedVersion).toBe("1.0.0");
    expect(result.options).toHaveLength(1);
    expect(result.platformSupported).toBe(true);
  });

  it("blocks incompatible releases but keeps older versions selectable", () => {
    const overrides = { installed_version: "1.0.0", releases: [release("2.0.0", { min_tabularis_version: "99.0.0" }), release("1.0.0")] };
    expect(state(overrides)).toMatchObject({ isCompatible: false, minVersion: "99.0.0" });
    expect(state(overrides, "1.0.0").isCompatible).toBe(true);
  });

  it("handles an installed release no longer present in the registry", () => {
    const result = state({ installed_version: "0.5.0" }, "0.5.0");
    expect(result.isSelectedInstalled).toBe(true);
    expect(result.options.at(-1)).toEqual({ version: "0.5.0", isInstalled: true, isLatest: false });
  });

  it("does not invent a supported release for an empty registry entry", () => {
    expect(state({ installed_version: null, releases: [] })).toMatchObject({ platformSupported: false, options: [] });
  });

  it("deduplicates release options", () => {
    expect(state({ releases: [release("2.0.0"), release("2.0.0"), release("1.0.0")] }).options).toHaveLength(2);
  });
});
