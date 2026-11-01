import type {ThemeColors} from '@/types/theme';

type TokenPath = readonly [keyof ThemeColors, string];

/**
 * Series order for result charts. Picked by running a colour-vision-deficiency
 * check (OKLab distance under simulated protanopia/deuteranopia) over every
 * built-in theme: primary → warning → boolean → success (blue, amber, violet,
 * green in the default theme) keeps neighbouring series apart far more often
 * than the notebook order (primary, success, warning, error...), where green,
 * amber and red merge for red-green colour-blind readers.
 */
export const CATEGORICAL_SERIES_TOKENS: readonly TokenPath[] = [
    ['accent', 'primary'],
    ['accent', 'warning'],
    ['semantic', 'boolean'],
    ['accent', 'success'],
    ['accent', 'info'],
    ['accent', 'error'],
    ['accent', 'secondary'],
    ['semantic', 'string'],
    ['semantic', 'date'],
    ['semantic', 'number'],
];

/**
 * Resolves the categorical series colours for a theme, dropping duplicates
 * (several themes reuse one hue for two accents) so two series never share a
 * colour.
 */
export function buildCategoricalSeries(colors: ThemeColors): string[] {
    const seen = new Set<string>();
    const series: string[] = [];
    for (const [group, key] of CATEGORICAL_SERIES_TOKENS) {
        const value = (colors[group] as Record<string, string>)[key];
        if (!value) continue;
        const normalized = value.trim().toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        series.push(value);
    }
    return series;
}

/** Parses a theme radius ("4px", "0", "0.25rem") into pixels for SVG marks, capped. */
export function radiusToPixels(radius: string | undefined, max = 4): number {
    if (!radius) return 0;
    const value = parseFloat(radius);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const px = radius.trim().endsWith('rem') ? value * 16 : value;
    return Math.min(px, max);
}
