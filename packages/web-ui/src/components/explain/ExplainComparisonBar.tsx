import {memo} from 'react';
import {useTranslation} from 'react-i18next';
import {type PlanComparisonResult, formatCost, formatTime} from '@tabularis/explain';
import {ArrowDown, ArrowUp, AlertTriangle, Split} from 'lucide-react';
import clsx from 'clsx';

interface ExplainComparisonBarProps {
    comparison: PlanComparisonResult;
    baselineName: string;
    onClearBaseline: () => void;
}

export const ExplainComparisonBar = memo(
    ({comparison, baselineName, onClearBaseline}: ExplainComparisonBarProps) => {
        const {t} = useTranslation();

        if (!comparison.isCompatible) {
            return (
                <div className="flex items-center justify-between px-4 py-2 bg-accent-error/15 border-b border-accent-error/30 text-xs text-accent-error">
                    <div className="flex items-center gap-2">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>
                            {t(
                                'editor.visualExplain.incompatibleBaseline',
                                'Incompatible baseline',
                            )}
                            : {comparison.incompatibilityReason}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onClearBaseline}
                        className="px-2 py-0.5 rounded bg-surface hover:bg-surface-secondary text-primary border border-default text-xs"
                    >
                        {t('editor.visualExplain.clearBaseline', 'Clear Baseline')}
                    </button>
                </div>
            );
        }

        const costDelta = comparison.summary.totalCostDelta.delta;
        const timeDelta = comparison.summary.executionTimeDelta.delta;

        return (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-elevated/70 border-b border-default text-xs select-none">
                <div className="flex items-center gap-2">
                    <Split size={14} className="text-secondary shrink-0" />
                    <span className="text-muted">
                        {t('editor.visualExplain.comparingAgainst', 'Baseline')}:
                    </span>
                    <span
                        className="font-semibold text-primary truncate max-w-[200px]"
                        title={baselineName}
                    >
                        {baselineName}
                    </span>
                    {comparison.hasAnalyzeMismatch && (
                        <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-warning/15 text-accent-warning font-medium text-[11px]"
                            title={t(
                                'editor.visualExplain.analyzeMismatchTooltip',
                                'One plan has actual execution metrics (EXPLAIN ANALYZE) while the other only has estimates',
                            )}
                        >
                            <AlertTriangle size={11} />
                            {t('editor.visualExplain.analyzeMismatch', 'Estimate vs Actual')}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    {/* Cost delta */}
                    {costDelta != null && (
                        <div className="flex items-center gap-1 font-mono">
                            <span className="text-muted">{t('editor.visualExplain.cost')}:</span>
                            <span
                                className={clsx(
                                    'flex items-center font-semibold',
                                    costDelta > 0
                                        ? 'text-accent-error'
                                        : costDelta < 0
                                          ? 'text-accent-success'
                                          : 'text-muted',
                                )}
                            >
                                {costDelta > 0 ? (
                                    <ArrowUp size={12} />
                                ) : costDelta < 0 ? (
                                    <ArrowDown size={12} />
                                ) : null}
                                {costDelta > 0
                                    ? `+${formatCost(costDelta)}`
                                    : formatCost(costDelta)}
                            </span>
                        </div>
                    )}

                    {/* Time delta */}
                    {timeDelta != null && (
                        <div className="flex items-center gap-1 font-mono">
                            <span className="text-muted">{t('editor.visualExplain.time')}:</span>
                            <span
                                className={clsx(
                                    'flex items-center font-semibold',
                                    timeDelta > 0
                                        ? 'text-accent-error'
                                        : timeDelta < 0
                                          ? 'text-accent-success'
                                          : 'text-muted',
                                )}
                            >
                                {timeDelta > 0 ? (
                                    <ArrowUp size={12} />
                                ) : timeDelta < 0 ? (
                                    <ArrowDown size={12} />
                                ) : null}
                                {timeDelta > 0
                                    ? `+${formatTime(timeDelta)}`
                                    : formatTime(timeDelta)}
                            </span>
                        </div>
                    )}

                    {/* Changed operators */}
                    {comparison.summary.operatorsChanged > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-accent-warning/15 text-accent-warning font-medium">
                            {comparison.summary.operatorsChanged}{' '}
                            {t('editor.visualExplain.operatorsChanged', 'operators changed')}
                        </span>
                    )}

                    <button
                        type="button"
                        onClick={onClearBaseline}
                        className="px-2 py-0.5 rounded bg-surface hover:bg-surface-secondary text-secondary hover:text-primary border border-default text-[11px] transition-colors"
                        title={t('editor.visualExplain.clearBaseline', 'Clear Baseline')}
                    >
                        {t('editor.visualExplain.clearBaseline', 'Clear Baseline')}
                    </button>
                </div>
            </div>
        );
    },
);
