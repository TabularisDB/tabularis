import React from 'react';
import {ExternalLink, Eye, EyeOff} from 'lucide-react';
import {MASKED_PLACEHOLDER} from '@/utils/columnMasking';
import {
    formatCellValue,
    resolveInsertionCellDisplay,
    resolveExistingCellDisplay,
    getCellStateClass,
    getResultValueType,
    buildPkMap,
    serializePkKey,
    isZebraStripedRow,
    getFrozenCellBackdropClass,
    type ColumnDisplayInfo,
} from '@/utils/dataGrid';
import {isGeometricType} from '@/utils/geometry';
import {isEnumType, parseEnumValues, isSetType, parseSetValues} from '@/utils/columnTypes';
import {
    isBlobColumn,
    isBlobWireFormat,
    hasCellImagePreview,
    extractCellImagePreviewUrl,
} from '@/utils/blob';
import {isLongTextCellTarget, truncateCellPreview} from '@/utils/text';
import {getForeignKeyForPreview} from '@/utils/foreignKeys';
import {getDateInputMode} from '@/utils/dateInput';
import {renderDefaultCellContent} from '@/utils/dataGridCell';
import {resolveResultFontFamily} from '@/utils/settings';
import {GeometryInput} from './GeometryInput';
import {DateInput} from './DateInput';
import {JsonCell} from './JsonCell';
import {JsonExpansionEditor} from './JsonExpansionEditor';
import {TextCell} from './TextCell';
import {TextExpansionEditor} from './TextExpansionEditor';
import {EnumSetInput} from './EnumSetInput';
import {ImagePreviewHover} from './ImagePreviewHover';
import type {RowCtx} from './DataGridRow';

export interface DataGridCellProps {
    ctx: RowCtx;
    rowIndex: number;
    colIndex: number;
    rowOriginal: unknown[];
    isSelected: boolean;
    isInsertion: boolean;
    isPendingDelete: boolean;
    pkVal: string | null;
    isEditing: boolean;
    editingValue: unknown;
    isFocused: boolean;
    expandedKind: 'json' | 'text' | null;
    /** Sticky `left` offset while this cell is frozen (#1152), otherwise null. */
    frozenLeft: number | null;
    /** Width constraint applied to the cell when it isn't being edited. */
    widthClassName?: string;
    /** Extra classes, e.g. the record tint in the transposed layout. */
    className?: string;
    style?: React.CSSProperties;
}

/**
 * One data cell, addressed by its logical (rowIndex, colIndex) in the result
 * set. Shared by the normal row layout and the transposed layout (#561), so
 * editing, masking, FK preview and pending-change styling behave the same in both.
 */
