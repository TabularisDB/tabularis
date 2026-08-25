import { Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useColumnResize } from '../../../hooks/useColumnResize';

const MAX_PREVIEW_ROWS = 10;

interface DataPreviewProps {
  headers: string[];
  rows: string[][];
  rowCount: number;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function DataPreview({ headers, rows, rowCount, isMaximized, onToggleMaximize }: DataPreviewProps) {
  const { t } = useTranslation();
  const previewRows = isMaximized ? rows : rows.slice(0, MAX_PREVIEW_ROWS);
  const { widths, startResize } = useColumnResize(headers.length, 160);

  return (
    <div className="flex flex-col h-full min-h-0 border border-strong rounded-lg bg-base/50 overflow-hidden">
      <div className="bg-elevated/80 px-3 py-2 border-b border-strong flex items-center justify-between shrink-0 gap-2">
        <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider shrink-0">
          {t('clipboardImport.dataPreview')}
        </h3>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-muted truncate">
            {t('clipboardImport.rowsTotal', { count: rowCount })}
            {!isMaximized && rowCount > MAX_PREVIEW_ROWS && ` (${t('clipboardImport.showingFirst', { count: MAX_PREVIEW_ROWS })})`}
          </span>
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="text-muted hover:text-primary transition-colors p-0.5 rounded hover:bg-surface-secondary/50 shrink-0"
              title={t(isMaximized ? 'clipboardImport.minimize' : 'clipboardImport.maximize')}
            >
              {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
        </div>
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="text-left border-collapse" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {headers.map((_, i) => (
              <col key={i} style={{ width: (widths[i] ?? 160) + 'px' }} />
            ))}
          </colgroup>
          <thead className="bg-elevated/50 sticky top-0 z-10">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="relative p-2 text-[10px] text-muted font-semibold font-mono whitespace-nowrap truncate">
                  {h}
                  <div
                    onMouseDown={(e) => startResize(i, e)}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 select-none"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-surface-secondary/30 border-b border-strong/20">
                {row.map((cell, ci) => (
                  <td key={ci} className="p-2 text-xs text-secondary font-mono whitespace-nowrap truncate">
                    {cell === '' ? <span className="text-muted italic">NULL</span> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
