/**
 * Shared responsive conventions; the full guide is "Responsive layout" in docs/DESIGN.md.
 *
 * Widths are rem and match the `md` and `lg` breakpoints pinned in src/index.css (48rem,
 * 64rem), so a `md:` class and `useViewportLayout()` always agree, even when the browser's
 * default font size is not 16px. Prefer CSS (media or container
 * queries) for presentation; reach for these only when behavior changes.
 */
export const BREAKPOINTS = {
    /** Intermediate layout from this width; compact below it. */
    intermediate: 48,
    /** Wide (desktop) layout from this width. */
    wide: 64,
} as const;

export type ViewportLayout = 'compact' | 'intermediate' | 'wide';

/**
 * Media queries for behavior that depends on the viewport or the input device. Width and
 * input capability are independent: a narrow desktop window is compact with a fine
 * pointer, a touch laptop is wide with a coarse one.
 */
export const MEDIA_QUERIES = {
    intermediate: `(min-width: ${BREAKPOINTS.intermediate}rem)`,
    wide: `(min-width: ${BREAKPOINTS.wide}rem)`,
    /** Primary pointer is a finger: size primary controls with `min-h-touch`. */
    coarsePointer: '(pointer: coarse)',
    /** Primary pointer can hover: hover-only affordances are acceptable as extras. */
    hover: '(hover: hover)',
} as const;
