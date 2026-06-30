import React from "react";
import { ExternalLink } from "lucide-react";
import {
  formatCellValue,
  resolveInsertionCellDisplay,
  resolveExistingCellDisplay,
  getCellStateClass,
  getResultValueType,
  buildPkMap,
  serializePkKey,
  type ColumnDisplayInfo,
  type MergedRow,
} from "../../utils/dataGrid";
import { isGeometricType } from "../../utils/geometry";
import { isBlobColumn, isBlobWireFormat } from "../../utils/blob";
import { isLongTextCellTarget, truncateCellPreview } from "../../utils/text";
import { getForeignKeyForPreview } from "../../utils/foreignKeys";
import { getDateInputMode } from "../../utils/dateInput";
import { renderDefaultCellContent } from "../../utils/dataGridCell";
import { GeometryInput } from "./GeometryInput";
import { DateInput } from "./DateInput";
import { JsonCell } from "./JsonCell";
import { JsonExpansionEditor } from "./JsonExpansionEditor";
import { TextCell } from "./TextCell";
import { TextExpansionEditor } from "./TextExpansionEditor";
import type { ForeignKey } from "../../types/editor";

/**
 * Stable, per-grid dependencies shared by every row. Bundled into a single
 * object that is memoized in DataGrid so React.memo's default shallow compare
 * on MemoRow only sees a new `ctx` reference when one of these actually changes.
 */
export interface RowCtx {
  columns: string[];
  autoIncrementColumns?: string[];
  defaultValueColumns?: string[];
  nullableColumns?: string[];
  pkColumns?: string[] | null;
  pendingChanges?: Record<
    string,
    { pkOriginalValue: unknown; changes: Record<string, unknown> }
  >;
  columnTypeMap: Map<string, string> | null;
  columnLengthMap: Map<string, number | undefined> | null;
  /**
   * Per-column result-coloring class (e.g. "rcell-number"), precomputed once in
   * DataGrid. `null` when colorize-by-type is disabled — in that case cells
   * render plain text with no extra wrapper, matching the original behavior.
   */
  resultColorClassMap: Map<string, string> | null;
  isJsonCellTarget: (colType: string | undefined, value: unknown) => boolean;
  fksByColumn: Map<string, ForeignKey>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  mergedRows: MergedRow[];
  pkIndexMaps: number[];
  parentViewportWidth: number;
  readonly: boolean | undefined;
  updateSelection: (s: Set<number>) => void;
  setFocusedCell: React.Dispatch<
    React.SetStateAction<{ rowIndex: number; colIndex: number } | null>
  >;
  setExpandedCell: React.Dispatch<
    React.SetStateAction<{
      rowIndex: number;
      colIndex: number;
      kind: "json" | "text";
    } | null>
  >;
  setEditingCell: React.Dispatch<
    React.SetStateAction<{
      rowIndex: number;
      colIndex: number;
      value: unknown;
      isRawSql?: boolean;
    } | null>
  >;
  setSidebarRowData: React.Dispatch<
    React.SetStateAction<{
      data: Record<string, unknown>;
      rowIndex: number;
      focusField?: string;
    } | null>
  >;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleRowClick: (index: number, e: React.MouseEvent) => void;
  handleCellDoubleClick: (
    rowIndex: number,
    colIndex: number,
    value: unknown,
  ) => void;
  handleContextMenu: (
    e: React.MouseEvent,
    row: unknown[],
    rowIndex: number,
    colIndex: number,
    colName: string,
  ) => void;
  handleEditCommit: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  onForeignKeyShowPanel?: (fk: ForeignKey, value: unknown) => void;
  onForeignKeyHidePanel?: () => void;
  onForeignKeyNavigate?: (fk: ForeignKey, value: unknown) => void;
  onPendingChange?: (pkVal: unknown, colName: string, value: unknown) => void;
  onPendingInsertionChange?: (
    tempId: string,
    colName: string,
    value: unknown,
  ) => void;
  openJsonViewerWindow: (
    value: unknown,
    originalValue: unknown,
    colName: string,
    rowData: unknown[],
    rowIndex: number,
    isInsertion: boolean,
    tempId: string | undefined,
    readOnly: boolean,
  ) => void;
  buildRowDataWithPending: (
    rowArray: unknown[],
    isInsertion: boolean,
  ) => Record<string, unknown>;
  editInputRef: React.RefObject<HTMLInputElement | null>;
}

