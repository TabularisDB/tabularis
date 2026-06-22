import React from "react";

/**
 * Inlined equivalent of the DataGrid column's default `cell` renderer (see
 * `tableColumns` in DataGrid). Kept as a standalone helper so the memoized row
 * (`DataGridRow`) can render cell content without going through react-table's
 * `flexRender`.
 *
 * NULL / undefined render as a muted italic placeholder; any other value
 * (including the falsy-but-present `0`, `""`, `false`) renders the already
 * formatted text verbatim — this helper never re-formats.
 */
export function renderDefaultCellContent(
  value: unknown,
  formatted: string,
  colorClass?: string,
): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted italic">{formatted}</span>;
  }
  if (colorClass) {
    return <span className={colorClass}>{formatted}</span>;
  }
  return formatted;
}
