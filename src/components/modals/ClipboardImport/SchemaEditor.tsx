import { useMemo, useState } from 'react';
import { AlertTriangle, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../ui/Select';
import type { DataTypeInfo } from '../../../types/dataTypes';
import { useColumnResize } from '../../../hooks/useColumnResize';

export interface SchemaColumn {
  name: string;
  sqlType: string;
  nullable: boolean;
  confidence: 'high' | 'low';
  sampleValues: string[];
  originalIndex: number;
  /** Name of the existing target column to insert into. null means "skip". */
  targetColumn: string | null;
  /**
   * When true (append mode only), the column will be created on the target
   * table via ALTER TABLE ADD COLUMN using `name`, `sqlType`, `nullable`.
   * When true, `targetColumn` must be null.
   */
  isNewColumn?: boolean;
}

interface SchemaEditorProps {
  columns: SchemaColumn[];
  availableTypes: DataTypeInfo[];
  onColumnChange: (index: number, patch: Partial<SchemaColumn>) => void;
  onDeleteColumns: (indices: number[]) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  /**
   * When provided (append mode), renders a "Target column" Select per row
   * instead of type/nullable editors. `null` in the list represents "skip".
   */
  targetColumnOptions?: string[];
}

const SKIP_VALUE = '__skip__';
const NEW_VALUE = '__new__';

export function SchemaEditor({
  columns,
  availableTypes,
  onColumnChange,
  onDeleteColumns,
  isMaximized,
  onToggleMaximize,
  targetColumnOptions,
}: SchemaEditorProps) {
  const { t } = useTranslation();
  const typeOptions = availableTypes.map((ty) => ty.name);
  const isAppend = Array.isArray(targetColumnOptions);
  // Select options for the Target-column picker in append mode:
  //   [Skip, Create new, ...existing columns]
  const targetOptions = isAppend ? [SKIP_VALUE, NEW_VALUE, ...targetColumnOptions!] : [];
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Column layout:
  //   append mode (5):  [checkbox, source, target, sample, delete]
  //   create mode (6):  [checkbox, name,   type,   null, sample, delete]
  const initialWidths = useMemo<number[]>(
    () => (isAppend ? [32, 180, 224, 260, 32] : [32, 180, 176, 64, 260, 32]),
    [isAppend],
  );
  const colCount = initialWidths.length;
  const { widths, startResize } = useColumnResize(colCount, 160, 40, initialWidths);

  // Selection is remounted with an empty set via key={columns.length} in the
  // parent whenever the column list is replaced (delete or re-parse), so no
  // cleanup effect is needed here.

  const allSelected = columns.length > 0 && selected.size === columns.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(columns.map((_, i) => i)));
  };

  const handleBulkDelete = () => {
    if (selected.size === 0) return;
    onDeleteColumns([...selected].sort((a, b) => a - b));
    setSelected(new Set());
  };

  const handleSingleDelete = (i: number) => {
    onDeleteColumns([i]);
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col h-full min-h-0 border border-strong rounded-lg bg-base/50 overflow-hidden">
      <div className="bg-elevated/80 px-3 py-2 border-b border-strong flex items-center justify-between shrink-0">
        {selected.size > 0 ? (
          <>
            <span className="text-xs font-semibold text-blue-400">
              {t('clipboardImport.nSelected', { count: selected.size })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-2 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 border border-red-800/40 text-red-300 rounded transition-colors"
              >
                <Trash2 size={12} />
                {t('clipboardImport.deleteSelected')}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-[11px] text-muted hover:text-primary transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
              {t('clipboardImport.schemaPreview')}
            </h3>
            {onToggleMaximize && (
              <button
                onClick={onToggleMaximize}
                className="text-muted hover:text-primary transition-colors p-0.5 rounded hover:bg-surface-secondary/50"
                title={t(isMaximized ? 'clipboardImport.minimize' : 'clipboardImport.maximize')}
              >
                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
          </>
        )}
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="text-left border-collapse" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w + 'px' }} />
            ))}
          </colgroup>
          <thead className="bg-elevated/50 sticky top-0 z-10">
            <tr>
              <th className="relative p-2 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="accent-blue-500"
                  disabled={columns.length === 0}
                />
                <div
                  onMouseDown={(e) => startResize(0, e)}
                  className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                />
              </th>
              <th className="relative p-2 text-[10px] text-muted font-semibold">
                {isAppend ? t('clipboardImport.sourceColumn') : t('createTable.colName')}
                <div
                  onMouseDown={(e) => startResize(1, e)}
                  className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                />
              </th>
              {isAppend ? (
                <th className="relative p-2 text-[10px] text-muted font-semibold">
                  {t('clipboardImport.targetColumn')}
                  <div
                    onMouseDown={(e) => startResize(2, e)}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                  />
                </th>
              ) : (
                <>
                  <th className="relative p-2 text-[10px] text-muted font-semibold">
                    {t('createTable.colType')}
                    <div
                      onMouseDown={(e) => startResize(2, e)}
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                    />
                  </th>
                  <th className="relative p-2 text-[10px] text-muted font-semibold text-center">
                    NULL
                    <div
                      onMouseDown={(e) => startResize(3, e)}
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                    />
                  </th>
                </>
              )}
              <th className="relative p-2 text-[10px] text-muted font-semibold">
                {t('clipboardImport.sample')}
                <div
                  onMouseDown={(e) => startResize(isAppend ? 3 : 4, e)}
                  className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                />
              </th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => {
              const isRowSelected = selected.has(i);
              return (
                <tr
                  key={i}
                  className={`group border-b border-strong/30 transition-colors ${
                    isRowSelected ? 'bg-blue-600/10' : 'hover:bg-surface-secondary/30'
                  }`}
                >
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={isRowSelected}
                      onChange={() => toggleRow(i)}
                      className="accent-blue-500"
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      {isAppend && !col.isNewColumn ? (
                        <span className="w-full text-sm text-primary font-mono truncate">{col.name}</span>
                      ) : (
                        <input
                          value={col.name}
                          onChange={(e) => onColumnChange(i, { name: e.target.value })}
                          className="w-full bg-transparent text-sm text-primary focus:outline-none border-b border-transparent focus:border-blue-500 font-mono"
                        />
                      )}
                      {col.confidence === 'low' && (
                        <span title={t('clipboardImport.lowConfidence')} className="shrink-0 flex">
                          <AlertTriangle size={12} className="text-yellow-400" />
                        </span>
                      )}
                    </div>
                  </td>
                  {isAppend ? (
                    <td className="p-2">
                      <div className="flex flex-col gap-1.5">
                        <Select
                          value={col.isNewColumn ? NEW_VALUE : col.targetColumn ?? SKIP_VALUE}
                          options={targetOptions}
                          onChange={(v) => {
                            if (v === SKIP_VALUE) {
                              onColumnChange(i, { targetColumn: null, isNewColumn: false });
                            } else if (v === NEW_VALUE) {
                              onColumnChange(i, { targetColumn: null, isNewColumn: true });
                            } else {
                              onColumnChange(i, { targetColumn: v, isNewColumn: false });
                            }
                          }}
                          placeholder={t('clipboardImport.targetColumnPlaceholder')}
                          searchPlaceholder={t('common.search')}
                          noResultsLabel={t('common.noResults')}
                          labels={{
                            [SKIP_VALUE]: t('clipboardImport.skipColumn'),
                            [NEW_VALUE]: `+ ${t('clipboardImport.createNewColumn')}`,
                          }}
                          hasError={!col.isNewColumn && col.targetColumn === null}
                        />
                        {col.isNewColumn && (
                          <div className="flex items-center gap-2">
                            <Select
                              value={col.sqlType}
                              options={typeOptions}
                              onChange={(v) => onColumnChange(i, { sqlType: v })}
                              placeholder={t('clipboardImport.typePlaceholder')}
                              searchPlaceholder={t('common.search')}
                              noResultsLabel={t('common.noResults')}
                            />
                            <label className="flex items-center gap-1 text-[10px] text-muted whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={col.nullable}
                                onChange={(e) => onColumnChange(i, { nullable: e.target.checked })}
                                className="accent-blue-500"
                              />
                              NULL
                            </label>
                          </div>
                        )}
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="p-2">
                        <Select
                          value={col.sqlType}
                          options={typeOptions}
                          onChange={(v) => onColumnChange(i, { sqlType: v })}
                          placeholder={t('clipboardImport.typePlaceholder')}
                          searchPlaceholder={t('common.search')}
                          noResultsLabel={t('common.noResults')}
                        />
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          onChange={(e) => onColumnChange(i, { nullable: e.target.checked })}
                          className="accent-blue-500"
                        />
                      </td>
                    </>
                  )}
                  <td className="p-2 overflow-hidden">
                    <span className="text-xs text-muted font-mono truncate block">
                      {col.sampleValues.slice(0, 3).join(', ')}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <button
                      onClick={() => handleSingleDelete(i)}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all"
                      title={t('clipboardImport.deleteColumn')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
