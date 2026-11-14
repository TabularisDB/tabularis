import {useTranslation} from 'react-i18next';
import {X, AlertTriangle, CheckCircle2} from 'lucide-react';
import type {RunAllResult} from '@/types/notebook';

interface RunAllSummaryProps {
    result: RunAllResult;
    onDismiss: () => void;
    onScrollToCell?: (cellId: string) => void;
}

export function RunAllSummary({result, onDismiss, onScrollToCell}: RunAllSummaryProps) {
    const {t} = useTranslation();
    const hasErrors = result.failed > 0;

    return (
        <div
            className={`mx-4 mb-3 rounded-lg border ${
                hasErrors
                    ? 'border-accent-error/30 bg-accent-error/5'
                    : 'border-accent-success/30 bg-accent-success/5'
            }`}
        >
            <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                    {hasErrors ? (
                        <AlertTriangle size={14} className="text-accent-error" />
                    ) : (
                        <CheckCircle2 size={14} className="text-accent-success" />
                    )}
                    <span className={hasErrors ? 'text-accent-error' : 'text-accent-success'}>
                        {t('editor.notebook.runAllComplete')}
                    </span>
                    <span className="text-muted">
                        {result.succeeded > 0 && (
                            <span className="text-accent-success">
                                {result.succeeded} {t('editor.notebook.succeeded')}
                            </span>
                        )}
                        {result.failed > 0 && (
                            <span className="text-accent-error">
                                {result.succeeded > 0 && ', '}
                                {result.failed} {t('editor.notebook.failed')}
                            </span>
                        )}
                        {result.skipped > 0 && (
                            <span className="text-muted">
                                {(result.succeeded > 0 || result.failed > 0) && ', '}
                                {result.skipped} {t('editor.notebook.skipped')}
                            </span>
                        )}
                        {result.blocked > 0 && (
                            <span className="text-accent-warning">
                                {(result.succeeded > 0 ||
                                    result.failed > 0 ||
                                    result.skipped > 0) &&
                                    ', '}
                                {result.blocked} {t('editor.notebook.blocked')}
                            </span>
                        )}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="p-0.5 text-muted hover:text-secondary rounded transition-colors"
                >
                    <X size={12} />
                </button>
            </div>

            {result.errors.length > 0 && (
                <div className="px-3 pb-2 space-y-1">
                    {result.errors.map((err) => (
                        <div key={err.cellId} className="flex items-start gap-2 text-[11px]">
                            <button
                                type="button"
                                onClick={() => onScrollToCell?.(err.cellId)}
                                className="text-accent-error underline whitespace-nowrap shrink-0"
                            >
                                Cell #{err.cellIndex + 1}
                            </button>
                            <span className="text-muted truncate">{err.error}</span>
                        </div>
                    ))}
                </div>
            )}

            {result.blockedCells.length > 0 && (
                <div className="px-3 pb-2 space-y-1">
                    {result.blockedCells.map((blocked) => (
                        <div key={blocked.cellId} className="flex items-start gap-2 text-[11px]">
                            <button
                                type="button"
                                onClick={() => onScrollToCell?.(blocked.cellId)}
                                className="text-accent-warning underline whitespace-nowrap shrink-0"
                            >
                                Cell #{blocked.cellIndex + 1}
                            </button>
                            <span className="text-muted">
                                {t('editor.notebook.blockedWaitsOn')}
                            </span>
                            {blocked.disabledCells.map((disabled) => (
                                <button
                                    key={disabled.cellId}
                                    type="button"
                                    onClick={() => onScrollToCell?.(disabled.cellId)}
                                    className="text-accent underline whitespace-nowrap shrink-0"
                                >
                                    Cell #{disabled.cellIndex + 1}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
