import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Copy,
  Undo,
  Trash2,
  Edit,
  Sparkles,
  Ban,
  FileDigit,
  ExternalLink,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAlert } from "../../hooks/useAlert";
import {
  USE_DEFAULT_SENTINEL,
  formatCellValue,
  getColumnSortState,
  calculateSelectionRange,
  toggleSetValue,
  resolveInsertionCellDisplay,
  resolveExistingCellDisplay,
  getCellStateClass,
  type MergedRow,
  type ColumnDisplayInfo,
} from "../../utils/dataGrid";
import { isGeometricType, formatGeometricValue } from "../../utils/geometry";
import { isBlobColumn, isBlobWireFormat } from "../../utils/blob";
import { isJsonColumn } from "../../utils/json";
import { getDateInputMode } from "../../utils/dateInput";
import { GeometryInput } from "./GeometryInput";
import { DateInput } from "./DateInput";
import { RowEditorSidebar } from "./RowEditorSidebar";
import { useDatabase } from "../../hooks/useDatabase";
import {
  rowsToCSV,
  rowsToJSON,
  getSelectedRows,
  copyTextToClipboard,
} from "../../utils/clipboard";
import type { PendingInsertion, TableColumn } from "../../types/editor";

interface DataGridProps {
  columns: string[];
  data: unknown[][];
  tableName?: string | null;
  pkColumn?: string | null;
  autoIncrementColumns?: string[];
  defaultValueColumns?: string[];
  nullableColumns?: string[];
  columnMetadata?: TableColumn[];
  connectionId?: string | null;
  onRefresh?: () => void;
  pendingChanges?: Record<
    string,
    { pkOriginalValue: unknown; changes: Record<string, unknown> }
  >;
  pendingDeletions?: Record<string, unknown>;
  pendingInsertions?: Record<string, PendingInsertion>;
  onPendingChange?: (pkVal: unknown, colName: string, value: unknown) => void;
  onPendingInsertionChange?: (
    tempId: string,
    colName: string,
    value: unknown,
  ) => void;
  onDiscardInsertion?: (tempId: string) => void;
  onRevertDeletion?: (pkVal: unknown) => void;
  onMarkForDeletion?: (pkVal: unknown) => void;
  selectedRows?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
  copyFormat?: "csv" | "json";
  csvDelimiter?: string;
  sortClause?: string;
  onSort?: (colName: string) => void;
}

