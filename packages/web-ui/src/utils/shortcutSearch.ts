/**
 * Filtering helpers for the Settings → Shortcuts search field.
 *
 * A row matches when its translated action label contains the query, or when
 * its displayed key combination contains the query once both are normalised:
 * modifier symbols and their textual names (⌘ / Cmd / Command, ⌥ / Opt /
 * Option, ⇧ / Shift, ⌃ / Control / Ctrl) compare equal, case and spacing
 * around "+" are ignored. macOS keeps Cmd and Ctrl apart because both exist
 * there; other platforms have no Cmd key, so a "Cmd" query finds "Ctrl".
 */

const SYMBOL_ALIASES: ReadonlyArray<[RegExp, string]> = [
    [/⌘/g, 'cmd'],
    [/⌥/g, 'alt'],
    [/⇧/g, 'shift'],
    [/⌃/g, 'ctrl'],
    [/⌫/g, 'backspace'],
];

const WORD_ALIASES: ReadonlyArray<[RegExp, string]> = [
    [/\b(?:command|meta)\b/g, 'cmd'],
    [/\b(?:option|opt)\b/g, 'alt'],
    [/\bcontrol\b/g, 'ctrl'],
    [/\bescape\b/g, 'esc'],
    [/\breturn\b/g, 'enter'],
    [/\bdelete\b/g, 'del'],
];

/**
 * Normalises a key combination (displayed or typed) to a canonical lowercase
 * form, e.g. "⌘ + Shift + Enter" → "cmd+shift+enter".
 */
export function normalizeShortcutText(text: string, isMac: boolean): string {
    let normalized = text.trim().toLowerCase();
    for (const [pattern, replacement] of SYMBOL_ALIASES) {
        normalized = normalized.replace(pattern, ` ${replacement} `);
    }
    for (const [pattern, replacement] of WORD_ALIASES) {
        normalized = normalized.replace(pattern, replacement);
    }
    if (!isMac) {
        normalized = normalized.replace(/\bcmd\b/g, 'ctrl');
    }
    return normalized
        .trim()
        .replace(/\s*([+/])\s*/g, '$1')
        .replace(/\s+/g, '+');
}

export interface ShortcutSearchRow {
    /** Translated action label as shown in the list. */
    label: string;
    /** Effective key combination as shown in the list. */
    shortcut: string;
}

/**
 * Returns whether a shortcut row matches the search query. An empty or
 * whitespace-only query matches every row.
 */
export function matchesShortcutSearch(
    row: ShortcutSearchRow,
    query: string,
    isMac: boolean,
): boolean {
    const trimmed = query.trim();
    if (!trimmed) return true;

    if (row.label.toLowerCase().includes(trimmed.toLowerCase())) return true;

    const normalizedQuery = normalizeShortcutText(trimmed, isMac);
    return (
        normalizedQuery.length > 0 &&
        normalizeShortcutText(row.shortcut, isMac).includes(normalizedQuery)
    );
}
