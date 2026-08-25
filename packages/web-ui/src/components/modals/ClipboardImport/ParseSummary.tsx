import { Database, Rows, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormatBadge } from './FormatBadge';
import type { ClipboardFormat } from '../../../utils/clipboardParser';

interface ParseSummaryProps {
  format: ClipboardFormat;
  rowCount: number;
  columnCount: number;
  activeDriver: string | null;
  hasHeaderRow: boolean;
  onToggleHeader: (hasHeader: boolean) => void;
}

export function ParseSummary({
  format,
  rowCount,
  columnCount,
  activeDriver,
  hasHeaderRow,
  onToggleHeader,
}: ParseSummaryProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 flex-wrap bg-base/60 border border-default rounded-lg px-3 py-2">
      <FormatBadge format={format} />
      <div className="flex items-center gap-1.5 text-xs text-secondary">
        <Table2 size={13} className="text-blue-400" />
        <span className="font-semibold text-primary">{columnCount}</span>
        <span className="text-muted">{t('clipboardImport.columnsLabel')}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-secondary">
        <Rows size={13} className="text-green-400" />
        <span className="font-semibold text-primary">{rowCount}</span>
        <span className="text-muted">{t('clipboardImport.rowsLabel')}</span>
      </div>
      {activeDriver && (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Database size={13} />
          <span className="font-mono uppercase">{activeDriver}</span>
        </div>
      )}
      <div className="ml-auto">
        <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasHeaderRow}
            onChange={(e) => onToggleHeader(e.target.checked)}
            className="accent-blue-500"
          />
          {t('clipboardImport.firstRowHeader')}
        </label>
      </div>
    </div>
  );
}