export function DataGridCell({
    ctx,
    rowIndex,
    colIndex,
    rowOriginal,
    isSelected,
    isInsertion,
    isPendingDelete,
    pkVal,
    isEditing,
    editingValue,
    isFocused,
    expandedKind,
    frozenLeft,
    widthClassName = 'max-w-[300px]',
    className = '',
    style,
}: DataGridCellProps) {
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
        readonly: readonlyProp,
        zebraStripes,
        maskedColIndices,
        revealedColIndices,
        revealedCells,
        toggleRevealCell,
        selectedColIndices,
        cellRange,
        handleCellClick,
        setExpandedCell,
        setEditingCell,
        openInSidebar,
        handleCellDoubleClick,
        handleContextMenu,
        handleEditCommit,
        commitEditWithValue,
        handleKeyDown,
        onForeignKeyShowPanel,
        onForeignKeyHidePanel,
        onForeignKeyNavigate,
        openJsonViewerWindow,
        editInputRef,
    } = ctx;

    const colName = columns[colIndex];
    const isInRange =
        cellRange !== null &&
        rowIndex >= cellRange.minRow &&
        rowIndex <= cellRange.maxRow &&
        colIndex >= cellRange.minCol &&
        colIndex <= cellRange.maxCol;

    const cellValue = rowOriginal[colIndex];

    const columnInfo: ColumnDisplayInfo = {
        colName,
        autoIncrementColumns,
        defaultValueColumns,
        nullableColumns,
    };

    const resolved = isInsertion
        ? resolveInsertionCellDisplay(cellValue, columnInfo)
        : resolveExistingCellDisplay(cellValue, pkVal, pkColumns, pendingChanges, columnInfo);

    const {
        displayValue,
        hasPendingChange,
        isModified,
        isAutoIncrementPlaceholder,
        isDefaultValuePlaceholder,
    } = resolved;

    const colTypeForCell = columnTypeMap?.get(colName);
    const rawCellValue = cellValue;
    const isJsonCell = isJsonCellTarget(colTypeForCell, rawCellValue) && !isPendingDelete;
    const isLongTextCell =
        !isJsonCell &&
        !isPendingDelete &&
        isLongTextCellTarget(colTypeForCell, hasPendingChange ? displayValue : rawCellValue);

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

    // Frozen first column (#1152): sticky after the gutter, on an opaque
    // backdrop. Sticky already anchors the inline editor, so the cell
    // must not switch to `relative` while editing, and its focus mark is
    // an outline because an inset ring would sit under the backdrop.
    const isFrozen = frozenLeft !== null;
    const frozenClass = isFrozen
        ? `sticky z-[5] ${getFrozenCellBackdropClass({
              isSelected,
              isInsertion,
              isPendingDelete,
              isZebra: isZebraStripedRow(rowIndex, zebraStripes),
          })}`
        : '';
    const focusClass = !isFocused
        ? ''
        : isFrozen
          ? 'outline outline-2 -outline-offset-2 outline-accent-primary'
          : 'ring-2 ring-inset ring-accent-primary';

    // Sensitive-column masking (#485): the real value stays in `data`
    // (copy/export unaffected); only the render is replaced.
    const isCellRevealed = revealedCells.has(`${rowIndex}:${colIndex}`);
    const isMasked =
        maskedColIndices.has(colIndex) && !revealedColIndices.has(colIndex) && !isCellRevealed;
    // An individually revealed cell in a still-masked column gets an
    // eye-off toggle so it can be re-masked.
    const showCellMaskToggle =
        maskedColIndices.has(colIndex) && !revealedColIndices.has(colIndex) && isCellRevealed;

    const fkForPreview = getForeignKeyForPreview(colName, rawCellValue, fksByColumn, {
        isPendingDelete,
        isInsertion,
    });

    // Format once and reuse for both the title tooltip and
    // the rendered content (previously formatted twice).
    const formattedDisplay = formatCellValue(
        displayValue,
        t('dataGrid.null'),
        colTypeForCell,
        columnLengthMap?.get(colName),
    );

    return (
        <td
            data-row-index={rowIndex}
            data-col-index={colIndex}
            onMouseDown={(e) => {
                // Shift+click extends the cell range — suppress the browser's
                // text selection that a Shift+click would otherwise start.
                if (e.shiftKey) e.preventDefault();
            }}
            onClick={(e) => {
                // Don't handle row click if clicking on a button
                const target = e.target as HTMLElement;
                if (target.closest('button')) {
                    return;
                }
                handleCellClick(rowIndex, colIndex, e);

                if (e.shiftKey) {
                    // Range extension click — don't pivot the FK panel.
                    onForeignKeyHidePanel?.();
                } else if (fkForPreview && onForeignKeyShowPanel) {
                    onForeignKeyShowPanel(fkForPreview, rawCellValue);
                } else {
                    onForeignKeyHidePanel?.();
                }
            }}
            onDoubleClick={() =>
                // Masked cells must be revealed before they can be edited —
                // the inline editor would otherwise expose the real value.
                !isPendingDelete &&
                !isMasked &&
                handleCellDoubleClick(
                    rowIndex,
                    colIndex,
                    isAutoIncrementPlaceholder || isDefaultValuePlaceholder ? '' : displayValue,
                )
            }
            onContextMenu={(e) => handleContextMenu(e, rowOriginal, rowIndex, colIndex, colName)}
            style={isFrozen ? {...style, left: frozenLeft} : style}
            className={`px-4 py-1.5 text-sm border-b border-r border-default last:border-r-0 font-result ${isEditing ? (isFrozen ? '' : 'relative') : `whitespace-nowrap truncate ${widthClassName}`} ${frozenClass} ${fkForPreview ? 'cursor-pointer' : 'cursor-text'} ${stateClass} ${selectedColIndices.has(colIndex) || isInRange ? 'bg-accent-primary/15' : ''} ${focusClass} ${className}`}
            title={
                // The hover tooltip would leak the real value of a masked cell.
                !isEditing && !isMasked ? truncateCellPreview(formattedDisplay).text : ''
            }
        >
            {isMasked ? (
                <span className="flex items-center gap-1.5 select-none">
                    <span className="text-muted tracking-widest">{MASKED_PLACEHOLDER}</span>
                    <button
                        type="button"
                        title={t('dataGrid.revealCell')}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleRevealCell(rowIndex, colIndex);
                        }}
                        className="text-muted hover:text-primary transition-colors"
                    >
                        <Eye size={12} />
                    </button>
                </span>
            ) : isEditing ? (
                (() => {
                    const colType = columnTypeMap?.get(colName);
                    if (colType && isGeometricType(colType)) {
                        return (
                            <GeometryInput
                                inputRef={editInputRef}
                                value={String(editingValue ?? '')}
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
                                    openInSidebar(rowIndex, colName);
                                }}
                                className="w-full bg-base text-primary border-none outline-none p-0 m-0 font-result"
                            />
                        );
                    }
                    const dateMode = colType ? getDateInputMode(colType) : null;
                    if (dateMode) {
                        return (
                            <DateInput
                                value={String(editingValue ?? '')}
                                mode={dateMode}
                                onChange={(newValue) =>
                                    setEditingCell((prev) =>
                                        prev ? {...prev, value: newValue} : null,
                                    )
                                }
                                onBlur={handleEditCommit}
                                onKeyDown={handleKeyDown}
                                onCommitValue={commitEditWithValue}
                                inputRef={editInputRef}
                            />
                        );
                    }
                    const isEnumCol = colType && isEnumType(colType);
                    const isSetCol = colType && isSetType(colType);
                    if (isEnumCol || isSetCol) {
                        const allowedValues = isSetCol
                            ? parseSetValues(colType!)
                            : parseEnumValues(colType!);
                        const isNullable = columnInfo.nullableColumns?.includes(colName) ?? false;
                        const rawVal = editingValue;
                        const currentValue =
                            rawVal === null || rawVal === undefined ? null : String(rawVal);
                        return (
                            <>
                                <span className="invisible whitespace-nowrap">
                                    {String(displayValue)}
                                </span>
                                <EnumSetInput
                                    variant="grid"
                                    multiple={!!isSetCol}
                                    autoOpen
                                    rootRef={
                                        editInputRef as React.MutableRefObject<HTMLElement | null>
                                    }
                                    value={currentValue}
                                    options={allowedValues}
                                    isNullable={isNullable}
                                    onChange={(newVal) =>
                                        setEditingCell((prev) =>
                                            prev ? {...prev, value: newVal} : null,
                                        )
                                    }
                                    onCommitValue={commitEditWithValue}
                                    onClose={handleEditCommit}
                                    onCancel={() => setEditingCell(null)}
                                />
                            </>
                        );
                    }
                    const textValue = String(editingValue ?? '');
                    // Measure the longest line to size the textarea
                    const lines = textValue.split('\n');
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        // Measure with the same font the textarea renders in
                        // (the "Result font" setting), otherwise a proportional
                        // font would be sized with monospace metrics.
                        ctx.font = `14px ${resolveResultFontFamily()}`;
                    }
                    const longestLineWidth = ctx
                        ? Math.max(...lines.map((line) => ctx.measureText(line).width))
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
                                autoCorrect="off"
                                autoCapitalize="off"
                                autoComplete="off"
                                spellCheck={false}
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
                                className="absolute left-0 top-0 max-w-[400px] max-h-[120px] bg-base text-primary border border-accent-primary rounded shadow-lg p-2 font-result text-sm resize-none z-50 outline-none"
                            />
                        </>
                    );
                })()
            ) : (
                <>
                    {(() => {
                        if (isJsonCell) {
                            const isExpanded = expandedKind === 'json';
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
                                                      kind: 'json',
                                                  },
                                        )
                                    }
                                    onOpenViewer={() => {
                                        const mergedRow = mergedRows[rowIndex];
                                        if (!mergedRow) return;
                                        const isInsertion = mergedRow.type === 'insertion';
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
                            const isExpanded = expandedKind === 'text';
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
                                                      kind: 'text',
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
                            (isBlobColumn(colTypeForCell, columnLengthMap?.get(colName)) ||
                                isBlobWireFormat(displayValue)) &&
                            !isPendingDelete
                        ) {
                            const hasImagePreview = hasCellImagePreview(displayValue);
                            const blobContent = (
                                <span className="inline-flex items-center gap-1 group/blobcell w-full min-w-0">
                                    <span className="truncate flex-1 min-w-0">
                                        {renderDefaultCellContent(displayValue, formattedDisplay)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            openInSidebar(rowIndex, colName);
                                        }}
                                        className="opacity-0 group-hover/blobcell:opacity-100 transition-opacity p-0.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary flex-shrink-0"
                                        title={t('blobInput.openSidebar')}
                                    >
                                        <ExternalLink size={11} />
                                    </button>
                                </span>
                            );

                            if (hasImagePreview) {
                                return (
                                    <ImagePreviewHover
                                        getSrc={() => extractCellImagePreviewUrl(displayValue)}
                                    >
                                        {blobContent}
                                    </ImagePreviewHover>
                                );
                            }

                            return blobContent;
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
                                        className="opacity-0 group-hover/fkcell:opacity-100 transition-opacity p-0.5 rounded text-muted hover:text-accent hover:bg-surface-tertiary flex-shrink-0"
                                        title={t('dataGrid.openReferenced', {
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
                    {showCellMaskToggle && !isEditing && (
                        <button
                            type="button"
                            title={t('dataGrid.maskCell')}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleRevealCell(rowIndex, colIndex);
                            }}
                            className="ml-1 shrink-0 text-muted hover:text-primary transition-colors"
                        >
                            <EyeOff size={12} />
                        </button>
                    )}
                </>
            )}
        </td>
    );
}

