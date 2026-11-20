/** Fraction of the connection color kept when brightening it (the rest is white). */
const BRIGHTEN_PERCENT = 80;

/**
 * Bar color when no connection is active, the same in light and dark themes.
 * A named CSS color, since it is not a theme choice.
 */
const DEFAULT_COLOR = 'lightskyblue';

/**
 * Color of the bottom bar: a brighter version of the active connection's
 * accent color, or light blue when there is none.
 */
export function resolveConnectionBarColor(accent: string | null | undefined): string {
    if (!accent) return DEFAULT_COLOR;
    return `color-mix(in srgb, ${accent} ${BRIGHTEN_PERCENT}%, white)`;
}
