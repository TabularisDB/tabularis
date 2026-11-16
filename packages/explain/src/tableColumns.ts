/**
 * Column order of the EXPLAIN table view. The row number column (`#`) always
 * comes first and is not part of the order; every other column can be moved.
 */

export const EXPLAIN_TABLE_COLUMNS = [
    'operation',
    'relation',
    'cost',
    'estRows',
    'actualRows',
    'loops',
    'selfTime',
    'estimateGap',
    'filter',
] as const;

export type ExplainTableColumnId = (typeof EXPLAIN_TABLE_COLUMNS)[number];

/** Columns that only hold values when the plan has ANALYZE data. */
export const EXPLAIN_TABLE_ANALYZE_COLUMNS: ReadonlySet<ExplainTableColumnId> = new Set([
    'actualRows',
    'loops',
]);

function isExplainTableColumnId(value: unknown): value is ExplainTableColumnId {
    return (
        typeof value === 'string' && (EXPLAIN_TABLE_COLUMNS as readonly string[]).includes(value)
    );
}

/**
 * Turn a saved order into a complete one. Unknown ids and duplicates are
 * dropped, and columns the saved order lacks (for example one added in a later
 * version) are inserted after the column they follow by default, so an old
 * saved order keeps working.
 */
export function normalizeExplainTableColumnOrder(saved: unknown): ExplainTableColumnId[] {
    const order: ExplainTableColumnId[] = [];
    if (Array.isArray(saved)) {
        for (const id of saved) {
            if (isExplainTableColumnId(id) && !order.includes(id)) order.push(id);
        }
    }

    EXPLAIN_TABLE_COLUMNS.forEach((id, defaultIndex) => {
        if (order.includes(id)) return;
        const previous = EXPLAIN_TABLE_COLUMNS.slice(0, defaultIndex).reverse();
        const anchor = previous.find((candidate) => order.includes(candidate));
        order.splice(anchor ? order.indexOf(anchor) + 1 : 0, 0, id);
    });

    return order;
}

/**
 * Move `column` to the place of `target`: to its left when moving left, to its
 * right when moving right, the way a dragged column header lands. Returns the
 * same array when nothing moves.
 */
export function moveExplainTableColumn(
    order: readonly ExplainTableColumnId[],
    column: ExplainTableColumnId,
    target: ExplainTableColumnId,
): readonly ExplainTableColumnId[] {
    const from = order.indexOf(column);
    const to = order.indexOf(target);
    if (from === -1 || to === -1 || from === to) return order;
    const next = order.filter((id) => id !== column);
    next.splice(to, 0, column);
    return next;
}

/**
 * Move `column` one place to the left (-1) or right (1) among the columns that
 * are shown, skipping hidden ones. Returns the same array at either end.
 */
export function shiftExplainTableColumn(
    order: readonly ExplainTableColumnId[],
    column: ExplainTableColumnId,
    direction: -1 | 1,
    visible: readonly ExplainTableColumnId[] = order,
): readonly ExplainTableColumnId[] {
    const shown = order.filter((id) => visible.includes(id));
    const at = shown.indexOf(column);
    const neighbour = at === -1 ? undefined : shown[at + direction];
    return neighbour ? moveExplainTableColumn(order, column, neighbour) : order;
}

/** True when `order` is the default order. */
export function isDefaultExplainTableColumnOrder(order: readonly ExplainTableColumnId[]): boolean {
    return (
        order.length === EXPLAIN_TABLE_COLUMNS.length &&
        order.every((id, index) => id === EXPLAIN_TABLE_COLUMNS[index])
    );
}
