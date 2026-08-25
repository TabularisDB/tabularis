import type { ClipboardFormat } from '../../../utils/clipboardParser';

const FORMAT_LABELS: Record<ClipboardFormat, string> = {
  tsv: 'TSV (Excel/Sheets)',
  csv: 'CSV',
  'json-array': 'JSON',
  'markdown-table': 'Markdown Table',
  unknown: 'Text',
};

const FORMAT_COLORS: Record<ClipboardFormat, string> = {
  tsv: 'bg-green-900/30 text-green-400 border-green-800/40',
  csv: 'bg-blue-900/30 text-blue-400 border-blue-800/40',
  'json-array': 'bg-yellow-900/30 text-yellow-400 border-yellow-800/40',
  'markdown-table': 'bg-purple-900/30 text-purple-400 border-purple-800/40',
  unknown: 'bg-surface-secondary text-muted border-strong',
};

interface FormatBadgeProps {
  format: ClipboardFormat;
}

export function FormatBadge({ format }: FormatBadgeProps) {
  return (
    <span
      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${FORMAT_COLORS[format]}`}
    >
      {FORMAT_LABELS[format]}
    </span>
  );
}
