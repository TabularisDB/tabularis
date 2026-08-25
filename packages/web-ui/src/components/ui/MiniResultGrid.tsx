import { useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpDown, Copy, Loader2 } from 'lucide-react';
import { copyTextToClipboard } from '../../utils/clipboard';

interface MiniResultGridProps {
  columns: string[];
  rows: unknown[][];
  loading?: boolean;
  message?: string;
}

export function MiniResultGrid({ columns, rows, loading, message }: MiniResultGridProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }, [sortCol]);

  const displayRows = useMemo(() => {
    if (!sortCol) return rows;
    const idx = columns.indexOf(sortCol);
    if (idx === -1) return rows;
    const sorted = [...rows].sort((a, b) => {
      const av = a[idx] ?? '';
      const bv = b[idx] ?? '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, sortCol, sortDir, columns]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual exposes non-memoizable methods; this local usage does not pass them to memoized children.
  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">{t('miniGrid.runningQuery')}</span>
      </div>
    );
  }

  if (message) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {message}
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        {t('common.noResults')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden text-sm">
      <div className="flex-1 overflow-auto" ref={parentRef}>
        <div className="w-full min-w-max">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-elevated border-b border-strong flex">
            {columns.map((col) => (
              <div
                key={col}
                className="text-left px-3 py-2 text-xs font-semibold text-secondary flex-1 min-w-[80px] whitespace-nowrap cursor-pointer select-none hover:text-primary transition-colors flex items-center gap-1 overflow-hidden"
                onClick={() => handleSort(col)}
                title={col}
              >
                <span className="truncate flex-1 min-w-0">{col}</span>
                <ArrowUpDown size={12} className={sortCol === col ? 'text-blue-400 flex-shrink-0' : 'text-muted opacity-50 flex-shrink-0'} />
              </div>
            ))}
          </div>

          {/* Body */}
          <div style={{ position: 'relative', height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = displayRows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  className="flex absolute left-0 w-full border-b border-strong/30 hover:bg-surface-secondary/50 transition-colors"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {columns.map((col, colIdx) => {
                    const value = row[colIdx];
                    const display = value === null ? 'NULL' : String(value);
                    return (
                      <div
                        key={col}
                        className="px-3 py-1.5 text-primary whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-[80px]"
                        title={display}
                      >
                        <span className={value === null ? 'text-muted italic' : ''}>{display}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="px-3 py-1.5 text-xs text-muted border-t border-strong bg-elevated flex items-center justify-between shrink-0">
        <span>{t('editor.rowCount', { total: rows.length })}</span>
        <button
          onClick={() => copyTextToClipboard(columns.join('\t') + '\n' + rows.map((r) => r.join('\t')).join('\n'))}
          className="flex items-center gap-1 hover:text-primary transition-colors"
          title={t('miniGrid.copyAll')}
          aria-label={t('miniGrid.copyAll')}
        >
          <Copy size={12} />
          {t('common.copy')}
        </button>
      </div>
    </div>
  );
}
