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
import { SlotAnchor } from "./SlotAnchor";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Braces,
  Copy,
  CopyPlus,
  Clock,
  Undo,
  Trash2,
  Edit,
  Sparkles,
  Ban,
  FileDigit,
  ExternalLink,
  PanelBottomOpen,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAlert } from "../../hooks/useAlert";
import {
  USE_DEFAULT_SENTINEL,
  formatCellValue,
  getColumnSortState,
  calculateSelectionRange,
  toggleSetValue,
  getResultValueType,
  type MergedRow,
} from "../../utils/dataGrid";
import { useSettings } from "../../hooks/useSettings";
import { isGeometricType, formatGeometricValue } from "../../utils/geometry";
import { isBlobColumn, isBlobWireFormat } from "../../utils/blob";
import { isJsonColumn, isJsonContent } from "../../utils/json";
import {
  pickPrimaryForeignKeyByColumn,
  getForeignKeyForPreview,
} from "../../utils/foreignKeys";
import {
  getDateInputMode,
  parseDateTime,
  formatDateTime,
} from "../../utils/dateInput";
import { RowEditorSidebar } from "./RowEditorSidebar";
import { useDatabase } from "../../hooks/useDatabase";
import {
  rowsToCSV,
  rowsToCSVWithHeaders,
  rowsToJSON,
  rowsToSqlInsert,
  getSelectedRows,
  copyTextToClipboard,
} from "../../utils/clipboard";
import type {
  PendingInsertion,
  TableColumn,
  ForeignKey,
} from "../../types/editor";
import { MemoRow, type RowCtx } from "./DataGridRow";

