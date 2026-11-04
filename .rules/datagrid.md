# Data Grid Rules

The result grid (`packages/web-ui/src/components/ui/DataGrid.tsx`) has two layouts: the normal one, where each record is a row, and the transposed one (#561), where each record is a column and each field is a row. Both render the same `DataGridCell` at a logical `(rowIndex, colIndex)`, where `rowIndex` is the record and `colIndex` the result column, whichever way they are laid out.

1. **Logic works on logical addresses.** Selection, editing, copy, paste, masking, find matching and pending changes use `(rowIndex, colIndex)`, never the screen axis. Written that way, a feature works in both layouts with no extra code.
2. **Geometry is per layout.** Code that scrolls, focuses, measures, pins (sticky or frozen) or maps keys must also handle the transposed layout, where records are virtualized horizontally and fields are not virtualized:
   - Scroll to a record with `recordAxisVirtualizer`, which is the row or the record virtualizer depending on the layout.
   - Find a cell with `td[data-row-index][data-col-index]`. When transposed there is no `tr[data-row-index]`.
   - Map arrow keys with `toLogicalArrowKey` and `navigateVisibleCell`, so they follow the screen in both layouts.
3. **Render and navigate visible columns.** Iterate `visibleColIndices`, not `columns`: hidden columns are hidden fields when transposed.
4. **Check both layouts.** A grid change that touches geometry adds at least one `transposed` case to its tests and is tried in the app with the transpose toggle on.
