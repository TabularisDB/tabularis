import { memo, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Key, Link, Columns } from 'lucide-react';
import clsx from 'clsx';

export interface SchemaTableNodeData extends Record<string, unknown> {
  label: string;
  columns: { name: string; type: string; isPk: boolean; isFk: boolean }[];
}

export type SchemaTableNode = Node<SchemaTableNodeData, 'schemaTable'>;

export const SchemaTableNodeComponent = memo(({ data }: NodeProps<SchemaTableNode>) => {
  const [showHandles, setShowHandles] = useState(false);

  return (
    <div
      className="bg-elevated border border-strong rounded shadow-xl min-w-[220px] overflow-hidden cursor-pointer hover:border-indigo-500 transition-colors"
      onMouseEnter={() => setShowHandles(true)}
      onMouseLeave={() => setShowHandles(false)}
    >
      <div className="bg-base px-3 py-2 text-sm font-bold text-primary border-b border-default flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
        {data.label}
      </div>
      <div className="flex flex-col">
        {data.columns.map((col) => (
          <div 
            key={col.name} 
            className={clsx(
              "flex items-center justify-between text-xs py-1.5 px-3 border-b border-default/50 last:border-0 relative group",
              col.isPk ? "bg-yellow-500/5 text-yellow-100" : "text-secondary"
            )}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {col.isPk ? (
                <Key size={10} className="text-yellow-500 shrink-0" />
              ) : col.isFk ? (
                <Link size={10} className="text-purple-400 shrink-0" />
              ) : (
                <Columns size={10} className="text-surface-tertiary shrink-0" />
              )}
              <span className={clsx("truncate font-mono flex-1 min-w-0", col.isPk && "font-bold")}>
                {col.name}
              </span>
            </div>
            <span className="text-[10px] text-surface-tertiary ml-2 font-mono shrink-0">
              {col.type}
            </span>

            {/* Handles for connections - always rendered but visually hidden until hover */}
            <Handle
              type="source"
              position={Position.Right}
              id={col.name}
              className={showHandles
                ? "!w-2 !h-2 !bg-indigo-500 !border-strong !right-0"
                : "!w-1 !h-1 !bg-transparent !border-none !right-0"
              }
            />
            <Handle
              type="target"
              position={Position.Left}
              id={col.name}
              className={showHandles
                ? "!w-2 !h-2 !bg-indigo-500 !border-strong !left-0"
                : "!w-1 !h-1 !bg-transparent !border-none !left-0"
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
});
