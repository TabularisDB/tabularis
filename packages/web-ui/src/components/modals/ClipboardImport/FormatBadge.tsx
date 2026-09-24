import type { ClipboardFormat } from '../../../utils/clipboardParser';

const FORMAT_LABELS: Record<ClipboardFormat, string> = {
  tsv: 'TSV (Excel/Sheets)',
  csv: 'CSV',
  'json-array': 'JSON',
  'markdown-table': 'Markdown Table',
  unknown: 'Text',
};

const FORMAT_COLORS: Record<ClipboardFormat, string> = {
  tsv: 'bg-accent-success/15 text-accent-success border-accent-success/20',
  csv: 'bg-accent-primary/15 text-accent border-accent-primary/20',
  'json-array': 'bg-accent-warning/15 text-accent-warning border-accent-warning/20',
  'markdown-table': 'bg-accent-secondary/15 text-accent-secondary border-accent-secondary/20',
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
