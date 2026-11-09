import {useCallback, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Download, Loader2} from 'lucide-react';
import {MonacoEditor} from '@/components/ui/LazyMonaco';
import type * as monaco from 'monaco-editor';
import type {ExplainPlan, ExplainTableColumnId} from '@tabularis/explain';
import {
    computeExplainMetrics,
    findExplainNode,
    getPlanDiagnostics,
    normalizeExplainTableColumnOrder,
} from '@tabularis/explain';
import {
    ExplainDiagramView,
    ExplainGraph,
    ExplainNodeDetails,
    ExplainOverviewBar,
    ExplainStatsView,
    ExplainSummaryBar,
    ExplainTableView,
    type ExplainViewMode,
} from '@tabularis/explain/react';
import {useEditorTheme} from '@/hooks/useEditorTheme';
import {useAlert} from '@/hooks/useAlert';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {useToast} from '@/hooks/useToast';
import {useUiState} from '@/hooks/useUiState';
import {UI_STATE_KEYS} from '@/utils/uiStateStore';
import {loadMonacoTheme} from '@/themes/themeUtils';
import {getMonacoThemeId} from '@/themes/themeRuntime';
import {
    detectRawExplainLanguage,
    formatRawExplainOutput,
    getRawExplainFormatLabel,
    saveRawExplainOutput,
} from '@/utils/explainRaw';
import {saveExplainTableCsv} from '@/utils/explainTableExport';
import {toErrorMessage} from '@/utils/errors';
import {ExplainAiAnalysis} from '@/components/modals/visual-explain/ExplainAiAnalysis';
import {Camera} from 'lucide-react';
import {
    type ExplainSnapshot,
    comparePlanSnapshots,
    type PlanComparisonResult,
} from '@tabularis/explain';
import {
    loadExplainSnapshots,
    saveExplainSnapshot,
    deleteExplainSnapshot,
    togglePinExplainSnapshot,
} from '@/utils/explainSnapshots';
import {ExplainComparisonBar} from './ExplainComparisonBar';
import {ExplainSnapshotsModal} from './ExplainSnapshotsModal';

export interface VisualExplainViewProps {
    plan: ExplainPlan | null;
    isLoading: boolean;
    error: string | null;
    viewMode: ExplainViewMode;
    onViewModeChange: (mode: ExplainViewMode) => void;
    selectedNodeId: string | null;
    onSelectNode: (id: string | null) => void;
    aiEnabled: boolean;
    connectionId?: string;
    connectionName?: string;
    databaseName?: string;
    schemaName?: string;
}

/**
 * Pure presentation of a resolved `ExplainPlan`. Does not fetch data itself —
 * both the Editor modal and the standalone CLI page feed it `plan`.
 */
