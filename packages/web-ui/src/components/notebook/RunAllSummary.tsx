import {useTranslation} from 'react-i18next';
import {X, AlertTriangle, CheckCircle2} from 'lucide-react';
import type {NotebookCellLocation, RunAllResult} from '@/types/notebook';

interface RunAllSummaryProps {
    result: RunAllResult;
    onDismiss: () => void;
    onScrollToCell?: (cellId: string) => void;
}

export function RunAllSummary({result, onDismiss, onScrollToCell}: RunAllSummaryProps) {
    const {t} = useTranslation();
    const preflightFailed = result.preflightErrors.length > 0;
    const hasErrors = preflightFailed || result.failed > 0;
    const hasWarnings = result.blocked > 0 || result.skipped > 0;
    const style = hasErrors
        ? 'border-accent-error/30 bg-accent-error/5 text-accent-error'
        : hasWarnings
          ? 'border-accent-warning/30 bg-accent-warning/5 text-accent-warning'
          : 'border-accent-success/30 bg-accent-success/5 text-accent-success';
    const Icon = hasErrors || hasWarnings ? AlertTriangle : CheckCircle2;
    const counts = [
        [result.succeeded, t('editor.notebook.succeeded')],
        [result.failed, t('editor.notebook.failed')],
        [result.skipped, t('editor.notebook.skipped')],
        [result.blocked, t('editor.notebook.blocked')],
    ].filter(([count]) => count !== 0);

    const cellLink = ({cellId, cellIndex}: NotebookCellLocation) => {
        const label = t('editor.notebook.execution.cell', {number: cellIndex + 1});
        return onScrollToCell ? (
            <button
                type="button"
                onClick={() => onScrollToCell(cellId)}
                className="underline whitespace-nowrap shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
                {label}
            </button>
        ) : (
            <span className="whitespace-nowrap shrink-0">{label}</span>
        );
    };

    return (
        <div className={`mx-4 mb-3 rounded-lg border ${style}`}>
            <div className="flex items-center justify-between px-3 py-2">
                <div role="status" className="flex items-center gap-2 text-xs">
                    <Icon size={14} aria-hidden="true" />
                    <span>
                        {t(
                            preflightFailed
                                ? 'editor.notebook.execution.preflightFailed'
                                : result.mode === 'all'
                                  ? 'editor.notebook.runAllComplete'
                                  : 'editor.notebook.execution.complete',
                        )}
                    </span>
                    <span className="text-muted">
                        {counts.map(([count, label]) => `${count} ${label}`).join(', ')}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={t('common.dismiss')}
                    className="p-0.5 text-muted hover:text-secondary rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                    <X size={12} aria-hidden="true" />
                </button>
            </div>

            {preflightFailed && (
                <ul role="alert" className="px-3 pb-2 space-y-1 text-xs">
                    {result.preflightErrors.map((error) => (
                        <li key={error}>{error}</li>
                    ))}
                </ul>
            )}

            {result.errors.length > 0 && (
                <ul className="px-3 pb-2 space-y-1 text-xs text-accent-error">
                    {result.errors.map((err) => (
                        <li key={err.cellId} className="flex items-start gap-2">
                            {cellLink(err)}
                            <span className="text-muted whitespace-pre-wrap break-words">
                                {err.error}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {result.blockedCells.length > 0 && (
                <ul className="px-3 pb-2 space-y-1 text-xs text-accent-warning">
                    {result.blockedCells.map((blocked) => (
                        <li key={blocked.cellId} className="flex flex-wrap items-start gap-x-2">
                            {cellLink(blocked)}
                            <span className="text-muted">
                                {t('editor.notebook.execution.blockedBy')}
                            </span>
                            {cellLink(blocked.prerequisite)}
                        </li>
                    ))}
                </ul>
            )}

            {result.changedCells.length > 0 && (
                <ul className="px-3 pb-2 space-y-1 text-xs text-accent-warning">
                    {result.changedCells.map((cell) => (
                        <li key={cell.cellId} className="flex items-start gap-2">
                            {cellLink(cell)}
                            <span className="text-muted">
                                {t('editor.notebook.execution.changed')}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
