import { describe, expect, it } from "vitest";
import { themeRegistry } from "../../src/themes/themeRegistry";
import { hexToRgb } from "../../src/themes/colorUtils";
import { TONE_ACCENT, type TintedTone } from "../../src/utils/tones";
import type { Theme } from "../../src/types/theme";

type Rgb = { r: number; g: number; b: number };

const ACCENT_KEY: Record<TintedTone, keyof Theme["colors"]["accent"]> = {
  primary: "primary",
  success: "success",
  update: "primary",
  warning: "warning",
  danger: "error",
};

const rgb = (hex: string): Rgb => {
  const parsed = hexToRgb(hex);
  if (!parsed) throw new Error(`Invalid colour ${hex}`);
  return parsed;
};
const luminance = ({ r, g, b }: Rgb) => {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Same recipe as `toneStyle`: accent share mixed into a base colour. */
const mix = (accent: Rgb, base: Rgb, share: number): Rgb => ({
  r: Math.round(accent.r * share + base.r * (1 - share)),
  g: Math.round(accent.g * share + base.g * (1 - share)),
  b: Math.round(accent.b * share + base.b * (1 - share)),
});
const canvasText = (theme: Theme): Rgb =>
  theme.monacoTheme.base === "vs" || theme.monacoTheme.base === "hc-light"
    ? { r: 0, g: 0, b: 0 }
    : { r: 255, g: 255, b: 255 };

const themes = themeRegistry.getAllPresets();

describe("tone coverage across bundled themes", () => {
  it("covers every preset", () => {
    expect(themes.length).toBeGreaterThanOrEqual(12);
  });

  it("maps each tone to the theme variable it is derived from", () => {
    for (const [tone, key] of Object.entries(ACCENT_KEY) as [TintedTone, string][]) {
      expect(TONE_ACCENT[tone]).toBe(`var(--accent-${key})`);
    }
  });

  describe.each(themes.map((theme) => [theme.name, theme] as const))("%s", (_, theme) => {
    const elevated = rgb(theme.colors.bg.elevated);
    const accents = Object.fromEntries(
      (Object.keys(ACCENT_KEY) as TintedTone[]).map((tone) => [tone, rgb(theme.colors.accent[ACCENT_KEY[tone]])]),
    ) as Record<TintedTone, Rgb>;

    it("keeps chip text readable on its tinted background (WCAG AA for UI text)", () => {
      for (const tone of Object.keys(accents) as TintedTone[]) {
        const background = mix(accents[tone], elevated, 0.14);
        const text = mix(accents[tone], canvasText(theme), 0.4);
        expect(contrast(text, background), `${tone} text`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps the chip border visible against the card", () => {
      for (const tone of Object.keys(accents) as TintedTone[]) {
        const border = mix(accents[tone], elevated, 0.32);
        expect(contrast(border, elevated), `${tone} border`).toBeGreaterThanOrEqual(1.15);
      }
    });

    it("never lets updates look like a warning or an error", () => {
      const update = theme.colors.accent.primary.toLowerCase();
      expect(update).not.toBe(theme.colors.accent.warning.toLowerCase());
      expect(update).not.toBe(theme.colors.accent.error.toLowerCase());
    });
  });
});
