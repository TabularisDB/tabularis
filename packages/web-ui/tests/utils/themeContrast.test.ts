import { describe, expect, it } from "vitest";
import { themeRegistry } from "../../src/themes/themeRegistry";
import type { Theme } from "../../src/types/theme";
import {
  auditThemeContrast,
  contrastRatio,
  CONTRAST_PAIRS,
  onAccentColor,
  relativeLuminance,
  resolveContrastToken,
  suggestForeground,
  TEXT_CONTRAST,
  UI_CONTRAST,
} from "../../src/utils/themeContrast";

const tabularisDark = themeRegistry.getPreset("tabularis-dark") as Theme;

function withColors(overrides: Record<string, Record<string, string>>): Theme {
  const colors = structuredClone(tabularisDark.colors) as unknown as Record<string, Record<string, string>>;
  for (const [group, values] of Object.entries(overrides)) Object.assign(colors[group], values);
  return { ...tabularisDark, colors: colors as unknown as Theme["colors"] };
}

describe("themeContrast", () => {
  describe("relativeLuminance", () => {
    it("returns 0 for black and 1 for white", () => {
      expect(relativeLuminance("#000000")).toBe(0);
      expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    });
    it("accepts shorthand hex", () => {
      expect(relativeLuminance("#fff")).toBeCloseTo(1, 10);
    });
    it("returns null for colors it cannot parse", () => {
      expect(relativeLuminance("rgb(0, 0, 0)")).toBeNull();
      expect(relativeLuminance("#12345")).toBeNull();
    });
  });

  describe("contrastRatio", () => {
    it("is 21 between black and white, in either order", () => {
      expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
      expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    });
    it("is 1 for identical colors", () => {
      expect(contrastRatio("#3b82f6", "#3b82f6")).toBe(1);
    });
    it("matches the WCAG reference value for #767676 on white", () => {
      expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    });
    it("returns null when a color cannot be parsed", () => {
      expect(contrastRatio("transparent", "#ffffff")).toBeNull();
    });
  });

  describe("onAccentColor", () => {
    it("puts white on dark fills and black on light fills", () => {
      expect(onAccentColor("#1d4ed8")).toBe("#ffffff");
      expect(onAccentColor("#fde047")).toBe("#000000");
    });
    it("returns null for unparseable fills", () => {
      expect(onAccentColor("var(--accent)")).toBeNull();
    });
  });

  describe("resolveContrastToken", () => {
    it("reads a theme color by path", () => {
      expect(resolveContrastToken(tabularisDark.colors, "text.primary")).toBe(tabularisDark.colors.text.primary);
    });
    it("derives the label color for onAccent tokens", () => {
      const theme = withColors({ accent: { warning: "#fde047" } });
      expect(resolveContrastToken(theme.colors, "onAccent:accent.warning")).toBe("#000000");
    });
    it("returns null for unknown paths", () => {
      expect(resolveContrastToken(tabularisDark.colors, "text.nope")).toBeNull();
      expect(resolveContrastToken(tabularisDark.colors, "nope.primary")).toBeNull();
    });
  });

  describe("auditThemeContrast", () => {
    it("reports a failing pair with its ratio", () => {
      const theme = withColors({ bg: { base: "#000000" }, text: { primary: "#222222" } });
      const violation = auditThemeContrast(theme).find((v) => v.foreground === "text.primary" && v.background === "bg.base");
      expect(violation).toMatchObject({ foregroundColor: "#222222", backgroundColor: "#000000", minimum: TEXT_CONTRAST });
      expect(violation!.ratio).toBeLessThan(TEXT_CONTRAST);
    });
    it("uses the UI threshold for focus rings", () => {
      const pair = CONTRAST_PAIRS.find((p) => p.foreground === "border.focus");
      expect(pair?.minimum).toBe(UI_CONTRAST);
    });
    it("skips colors that are not plain hex", () => {
      const theme = withColors({ text: { primary: "rgb(0 0 0)" } });
      expect(auditThemeContrast(theme).some((v) => v.foreground === "text.primary")).toBe(false);
    });
    it("accepts a custom pair list", () => {
      const theme = withColors({ bg: { base: "#000000" }, text: { primary: "#111111" } });
      expect(auditThemeContrast(theme, [])).toEqual([]);
    });
  });

  describe("suggestForeground", () => {
    it("returns the color unchanged when it already passes", () => {
      expect(suggestForeground("#ffffff", ["#000000"], TEXT_CONTRAST)).toBe("#ffffff");
    });
    it("darkens text on light backgrounds until it passes", () => {
      const suggestion = suggestForeground("#3b82f6", ["#ffffff", "#f8fafc"], TEXT_CONTRAST)!;
      expect(relativeLuminance(suggestion)!).toBeLessThan(relativeLuminance("#3b82f6")!);
      expect(contrastRatio(suggestion, "#f8fafc")!).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    });
    it("lightens text on dark backgrounds until it passes", () => {
      const suggestion = suggestForeground("#475569", ["#020617"], TEXT_CONTRAST)!;
      expect(relativeLuminance(suggestion)!).toBeGreaterThan(relativeLuminance("#475569")!);
      expect(contrastRatio(suggestion, "#020617")!).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    });
    it("returns null when no lightness is enough or a color cannot be parsed", () => {
      expect(suggestForeground("#808080", ["#000000", "#ffffff"], 15)).toBeNull();
      expect(suggestForeground("nope", ["#000000"], TEXT_CONTRAST)).toBeNull();
    });
  });

  describe("built-in themes", () => {
    it.each(themeRegistry.getAllPresets().map((theme) => [theme.id, theme] as const))("%s meets WCAG AA on every token pair", (_id, theme) => {
      const report = auditThemeContrast(theme).map((v) => {
        const suggestion = suggestForeground(v.foregroundColor, [v.backgroundColor], v.minimum);
        return `${v.foreground} ${v.foregroundColor} on ${v.background} ${v.backgroundColor}: ${v.ratio.toFixed(2)}:1, needs ${v.minimum}:1${suggestion ? ` (nearest passing foreground: ${suggestion})` : ""}`;
      });
      expect(report.join("\n")).toBe("");
    });

    it.each(themeRegistry.getAllPresets().map((theme) => [theme.id, theme] as const))("%s keeps primary text stronger than secondary, and secondary stronger than muted", (_id, theme) => {
      const { bg, text } = theme.colors;
      const primary = contrastRatio(text.primary, bg.base)!;
      const secondary = contrastRatio(text.secondary, bg.base)!;
      const muted = contrastRatio(text.muted, bg.base)!;
      expect(primary).toBeGreaterThan(secondary);
      expect(secondary).toBeGreaterThan(muted);
    });
  });
});