export interface MemoRowProps {
  ctx: RowCtx;
  rowIndex: number;
  rowOriginal: unknown[];
  isSelected: boolean;
  isInsertion: boolean;
  isPendingDelete: boolean;
  pkVal: string | null;
  editingColIndex: number | null;
  editingValue: unknown;
  focusedColIndex: number | null;
  expandedColIndex: number | null;
  expandedKind: "json" | "text" | null;
}

export const MemoRow = React.memo(function MemoRow(rowCtx: MemoRowProps) {
  const {
    ctx,
    rowIndex,
    rowOriginal,
    isSelected,
    isInsertion,
    isPendingDelete,
    pkVal,
    editingColIndex,
    editingValue,
    focusedColIndex,
    expandedColIndex,
    expandedKind,
  } = rowCtx;

  const {
    columns,
    autoIncrementColumns,
    defaultValueColumns,
    nullableColumns,
    pkColumns,
    pendingChanges,
    columnTypeMap,
    columnLengthMap,
    resultColorClassMap,
    isJsonCellTarget,
    fksByColumn,
    t,
    mergedRows,
    pkIndexMaps,
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
  } = ctx;

  const editingCell =
    editingColIndex !== null
      ? {
          rowIndex,
          colIndex: editingColIndex,
          value: editingValue,
        }
      : null;
  const focusedCell =
    focusedColIndex !== null ? { rowIndex, colIndex: focusedColIndex } : null;
  const expandedCell =
    expandedColIndex !== null
      ? {
          rowIndex,
          colIndex: expandedColIndex,
          kind: expandedKind as "json" | "text",
        }
      : null;
  const expansionMatchesRow = expandedColIndex !== null;

  return (
    <>
      <tr
        style={{ height: 35 }}
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
          onClick={(e) => {
            setFocusedCell(null);
            onForeignKeyHidePanel?.();
            handleRowClick(rowIndex, e);
          }}
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
        {columns.map((colName, colIndex) => {
          const cellValue = rowOriginal[colIndex];
          const isEditing =
            editingCell?.rowIndex === rowIndex &&
            editingCell?.colIndex === colIndex;

          const columnInfo: ColumnDisplayInfo = {
            colName,
            autoIncrementColumns,
            defaultValueColumns,
            nullableColumns,
          };

          const resolved = isInsertion
            ? resolveInsertionCellDisplay(cellValue, columnInfo)
            : resolveExistingCellDisplay(
                cellValue,
                pkVal,
                pkColumns,
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

          const colTypeForCell = columnTypeMap?.get(colName);
          const rawCellValue = cellValue;
          const isJsonCell =
            isJsonCellTarget(colTypeForCell, rawCellValue) && !isPendingDelete;
          const isLongTextCell =
            !isJsonCell &&
            !isPendingDelete &&
            isLongTextCellTarget(
              colTypeForCell,
              hasPendingChange ? displayValue : rawCellValue,
            );

          const stateClass = getCellStateClass({
            isPendingDelete,
            isSelected,
            isInsertion,
            isAutoIncrementPlaceholder,
            isDefaultValuePlaceholder,
            isModified,
            isJsonCell,
          });

          let valueColorClass: string | undefined;
          if (
            resultColorClassMap &&
            rawCellValue !== null &&
            rawCellValue !== undefined &&
            !isPendingDelete &&
            !isInsertion &&
            !isModified &&
            !isAutoIncrementPlaceholder &&
            !isDefaultValuePlaceholder
          ) {
            valueColorClass =
              resultColorClassMap.get(colName) ??
              `rcell-${getResultValueType(rawCellValue, colTypeForCell)}`;
          }

          const isFocused =
            focusedCell?.rowIndex === rowIndex &&
            focusedCell?.colIndex === colIndex;

          const fkForPreview = getForeignKeyForPreview(
            colName,
            rawCellValue,
            fksByColumn,
            { isPendingDelete, isInsertion },
          );

          // Format once and reuse for both the title tooltip and
          // the rendered content (previously formatted twice).
          const formattedDisplay = formatCellValue(
            displayValue,
            t("dataGrid.null"),
            colTypeForCell,
            columnLengthMap?.get(colName),
          );

          return (
            <td
              key={colName}
              onClick={(e) => {
                // Don't handle row click if clicking on a button
                const target = e.target as HTMLElement;
                if (target.closest("button")) {
                  return;
                }
                setFocusedCell({ rowIndex, colIndex });
                updateSelection(new Set());

                if (fkForPreview && onForeignKeyShowPanel) {
                  onForeignKeyShowPanel(fkForPreview, rawCellValue);
                } else {
                  onForeignKeyHidePanel?.();
                }
              }}
              onDoubleClick={() =>
                !isPendingDelete &&
                handleCellDoubleClick(
                  rowIndex,
                  colIndex,
                  isAutoIncrementPlaceholder || isDefaultValuePlaceholder
                    ? ""
                    : displayValue,
                )
              }
              onContextMenu={(e) =>
                handleContextMenu(e, rowOriginal, rowIndex, colIndex, colName)
              }
              className={`px-4 py-1.5 text-sm border-b border-r border-default last:border-r-0 font-mono ${isEditing ? "relative" : "whitespace-nowrap truncate max-w-[300px]"} ${fkForPreview ? "cursor-pointer" : "cursor-text"} ${stateClass} ${isFocused ? "ring-2 ring-inset ring-blue-400" : ""}`}
              title={
                !isEditing ? truncateCellPreview(formattedDisplay).text : ""
              }
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
                                data: buildRowDataWithPending(
                                  mergedRow.rowData,
                                  mergedRow.type === "insertion",
                                ),
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
                    const dateMode = colType ? getDateInputMode(colType) : null;
                    if (dateMode) {
                      return (
                        <DateInput
                          value={String(editingCell.value ?? "")}
                          mode={dateMode}
                          onChange={(newValue) =>
                            setEditingCell((prev) =>
                              prev ? { ...prev, value: newValue } : null,
                            )
                          }
                          onBlur={handleEditCommit}
                          onKeyDown={handleKeyDown}
                          inputRef={editInputRef}
                        />
                      );
                    }
                    const textValue = String(editingCell.value ?? "");
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
                            (line) => ctx.measureText(line).width,
                          ),
                        )
                      : 200;
                    // padding (p-2 = 8px * 2) + small buffer
                    const textareaWidth = Math.ceil(longestLineWidth) + 32;

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
                : (() => {
                    if (isJsonCell) {
                      const isExpanded =
                        expandedCell?.kind === "json" &&
                        expandedCell?.rowIndex === rowIndex &&
                        expandedCell?.colIndex === colIndex;
                      return (
                        <JsonCell
                          value={displayValue}
                          displayText={formattedDisplay}
                          isExpanded={isExpanded}
                          isPendingDelete={isPendingDelete}
                          onToggleExpand={() =>
                            setExpandedCell(
                              isExpanded
                                ? null
                                : {
                                    rowIndex,
                                    colIndex,
                                    kind: "json",
                                  },
                            )
                          }
                          onOpenViewer={() => {
                            const mergedRow = mergedRows[rowIndex];
                            if (!mergedRow) return;
                            const isInsertion =
                              mergedRow.type === "insertion";
                            openJsonViewerWindow(
                              displayValue,
                              rawCellValue,
                              colName,
                              mergedRow.rowData,
                              rowIndex,
                              isInsertion,
                              mergedRow.tempId,
                              readonlyProp ?? false,
                            );
                          }}
                        />
                      );
                    }

                    if (isLongTextCell) {
                      const isExpanded =
                        expandedCell?.kind === "text" &&
                        expandedCell?.rowIndex === rowIndex &&
                        expandedCell?.colIndex === colIndex;
                      return (
                        <TextCell
                          value={displayValue}
                          displayText={formattedDisplay}
                          isExpanded={isExpanded}
                          isPendingDelete={isPendingDelete}
                          onToggleExpand={() =>
                            setExpandedCell(
                              isExpanded
                                ? null
                                : {
                                    rowIndex,
                                    colIndex,
                                    kind: "text",
                                  },
                            )
                          }
                        />
                      );
                    }

                    if (hasPendingChange) {
                      return formattedDisplay;
                    }

                    if (
                      colTypeForCell &&
                      (isBlobColumn(
                        colTypeForCell,
                        columnLengthMap?.get(colName),
                      ) ||
                        isBlobWireFormat(displayValue)) &&
                      !isPendingDelete
                    ) {
                      return (
                        <span className="inline-flex items-center gap-1 group/blobcell w-full min-w-0">
                          <span className="truncate flex-1 min-w-0">
                            {renderDefaultCellContent(
                              displayValue,
                              formattedDisplay,
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const mergedRow = mergedRows[rowIndex];
                              if (mergedRow) {
                                setSidebarRowData({
                                  data: buildRowDataWithPending(
                                    mergedRow.rowData,
                                    mergedRow.type === "insertion",
                                  ),
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

                    if (fkForPreview && onForeignKeyNavigate) {
                      return (
                        <span className="inline-flex items-center gap-1 group/fkcell w-full min-w-0">
                          <span className="truncate flex-1 min-w-0">
                            {renderDefaultCellContent(
                              displayValue,
                              formattedDisplay,
                              valueColorClass,
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onForeignKeyNavigate(fkForPreview, rawCellValue);
                            }}
                            className="opacity-0 group-hover/fkcell:opacity-100 transition-opacity p-0.5 rounded text-muted hover:text-blue-400 hover:bg-surface-tertiary flex-shrink-0"
                            title={t("dataGrid.openReferenced", {
                              table: fkForPreview.ref_table,
                            })}
                          >
                            <ExternalLink size={11} />
                          </button>
                        </span>
                      );
                    }

                    return renderDefaultCellContent(
                      displayValue,
                      formattedDisplay,
                      valueColorClass,
                    );
                  })()}
            </td>
          );
        })}
      </tr>
      {expansionMatchesRow &&
        expandedCell &&
        (() => {
          const expColName = columns[expandedCell.colIndex];
          const mergedRow = mergedRows[rowIndex];
          const pendingExpansionValue = (() => {
            if (!mergedRow) return undefined;
            if (mergedRow.type === "existing" && pkIndexMaps.length > 0 && pkColumns) {
              const pkMapVal = buildPkMap(pkColumns, mergedRow.rowData, pkIndexMaps);
              const pkKeyStr = serializePkKey(pkMapVal);
              const pendingVal =
                pendingChanges?.[pkKeyStr]?.changes?.[expColName];
              if (pendingVal !== undefined) return pendingVal;
            }
            return mergedRow.rowData?.[expandedCell.colIndex];
          })();
          const expansionOriginalValue =
            mergedRow?.type === "existing"
              ? mergedRow?.rowData?.[expandedCell.colIndex]
              : undefined;
          const persistExpansionSave = (next: unknown) => {
            if (!mergedRow || !expandedCell) return;
            if (
              mergedRow.type === "insertion" &&
              onPendingInsertionChange &&
              mergedRow.tempId
            ) {
              onPendingInsertionChange(mergedRow.tempId, expColName, next);
            } else if (
              mergedRow.type === "existing" &&
              onPendingChange &&
              pkIndexMaps.length > 0 &&
              pkColumns
            ) {
              const pkMapVal = buildPkMap(pkColumns, mergedRow.rowData, pkIndexMaps);
              onPendingChange(pkMapVal, expColName, next);
            }
            setExpandedCell(null);
          };
          return (
            <tr>
              <td
                colSpan={columns.length + 1}
                className="p-0 border-b border-default"
              >
                <div
                  className="sticky left-0 bg-base/60 p-3"
                  style={{
                    width:
                      parentViewportWidth > 0
                        ? `${parentViewportWidth}px`
                        : "100%",
                  }}
                >
                  {expandedCell.kind === "json" ? (
                    <JsonExpansionEditor
                      value={pendingExpansionValue}
                      originalValue={expansionOriginalValue}
                      readOnly={readonlyProp ?? false}
                      onCancel={() => setExpandedCell(null)}
                      onSave={persistExpansionSave}
                    />
                  ) : (
                    <TextExpansionEditor
                      value={pendingExpansionValue}
                      originalValue={expansionOriginalValue}
                      readOnly={readonlyProp ?? false}
                      onCancel={() => setExpandedCell(null)}
                      onSave={persistExpansionSave}
                    />
                  )}
                </div>
              </td>
            </tr>
          );
        })()}
    </>
  );
});
