import { afterEach, describe, expect, it, vi } from "vitest";
import { loadThemeBootCache, saveThemeBootCache, THEME_BOOT_CACHE_KEY } from "../../src/utils/themeBoot";

describe("themeBoot", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips the colors the window paints before React mounts", () => {
    saveThemeBootCache({ bg: "#fbf5ec", fg: "#2b2018", scheme: "light" });
    expect(JSON.parse(localStorage.getItem(THEME_BOOT_CACHE_KEY)!)).toEqual({ bg: "#fbf5ec", fg: "#2b2018", scheme: "light" });
    expect(loadThemeBootCache()).toEqual({ bg: "#fbf5ec", fg: "#2b2018", scheme: "light" });
  });

  it("ignores missing, malformed or incomplete caches", () => {
    expect(loadThemeBootCache()).toBeNull();
    localStorage.setItem(THEME_BOOT_CACHE_KEY, "{not json");
    expect(loadThemeBootCache()).toBeNull();
    localStorage.setItem(THEME_BOOT_CACHE_KEY, JSON.stringify({ bg: "#000000" }));
    expect(loadThemeBootCache()).toBeNull();
    localStorage.setItem(THEME_BOOT_CACHE_KEY, JSON.stringify({ bg: "#000000", fg: "#ffffff", scheme: "sepia" }));
    expect(loadThemeBootCache()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => saveThemeBootCache({ bg: "#000000", fg: "#ffffff", scheme: "dark" })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
