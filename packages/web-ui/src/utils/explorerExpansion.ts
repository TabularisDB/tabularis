/**
 * Expanded/collapsed state of explorer tree nodes, saved in the shared UI state
 * so the tree looks the same after a restart.
 *
 * Only nodes whose state differs from their default are stored, which keeps the
 * map small: collapsing an expanded table again removes its entry.
 */
export type ExplorerExpansion = Readonly<Record<string, boolean>>;

const EMPTY: ExplorerExpansion = Object.freeze({});

/**
 * Key of one tree node. `path` lists the node's ancestors and itself, for example
 * `['db', 'shop']` or `['table', 'shop', 'public', 'orders']`; missing database or
 * schema names (drivers without them) are kept as empty strings.
 */
export function expansionKey(
    connectionId: string,
    path: readonly (string | null | undefined)[],
): string {
    return JSON.stringify([connectionId, ...path.map((part) => part ?? '')]);
}

/** Saved state of one node, or `undefined` when nothing (valid) is saved for it. */
export function readExpanded(value: unknown, key: string): boolean | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (!Object.hasOwn(value, key)) return undefined;
    const entry = (value as Record<string, unknown>)[key];
    return typeof entry === 'boolean' ? entry : undefined;
}

/** Drops anything that is not a `key → boolean` map (old or broken values). */
export function sanitizeExplorerExpansion(value: unknown): ExplorerExpansion {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY;
    const entries = Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    );
    return entries.length === Object.keys(value).length
        ? (value as ExplorerExpansion)
        : Object.fromEntries(entries);
}

/**
 * Returns `expansion` with `key` set to `expanded`, or with the entry removed when
 * it matches the node's default. Returns the same object when nothing changes, so
 * the store skips the write.
 */
export function withExpanded(
    expansion: ExplorerExpansion,
    key: string,
    expanded: boolean,
    defaultExpanded: boolean,
): ExplorerExpansion {
    if (expanded === defaultExpanded) {
        if (!Object.hasOwn(expansion, key)) return expansion;
        const next: Record<string, boolean> = {...expansion};
        delete next[key];
        return next;
    }
    if (expansion[key] === expanded) return expansion;
    return {...expansion, [key]: expanded};
}