/**
 * The inline JSON/text editor row shown under a row (or under a field, in the
 * transposed layout) while one of its cells is expanded.
 */
export function DataGridExpansionRow({
    ctx,
    rowIndex,
    expandedCell,
    colSpan,
}: {
    ctx: RowCtx;
    rowIndex: number;
    expandedCell: {colIndex: number; kind: 'json' | 'text'};
    colSpan: number;
}) {
    const {
        columns,
        mergedRows,
        pkIndexMaps,
        pkColumns,
        pendingChanges,
        parentViewportWidth,
        readonly: readonlyProp,
        setExpandedCell,
        onPendingChange,
        onPendingInsertionChange,
    } = ctx;

    const expColName = columns[expandedCell.colIndex];
    const mergedRow = mergedRows[rowIndex];
    const pendingExpansionValue = (() => {
        if (!mergedRow) return undefined;
        if (mergedRow.type === 'existing' && pkIndexMaps.length > 0 && pkColumns) {
            const pkMapVal = buildPkMap(pkColumns, mergedRow.rowData, pkIndexMaps);
            const pkKeyStr = serializePkKey(pkMapVal);
            const pendingVal = pendingChanges?.[pkKeyStr]?.changes?.[expColName];
            if (pendingVal !== undefined) return pendingVal;
        }
        return mergedRow.rowData?.[expandedCell.colIndex];
    })();
    const expansionOriginalValue =
        mergedRow?.type === 'existing' ? mergedRow?.rowData?.[expandedCell.colIndex] : undefined;
    const persistExpansionSave = (next: unknown) => {
        if (!mergedRow) return;
        if (mergedRow.type === 'insertion' && onPendingInsertionChange && mergedRow.tempId) {
            onPendingInsertionChange(mergedRow.tempId, expColName, next);
        } else if (
            mergedRow.type === 'existing' &&
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
            <td colSpan={colSpan} className="p-0 border-b border-default">
                <div
                    className="sticky left-0 bg-base/60 p-3"
                    style={{
                        width: parentViewportWidth > 0 ? `${parentViewportWidth}px` : '100%',
                    }}
                >
                    {expandedCell.kind === 'json' ? (
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
}
