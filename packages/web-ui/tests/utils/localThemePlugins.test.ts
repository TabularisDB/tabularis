import { describe, expect, it } from "vitest";
import { mergeLocalThemePlugins } from "../../src/utils/localThemePlugins";
import type { NativeThemeContribution } from "../../src/types/themeCatalog";
import type { RegistryPluginWithStatus } from "../../src/types/plugins";

const local: NativeThemeContribution = {
  id: `theme:${"a".repeat(64)}:ember-theme:dark`, name: "Ember Dark", revision: "fixture",
  origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "ember-theme", variantId: "dark" }, packageVersion: "1.0.0" },
  readOnly: true, mode: "dark", format: "v1", source: '{"schemaVersion":1,"mode":"dark"}', available: true,
};
const remote: RegistryPluginWithStatus = {
  id: "ember-theme", name: "Ember", description: "Theme", author: "Author", homepage: "",
  kind: "theme", installed_version: null, latest_version: "2.0.0", releases: [], update_available: false, platform_supported: true,
};

describe("mergeLocalThemePlugins", () => {
  it("shows one package for multiple local variants, even offline or disabled", () => {
    const result = mergeLocalThemePlugins([], [local, { ...local, id: "light", available: false }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "ember-theme", kind: "theme", installed_version: "1.0.0", releases: [] });
  });

  it("merges local status without discarding registry metadata or adding duplicates", () => {
    const result = mergeLocalThemePlugins([remote], [local]);
    expect(result).toEqual([{ ...remote, installed_version: "1.0.0", update_available: true }]);
    expect(remote.installed_version).toBeNull();
  });

  it("keeps drivers with the same name separate and excludes personal/builtin themes", () => {
    const driver = { ...remote, kind: "driver" };
    const result = mergeLocalThemePlugins([driver], [local, { ...local, origin: { kind: "personal" } }, { ...local, origin: { kind: "builtin" } }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(driver);
    expect(result[1].kind).toBe("theme");
  });
});
