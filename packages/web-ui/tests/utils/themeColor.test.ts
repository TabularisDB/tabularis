import { describe, expect, it } from "vitest";
import { flattenThemeColor, lightenThemeColor, withThemeAlpha } from "../../src/utils/themeColor";

describe("v1 theme color composition", () => {
  it("multiplies existing alpha instead of appending another channel", () => {
    expect(withThemeAlpha("#33669980", 0.5)).toBe("#33669940");
    expect(withThemeAlpha("#336699", 128 / 255)).toBe("#33669980");
    expect(withThemeAlpha("#33669900", 1)).toBe("#33669900");
    expect(withThemeAlpha("#336699ff", 0)).toBe("#33669900");
  });
  it("flattens token opacity against an opaque background", () => {
    expect(flattenThemeColor("#ff000080", "#000000")).toBe("#800000");
    expect(flattenThemeColor("#ff000000", "#123456")).toBe("#123456");
    expect(flattenThemeColor("#123456ff", "#ffffff")).toBe("#123456");
    expect(() => flattenThemeColor("#ff000080", "#00000080")).toThrow("opaque");
  });
  it("lightens RGB while preserving alpha", () => {
    expect(lightenThemeColor("#00000080", 0.5)).toBe("#80808080");
    expect(lightenThemeColor("#000000", 1)).toBe("#ffffff");
    expect(lightenThemeColor("#336699", 0)).toBe("#336699");
  });
  it.each(["red", "#fff", "#010203ffff", "url(remote)", "#zz0000", "#010203\n"])("rejects %s", (color) => {
    expect(() => withThemeAlpha(color, 0.5)).toThrow();
    expect(() => lightenThemeColor(color, 0.5)).toThrow();
  });
  it.each([-1, 2, NaN, Infinity])("rejects invalid fractions %s", (fraction) => {
    expect(() => withThemeAlpha("#112233", fraction)).toThrow();
    expect(() => lightenThemeColor("#112233", fraction)).toThrow();
  });
});
