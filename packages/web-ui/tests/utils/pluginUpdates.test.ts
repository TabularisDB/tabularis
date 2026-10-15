import { describe, expect, it } from "vitest";
import { getPluginUpdates } from "../../src/utils/pluginUpdates";
import type { RegistryPluginWithStatus } from "../../src/types/plugins";

const plugin: RegistryPluginWithStatus = {
  id: "test",
  name: "Test",
  description: "",
  author: "",
  homepage: "",
  installed_version: "1.0.0",
  latest_version: "2.0.0",
  update_available: true,
  platform_supported: true,
  releases: [
    { version: "2.0.0", platform_supported: true, min_tabularis_version: null },
  ],
};

describe("getPluginUpdates", () => {
  it("counts installed plugins with compatible updates, regardless of activation", () => {
    expect(getPluginUpdates([plugin], "0.24.0")).toEqual([plugin]);
  });

  it("excludes uninstalled, current, unsupported and incompatible plugins", () => {
    const plugins = [
      { ...plugin, installed_version: null },
      { ...plugin, update_available: false },
      { ...plugin, releases: [] },
      {
        ...plugin,
        releases: [{ ...plugin.releases[0], platform_supported: false }],
      },
      {
        ...plugin,
        releases: [{ ...plugin.releases[0], min_tabularis_version: "99.0.0" }],
      },
    ];
    expect(getPluginUpdates(plugins, "0.24.0")).toEqual([]);
    expect(getPluginUpdates([], "0.24.0")).toEqual([]);
  });
});