export const VisualExplainView = ({
    plan,
    isLoading,
    error,
    viewMode,
    onViewModeChange,
    selectedNodeId,
    onSelectNode,
    aiEnabled,
    connectionId,
    connectionName,
    databaseName,
    schemaName,
}: VisualExplainViewProps) => {
    const {t} = useTranslation();
    const editorTheme = useEditorTheme();

    // Computed once per plan and shared by every view, so switching views does not
    // walk the tree again.
    const metrics = useMemo(() => (plan ? computeExplainMetrics(plan) : null), [plan]);

    const diagnostics = useMemo(
        () => (plan && metrics ? getPlanDiagnostics(plan, metrics) : null),
        [plan, metrics],
    );

    const selectedNode = useMemo(
        () => (plan ? findExplainNode(plan.root, selectedNodeId) : null),
        [plan, selectedNodeId],
    );

    const {showAlert} = useAlert();
    const platform = usePlatformCapabilities();
    const {showToast} = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const [snapshots, setSnapshots] = useState<ExplainSnapshot[]>(() => loadExplainSnapshots());
    const [isSnapshotsModalOpen, setIsSnapshotsModalOpen] = useState(false);
    const [baselineSnapshot, setBaselineSnapshot] = useState<ExplainSnapshot | null>(null);

    // Compute comparison against active baseline snapshot
    const comparison: PlanComparisonResult | null = useMemo(() => {
        if (!plan || !baselineSnapshot) return null;
        const currentSnapshot: ExplainSnapshot = {
            id: 'current',
            name: 'Current Plan',
            createdAt: new Date().toISOString(),
            sql: plan.original_query || '',
            context: {
                engine: plan.driver,
                connectionId,
                connectionName,
                databaseName,
                schema: schemaName,
            },
            hasAnalyzeData: plan.has_analyze_data,
            planningTimeMs: plan.planning_time_ms,
            executionTimeMs: plan.execution_time_ms,
            totalCost: plan.root.total_cost,
            rawOutput: plan.raw_output,
            plan,
        };
        const baselineMetrics = baselineSnapshot.plan
            ? computeExplainMetrics(baselineSnapshot.plan).byId
            : undefined;
        return comparePlanSnapshots(
            baselineSnapshot,
            currentSnapshot,
            baselineMetrics,
            metrics?.byId,
        );
    }, [plan, baselineSnapshot, metrics, connectionId, connectionName, databaseName, schemaName]);

    const handleSaveCurrentSnapshot = useCallback(
        (name: string) => {
            if (!plan) return;
            try {
                saveExplainSnapshot(plan, name, {
                    engine: plan.driver,
                    connectionId,
                    connectionName,
                    databaseName,
                    schema: schemaName,
                });
                setSnapshots(loadExplainSnapshots());
                showToast(
                    t('editor.visualExplain.snapshotSaved', 'Plan snapshot saved successfully'),
                    {
                        kind: 'success',
                    },
                );
            } catch (error) {
                console.error('Failed to save explain snapshot:', error);
                showToast(
                    t(
                        'editor.visualExplain.snapshotSaveFailed',
                        'Failed to save plan snapshot: storage limit reached or unavailable',
                    ),
                    {
                        kind: 'error',
                    },
                );
            }
        },
        [plan, connectionId, connectionName, databaseName, schemaName, showToast, t],
    );

    const handleDeleteSnapshot = useCallback(
        (id: string) => {
            try {
                const remaining = deleteExplainSnapshot(id);
                setSnapshots(remaining);
                setBaselineSnapshot((prev) => (prev?.id === id ? null : prev));
            } catch (error) {
                console.error('Failed to delete explain snapshot:', error);
                showToast(
                    t(
                        'editor.visualExplain.snapshotDeleteFailed',
                        'Failed to delete snapshot from storage',
                    ),
                    {
                        kind: 'error',
                    },
                );
            }
        },
        [showToast, t],
    );

    const handleTogglePinSnapshot = useCallback(
        (id: string) => {
            try {
                const updated = togglePinExplainSnapshot(id);
                setSnapshots(updated);
            } catch (error) {
                console.error('Failed to pin explain snapshot:', error);
                showToast(
                    t(
                        'editor.visualExplain.snapshotPinFailed',
                        'Failed to update snapshot pin state in storage',
                    ),
                    {
                        kind: 'error',
                    },
                );
            }
        },
        [showToast, t],
    );

    const handleSelectBaseline = useCallback((snap: ExplainSnapshot) => {
        setBaselineSnapshot((prev) => (prev?.id === snap.id ? null : snap));
        setIsSnapshotsModalOpen(false);
    }, []);

    const rawLanguage = useMemo(
        () => (plan?.raw_output ? detectRawExplainLanguage(plan.raw_output) : 'plaintext'),
        [plan],
    );

    const rawFormatLabel = useMemo(
        () => getRawExplainFormatLabel(rawLanguage, t('editor.visualExplain.formatText', 'Text')),
        [rawLanguage, t],
    );

    const rawValue = useMemo(
        () => (plan?.raw_output ? formatRawExplainOutput(plan.raw_output) : ''),
        [plan],
    );

    const handleBeforeMount = useCallback(
        (monacoInstance: typeof monaco) => {
            loadMonacoTheme(editorTheme, monacoInstance);
        },
        [editorTheme],
    );

    const [isExportingCsv, setIsExportingCsv] = useState(false);

    // Shared by every window, so a detached plan shows the same column order.
    const [storedColumnOrder, setStoredColumnOrder] = useUiState<unknown>(
        UI_STATE_KEYS.explainTableColumns,
        null,
    );
    const columnOrder = useMemo(
        () => normalizeExplainTableColumnOrder(storedColumnOrder),
        [storedColumnOrder],
    );
    const handleColumnOrderChange = useCallback(
        (order: readonly ExplainTableColumnId[]) => setStoredColumnOrder([...order]),
        [setStoredColumnOrder],
    );

    const handleSaveRaw = useCallback(async () => {
        // Capture the selected plan synchronously before awaiting the dialog
        const planSnapshot = plan;
        const rawToSave = planSnapshot?.raw_output;
        if (!rawToSave || isSaving) return;

        setIsSaving(true);
        try {
            const saved = await saveRawExplainOutput(platform, rawToSave);
            if (saved) {
                showAlert(t('editor.visualExplain.rawExported'), {kind: 'info'});
            }
        } catch (e) {
            console.error('Failed to save raw EXPLAIN output', e);
            showAlert(t('editor.visualExplain.saveRawError'), {kind: 'error'});
        } finally {
            setIsSaving(false);
        }
    }, [plan, isSaving, platform, showAlert, t]);

    const handleExportCsv = useCallback(async () => {
        if (!plan || !metrics) return;
        setIsExportingCsv(true);
        try {
            const saved = await saveExplainTableCsv(platform, plan, metrics);
            if (saved) {
                showToast(
                    t('editor.visualExplain.exportCsvSuccess', 'Explain table exported as CSV'),
                    {kind: 'success'},
                );
            }
        } catch (err) {
            console.error('Failed to export EXPLAIN table CSV:', err);
            // Kept until dismissed so the reason can be read and reported.
            showToast(toErrorMessage(err), {
                title: t(
                    'editor.visualExplain.exportCsvError',
                    'Failed to export EXPLAIN table as CSV',
                ),
                kind: 'error',
                duration: 0,
            });
        } finally {
            setIsExportingCsv(false);
        }
    }, [plan, metrics, platform, showToast, t]);

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between border-b border-default bg-base/50 pr-2">
                <div className="flex-1 min-w-0">
                    <ExplainSummaryBar
                        plan={plan}
                        viewMode={viewMode}
                        onViewModeChange={onViewModeChange}
                        aiEnabled={aiEnabled}
                    />
                </div>
                {plan && (
                    <button
                        type="button"
                        onClick={() => setIsSnapshotsModalOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-default bg-surface hover:bg-surface-secondary text-primary transition-colors shrink-0 shadow-sm"
                        title={t('editor.visualExplain.snapshots', 'Snapshots')}
                    >
                        <Camera size={13} className="text-secondary" />
                        <span className="hidden @[640px]:inline">
                            {t('editor.visualExplain.snapshots', 'Snapshots')}
                        </span>
                        {snapshots.length > 0 && (
                            <span className="px-1 rounded-full bg-surface-secondary text-[10px] text-muted font-mono">
                                {snapshots.length}
                            </span>
                        )}
                    </button>
                )}
            </div>

            {comparison && baselineSnapshot && (
                <ExplainComparisonBar
                    comparison={comparison}
                    baselineName={baselineSnapshot.name}
                    onClearBaseline={() => setBaselineSnapshot(null)}
                />
            )}

            {plan && metrics && (
                <ExplainOverviewBar plan={plan} metrics={metrics} onSelectNode={onSelectNode} />
            )}

            <ExplainSnapshotsModal
                isOpen={isSnapshotsModalOpen}
                onClose={() => setIsSnapshotsModalOpen(false)}
                snapshots={snapshots}
                currentBaselineId={baselineSnapshot?.id ?? null}
                onSelectBaseline={handleSelectBaseline}
                onDeleteSnapshot={handleDeleteSnapshot}
                onTogglePinSnapshot={handleTogglePinSnapshot}
                onSaveCurrent={handleSaveCurrentSnapshot}
                canSaveCurrent={!!plan}
            />

            <div className="flex-1 overflow-hidden min-h-0">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted">
                        <Loader2 size={24} className="animate-spin" />
                        <span className="text-sm">{t('editor.visualExplain.loading')}</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 px-8">
                        <div className="text-error-text text-sm text-center max-w-lg">{error}</div>
                    </div>
                ) : plan && metrics && diagnostics ? (
                    viewMode === 'raw' ? (
                        <div className="flex flex-col h-full min-h-0">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-default bg-base/40">
                                <span className="text-xs font-mono uppercase text-muted">
                                    {rawFormatLabel}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleSaveRaw}
                                    disabled={!plan.raw_output || isSaving}
                                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-default bg-surface hover:bg-surface-secondary text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                    title={t('editor.visualExplain.saveRawPlan')}
                                    aria-label={t('editor.visualExplain.saveRawPlan')}
                                >
                                    <Download size={14} className="text-secondary" />
                                    <span>{t('editor.visualExplain.saveRawPlan')}</span>
                                </button>
                            </div>
                            <div className="flex-1 min-h-0">
                                {plan.raw_output ? (
                                    <MonacoEditor
                                        height="100%"
                                        language={rawLanguage}
                                        theme={getMonacoThemeId(editorTheme.id)}
                                        value={rawValue}
                                        beforeMount={handleBeforeMount}
                                        options={{
                                            readOnly: true,
                                            minimap: {enabled: false},
                                            scrollBeyondLastLine: false,
                                            fontSize: 12,
                                            wordWrap: 'on',
                                        }}
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-xs text-muted">
                                        {t('editor.visualExplain.noRawOutput')}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : viewMode === 'ai' ? (
                        <ExplainAiAnalysis plan={plan} />
                    ) : viewMode === 'table' ? (
                        <ExplainTableView
                            plan={plan}
                            metrics={metrics}
                            diagnostics={diagnostics}
                            selectedId={selectedNodeId}
                            onSelect={onSelectNode}
                            onExportCsv={handleExportCsv}
                            isExportingCsv={isExportingCsv}
                            columnOrder={columnOrder}
                            onColumnOrderChange={handleColumnOrderChange}
                        />
                    ) : viewMode === 'diagram' ? (
                        <ExplainDiagramView
                            plan={plan}
                            metrics={metrics}
                            diagnostics={diagnostics}
                            selectedId={selectedNodeId}
                            onSelect={onSelectNode}
                        />
                    ) : viewMode === 'stats' ? (
                        <ExplainStatsView plan={plan} metrics={metrics} />
                    ) : (
                        <div className="flex h-full">
                            <div className="flex-1 min-w-0 border-r border-default">
                                <ExplainGraph
                                    plan={plan}
                                    metrics={metrics}
                                    diagnostics={diagnostics}
                                    selectedNodeId={selectedNodeId}
                                    onSelectNode={onSelectNode}
                                />
                            </div>
                            <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
                                <ExplainNodeDetails
                                    node={selectedNode}
                                    hasAnalyzeData={plan.has_analyze_data}
                                    metrics={
                                        selectedNode
                                            ? (metrics.byId.get(selectedNode.id) ?? null)
                                            : null
                                    }
                                    diagnostics={
                                        selectedNode ? (diagnostics.get(selectedNode.id) ?? []) : []
                                    }
                                />
                            </div>
                        </div>
                    )
                ) : null}
            </div>
        </div>
    );
};
