import {useTranslation} from 'react-i18next';
import {AlertTriangle, Loader2, Presentation} from 'lucide-react';
import {DataGrid} from '@/components/ui/DataGrid';
import {ErrorDisplay} from '@/components/ui/ErrorDisplay';
import type {NotebookCell, NotebookParam, RunAllResult} from '@/types/notebook';
import {isCellIncludedInReport, isCellOutputOutdated} from '@/utils/notebook';
import {canRenderChart} from '@/utils/notebookChart';
import {CellChart} from './CellChart';
import {CellKpi} from './CellKpi';
import {MarkdownCell} from './MarkdownCell';
import {ParamsPanel} from './ParamsPanel';
import {RunAllSummary} from './RunAllSummary';

interface NotebookReportViewProps {
    cells: NotebookCell[];
    params: NotebookParam[];
    onParamsChange: (params: NotebookParam[]) => void;
    runAllResult: RunAllResult | null;
    onDismissRunAllResult: () => void;
    onSwitchToEdit: () => void;
    outdatedCellIds?: ReadonlySet<string>;
}

function ReportSqlCell({cell, paramsOutdated}: {cell: NotebookCell; paramsOutdated: boolean}) {
    const {t} = useTranslation();
    const outdated = isCellOutputOutdated(cell, paramsOutdated);
    const title = cell.name?.trim();
    const showKpi = !!cell.kpiConfig && (cell.isKpiVisible ?? !!cell.kpiConfig);
    const showChart =
        !!cell.result &&
        !!cell.chartConfig &&
        (cell.isChartVisible ?? !!cell.chartConfig) &&
        canRenderChart(cell.result);
    const height = cell.resultHeight ?? 300;

    const showHeader = Boolean(title || outdated || cell.result);

    return (
        <section
            aria-label={title || t('editor.notebook.sqlCell')}
            className="bg-base border border-default rounded-lg overflow-hidden"
        >
            {showHeader && (
                <div className="flex items-center justify-between gap-2 px-4 py-2 bg-elevated border-b border-default flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        {title && (
                            <h3 className="text-sm font-semibold text-primary truncate">{title}</h3>
                        )}
                        {outdated && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-accent-warning/15 text-accent-warning">
                                <AlertTriangle size={12} />
                                {t('editor.notebook.reportOutdated')}
                            </span>
                        )}
                    </div>
                    {cell.result && (
                        <span className="text-xs text-muted tabular-nums shrink-0">
                            {t('editor.notebook.cellResult', {
                                count: cell.result.rows.length,
                                time: Math.round(cell.executionTime ?? 0),
                            })}
                        </span>
                    )}
                </div>
            )}

            {cell.isLoading ? (
                <div className="flex items-center justify-center gap-2 p-6">
                    <Loader2 size={16} className="animate-spin text-accent" />
                    <span className="text-xs text-muted">{t('editor.executingQuery')}</span>
                </div>
            ) : cell.error ? (
                <div className="max-h-[200px] overflow-auto">
                    <ErrorDisplay error={cell.error} t={t} />
                </div>
            ) : !cell.result ? (
                <p className="px-4 py-6 text-xs text-muted italic text-center">
                    {t('editor.notebook.reportNoOutput')}
                </p>
            ) : (
                <div>
                    {showKpi && cell.kpiConfig && (
                        <CellKpi
                            result={cell.result}
                            error={cell.error}
                            config={cell.kpiConfig}
                            readOnly
                        />
                    )}
                    {showChart && cell.chartConfig && (
                        <CellChart result={cell.result} config={cell.chartConfig} readOnly />
                    )}
                    <div
                        style={{height}}
                        className="w-full overflow-hidden border-t border-default"
                    >
                        <DataGrid
                            columns={cell.result.columns}
                            data={cell.result.rows}
                            tableName={null}
                            pkColumns={null}
                            readonly
                        />
                    </div>
                </div>
            )}
        </section>
    );
}

export function NotebookReportView({
    cells,
    params,
    onParamsChange,
    runAllResult,
    onDismissRunAllResult,
    onSwitchToEdit,
    outdatedCellIds,
}: NotebookReportViewProps) {
    const {t} = useTranslation();
    const includedCells = cells.filter(isCellIncludedInReport);

    return (
        <div className="flex-1 overflow-auto p-4 sm:p-6">
            <div className="max-w-4xl mx-auto w-full space-y-4">
                <ParamsPanel params={params} onParamsChange={onParamsChange} />

                {runAllResult && (
                    <RunAllSummary result={runAllResult} onDismiss={onDismissRunAllResult} />
                )}

                {includedCells.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 border border-dashed border-default rounded-lg text-center">
                        <Presentation size={28} className="text-muted opacity-50" />
                        <p className="text-sm text-muted">{t('editor.notebook.reportEmpty')}</p>
                        <button
                            type="button"
                            onClick={onSwitchToEdit}
                            className="px-3 py-1.5 text-xs font-medium rounded bg-surface-secondary text-primary hover:bg-surface-hover border border-strong transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                            {t('editor.notebook.editMode')}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {includedCells.map((cell) =>
                            cell.type === 'markdown' ? (
                                <MarkdownCell key={cell.id} cell={cell} readOnly />
                            ) : (
                                <ReportSqlCell
                                    key={cell.id}
                                    cell={cell}
                                    paramsOutdated={!!outdatedCellIds?.has(cell.id)}
                                />
                            ),
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
