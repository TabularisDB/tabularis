import { describe, expect, it } from "vitest";
import { isCompatibleThemeRelease, themeDownloadCount } from "../../src/utils/themeDiscovery";

describe("theme discovery", () => {
  it("distinguishes zero, compact counts and unavailable values", () => {
    expect(themeDownloadCount(0, "en")).toEqual({ compact: "0", exact: "0" });
    expect(themeDownloadCount(1200, "en")).toEqual({ compact: "1.2K", exact: "1,200" });
    expect(themeDownloadCount(1200, "de")?.exact).toBe("1.200");
    for (const count of [null, undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(themeDownloadCount(count, "en")).toBeUndefined();
  });
  it("requires exactly one universal asset and compatible canonical versions", () => {
    const release = { version: "1.0.0", min_tabularis_version: "0.24.0", assets: { universal: "https://example.invalid/theme.zip" } };
    expect(isCompatibleThemeRelease(release, "0.24.0")).toBe(true);
    expect(isCompatibleThemeRelease(release, "0.23.0")).toBe(false);
    expect(isCompatibleThemeRelease({ ...release, assets: { ...release.assets, "linux-x64": "x" } }, "0.24.0")).toBe(false);
    expect(isCompatibleThemeRelease({ ...release, min_tabularis_version: "bad" }, "0.24.0")).toBe(false);
    expect(isCompatibleThemeRelease({ ...release, min_tabularis_version: null }, "0.24.0")).toBe(true);
  });
});