interface DataGridProps {
  columns: string[];
  data: unknown[][];
  tableName?: string | null;
  pkColumn?: string | null;
  autoIncrementColumns?: string[];
  defaultValueColumns?: string[];
  nullableColumns?: string[];
  columnMetadata?: TableColumn[];
  foreignKeys?: ForeignKey[];
  onForeignKeyNavigate?: (fk: ForeignKey, value: unknown) => void;
  onForeignKeyShowPanel?: (fk: ForeignKey, value: unknown) => void;
  onForeignKeyHidePanel?: () => void;
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
  onMarkMultipleForDeletion?: (pkVals: unknown[]) => void;
  onDuplicateRow?: (rowData: Record<string, unknown>) => void;
  selectedRows?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
  copyFormat?: "csv" | "json" | "sql-insert";
  csvDelimiter?: string;
  csvIncludeHeaders?: boolean;
  sortClause?: string;
  onSort?: (colName: string) => void;
  readonly?: boolean;
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
    foreignKeys,
    onForeignKeyNavigate,
    onForeignKeyShowPanel,
    onForeignKeyHidePanel,
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
    onMarkMultipleForDeletion,
    onDuplicateRow,
    selectedRows: externalSelectedRows,
    onSelectionChange,
    copyFormat,
    csvDelimiter = ",",
    csvIncludeHeaders = true,
    sortClause,
    onSort,
    readonly: readonlyProp,
  }: DataGridProps) => {
    const { t } = useTranslation();
    const { activeSchema, connections } = useDatabase();
    const { showAlert } = useAlert();
    const { settings } = useSettings();
    const colorByType = settings.resultColorByType ?? false;

    const detectJsonInTextColumns = useMemo(() => {
      if (!connectionId) return false;
      return (
        connections.find((c) => c.id === connectionId)
          ?.detect_json_in_text_columns === true
      );
    }, [connections, connectionId]);

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
    const [expandedCell, setExpandedCell] = useState<{
      rowIndex: number;
      colIndex: number;
      kind: "json" | "text";
    } | null>(null);

    useEffect(() => {
      setExpandedCell(null);
    }, [data]);

    const [internalSelectedRowIndices, setInternalSelectedRowIndices] =
      useState<Set<number>>(new Set());
    const [lastSelectedRowIndex, setLastSelectedRowIndex] = useState<
      number | null
    >(null);
    const [focusedCell, setFocusedCell] = useState<{
      rowIndex: number;
      colIndex: number;
    } | null>(null);
    const editInputRef = useRef<HTMLInputElement>(null);
    // Mirror of editingCell so the commit/keydown callbacks can read the latest
    // value without listing editingCell in their deps — keeps their identity
    // stable so the memoized rows don't re-render on every keystroke/scroll.
    const editingCellRef = useRef(editingCell);
    useEffect(() => {
      editingCellRef.current = editingCell;
    }, [editingCell]);
    const pendingJsonSessions = useRef<
      Map<string, { colName: string; rowData: unknown[]; isInsertion: boolean; tempId?: string }>
    >(new Map());

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
        columnMetadata.map((col) => [col.name, col.character_maximum_length]),
      );
    }, [columnMetadata]);

    // Precompute the result-coloring class per column once (the type is fixed
    // per column), so rows don't reclassify every cell on each render. `null`
    // when the feature is off, which makes rows skip the wrapper entirely.
    const resultColorClassMap = useMemo(() => {
      if (!colorByType) return null;
      const map = new Map<string, string>();
      for (const colName of columns) {
        const colType = columnTypeMap?.get(colName);
        if (colType) map.set(colName, `rcell-${getResultValueType(undefined, colType)}`);
      }
      return map;
    }, [colorByType, columns, columnTypeMap]);

    const isJsonCellTarget = useCallback(
      (colType: string | undefined, value: unknown): boolean => {
        if (colType && isJsonColumn(colType)) return true;
        if (!detectJsonInTextColumns) return false;
        if (Array.isArray(value)) return true;
        if (isJsonContent(value)) return true;
        return false;
      },
      [detectJsonInTextColumns],
    );

    const buildRowLabel = useCallback(
      (rowData: unknown[], rowIndex: number, isInsertion: boolean): string => {
        if (isInsertion) return t("dataGrid.newRow", { defaultValue: "NEW" });
        if (pkColumn && pkIndexMap !== null) {
          const pkVal = rowData[pkIndexMap];
          if (pkVal !== null && pkVal !== undefined && pkVal !== "") {
            return `${pkColumn}=${String(pkVal)}`;
          }
        }
        return `Row ${rowIndex + 1}`;
      },
      [pkColumn, pkIndexMap, t],
    );

    const openJsonViewerWindow = useCallback(
      async (
        value: unknown,
        originalValue: unknown,
        colName: string,
        rowData: unknown[],
        rowIndex: number,
        isInsertion: boolean,
        tempId: string | undefined,
        readOnly: boolean,
      ) => {
        try {
          const rowLabel = buildRowLabel(rowData, rowIndex, isInsertion);
          let cellKey: string | null = null;
          const canSaveBack =
            (isInsertion && !!tempId) ||
            (!isInsertion && pkIndexMap !== null);
          if (isInsertion && tempId) {
            cellKey = `ins:${tempId}:${colName}`;
          } else if (!isInsertion && pkIndexMap !== null) {
            const pkVal = rowData[pkIndexMap];
            if (pkVal !== null && pkVal !== undefined && pkVal !== "") {
              cellKey = `pk:${String(pkVal)}:${colName}`;
            }
          }
          const sessionId = await invoke<string>("open_json_viewer_window", {
            value,
            originalValue,
            colName,
            rowLabel,
            readOnly: readOnly || !canSaveBack,
            cellKey,
          });
          pendingJsonSessions.current.set(sessionId, {
            colName,
            rowData,
            isInsertion,
            tempId,
          });
        } catch (e) {
          console.error("Failed to open JSON viewer window:", e);
        }
      },
      [buildRowLabel, pkIndexMap],
    );

    useEffect(() => {
      const unlistenPromise = listen<{ session_id: string; value: unknown }>(
        "json-viewer:saved",
        (event) => {
          const { session_id, value } = event.payload;
          const session = pendingJsonSessions.current.get(session_id);
          if (!session) return;
          pendingJsonSessions.current.delete(session_id);

          const { colName, rowData, isInsertion, tempId } = session;
          if (isInsertion && onPendingInsertionChange && tempId) {
            onPendingInsertionChange(tempId, colName, value);
          } else if (!isInsertion && onPendingChange && pkIndexMap !== null) {
            const pkVal = rowData[pkIndexMap];
            onPendingChange(pkVal, colName, value);
          }
        },
      );
      return () => {
        unlistenPromise.then((fn) => fn());
      };
    }, [onPendingChange, onPendingInsertionChange, pkIndexMap]);

    const fksByColumn = useMemo(
      () => pickPrimaryForeignKeyByColumn(foreignKeys),
      [foreignKeys],
    );

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
      setFocusedCell(null);
      onForeignKeyHidePanel?.();
      if (selectedRowIndices.size === mergedRows.length) {
        updateSelection(new Set());
      } else {
        const allIndices = new Set(mergedRows.map((_, i) => i));
        updateSelection(allIndices);
        const allRows = mergedRows.map((r) => r.rowData);
        const text = copyFormat === "json"
          ? rowsToJSON(allRows, columns)
          : copyFormat === "sql-insert"
          ? rowsToSqlInsert(allRows, columns, tableName ?? "table")
          : csvIncludeHeaders
          ? rowsToCSVWithHeaders(allRows, columns, "null", csvDelimiter)
          : rowsToCSV(allRows, "null", csvDelimiter);
        copyTextToClipboard(text).catch((e) => {
          showAlert(t("common.error") + ": " + e, { title: t("common.error"), kind: "error" });
        });
      }
    }, [
      selectedRowIndices.size,
      mergedRows,
      updateSelection,
      onForeignKeyHidePanel,
      columns,
      copyFormat,
      csvDelimiter,
      csvIncludeHeaders,
      tableName,
      showAlert,
      t,
    ]);

    useEffect(() => {
      if (editingCell && editInputRef.current) {
        editInputRef.current.focus();
      }
    }, [editingCell]);

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

    const handleCellDoubleClick = useCallback(
      (rowIndex: number, colIndex: number, value: unknown) => {
      if (!tableName || readonlyProp) return;

      const mergedRow = mergedRows[rowIndex];
      if (!mergedRow) return;
      if (mergedRow.type !== "insertion" && !pkColumn) return;

      const colName = columns[colIndex];

      // For existing rows we must be able to build a safe UPDATE. Two guards,
      // each running whenever the data it depends on is available, so they
      // don't silently no-op when a driver omits result metadata:
      //
      // 1. The primary key must be present in the result set (needed for the
      //    WHERE clause). Depends only on pkColumn + columns.
      // 2. The edited column must map to a real physical column of the table
      //    (prevents malformed UPDATEs on aliased/computed columns). Requires
      //    columnMetadata; skipped when it's unavailable.
      if (mergedRow.type !== "insertion") {
        if (
          pkColumn &&
          !columns.some((c) => c.toLowerCase() === pkColumn.toLowerCase())
        ) {
          showAlert(
            t("dataGrid.pkRequiredToEdit", {
              pk: pkColumn,
              defaultValue:
                'To edit this result, include the primary key column "{{pk}}" in your SELECT.',
            }),
            { title: t("common.error"), kind: "warning" },
          );
          return;
        }

        if (columnMetadata && columnMetadata.length > 0) {
          const realColumns = new Set(
            columnMetadata.map((c) => c.name.toLowerCase()),
          );
          if (!realColumns.has(colName.toLowerCase())) {
            showAlert(
              t("dataGrid.columnNotEditable", {
                column: colName,
                table: tableName,
                defaultValue:
                  'Column "{{column}}" can\'t be edited — it is not a direct column of table "{{table}}" (likely an alias or computed value).',
              }),
              { title: t("common.error"), kind: "warning" },
            );
            return;
          }
        }
      }

      const colType = columnTypeMap?.get(colName);

      if (
        colType &&
        (isBlobColumn(colType, columnLengthMap?.get(colName)) ||
          isBlobWireFormat(value))
      ) {
        setSidebarRowData({
          data: buildRowDataWithPending(
            mergedRow.rowData,
            mergedRow.type === "insertion",
          ),
          rowIndex,
          focusField: colName,
        });
        setSidebarOpen(true);
        return;
      }

      if (colType && isJsonColumn(colType)) {
        const isInsertion = mergedRow.type === "insertion";
        openJsonViewerWindow(
          value,
          mergedRow.rowData[colIndex],
          colName,
          mergedRow.rowData,
          rowIndex,
          isInsertion,
          mergedRow.tempId,
          readonlyProp ?? false,
        );
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
    },
      [
        tableName,
        readonlyProp,
        mergedRows,
        pkColumn,
        columns,
        columnTypeMap,
        columnLengthMap,
        columnMetadata,
        buildRowDataWithPending,
        openJsonViewerWindow,
        showAlert,
        t,
      ],
    );

    const isCommittingRef = useRef(false);

    const handleEditCommit = useCallback(async () => {
      // Prevent multiple concurrent commits (e.g., from rapid blur events)
      if (isCommittingRef.current) return;
      const editingCell = editingCellRef.current;
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
    }, [
      tableName,
      mergedRows,
      columns,
      onPendingInsertionChange,
      onPendingChange,
      pkIndexMap,
      pkColumn,
      connectionId,
      activeSchema,
      onRefresh,
      showAlert,
      t,
    ]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      const editingCell = editingCellRef.current;
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
    }, [handleEditCommit, mergedRows, columns]);

    const columnHelper = useMemo(() => createColumnHelper<unknown[]>(), []);

    const coreRowModel = useMemo(() => getCoreRowModel(), []);

    const tableColumns = React.useMemo(
      () =>
        columns.map((colName, index) =>
          columnHelper.accessor((row) => row[index], {
            // react-table requires a non-empty `id` when an accessorFn is used.
            // Some drivers (e.g. SQL Server `SELECT @@VERSION`, Postgres `SELECT 1 AS ""`)
            // return columns with an empty name, which would otherwise crash the grid.
            id: colName !== "" ? colName : `__unnamed_${index}__`,
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
          }),
        ),
      [
        columns,
        columnHelper,
        t,
        sortClause,
        onSort,
      ],
    );

    const parentRef = useRef<HTMLDivElement>(null);
    const [parentViewportWidth, setParentViewportWidth] = useState(0);

    useEffect(() => {
      const el = parentRef.current;
      if (!el) return;
      const update = () => setParentViewportWidth(el.clientWidth);
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

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

    const deleteRowsByIndices = useCallback((indicesToDelete: number[]) => {
      const pkVals: unknown[] = [];
      for (const idx of indicesToDelete) {
        const mergedRow = mergedRows[idx];
        if (!mergedRow) continue;

        if (mergedRow.type === "insertion" && mergedRow.tempId && onDiscardInsertion) {
          onDiscardInsertion(mergedRow.tempId);
        } else if (mergedRow.type === "existing" && pkColumn && pkIndexMap !== null) {
          pkVals.push(mergedRow.rowData[pkIndexMap]);
        }
      }

      // Use batch handler to avoid stale-closure overwrites when called per-row.
      if (pkVals.length > 0) {
        if (onMarkMultipleForDeletion) {
          onMarkMultipleForDeletion(pkVals);
        } else if (onMarkForDeletion) {
          pkVals.forEach((v) => onMarkForDeletion(v));
        }
      }
    }, [mergedRows, onDiscardInsertion, onMarkForDeletion, onMarkMultipleForDeletion, pkColumn, pkIndexMap]);

    const deleteSelectedRow = useCallback(() => {
      if (!contextMenu) return;

      // If the right-clicked row is part of a multi-selection, delete all selected rows.
      // Otherwise fall back to deleting just the right-clicked row.
      const rightClickedIsSelected = selectedRowIndices.has(contextMenu.rowIndex);
      const indicesToDelete =
        rightClickedIsSelected && selectedRowIndices.size > 1
          ? Array.from(selectedRowIndices)
          : [contextMenu.rowIndex];

      deleteRowsByIndices(indicesToDelete);
      setContextMenu(null);
    }, [contextMenu, selectedRowIndices, deleteRowsByIndices]);

    const duplicateSelectedRow = useCallback(() => {
      if (!contextMenu || !onDuplicateRow) return;

      const mergedRow = contextMenu.mergedRow;
      const rowData: Record<string, unknown> = {};

      if (mergedRow?.type === "insertion" && mergedRow.tempId && pendingInsertions) {
        const insertion = pendingInsertions[mergedRow.tempId];
        if (insertion) {
          Object.assign(rowData, insertion.data);
        }
      } else {
        columns.forEach((col, idx) => {
          rowData[col] = contextMenu.row[idx];
        });
      }

      onDuplicateRow(rowData);
      setContextMenu(null);
    }, [contextMenu, columns, pendingInsertions, onDuplicateRow]);

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

    const openJsonEditor = useCallback(() => {
      if (!contextMenu) return;
      const isInsertion = contextMenu.mergedRow?.type === "insertion";

      openJsonViewerWindow(
        contextMenu.row[contextMenu.colIndex],
        contextMenu.row[contextMenu.colIndex],
        contextMenu.colName,
        contextMenu.row,
        contextMenu.rowIndex,
        isInsertion,
        contextMenu.mergedRow?.tempId,
        readonlyProp ?? false,
      );
      setContextMenu(null);
    }, [contextMenu, openJsonViewerWindow, readonlyProp]);

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

    const setCellServerNow = useCallback(() => {
      if (!contextMenu || !connectionId) return;
      const { colName, mergedRow, row } = contextMenu;
      const isInsertion = mergedRow?.type === "insertion";
      const colDataType = columnTypeMap?.get(colName) ?? "";
      const dateMode = getDateInputMode(colDataType);
      if (!dateMode) return;

      setContextMenu(null);
      invoke<string>("get_server_now", { connectionId })
        .then((raw) => {
          const formatted = formatDateTime(parseDateTime(raw), dateMode);
          if (isInsertion && onPendingInsertionChange && mergedRow?.tempId) {
            onPendingInsertionChange(mergedRow.tempId, colName, formatted);
          } else if (onPendingChange && pkIndexMap !== null) {
            onPendingChange(row[pkIndexMap], colName, formatted);
          }
        })
        .catch((err) => {
          showAlert(String(err), { title: t("general.error"), kind: "error" });
        });
    }, [
      contextMenu,
      connectionId,
      columnTypeMap,
      onPendingInsertionChange,
      onPendingChange,
      pkIndexMap,
      t,
      showAlert,
    ]);

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
      (rows: unknown[][], withHeaders = false) => {
        if (copyFormat === "json") return rowsToJSON(rows, columns);
        if (copyFormat === "sql-insert")
          return rowsToSqlInsert(rows, columns, tableName ?? "table");
        if (withHeaders && csvIncludeHeaders)
          return rowsToCSVWithHeaders(rows, columns, "null", csvDelimiter);
        return rowsToCSV(rows, "null", csvDelimiter);
      },
      [columns, copyFormat, csvDelimiter, csvIncludeHeaders, tableName],
    );

    const copySelectedOrContextRow = useCallback(async () => {
      if (!contextMenu) return;

      const rows =
        selectedRowIndices.size > 0
          ? getSelectedRows(data, selectedRowIndices)
          : [contextMenu.row];

      await copyToClipboard(formatRows(rows, true));
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
      await copyToClipboard(
        formatRows(getSelectedRows(data, selectedRowIndices), true),
      );
    }, [selectedRowIndices, data, formatRows, copyToClipboard]);

    const copyCellValue = useCallback(
      async (rowIndex: number, colIndex: number) => {
        const mergedRow = mergedRows[rowIndex];
        if (!mergedRow) return;
        const rawValue = mergedRow.rowData[colIndex];
        const colName = columns[colIndex];
        const colType = columnTypeMap?.get(colName);
        const colLength = columnLengthMap?.get(colName);
        const text = formatCellValue(rawValue, "null", colType, colLength);
        await copyToClipboard(text);
      },
      [mergedRows, columns, columnTypeMap, columnLengthMap, copyToClipboard],
    );

    const copyCellFromContext = useCallback(async () => {
      if (!contextMenu) return;
      await copyCellValue(contextMenu.rowIndex, contextMenu.colIndex);
      setContextMenu(null);
    }, [contextMenu, copyCellValue]);

    // Handle keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // CMD/CTRL + C
        if ((e.metaKey || e.ctrlKey) && e.key === "c") {
          // Only handle if not editing a cell
          if (!editingCell) {
            if (focusedCell) {
              e.preventDefault();
              copyCellValue(focusedCell.rowIndex, focusedCell.colIndex);
            } else if (selectedRowIndices.size > 0) {
              e.preventDefault();
              copySelectedCells();
            }
          }
        }

        // Delete / Backspace — delete selected rows
        if ((e.key === "Delete" || e.key === "Backspace") && !editingCell && !readonlyProp && selectedRowIndices.size > 0) {
          e.preventDefault();
          deleteRowsByIndices(Array.from(selectedRowIndices));
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [editingCell, selectedRowIndices, focusedCell, copyCellValue, copySelectedCells, readonlyProp, deleteRowsByIndices]);

    // Stable per-row dependency bundle. Memoizing it lets React.memo on MemoRow
    // skip re-rendering rows that didn't change during scroll.
    const rowCtx: RowCtx = useMemo(
      () => ({
        columns,
        autoIncrementColumns,
        defaultValueColumns,
        nullableColumns,
        pkColumn,
        pendingChanges,
        columnTypeMap,
        columnLengthMap,
        resultColorClassMap,
        isJsonCellTarget,
        fksByColumn,
        t,
        mergedRows,
        pkIndexMap,
        parentViewportWidth,
        readonly: readonlyProp,
        updateSelection,
        setFocusedCell,
        setExpandedCell,
        setEditingCell,
        setSidebarRowData,
        setSidebarOpen,
        handleRowClick,
        handleCellDoubleClick,
        handleContextMenu,
        handleEditCommit,
        handleKeyDown,
        onForeignKeyShowPanel,
        onForeignKeyHidePanel,
        onForeignKeyNavigate,
        onPendingChange,
        onPendingInsertionChange,
        openJsonViewerWindow,
        buildRowDataWithPending,
        editInputRef,
      }),
      [
        columns,
        autoIncrementColumns,
        defaultValueColumns,
        nullableColumns,
        pkColumn,
        pendingChanges,
        columnTypeMap,
        columnLengthMap,
        resultColorClassMap,
        isJsonCellTarget,
        fksByColumn,
        t,
        mergedRows,
        pkIndexMap,
        parentViewportWidth,
        readonlyProp,
        updateSelection,
        setFocusedCell,
        setExpandedCell,
        setEditingCell,
        setSidebarRowData,
        setSidebarOpen,
        handleRowClick,
        handleCellDoubleClick,
        handleContextMenu,
        handleEditCommit,
        handleKeyDown,
        onForeignKeyShowPanel,
        onForeignKeyHidePanel,
        onForeignKeyNavigate,
        onPendingChange,
        onPendingInsertionChange,
        openJsonViewerWindow,
        buildRowDataWithPending,
        editInputRef,
      ],
    );

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
      <>
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
                  const rowIndex = virtualRow.index;
                  const row = tableRows[rowIndex];
                  const rowOriginal = row.original as unknown[];
                  const isSelected = selectedRowIndices.has(rowIndex);
                  const mergedRow = mergedRows[rowIndex];
                  const isInsertion = mergedRow?.type === "insertion";
                  const pkVal =
                    pkIndexMap !== null
                      ? String(rowOriginal[pkIndexMap])
                      : null;
                  const isPendingDelete =
                    !isInsertion && pkVal
                      ? pendingDeletions?.[pkVal] !== undefined
                      : false;
                  const isRowEditing = editingCell?.rowIndex === rowIndex;
                  const isRowFocused = focusedCell?.rowIndex === rowIndex;
                  const isRowExpanded = expandedCell?.rowIndex === rowIndex;
                  return (
                    <MemoRow
                      key={row.id}
                      ctx={rowCtx}
                      rowIndex={rowIndex}
                      rowOriginal={rowOriginal}
                      isSelected={isSelected}
                      isInsertion={isInsertion}
                      isPendingDelete={isPendingDelete}
                      pkVal={pkVal}
                      editingColIndex={isRowEditing ? editingCell!.colIndex : null}
                      editingValue={isRowEditing ? editingCell!.value : undefined}
                      focusedColIndex={isRowFocused ? focusedCell!.colIndex : null}
                      expandedColIndex={isRowExpanded ? expandedCell!.colIndex : null}
                      expandedKind={isRowExpanded ? expandedCell!.kind : null}
                    />
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
                pkIndexMap !== null
                  ? String(contextMenu.row[pkIndexMap])
                  : null;
              const hasPendingChanges =
                !isInsertion && pkVal && pendingChanges?.[pkVal] !== undefined;
              const hasPendingDeletion =
                !isInsertion &&
                pkVal &&
                pendingDeletions?.[pkVal] !== undefined;

              // Enable revert if there's any pending change, deletion, or insertion
              const canRevert =
                isInsertion || hasPendingChanges || hasPendingDeletion;

              const deleteRowCount = selectedRowIndices.has(contextMenu.rowIndex)
                ? selectedRowIndices.size
                : 1;

              // Determine which cell value options to show based on column properties
              const { colName } = contextMenu;
              const isAutoIncrement = autoIncrementColumns?.includes(colName);
              const isNullable = nullableColumns?.includes(colName);
              const hasDefault = defaultValueColumns?.includes(colName);

              // Build menu items dynamically
              const menuItems: ContextMenuItem[] = [];

              if (!readonlyProp) {
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
                if (getDateInputMode(colDataType) !== null) {
                  menuItems.push({
                    label: t("dataGrid.setServerNow"),
                    icon: Clock,
                    action: setCellServerNow,
                  });
                }
                if (isJsonColumn(colDataType)) {
                  menuItems.push({
                    label: t("contextMenu.openJsonEditor"),
                    icon: Braces,
                    action: openJsonEditor,
                  });
                }

                // Separator before row actions
                if (menuItems.length > 0) {
                  menuItems.push({ separator: true });
                }
              }

              const fkContextValue =
                contextMenu.row[contextMenu.colIndex];
              const fkForContextPreview = getForeignKeyForPreview(
                contextMenu.colName,
                fkContextValue,
                fksByColumn,
                { isInsertion },
              );
              if (fkForContextPreview) {
                if (onForeignKeyShowPanel) {
                  menuItems.push({
                    label: t("dataGrid.previewReferenced"),
                    icon: PanelBottomOpen,
                    action: () => {
                      setFocusedCell({
                        rowIndex: contextMenu.rowIndex,
                        colIndex: contextMenu.colIndex,
                      });
                      updateSelection(new Set());
                      onForeignKeyShowPanel(
                        fkForContextPreview,
                        fkContextValue,
                      );
                      setContextMenu(null);
                    },
                  });
                }
                if (onForeignKeyNavigate) {
                  menuItems.push({
                    label: t("dataGrid.openReferenced", {
                      table: fkForContextPreview.ref_table,
                    }),
                    icon: ExternalLink,
                    action: () => {
                      onForeignKeyNavigate(
                        fkForContextPreview,
                        fkContextValue,
                      );
                      setContextMenu(null);
                    },
                  });
                }
                if (onForeignKeyShowPanel || onForeignKeyNavigate) {
                  menuItems.push({ separator: true });
                }
              }

              menuItems.push({
                label: t("dataGrid.copyCell"),
                icon: Copy,
                action: copyCellFromContext,
              });

              menuItems.push({
                label: t("dataGrid.copySelectedRows"),
                icon: Copy,
                action: copySelectedOrContextRow,
              });

              if (!readonlyProp) {
                menuItems.push(
                  {
                    label: t("contextMenu.openSidebar"),
                    icon: Edit,
                    action: openSidebarEditor,
                  },
                  {
                    label: t("dataGrid.duplicateRow"),
                    icon: CopyPlus,
                    action: duplicateSelectedRow,
                  },
                  {
                    label: deleteRowCount > 1
                      ? t("dataGrid.deleteRows", { count: deleteRowCount })
                      : t("dataGrid.deleteRow"),
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
              }

              return (
                <ContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  onClose={() => setContextMenu(null)}
                  items={menuItems}
                >
                  <SlotAnchor
                    name="data-grid.context-menu.items"
                    context={{
                      connectionId,
                      tableName,
                      schema: activeSchema,
                      columnName: contextMenu.colName,
                      rowIndex: contextMenu.rowIndex,
                      rowData: mergedRows[contextMenu.rowIndex]
                        ?.rowData as unknown as
                        | Record<string, unknown>
                        | undefined,
                    }}
                    className="border-t border-default mt-1 pt-1"
                  />
                </ContextMenu>
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
              const originalRowData =
                mergedRow && mergedRow.type === "existing"
                  ? columns.reduce<Record<string, unknown>>((acc, col, idx) => {
                      acc[col] = mergedRow.rowData[idx];
                      return acc;
                    }, {})
                  : undefined;

              return (
                <RowEditorSidebar
                  isOpen={sidebarOpen}
                  onClose={() => {
                    setSidebarOpen(false);
                    setSidebarRowData(null);
                  }}
                  rowData={sidebarRowData.data}
                  originalRowData={originalRowData}
                  detectJsonInTextColumns={detectJsonInTextColumns}
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
                      onPendingInsertionChange(
                        mergedRow.tempId,
                        colName,
                        value,
                      );
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
      </>
    );
  },
);
