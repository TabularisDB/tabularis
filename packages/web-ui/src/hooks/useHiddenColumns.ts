import {useCallback, useMemo, useState} from 'react';
import {getVisibleColumnIndices, hideColumn, showColumn} from '@/utils/columnVisibility';

const NO_HIDDEN_COLUMNS: ReadonlySet<number> = new Set();

/**
 * Columns hidden in a data grid (visual only, not persisted). The hidden set
 * belongs to one column layout: when the result's columns change, it starts
 * empty again instead of hiding unrelated columns at the same positions.
 */
export function useHiddenColumns(columns: readonly string[]) {
    const layoutKey = useMemo(() => `${columns.length}:${columns.join('\u0000')}`, [columns]);
    const [state, setState] = useState<{key: string; hidden: ReadonlySet<number>}>({
        key: layoutKey,
        hidden: NO_HIDDEN_COLUMNS,
    });
    const hiddenColumns = state.key === layoutKey ? state.hidden : NO_HIDDEN_COLUMNS;

    const visibleColumns = useMemo(
        () => getVisibleColumnIndices(columns.length, hiddenColumns),
        [columns.length, hiddenColumns],
    );

    const hide = useCallback(
        (colIndex: number) =>
            setState((prev) => ({
                key: layoutKey,
                hidden: hideColumn(
                    prev.key === layoutKey ? prev.hidden : NO_HIDDEN_COLUMNS,
                    colIndex,
                    columns.length,
                ),
            })),
        [layoutKey, columns.length],
    );

    const show = useCallback(
        (colIndex: number) =>
            setState((prev) =>
                prev.key === layoutKey
                    ? {key: layoutKey, hidden: showColumn(prev.hidden, colIndex)}
                    : prev,
            ),
        [layoutKey],
    );

    const showAll = useCallback(
        () => setState({key: layoutKey, hidden: NO_HIDDEN_COLUMNS}),
        [layoutKey],
    );

    return {hiddenColumns, visibleColumns, hide, show, showAll};
}
