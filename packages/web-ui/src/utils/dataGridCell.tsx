import React from 'react';

/**
 * Inlined equivalent of the DataGrid column's default `cell` renderer (see
 * `tableColumns` in DataGrid). Kept as a standalone helper so the memoized row
 * (`DataGridRow`) can render cell content without going through react-table's
 * `flexRender`.
 *
 * NULL / undefined render as a muted italic placeholder (a muted dot when the
 * "empty cell" NULL display leaves no label, so it still differs from an empty
 * string); any other value
 * (including the falsy-but-present `0`, `""`, `false`) renders the already
 * formatted text verbatim — this helper never re-formats.
 */
export function renderDefaultCellContent(
    value: unknown,
    formatted: string,
    colorClass?: string,
): React.ReactNode {
    if (value === null || value === undefined) {
        if (formatted === '') {
            return (
                <span className="text-muted italic" data-null-marker="">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current align-middle opacity-60" />
                </span>
            );
        }
        return <span className="text-muted italic">{formatted}</span>;
    }
    if (colorClass) {
        return <span className={colorClass}>{formatted}</span>;
    }
    return formatted;
}
