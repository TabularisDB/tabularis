import {useCallback, useEffect, useMemo, useState} from 'react';
import {getVisibleColumnIndices, hideColumn, showColumn} from '@/utils/columnVisibility';

const NO_HIDDEN_COLUMNS: ReadonlySet<number> = new Set();

interface HiddenColumnsState {
    key: string;
    hidden: ReadonlySet<number>;
}

// Hidden columns of grids that remount with the same columns, such as a table tab
// after Submit refreshes it. In memory only, like the hidden set itself.
const rememberedHiddenColumns = new Map<string, HiddenColumnsState>();

/**
 * Columns hidden in a data grid (visual only, not persisted). The hidden set
 * belongs to one column layout: when the result's columns change, it starts
 * empty again instead of hiding unrelated columns at the same positions.
 * With a `rememberKey`, a remounted grid with the same columns gets the set back.
 */
export function useHiddenColumns(columns: readonly string[], rememberKey?: string) {
    const layoutKey = useMemo(() => `${columns.length}:${columns.join('\u0000')}`, [columns]);
    const [state, setState] = useState<HiddenColumnsState>(() => {
        const remembered = rememberKey ? rememberedHiddenColumns.get(rememberKey) : undefined;
        return remembered?.key === layoutKey
            ? remembered
            : {key: layoutKey, hidden: NO_HIDDEN_COLUMNS};
    });
    const hiddenColumns = state.key === layoutKey ? state.hidden : NO_HIDDEN_COLUMNS;

    useEffect(() => {
        if (!rememberKey) return;
        if (state.hidden.size === 0) {
            rememberedHiddenColumns.delete(rememberKey);
        } else {
            rememberedHiddenColumns.set(rememberKey, state);
        }
    }, [rememberKey, state]);

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
