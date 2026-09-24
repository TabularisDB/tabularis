import type { Theme, ThemeColors } from "../types/theme";
import { hexToRgb, rgbToHex } from "../themes/colorUtils";

/** WCAG 2.2 AA minimum for body text (SC 1.4.3). */
export const TEXT_CONTRAST = 4.5;
/** WCAG 2.2 AA minimum for focus indicators and other UI graphics (SC 1.4.11). */
export const UI_CONTRAST = 3;

type ColorGroup = keyof ThemeColors;
/** A theme color path such as `text.primary`, or `onAccent:accent.error` for a derived label color. */
export type ContrastToken = string;

export interface ContrastPair {
  foreground: ContrastToken;
  background: ContrastToken;
  minimum: number;
}

export interface ContrastViolation extends ContrastPair {
  foregroundColor: string;
  backgroundColor: string;
  ratio: number;
}

const pairs = (foregrounds: ContrastToken[], backgrounds: ContrastToken[], minimum: number): ContrastPair[] =>
  foregrounds.flatMap((foreground) => backgrounds.map((background) => ({ foreground, background, minimum })));

const ACCENT_TONES = ["secondary", "success", "warning", "error", "info"] as const;

/**
 * Foreground/background token combinations the UI actually paints, as
 * described in DESIGN.md. Each built-in theme must meet WCAG AA on all of them.
 * `text.disabled` is left out on purpose: WCAG exempts inactive controls.
 */
export const CONTRAST_PAIRS: ContrastPair[] = [
  ...pairs(["text.primary", "text.secondary", "text.muted"], ["bg.base", "bg.elevated", "bg.overlay", "surface.secondary"], TEXT_CONTRAST),
  ...pairs(["text.primary"], ["bg.tooltip", "surface.tertiary"], TEXT_CONTRAST),
  ...pairs(["text.accent"], ["bg.base", "bg.elevated", "surface.secondary"], TEXT_CONTRAST),
  ...pairs(["text.inverse"], ["accent.primary"], TEXT_CONTRAST),
  ...ACCENT_TONES.flatMap((tone) => pairs([`onAccent:accent.${tone}`], [`accent.${tone}`], TEXT_CONTRAST)),
  // `text-accent-success`, `text-accent-error`, ... paint status text with the fill color.
  ...pairs(ACCENT_TONES.map((tone) => `accent.${tone}`), ["bg.base", "bg.elevated"], TEXT_CONTRAST),
  ...pairs(
    ["string", "number", "boolean", "date", "null", "primaryKey", "foreignKey", "index", "modified", "new", "deleted"].map((key) => `semantic.${key}`),
    ["bg.base", "bg.elevated"],
    TEXT_CONTRAST,
  ),
  ...pairs(["border.focus"], ["bg.base", "bg.elevated", "bg.input"], UI_CONTRAST),
];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex color, or null when it cannot be parsed. */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two hex colors (1 to 21), or null when either cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Label color painted over an accent fill, mirroring `--text-on-accent-*` in
 * index.css: white below CIELAB lightness 49.44, black from there up.
 */
export function onAccentColor(fill: string): string | null {
  const y = relativeLuminance(fill);
  if (y === null) return null;
  const lightness = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  return lightness < 49.44 ? "#ffffff" : "#000000";
}

/** Resolves a contrast token against a theme's colors. */
export function resolveContrastToken(colors: ThemeColors, token: ContrastToken): string | null {
  if (token.startsWith("onAccent:")) {
    const fill = resolveContrastToken(colors, token.slice("onAccent:".length));
    return fill === null ? null : onAccentColor(fill);
  }
  const [group, key] = token.split(".") as [ColorGroup, string];
  const value = (colors[group] as Record<string, string> | undefined)?.[key];
  return typeof value === "string" ? value : null;
}

/** Lists every contrast pair a theme fails. Colors that are not plain hex are skipped. */
export function auditThemeContrast(theme: Pick<Theme, "colors">, contrastPairs: ContrastPair[] = CONTRAST_PAIRS): ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  for (const pair of contrastPairs) {
    const foregroundColor = resolveContrastToken(theme.colors, pair.foreground);
    const backgroundColor = resolveContrastToken(theme.colors, pair.background);
    if (!foregroundColor || !backgroundColor) continue;
    const ratio = contrastRatio(foregroundColor, backgroundColor);
    if (ratio !== null && ratio < pair.minimum) violations.push({ ...pair, foregroundColor, backgroundColor, ratio });
  }
  return violations;
}

function toHsl(hex: string): [number, number, number] | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255);
}

/**
 * Nearest color with the same hue and saturation that reaches `minimum`
 * against every background, moving lightness away from the backgrounds.
 * Returns null when no lightness in that direction is enough.
 */
export function suggestForeground(foreground: string, backgrounds: string[], minimum: number): string | null {
  const hsl = toHsl(foreground);
  const luminances = backgrounds.map(relativeLuminance);
  if (!hsl || luminances.some((l) => l === null)) return null;
  const passes = (hex: string) => backgrounds.every((bg) => (contrastRatio(hex, bg) ?? 0) >= minimum);
  if (passes(foreground)) return foreground;
  const [h, s, l] = hsl;
  const backgroundLuminance = (luminances as number[]).reduce((sum, lum) => sum + lum, 0) / luminances.length;
  const lighten = (relativeLuminance(foreground) ?? 0) >= backgroundLuminance;
  for (let step = 1; step <= 200; step++) {
    const lightness = lighten ? l + step / 400 : l - step / 400;
    if (lightness < 0 || lightness > 1) break;
    const candidate = fromHsl(h, s, lightness);
    if (passes(candidate)) return candidate;
  }
  return null;
}
