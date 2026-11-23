/** Share of the connection color kept in the bar (the rest is the theme's text color). */
const ACCENT_PERCENT = 80;

/** Bar color when no connection is active: the theme's primary accent, like the editor tab bar. */
const DEFAULT_ACCENT = 'var(--accent-primary)';

/**
 * Color of the bottom bar: the active connection's accent color (or the
 * theme accent when there is none), mixed toward the theme's primary text
 * color so it stands out more against the background. On dark themes this
 * makes it lighter, on light themes a little deeper.
 */
export function resolveConnectionBarColor(accent: string | null | undefined): string {
    return `color-mix(in srgb, ${accent || DEFAULT_ACCENT} ${ACCENT_PERCENT}%, var(--text-primary))`;
}
