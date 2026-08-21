import { memo, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export interface ColumnAggregation {
  function?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  alias?: string;
  order?: number; // Position in SELECT clause
}

export interface ColumnAlias {
  alias?: string;
  order?: number; // Position in SELECT clause
}

export interface TableNodeData extends Record<string, unknown> {
  label: string;
  schema?: string | null;
  columns: { name: string; type: string }[];
  selectedColumns: Record<string, boolean>;
  columnAggregations: Record<string, ColumnAggregation>;
  columnAliases: Record<string, ColumnAlias>;
  onColumnCheck: (column: string, checked: boolean) => void;
  onColumnAggregation: (column: string, aggregation: ColumnAggregation) => void;
  onColumnAlias: (column: string, alias: string, order?: number) => void;
  onDelete?: () => void;
}

export type TableNode = Node<TableNodeData, 'table'>;

export const TableNodeComponent = memo(({ data }: NodeProps<TableNode>) => {
  const [expandedColumn, setExpandedColumn] = useState<string | null>(null);

  return (
    <div className="bg-surface-secondary border border-strong rounded shadow-lg min-w-[200px] overflow-hidden">
      <div className="bg-elevated px-3 py-2 text-sm font-semibold text-primary border-b border-strong flex items-center gap-2 relative">
        <div className="w-2 h-2 rounded-full bg-blue-500" />
        {data.label}
        {data.onDelete && (
          <button
            onClick={data.onDelete}
            className="absolute top-1.5 right-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 p-1 rounded transition-colors"
            title="Delete Table"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="p-2 flex flex-col gap-1 max-h-[300px] overflow-y-auto custom-scrollbar">
        {data.columns.map((col) => {
          const isExpanded = expandedColumn === col.name;
          const aggregation = data.columnAggregations?.[col.name];
          const columnAlias = data.columnAliases?.[col.name];
          
          return (
            <div key={col.name} className="group relative">
              <div className="flex items-center justify-between text-xs text-secondary hover:text-primary py-0.5 px-2">
                <div className="flex items-center gap-2 flex-1 select-none">
                  <input
                    type="checkbox"
                    className="rounded border-strong bg-surface-tertiary text-blue-500 focus:ring-0 w-3 h-3 cursor-pointer"
                    checked={!!data.selectedColumns[col.name]}
                    onChange={(e) => data.onColumnCheck(col.name, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span 
                    className="truncate cursor-pointer hover:text-purple-300 transition-colors"
                    onClick={() => setExpandedColumn(isExpanded ? null : col.name)}
                  >
                    {col.name}
                  </span>
                  {aggregation?.function && (
                    <span className="text-purple-400 text-[9px] font-mono bg-purple-500/10 px-1 rounded">
                      {aggregation.function}
                    </span>
                  )}
                  {columnAlias?.alias && (
                    <span className="text-green-400 text-[9px] font-mono bg-green-500/10 px-1 rounded">
                      as {columnAlias.alias}
                    </span>
                  )}
                  <span className="text-surface-tertiary text-[10px] ml-auto font-mono">{col.type}</span>
                </div>
                <button
                  onClick={() => setExpandedColumn(isExpanded ? null : col.name)}
                  className={clsx(
                    "ml-2 text-muted transition-colors p-0.5 rounded opacity-0 group-hover:opacity-100",
                    isExpanded ? "bg-purple-500/20 text-purple-400 !opacity-100" : "hover:text-purple-400"
                  )}
                  title={isExpanded ? "Close options" : "Column options"}
                >
                  <span className="text-[10px]">{isExpanded ? '✕' : '⚙'}</span>
                </button>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={col.name}
                  className="!w-2.5 !h-2.5 !bg-purple-400 !border !border-strong !right-[-5px] !opacity-0 group-hover:!opacity-80 transition-opacity"
                />
                <Handle
                  type="target"
                  position={Position.Left}
                  id={col.name}
                  className="!w-2.5 !h-2.5 !bg-purple-400 !border !border-strong !left-[-5px] !opacity-0 group-hover:!opacity-80 transition-opacity"
                />
              </div>
              
              {isExpanded && (
                <div className="ml-5 mt-1 p-2 bg-elevated rounded border border-strong space-y-2 relative z-50 shadow-2xl">
                  <div className="text-[10px] text-secondary font-semibold mb-1">AGGREGATION</div>
                  <select
                    value={aggregation?.function || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      // If "None" is selected, set function to undefined
                      const func = value === '' ? undefined : value as ColumnAggregation['function'];
                      data.onColumnAggregation(col.name, {
                        ...aggregation,
                        function: func,
                      });
                    }}
                    className="w-full bg-surface-secondary border border-strong rounded px-2 py-1 text-[10px] text-secondary"
                  >
                    <option value="">None</option>
                    <option value="COUNT">COUNT</option>
                    <option value="COUNT_DISTINCT">COUNT DISTINCT</option>
                    <option value="SUM">SUM</option>
                    <option value="AVG">AVG</option>
                    <option value="MIN">MIN</option>
                    <option value="MAX">MAX</option>
                  </select>
                  
                  {aggregation?.function && (
                    <>
                      <div className="text-[10px] text-secondary font-semibold mb-1 mt-2">AGGREGATION ALIAS</div>
                      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                        type="text"
                        placeholder="e.g., total_count"
                        value={aggregation?.alias || ''}
                        onChange={(e) => {
                          data.onColumnAggregation(col.name, {
                            ...aggregation,
                            alias: e.target.value,
                          });
                        }}
                        className="w-full bg-surface-secondary border border-strong rounded px-2 py-1 text-[10px] text-secondary placeholder-slate-500"
                      />
                      <div className="text-[10px] text-secondary font-semibold mb-1 mt-2">POSITION</div>
                      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                        type="number"
                        min="1"
                        placeholder="e.g., 1"
                        value={aggregation?.order || ''}
                        onChange={(e) => {
                          const order = e.target.value ? parseInt(e.target.value) : undefined;
                          data.onColumnAggregation(col.name, {
                            ...aggregation,
                            order,
                          });
                        }}
                        className="w-full bg-surface-secondary border border-strong rounded px-2 py-1 text-[10px] text-secondary placeholder-slate-500"
                      />
                    </>
                  )}
                  
                  {!aggregation?.function && (
                    <>
                      <div className="text-[10px] text-secondary font-semibold mb-1 mt-2">COLUMN ALIAS</div>
                      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                        type="text"
                        placeholder="e.g., user_name"
                        value={columnAlias?.alias || ''}
                        onChange={(e) => {
                          data.onColumnAlias(col.name, e.target.value, columnAlias?.order);
                        }}
                        className="w-full bg-surface-secondary border border-strong rounded px-2 py-1 text-[10px] text-secondary placeholder-slate-500"
                      />
                      <div className="text-[10px] text-secondary font-semibold mb-1 mt-2">POSITION</div>
                      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                        type="number"
                        min="1"
                        placeholder="e.g., 1"
                        value={columnAlias?.order || ''}
                        onChange={(e) => {
                          const order = e.target.value ? parseInt(e.target.value) : undefined;
                          data.onColumnAlias(col.name, columnAlias?.alias || '', order);
                        }}
                        className="w-full bg-surface-secondary border border-strong rounded px-2 py-1 text-[10px] text-secondary placeholder-slate-500"
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
