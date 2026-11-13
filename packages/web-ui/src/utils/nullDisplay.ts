/**
 * How NULL values are shown in the data grid (Settings > General > Data
 * Editor). Display only: copy, export and editing keep their own NULL text.
 */
export type NullDisplay = 'default' | 'parenthesized' | 'emptySet' | 'empty';

export const DEFAULT_NULL_DISPLAY: NullDisplay = 'default';

/**
 * The label a NULL grid cell renders for the chosen display. `defaultLabel`
 * is the translated `dataGrid.null` text, today's look. `"empty"` returns an
 * empty string; the cell renderer still marks it as NULL.
 */
export function getNullDisplayLabel(
    display: NullDisplay | undefined,
    defaultLabel: string,
): string {
    switch (display) {
        case 'parenthesized':
            return '(null)';
        case 'emptySet':
            return '∅';
        case 'empty':
            return '';
        default:
            return defaultLabel;
    }
}
