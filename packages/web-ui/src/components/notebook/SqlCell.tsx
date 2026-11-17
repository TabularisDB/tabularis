import {useTranslation} from 'react-i18next';
import type {NotebookCell} from '@/types/notebook';
import type {CellChartConfig, CellKpiConfig} from '@/types/notebook';
import type {ResolvedQuery} from '@/utils/notebookVariables';
import {SqlCellEditor} from './SqlCellEditor';
import {SqlCellResult} from './SqlCellResult';
import {SqlCellExplain} from './SqlCellExplain';

interface SqlCellProps {
    cell: NotebookCell;
    onContentChange: (content: string) => void;
    onRun: () => void;
    onChartConfigChange?: (config: CellChartConfig | null) => void;
    onResultHeightChange?: (height: number) => void;
    onToggleQueryCollapse: () => void;
    onToggleResultCollapse: () => void;
    onToggleChartVisible: (visible: boolean) => void;
    onKpiConfigChange?: (config: CellKpiConfig | null) => void;
    onToggleKpiVisible?: (visible: boolean) => void;
    onToggleQueryPlanVisible: () => void;
    connectionId: string;
    explainQuery?: ResolvedQuery;
    schema?: string;
}

export function SqlCell({
    cell,
    onContentChange,
    onRun,
    onChartConfigChange,
    onResultHeightChange,
    onToggleQueryCollapse,
    onToggleResultCollapse,
    onToggleChartVisible,
    onKpiConfigChange,
    onToggleKpiVisible,
    onToggleQueryPlanVisible,
    connectionId,
    explainQuery,
    schema,
}: SqlCellProps) {
    const {t} = useTranslation();
    const unresolvedRefs = explainQuery?.unresolvedRefs ?? [];
    return (
        <div>
            <SqlCellEditor
                cellId={cell.id}
                content={cell.content}
                onContentChange={onContentChange}
                onRun={onRun}
                connectionId={connectionId}
                schema={schema}
                collapsed={cell.isQueryCollapsed}
                onToggleCollapse={onToggleQueryCollapse}
            />
            {cell.isDisabled && (
                <p
                    role="status"
                    className="px-3 py-1.5 border-t border-default bg-accent-warning/5 text-[11px] text-secondary"
                >
                    {t('editor.notebook.disabledNotice')}
                    {(cell.result || cell.error) && (
                        <> {t('editor.notebook.disabledOutputNotice')}</>
                    )}
                </p>
            )}
            <SqlCellResult
                result={cell.result ?? null}
                error={cell.error}
                executionTime={cell.executionTime}
                isLoading={cell.isLoading}
                chartConfig={cell.chartConfig}
                onChartConfigChange={onChartConfigChange}
                resultHeight={cell.resultHeight}
                onResultHeightChange={onResultHeightChange}
                isResultCollapsed={cell.isResultCollapsed}
                onToggleResultCollapse={onToggleResultCollapse}
                isChartVisible={cell.isChartVisible}
                onToggleChartVisible={onToggleChartVisible}
                kpiConfig={cell.kpiConfig}
                onKpiConfigChange={onKpiConfigChange}
                isKpiVisible={cell.isKpiVisible}
                onToggleKpiVisible={onToggleKpiVisible}
            />
            <SqlCellExplain
                query={explainQuery?.sql ?? cell.content}
                queryError={
                    unresolvedRefs.length > 0
                        ? t('editor.notebook.queryPlanUnresolved', {
                              refs: [...new Set(unresolvedRefs.map((ref) => ref.match))].join(', '),
                          })
                        : undefined
                }
                connectionId={connectionId}
                schema={schema}
                // A disabled cell sends nothing to the database, EXPLAIN included.
                visible={!!cell.isQueryPlanVisible && !cell.isDisabled}
                onToggleVisible={onToggleQueryPlanVisible}
            />
        </div>
    );
}
