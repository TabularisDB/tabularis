import {useEffect, useId, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import type {DmlPreview} from '@/api/contract';

interface DmlPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    preview: DmlPreview | null;
    error: string | null;
    loading: boolean;
    onRunStatement?: (sql: string) => void;
}

function formatCell(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

export const DmlPreviewModal = ({
    isOpen,
    onClose,
    preview,
    error,
    loading,
    onRunStatement,
}: DmlPreviewModalProps) => {
    const {t} = useTranslation();
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isOpen) closeRef.current?.focus();
    }, [isOpen, loading, preview, error]);

    const title = preview
        ? t(
              preview.kind === 'update'
                  ? 'editor.dmlPreview.titleUpdate'
                  : 'editor.dmlPreview.titleDelete',
              {
                  target: preview.target,
              },
          )
        : t('editor.dmlPreview.title');

    return (
        <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-default rounded-xl shadow-2xl w-[min(96vw,72rem)] max-h-[85vh] flex flex-col"
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
                    <h2 id={titleId} className="text-base font-semibold text-primary">
                        {title}
                    </h2>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        className="text-muted hover:text-primary transition-colors p-1 rounded hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        aria-label={t('editor.dmlPreview.close')}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 space-y-3">
                    {loading && (
                        <div className="flex items-center gap-2 text-sm text-secondary">
                            <Loader2 size={16} className="animate-spin" />
                            {t('editor.dmlPreview.loading')}
                        </div>
                    )}
                    {error && !loading && (
                        <div
                            className="text-sm text-error-text bg-error-bg border border-error-border rounded px-3 py-2"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}
                    {preview && !loading && (
                        <>
                            {!preview.hasFilter && (
                                <p
                                    className="text-sm text-accent-warning bg-accent-warning/10 border border-accent-warning/30 rounded px-3 py-2"
                                    role="status"
                                >
                                    {t('editor.dmlPreview.noFilter', {target: preview.target})}
                                </p>
                            )}
                            {preview.truncated && (
                                <p className="text-sm text-secondary" role="status">
                                    {t('editor.dmlPreview.truncated', {limit: preview.limit})}
                                </p>
                            )}
                            {(preview.triggers > 0 || preview.rules > 0) && (
                                <p className="text-sm text-secondary" role="status">
                                    {t('editor.dmlPreview.triggers', {
                                        triggers: preview.triggers,
                                        rules: preview.rules,
                                        target: preview.target,
                                    })}
                                </p>
                            )}
                            <p className="text-sm text-muted">{t('editor.dmlPreview.canDiffer')}</p>
                            <div>
                                <h3 className="text-xs font-medium text-secondary mb-1">
                                    {t('editor.dmlPreview.previewSql')}
                                </h3>
                                <pre className="text-xs font-mono text-primary bg-surface-secondary border border-default rounded p-3 overflow-x-auto whitespace-pre-wrap">
                                    {preview.previewSql}
                                </pre>
                            </div>
                            {preview.result.rows.length === 0 ? (
                                <p className="text-sm text-secondary">
                                    {t('editor.dmlPreview.empty')}
                                </p>
                            ) : (
                                <div className="overflow-auto border border-default rounded max-h-[40vh]">
                                    <table className="min-w-full text-xs font-mono border-collapse">
                                        <thead className="bg-surface-secondary sticky top-0">
                                            <tr>
                                                {preview.result.columns.map((column, index) => (
                                                    <th
                                                        key={`${column}-${index}`}
                                                        scope="col"
                                                        className={headerClass(preview, index)}
                                                    >
                                                        {column}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {preview.result.rows.map((row, rowIndex) => (
                                                <tr
                                                    key={rowIndex}
                                                    className="border-t border-default odd:bg-elevated even:bg-surface-secondary/40"
                                                >
                                                    {preview.result.columns.map(
                                                        (column, colIndex) => (
                                                            <td
                                                                key={`${rowIndex}-${column}-${colIndex}`}
                                                                className={cellClass(
                                                                    preview,
                                                                    colIndex,
                                                                    row[colIndex],
                                                                )}
                                                            >
                                                                {formatCell(row[colIndex])}
                                                            </td>
                                                        ),
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-default shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-secondary hover:text-primary hover:bg-surface-secondary rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        {t('editor.dmlPreview.close')}
                    </button>
                    {onRunStatement && preview && !loading && !error && (
                        <button
                            type="button"
                            onClick={() => onRunStatement(preview.sourceSql)}
                            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                            {t('editor.dmlPreview.runStatement')}
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    );
};

function isAssignedPair(preview: DmlPreview, index: number): 'current' | 'proposed' | null {
    if (preview.kind !== 'update') return null;
    const assigned = preview.assignedColumns.length * 2;
    if (index >= assigned) return null;
    return index % 2 === 0 ? 'current' : 'proposed';
}

function headerClass(preview: DmlPreview, index: number): string {
    const kind = isAssignedPair(preview, index);
    const base =
        'text-left font-medium text-secondary px-3 py-2 whitespace-nowrap border-r border-default last:border-r-0';
    if (kind === 'current') return `${base} bg-surface-tertiary`;
    if (kind === 'proposed') return `${base} bg-accent-primary/10 text-primary`;
    return base;
}

function cellClass(preview: DmlPreview, index: number, value: unknown): string {
    const kind = isAssignedPair(preview, index);
    const nullish = value === null || value === undefined;
    const base =
        'px-3 py-1.5 whitespace-nowrap border-r border-default last:border-r-0 text-primary';
    const muted = nullish ? ' text-muted italic' : '';
    if (kind === 'proposed') return `${base}${muted} bg-accent-primary/5`;
    return `${base}${muted}`;
}