export const DataGrid = React.memo(
  ({
    columns,
    data,
    tableName,
    pkColumn,
    autoIncrementColumns,
    defaultValueColumns,
    nullableColumns,
    columnMetadata,
    connectionId,
    onRefresh,
    pendingChanges,
    pendingDeletions,
    pendingInsertions,
    onPendingChange,
    onPendingInsertionChange,
    onDiscardInsertion,
    onRevertDeletion,
    onMarkForDeletion,
    selectedRows: externalSelectedRows,
    onSelectionChange,
    copyFormat,
    csvDelimiter = ",",
    sortClause,
    onSort,
  }: DataGridProps) => {
    const { t } = useTranslation();
    const { activeSchema } = useDatabase();
    const { showAlert } = useAlert();

    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      row: unknown[];
      rowIndex: number;
      colIndex: number;
      colName: string;
      mergedRow?: {
        type: "existing" | "insertion";
        rowData: unknown[];
        displayIndex: number;
        tempId?: string;
      };
    } | null>(null);
    const [headerContextMenu, setHeaderContextMenu] = useState<{
      x: number;
      y: number;
      colName: string;
    } | null>(null);
    const [editingCell, setEditingCell] = useState<{
      rowIndex: number;
      colIndex: number;
      value: unknown;
      isRawSql?: boolean;
    } | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarRowData, setSidebarRowData] = useState<{
      data: Record<string, unknown>;
      rowIndex: number;
      focusField?: string;
    } | null>(null);
    const [internalSelectedRowIndices, setInternalSelectedRowIndices] =
      useState<Set<number>>(new Set());
    const [lastSelectedRowIndex, setLastSelectedRowIndex] = useState<
      number | null
    >(null);
    const editInputRef = useRef<HTMLInputElement>(null);

    const selectedRowIndices =
      externalSelectedRows || internalSelectedRowIndices;

    const updateSelection = useCallback(
      (newSelection: Set<number>) => {
        if (onSelectionChange) {
          onSelectionChange(newSelection);
        } else {
          setInternalSelectedRowIndices(newSelection);
        }
      },
      [onSelectionChange],
    );

    // Pre-calculate pkIndex once for O(1) lookup instead of O(n) in render loop
    const pkIndexMap = useMemo(() => {
      if (!pkColumn) return null;
      const pkIndex = columns.indexOf(pkColumn);
      return pkIndex >= 0 ? pkIndex : null;
    }, [columns, pkColumn]);

    // Create column type map for O(1) lookup during cell rendering
    const columnTypeMap = useMemo(() => {
      if (!columnMetadata) return null;
      return new Map(columnMetadata.map((col) => [col.name, col.data_type]));
    }, [columnMetadata]);

    // Create column length map for O(1) lookup during blob rendering decisions
    const columnLengthMap = useMemo(() => {
      if (!columnMetadata) return null;
      return new Map(
        columnMetadata.map((col) => [
          col.name,
          col.character_maximum_length,
        ]),
      );
    }, [columnMetadata]);

    // Merge existing rows with pending insertions
    const mergedRows = useMemo(() => {
      const rows: MergedRow[] = [];

      // Add existing rows first (displayIndex 0, 1, 2, ...)
      data.forEach((rowData, idx) => {
        rows.push({
          type: "existing",
          rowData,
          displayIndex: idx,
        });
      });

      // Add pending insertions at the end
      if (pendingInsertions) {
        const existingRowCount = data.length;
        let insertionIndex = 0;
        Object.entries(pendingInsertions).forEach(([tempId, insertion]) => {
          const rowData = columns.map((col) => insertion.data[col] ?? null);
          rows.push({
            type: "insertion",
            rowData,
            displayIndex: existingRowCount + insertionIndex,
            tempId,
          });
          insertionIndex++;
        });
      }

      // Sort by displayIndex (insertions are now at the end)
      return rows.sort((a, b) => a.displayIndex - b.displayIndex);
    }, [data, pendingInsertions, columns]);

    const handleRowClick = useCallback(
      (index: number, event: React.MouseEvent) => {
        let newSelected = new Set(selectedRowIndices);

        if (event.shiftKey && lastSelectedRowIndex !== null) {
          // Range selection
          const range = calculateSelectionRange(lastSelectedRowIndex, index);

          // If NOT Ctrl/Cmd, clear previous selection first (standard OS behavior)
          if (!event.ctrlKey && !event.metaKey) {
            newSelected.clear();
          }

          range.forEach((i) => newSelected.add(i));
        } else if (event.ctrlKey || event.metaKey) {
          // Toggle selection
          newSelected = toggleSetValue(newSelected, index);
          setLastSelectedRowIndex(index);
        } else {
          // Single selection
          newSelected.clear();
          newSelected.add(index);
          setLastSelectedRowIndex(index);
        }

        updateSelection(newSelected);
      },
      [selectedRowIndices, lastSelectedRowIndex, updateSelection],
    );

    const handleSelectAll = useCallback(() => {
      if (selectedRowIndices.size === mergedRows.length) {
        updateSelection(new Set());
      } else {
        const allIndices = new Set(mergedRows.map((_, i) => i));
        updateSelection(allIndices);
      }
    }, [selectedRowIndices.size, mergedRows, updateSelection]);

    useEffect(() => {
      if (editingCell && editInputRef.current) {
        editInputRef.current.focus();
      }
    }, [editingCell]);

    const handleCellDoubleClick = (
      rowIndex: number,
      colIndex: number,
      value: unknown,
    ) => {
      if (!tableName) return;

      const mergedRow = mergedRows[rowIndex];
      if (!mergedRow) return;
      if (mergedRow.type !== "insertion" && !pkColumn) return;

      const colName = columns[colIndex];
      const colType = columnTypeMap?.get(colName);

      if (
        colType &&
        (isBlobColumn(colType, columnLengthMap?.get(colName)) ||
          isBlobWireFormat(value))
      ) {
        setSidebarRowData({
          data: buildRowDataWithPending(mergedRow.rowData, mergedRow.type === "insertion"),
          rowIndex,
          focusField: colName,
        });
        setSidebarOpen(true);
        return;
      }

      if (colType && isJsonColumn(colType)) {
        setSidebarRowData({
          data: buildRowDataWithPending(mergedRow.rowData, mergedRow.type === "insertion"),
          rowIndex,
          focusField: colName,
        });
        setSidebarOpen(true);
        return;
      }

      let editValue = value;
      if (
        colType &&
        isGeometricType(colType) &&
        value !== null &&
        value !== undefined
      ) {
        editValue = formatGeometricValue(value);
      }

      setEditingCell({ rowIndex, colIndex, value: editValue });
    };

    const isCommittingRef = useRef(false);

    const handleEditCommit = async () => {
      // Prevent multiple concurrent commits (e.g., from rapid blur events)
      if (isCommittingRef.current) return;
      if (!editingCell || !tableName) {
        setEditingCell(null);
        return;
      }

      isCommittingRef.current = true;

      try {
        const { rowIndex, colIndex, value } = editingCell;

        // Safety check: ensure mergedRows has data
        if (!mergedRows || rowIndex >= mergedRows.length) {
          console.warn("Invalid rowIndex in handleEditCommit");
          setEditingCell(null);
          return;
        }

        // Check if this is an insertion row
        const mergedRow = mergedRows[rowIndex];
        const isInsertion = mergedRow?.type === "insertion";

        if (isInsertion) {
          // Handle insertion cell edit
          if (onPendingInsertionChange && mergedRow.tempId) {
            const colName = columns[colIndex];
            onPendingInsertionChange(mergedRow.tempId, colName, value);
          }
          setEditingCell(null);
          return;
        }

        // Existing row logic
        const row = mergedRow.rowData;
        if (!row) {
          console.warn("Invalid row data in handleEditCommit");
          setEditingCell(null);
          return;
        }

        // Original value
        const originalValue = row[colIndex];

        // Check if value changed (handling string/number differences)
        const isUnchanged = String(value) === String(originalValue);

        if (isUnchanged && !onPendingChange) {
          setEditingCell(null);
          return;
        }

        // PK Value - check pkIndexMap is valid
        if (pkIndexMap === null) {
          setEditingCell(null);
          return;
        }
        const pkVal = row[pkIndexMap];
        const colName = columns[colIndex];

        if (onPendingChange) {
          // If value matches original, pass undefined to remove the pending change
          onPendingChange(pkVal, colName, isUnchanged ? undefined : value);
          setEditingCell(null);
          return;
        }

        if (!connectionId) return;

        // Legacy immediate update
        try {
          await invoke("update_record", {
            connectionId,
            table: tableName,
            pkCol: pkColumn,
            pkVal,
            colName,
            newVal: value,
            ...(activeSchema ? { schema: activeSchema } : {}),
          });
          if (onRefresh) onRefresh();
        } catch (e) {
          console.error("Update failed:", e);
          showAlert(t("dataGrid.updateFailed") + e, {
            title: t("common.error"),
            kind: "error",
          });
        }
        setEditingCell(null);
      } finally {
        isCommittingRef.current = false;
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleEditCommit();
      } else if (e.key === "Escape") {
        setEditingCell(null);
      } else if (e.key === "Tab") {
        e.preventDefault(); // Prevent default tab behavior

        if (!editingCell) return;

        // Commit current cell first
        handleEditCommit();

        const { rowIndex, colIndex } = editingCell;
        const totalRows = mergedRows.length;
        const totalCols = columns.length;

        // Calculate next position
        let nextRowIndex = rowIndex;
        let nextColIndex = colIndex + 1;

        // If we're at the last column, move to next row
        if (nextColIndex >= totalCols) {
          nextColIndex = 0;
          nextRowIndex = rowIndex + 1;

          // If we're at the last row, wrap to first row
          if (nextRowIndex >= totalRows) {
            nextRowIndex = 0;
          }
        }

        // Get the value of the next cell
        const nextRow = mergedRows[nextRowIndex];
        if (nextRow) {
          const nextValue = nextRow.rowData[nextColIndex];

          // Set editing on the next cell
          setTimeout(() => {
            setEditingCell({
              rowIndex: nextRowIndex,
              colIndex: nextColIndex,
              value: nextValue,
            });
          }, 0);
        }
      }
    };

    const columnHelper = useMemo(() => createColumnHelper<unknown[]>(), []);

    const coreRowModel = useMemo(() => getCoreRowModel(), []);

    const tableColumns = React.useMemo(
      () =>
        columns.map((colName, index) =>
          columnHelper.accessor((row) => row[index], {
            id: colName,
            header: () => {
              const sortState = getColumnSortState(colName, sortClause);
              const displaySortState: "none" | "asc" | "desc" =
                sortState ?? "none";

              return (
                <div
                  className={`flex items-center gap-2 select-none group/header ${onSort ? "cursor-pointer" : ""}`}
                  onClick={() => onSort && onSort(colName)}
                  title={
                    onSort
                      ? displaySortState === "none"
                        ? t("dataGrid.sortByAsc", { col: colName })
                        : displaySortState === "asc"
                          ? t("dataGrid.sortByDesc", { col: colName })
                          : t("dataGrid.clearSort")
                      : undefined
                  }
                >
                  <span>{colName}</span>
                  {onSort && (
                    <span className="flex flex-col items-center justify-center">
                      {displaySortState === "asc" && (
                        <ArrowUp size={14} className="text-blue-400" />
                      )}
                      {displaySortState === "desc" && (
                        <ArrowDown size={14} className="text-blue-400" />
                      )}
                      {displaySortState === "none" && (
                        <ArrowUpDown
                          size={14}
                          className="text-secondary/60 opacity-50 group-hover/header:opacity-100 transition-opacity"
                        />
                      )}
                    </span>
                  )}
                </div>
              );
            },
            cell: (info) => {
              const val = info.getValue();
              const colName = info.column.id;
              const colType = columnTypeMap?.get(colName);
              const formatted = formatCellValue(
                val,
                t("dataGrid.null"),
                colType,
                columnLengthMap?.get(colName),
              );

              // The <generated> placeholder logic for auto-increment columns is handled
              // in the main render loop where we have full context (isInsertion, etc).

              // Apply styling for null values
              if (val === null || val === undefined) {
                return <span className="text-muted italic">{formatted}</span>;
              }

              return formatted;
            },
          }),
        ),
      [columns, columnHelper, t, sortClause, onSort, columnTypeMap, columnLengthMap],
    );

    const parentRef = useRef<HTMLDivElement>(null);

    // Memoize table data to prevent unnecessary re-renders
    const tableData = useMemo(
      () => mergedRows.map((r) => r.rowData),
      [mergedRows],
    );

    const table = useReactTable({
      data: tableData,
      columns: tableColumns,
      getCoreRowModel: coreRowModel,
    });

    const { rows: tableRows } = table.getRowModel();

    const rowVirtualizer = useVirtualizer({
      count: tableRows.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 35,
      overscan: 10,
    });

    // Track insertion count to auto-scroll to bottom when new rows are added
    const prevInsertionCountRef = useRef(0);
    useEffect(() => {
      const insertionCount = pendingInsertions
        ? Object.keys(pendingInsertions).length
        : 0;
      if (
        insertionCount > prevInsertionCountRef.current &&
        tableRows.length > 0
      ) {
        rowVirtualizer.scrollToIndex(tableRows.length - 1, { align: "end" });
      }
      prevInsertionCountRef.current = insertionCount;
    }, [pendingInsertions, tableRows.length, rowVirtualizer]);

    const handleContextMenu = useCallback(
      (
        e: React.MouseEvent,
        row: unknown[],
        rowIndex: number,
        colIndex: number,
        colName: string,
      ) => {
        if (tableName) {
          e.preventDefault();
          // Find the merged row corresponding to this DOM element
          const mergedRow = mergedRows.find((mr) => mr.rowData === row);
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            row,
            rowIndex,
            colIndex,
            colName,
            mergedRow,
          });
        }
      },
      [tableName, mergedRows],
    );

    const revertSelectedRow = useCallback(() => {
      if (!contextMenu) return;

      const isInsertion = contextMenu.mergedRow?.type === "insertion";
      const tempId = contextMenu.mergedRow?.tempId;

      // Handle insertion row revert (discard)
      if (isInsertion && tempId && onDiscardInsertion) {
        onDiscardInsertion(tempId);
        setContextMenu(null);
        return;
      }

      // For existing rows, need pkColumn
      if (!pkColumn || pkIndexMap === null) return;

      const pkVal = contextMenu.row[pkIndexMap];
      const pkValStr = String(pkVal);

      // Handle pending deletion revert
      const isPendingDelete = pendingDeletions?.[pkValStr] !== undefined;
      if (isPendingDelete && onRevertDeletion) {
        onRevertDeletion(pkVal);
        setContextMenu(null);
        return;
      }

      // Handle pending changes revert
      const rowPendingChanges = pendingChanges?.[pkValStr];
      if (rowPendingChanges && onPendingChange) {
        // Revert all pending changes for this row by setting them to undefined
        Object.keys(rowPendingChanges.changes).forEach((colName) => {
          onPendingChange(pkVal, colName, undefined);
        });
        setContextMenu(null);
        return;
      }

      setContextMenu(null);
    }, [
      contextMenu,
      onPendingChange,
      onRevertDeletion,
      onDiscardInsertion,
      pkColumn,
      pkIndexMap,
      pendingChanges,
      pendingDeletions,
    ]);

    const deleteSelectedRow = useCallback(() => {
      if (!contextMenu) return;

      const isInsertion = contextMenu.mergedRow?.type === "insertion";
      const tempId = contextMenu.mergedRow?.tempId;

      // Handle insertion row deletion (discard)
      if (isInsertion && tempId && onDiscardInsertion) {
        onDiscardInsertion(tempId);
        setContextMenu(null);
        return;
      }

      // For existing rows, mark for deletion
      if (pkColumn && pkIndexMap !== null && onMarkForDeletion) {
        const pkVal = contextMenu.row[pkIndexMap];
        onMarkForDeletion(pkVal);
        setContextMenu(null);
      }
    }, [
      contextMenu,
      onDiscardInsertion,
      onMarkForDeletion,
      pkColumn,
      pkIndexMap,
    ]);

    const buildRowDataWithPending = useCallback(
      (rowArray: unknown[], isInsertion: boolean): Record<string, unknown> => {
        const rowData: Record<string, unknown> = {};
        columns.forEach((col, idx) => {
          rowData[col] = rowArray[idx];
        });
        if (!isInsertion && pkIndexMap !== null) {
          const pkVal = rowArray[pkIndexMap];
          const pending = pendingChanges?.[String(pkVal)]?.changes;
          if (pending) Object.assign(rowData, pending);
        }
        return rowData;
      },
      [columns, pkIndexMap, pendingChanges],
    );

    const openSidebarEditor = useCallback(() => {
      if (!contextMenu) return;
      const isInsertion = contextMenu.mergedRow?.type === "insertion";
      setSidebarRowData({
        data: buildRowDataWithPending(contextMenu.row, isInsertion ?? false),
        rowIndex: contextMenu.rowIndex,
      });
      setSidebarOpen(true);
      setContextMenu(null);
    }, [contextMenu, buildRowDataWithPending]);

    // Unified handler for setting cell values from context menu actions
    const setCellValue = useCallback(
      (value: unknown) => {
        if (!contextMenu) return;
        const { colName, mergedRow } = contextMenu;
        const isInsertion = mergedRow?.type === "insertion";

        if (isInsertion && onPendingInsertionChange && mergedRow.tempId) {
          onPendingInsertionChange(mergedRow.tempId, colName, value);
        } else if (onPendingChange && pkIndexMap !== null) {
          const pkVal = contextMenu.row[pkIndexMap];
          onPendingChange(pkVal, colName, value);
        }
        setContextMenu(null);
      },
      [contextMenu, onPendingInsertionChange, onPendingChange, pkIndexMap],
    );

    const setCellGenerate = useCallback(
      () => setCellValue(null),
      [setCellValue],
    );
    const setCellNull = useCallback(() => setCellValue(null), [setCellValue]);
    const setCellDefault = useCallback(() => {
      if (!contextMenu) return;
      const isInsertion = contextMenu.mergedRow?.type === "insertion";
      // For insertions, null triggers <default> display; for existing rows, use sentinel
      setCellValue(isInsertion ? null : USE_DEFAULT_SENTINEL);
    }, [contextMenu, setCellValue]);
    const setCellEmpty = useCallback(() => setCellValue(" "), [setCellValue]);

    const copyToClipboard = useCallback(
      async (text: string) => {
        try {
          await copyTextToClipboard(text);
          // Optional: show a brief success message
          // showAlert(t("dataGrid.copied"), { title: t("common.success"), kind: "info" });
        } catch (e) {
          console.error("Copy failed:", e);
          showAlert(t("common.error") + ": " + e, {
            title: t("common.error"),
            kind: "error",
          });
        }
      },
      [t, showAlert],
    );

    const formatRows = useCallback(
      (rows: unknown[][]) =>
        copyFormat === "json"
          ? rowsToJSON(rows, columns)
          : rowsToCSV(rows, "null", csvDelimiter),
      [columns, copyFormat, csvDelimiter],
    );

    const copySelectedOrContextRow = useCallback(async () => {
      if (!contextMenu) return;

      const rows =
        selectedRowIndices.size > 0
          ? getSelectedRows(data, selectedRowIndices)
          : [contextMenu.row];

      await copyToClipboard(formatRows(rows));
    }, [contextMenu, selectedRowIndices, data, formatRows, copyToClipboard]);

    const copyHeaderName = useCallback(async () => {
      if (!headerContextMenu) return;
      await copyToClipboard(headerContextMenu.colName);
      setHeaderContextMenu(null);
    }, [headerContextMenu, copyToClipboard]);

    const copyHeaderNameQuoted = useCallback(async () => {
      if (!headerContextMenu) return;
      await copyToClipboard(`\`${headerContextMenu.colName}\``);
      setHeaderContextMenu(null);
    }, [headerContextMenu, copyToClipboard]);

    const copyHeaderNameTable = useCallback(async () => {
      if (!headerContextMenu) return;
      const tName = tableName ? `${tableName}.` : "";
      await copyToClipboard(`${tName}${headerContextMenu.colName}`);
      setHeaderContextMenu(null);
    }, [headerContextMenu, tableName, copyToClipboard]);

    const copySelectedCells = useCallback(async () => {
      if (selectedRowIndices.size === 0) return;
      await copyToClipboard(formatRows(getSelectedRows(data, selectedRowIndices)));
    }, [selectedRowIndices, data, formatRows, copyToClipboard]);

    // Handle keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // CMD/CTRL + C
        if ((e.metaKey || e.ctrlKey) && e.key === "c") {
          // Only handle if not editing a cell
          if (!editingCell && selectedRowIndices.size > 0) {
            e.preventDefault();
            copySelectedCells();
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [editingCell, selectedRowIndices, copySelectedCells]);

    // Show "no data" if there are no columns (even with pending insertions, we can't render without column info)
    // OR if there are columns but no data and no pending insertions
    if (columns.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-muted">
          {t("dataGrid.noData")}
        </div>
      );
    }

    return (
      <div
        ref={parentRef}
        className="h-full overflow-auto border border-default rounded bg-elevated relative"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          <table
            className="w-full text-left border-collapse absolute top-0 left-0"
            style={{
              transform: `translateY(${rowVirtualizer.getVirtualItems()[0]?.start ?? 0}px)`,
            }}
          >
            <thead
              className="bg-base sticky top-0 z-10 shadow-sm"
              style={{
                transform: `translateY(${-1 * (rowVirtualizer.getVirtualItems()[0]?.start ?? 0)}px)`,
              }}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  <th
                    onClick={handleSelectAll}
                    className="px-2 py-2 text-xs font-semibold text-muted border-b border-r border-default bg-base sticky left-0 z-20 text-center select-none w-[50px] min-w-[50px] cursor-pointer hover:bg-elevated"
                  >
                    #
                  </th>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-2 text-xs font-semibold text-secondary tracking-wider border-b border-r border-default last:border-r-0 whitespace-nowrap"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setHeaderContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          colName: header.id,
                        });
                      }}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index];
                const rowIndex = virtualRow.index;
                const isSelected = selectedRowIndices.has(rowIndex);

                // Check if this is an insertion row
                const mergedRow = mergedRows[rowIndex];
                const isInsertion = mergedRow?.type === "insertion";

                // Get PK for pending check (using pre-calculated pkIndexMap)
                const pkVal =
                  pkIndexMap !== null ? String(row.original[pkIndexMap]) : null;
                const isPendingDelete =
                  !isInsertion && pkVal
                    ? pendingDeletions?.[pkVal] !== undefined
                    : false;

                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className={`transition-colors group ${
                      isSelected
                        ? "bg-blue-900/20 border-l-4 border-blue-400"
                        : isInsertion
                          ? "bg-green-500/8 border-l-4 border-green-400"
                          : isPendingDelete
                            ? "bg-red-900/20 opacity-60"
                            : "hover:bg-surface-secondary/50"
                    }`}
                  >
                    <td
                      onClick={(e) => handleRowClick(rowIndex, e)}
                      className={`px-2 py-1.5 text-xs text-center border-b border-r border-default sticky left-0 z-10 cursor-pointer select-none w-[50px] min-w-[50px] ${
                        isInsertion
                          ? isSelected
                            ? "bg-blue-900/40 text-blue-200 font-bold"
                            : "bg-green-950/30 text-green-300 font-bold"
                          : isPendingDelete
                            ? "bg-red-950/50 text-red-500 line-through"
                            : isSelected
                              ? "bg-blue-900/40 text-blue-200 font-bold"
                              : "bg-base text-muted hover:bg-surface-secondary"
                      }`}
                    >
                      {isInsertion ? "NEW" : rowIndex + 1}
                    </td>
                    {row.getVisibleCells().map((cell, colIndex) => {
                      const isEditing =
                        editingCell?.rowIndex === rowIndex &&
                        editingCell?.colIndex === colIndex;

                      const colName = cell.column.id;

                      const columnInfo: ColumnDisplayInfo = {
                        colName,
                        autoIncrementColumns,
                        defaultValueColumns,
                        nullableColumns,
                      };

                      const resolved = isInsertion
                        ? resolveInsertionCellDisplay(
                            cell.getValue(),
                            columnInfo,
                          )
                        : resolveExistingCellDisplay(
                            cell.getValue(),
                            pkVal,
                            pkColumn,
                            pendingChanges,
                            columnInfo,
                          );

                      const {
                        displayValue,
                        hasPendingChange,
                        isModified,
                        isAutoIncrementPlaceholder,
                        isDefaultValuePlaceholder,
                      } = resolved;

                      const stateClass = getCellStateClass({
                        isPendingDelete,
                        isSelected,
                        isInsertion,
                        isAutoIncrementPlaceholder,
                        isDefaultValuePlaceholder,
                        isModified,
                      });

                      return (
                        <td
                          key={cell.id}
                          onClick={(e) => {
                            // Don't handle row click if clicking on a button
                            const target = e.target as HTMLElement;
                            if (target.closest("button")) {
                              return;
                            }
                            handleRowClick(rowIndex, e);
                          }}
                          onDoubleClick={() =>
                            !isPendingDelete &&
                            handleCellDoubleClick(
                              rowIndex,
                              colIndex,
                              isAutoIncrementPlaceholder ||
                                isDefaultValuePlaceholder
                                ? ""
                                : displayValue,
                            )
                          }
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              row.original,
                              rowIndex,
                              colIndex,
                              colName,
                            )
                          }
                          className={`px-4 py-1.5 text-sm border-b border-r border-default last:border-r-0 font-mono ${isEditing ? "relative" : "whitespace-nowrap truncate max-w-[300px]"} cursor-text ${stateClass}`}
                          title={!isEditing ? String(displayValue) : ""}
                        >
                          {isEditing
                            ? (() => {
                                const colType = columnTypeMap?.get(colName);
                                if (colType && isGeometricType(colType)) {
                                  return (
                                    <GeometryInput
                                      inputRef={editInputRef}
                                      value={String(editingCell.value ?? "")}
                                      dataType={colType}
                                      onChange={(newValue, isRawSql) =>
                                        setEditingCell((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                value: newValue,
                                                isRawSql,
                                              }
                                            : null,
                                        )
                                      }
                                      onBlur={handleEditCommit}
                                      onKeyDown={handleKeyDown}
                                      onSqlFunctionsClick={() => {
                                        // Close inline editing
                                        setEditingCell(null);

                                        // Open sidebar with the current row
                                        const mergedRow = mergedRows[rowIndex];
                                        if (mergedRow) {
                                          setSidebarRowData({
                                            data: buildRowDataWithPending(mergedRow.rowData, mergedRow.type === "insertion"),
                                            rowIndex: rowIndex,
                                            focusField: colName,
                                          });
                                          setSidebarOpen(true);
                                        }
                                      }}
                                      className="w-full bg-base text-primary border-none outline-none p-0 m-0 font-mono"
                                    />
                                  );
                                }
                                const dateMode =
                                  colType ? getDateInputMode(colType) : null;
                                if (dateMode) {
                                  return (
                                    <DateInput
                                      value={String(editingCell.value ?? "")}
                                      mode={dateMode}
                                      onChange={(newValue) =>
                                        setEditingCell((prev) =>
                                          prev
                                            ? { ...prev, value: newValue }
                                            : null,
                                        )
                                      }
                                      onBlur={handleEditCommit}
                                      onKeyDown={handleKeyDown}
                                      inputRef={editInputRef}
                                    />
                                  );
                                }
                                const textValue = String(
                                  editingCell.value ?? "",
                                );
                                // Measure the longest line to size the textarea
                                const lines = textValue.split("\n");
                                const canvas = document.createElement("canvas");
                                const ctx = canvas.getContext("2d");
                                if (ctx) {
                                  ctx.font =
                                    "14px ui-monospace, SFMono-Regular, monospace";
                                }
                                const longestLineWidth = ctx
                                  ? Math.max(
                                      ...lines.map(
                                        (line) =>
                                          ctx.measureText(line).width,
                                      ),
                                    )
                                  : 200;
                                // padding (p-2 = 8px * 2) + small buffer
                                const textareaWidth =
                                  Math.ceil(longestLineWidth) + 32;

                                return (
                                  <>
                                    {/* Invisible placeholder to preserve td width */}
                                    <span className="invisible whitespace-nowrap">
                                      {String(displayValue)}
                                    </span>
                                    <textarea
                                      ref={(el) => {
                                        (
                                          editInputRef as React.MutableRefObject<HTMLElement | null>
                                        ).current = el;
                                        if (el) {
                                          const td = el.parentElement;
                                          if (td) {
                                            el.style.width = `${Math.max(td.offsetWidth, textareaWidth)}px`;
                                          }
                                        }
                                      }}
                                      value={textValue}
                                      rows={Math.min(lines.length, 10)}
                                      onChange={(e) => {
                                        setEditingCell((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                value: e.target.value,
                                              }
                                            : null,
                                        );
                                      }}
                                      onBlur={handleEditCommit}
                                      onKeyDown={handleKeyDown}
                                      className="absolute left-0 top-0 max-w-[400px] max-h-[120px] bg-base text-primary border border-blue-500 rounded shadow-lg p-2 font-mono text-sm resize-none z-50 outline-none"
                                    />
                                  </>
                                );
                              })()
                            : hasPendingChange
                              ? String(displayValue)
                              : (() => {
                                  const colType = columnTypeMap?.get(colName);
                                  if (
                                    colType &&
                                    (isBlobColumn(colType, columnLengthMap?.get(colName)) ||
                                      isBlobWireFormat(displayValue)) &&
                                    !isPendingDelete
                                  ) {
                                    return (
                                      <span className="flex items-center gap-1 group/blobcell w-full">
                                        <span className="truncate flex-1">
                                          {flexRender(
                                            cell.column.columnDef.cell,
                                            cell.getContext(),
                                          )}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const mergedRow =
                                              mergedRows[rowIndex];
                                            if (mergedRow) {
                                              setSidebarRowData({
                                                data: buildRowDataWithPending(mergedRow.rowData, mergedRow.type === "insertion"),
                                                rowIndex,
                                                focusField: colName,
                                              });
                                              setSidebarOpen(true);
                                            }
                                          }}
                                          className="opacity-0 group-hover/blobcell:opacity-100 transition-opacity p-0.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary flex-shrink-0"
                                          title={t("blobInput.openSidebar")}
                                        >
                                          <ExternalLink size={11} />
                                        </button>
                                      </span>
                                    );
                                  }
                                  return flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext(),
                                  );
                                })()}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {contextMenu &&
          (() => {
            // Check if this row has any pending changes, deletions, or is an insertion
            const isInsertion = contextMenu.mergedRow?.type === "insertion";
            const pkVal =
              pkIndexMap !== null ? String(contextMenu.row[pkIndexMap]) : null;
            const hasPendingChanges =
              !isInsertion && pkVal && pendingChanges?.[pkVal] !== undefined;
            const hasPendingDeletion =
              !isInsertion && pkVal && pendingDeletions?.[pkVal] !== undefined;

            // Enable revert if there's any pending change, deletion, or insertion
            const canRevert =
              isInsertion || hasPendingChanges || hasPendingDeletion;

            // Determine which cell value options to show based on column properties
            const { colName } = contextMenu;
            const isAutoIncrement = autoIncrementColumns?.includes(colName);
            const isNullable = nullableColumns?.includes(colName);
            const hasDefault = defaultValueColumns?.includes(colName);

            // Build menu items dynamically
            const menuItems: ContextMenuItem[] = [];

            // Cell value manipulation options (shown first for cell context)
            // SET GENERATED only for insertion rows, not for existing rows
            if (isAutoIncrement && isInsertion) {
              menuItems.push({
                label: t("dataGrid.setGenerate"),
                icon: Sparkles,
                action: setCellGenerate,
              });
            }
            if (isNullable) {
              menuItems.push({
                label: t("dataGrid.setNull"),
                icon: Ban,
                action: setCellNull,
              });
            }
            if (hasDefault) {
              menuItems.push({
                label: t("dataGrid.setDefault"),
                icon: FileDigit,
                action: setCellDefault,
              });
            }
            // Always allow setting empty string, except for BLOB columns
            const colDataType = columnTypeMap?.get(colName) ?? "";
            if (!isBlobColumn(colDataType, columnLengthMap?.get(colName))) {
              menuItems.push({
                label: t("dataGrid.setEmpty"),
                icon: Copy,
                action: setCellEmpty,
              });
            }

            // Separator and row actions
            if (menuItems.length > 0) {
              menuItems.push({ separator: true });
            }

            menuItems.push(
              {
                label: t("dataGrid.copySelectedRows"),
                icon: Copy,
                action: copySelectedOrContextRow,
              },
              {
                label: t("contextMenu.openSidebar"),
                icon: Edit,
                action: openSidebarEditor,
              },
              {
                label: t("dataGrid.deleteRow"),
                icon: Trash2,
                danger: true,
                action: deleteSelectedRow,
              },
              {
                label: t("dataGrid.revertSelected"),
                icon: Undo,
                action: revertSelectedRow,
                disabled: !canRevert,
              },
            );

            return (
              <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                onClose={() => setContextMenu(null)}
                items={menuItems}
              />
            );
          })()}

        {headerContextMenu && (
          <ContextMenu
            x={headerContextMenu.x}
            y={headerContextMenu.y}
            onClose={() => setHeaderContextMenu(null)}
            items={[
              {
                label: t("dataGrid.copyColumnName"),
                icon: Copy,
                action: copyHeaderName,
              },
              {
                label: t("dataGrid.copyColumnNameQuoted"),
                icon: Copy,
                action: copyHeaderNameQuoted,
              },
              {
                label: t("dataGrid.copyColumnNameTable"),
                icon: Copy,
                action: copyHeaderNameTable,
              },
            ]}
          />
        )}

        {/* Row Editor Sidebar */}
        {sidebarOpen &&
          sidebarRowData &&
          (() => {
            const mergedRow = mergedRows[sidebarRowData.rowIndex];
            const isInsertion = mergedRow?.type === "insertion";

            return (
              <RowEditorSidebar
                isOpen={sidebarOpen}
                onClose={() => {
                  setSidebarOpen(false);
                  setSidebarRowData(null);
                }}
                rowData={sidebarRowData.data}
                rowIndex={sidebarRowData.rowIndex}
                isInsertion={isInsertion}
                columns={columns.map((colName, index) => ({
                  name: colName,
                  type: columnMetadata?.[index]?.data_type,
                  characterMaximumLength:
                    columnMetadata?.[index]?.character_maximum_length,
                }))}
                autoIncrementColumns={autoIncrementColumns}
                defaultValueColumns={defaultValueColumns}
                nullableColumns={nullableColumns}
                focusField={sidebarRowData.focusField}
                connectionId={connectionId}
                tableName={tableName}
                pkColumn={pkColumn}
                schema={activeSchema}
                onChange={(colName, value) => {
                  // Get the merged row to determine if it's an insertion or existing row
                  const mergedRow = mergedRows[sidebarRowData.rowIndex];
                  if (!mergedRow) return;

                  const isInsertion = mergedRow.type === "insertion";

                  // Apply change immediately
                  if (
                    isInsertion &&
                    onPendingInsertionChange &&
                    mergedRow.tempId
                  ) {
                    // Handle insertion row updates
                    onPendingInsertionChange(mergedRow.tempId, colName, value);
                  } else if (
                    !isInsertion &&
                    onPendingChange &&
                    pkColumn &&
                    pkIndexMap !== null
                  ) {
                    // Handle existing row updates
                    const rowData = mergedRow.rowData;
                    if (rowData) {
                      const pkVal = rowData[pkIndexMap];
                      onPendingChange(pkVal, colName, value);
                    }
                  }
                }}
              />
            );
          })()}
      </div>
    );
  },
);
