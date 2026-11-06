import {useState, useMemo, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {
    AlertTriangle,
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    CheckCircle2,
    Clock,
    DollarSign,
    Download,
    HelpCircle,
    Layers,
    Minus,
    Pin,
    Plus,
    Trash2,
    Upload,
} from 'lucide-react';
import type {ExplainPlan} from '../types';
import {deserializeExplainSnapshot, type ExplainSnapshot} from '../snapshot';
import {
    compareExplainPlans,
    type ExplainAlignedNode,
    type ExplainMetricDelta,
    type ExplainNodeDiffStatus,
} from '../compare';
import {formatCost, formatRows, formatTime} from '../plan';

export interface ExplainCompareViewProps {
    baseline: ExplainSnapshot | ExplainPlan | null;
    current: ExplainPlan;
    baselineName?: string;
    snapshots?: readonly ExplainSnapshot[];
    onSelectBaseline?: (id: string) => void;
    onSaveSnapshot?: () => void;
    onDeleteSnapshot?: (id: string) => void;
    onTogglePinSnapshot?: (id: string) => void;
    onExportSnapshot?: (id: string) => void;
    onImportSnapshot?: (snapshot: ExplainSnapshot) => void;
}

export function ExplainCompareView({
    baseline,
    current,
    baselineName,
    snapshots = [],
    onSelectBaseline,
    onSaveSnapshot,
    onDeleteSnapshot,
    onTogglePinSnapshot,
    onExportSnapshot,
    onImportSnapshot,
}: ExplainCompareViewProps) {
    const {t} = useTranslation();
    const [subTab, setSubTab] = useState<'operators' | 'raw' | 'snapshots'>('operators');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const baselineSnapshot = baseline && 'plan' in baseline ? (baseline as ExplainSnapshot) : null;
    const resolvedBaselinePlan = baselineSnapshot
        ? baselineSnapshot.plan
        : (baseline as ExplainPlan | null);

    const comparison = useMemo(() => {
        if (!resolvedBaselinePlan) return null;
        return compareExplainPlans(baselineSnapshot ?? resolvedBaselinePlan, current, {
            baselineEngine: baselineSnapshot?.context.engine ?? resolvedBaselinePlan.driver,
            currentEngine: current.driver,
        });
    }, [baselineSnapshot, resolvedBaselinePlan, current]);

    const filteredNodes = useMemo(() => {
        if (!comparison) return [];
        if (statusFilter === 'all') return comparison.alignedNodes;
        return comparison.alignedNodes.filter((node) => node.status === statusFilter);
    }, [comparison, statusFilter]);

    if (!resolvedBaselinePlan) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
                <Layers size={36} className="text-muted" />
                <div className="max-w-md">
                    <h3 className="text-base font-semibold text-primary mb-1">
                        {t(
                            'editor.visualExplain.compare.noBaselineTitle',
                            'No Baseline Plan Selected',
                        )}
                    </h3>
                    <p className="text-xs text-muted mb-4">
                        {t(
                            'editor.visualExplain.compare.noBaselineHint',
                            'Save a snapshot of an execution plan to establish a baseline, or select an existing snapshot from your saved baselines.',
                        )}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                        {onSaveSnapshot && (
                            <button
                                type="button"
                                onClick={onSaveSnapshot}
                                className="px-3 py-1.5 text-xs font-medium rounded border border-default bg-surface hover:bg-surface-secondary text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                            >
                                {t(
                                    'editor.visualExplain.compare.saveCurrentAsBaseline',
                                    'Save current as baseline',
                                )}
                            </button>
                        )}
                        {snapshots.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setSubTab('snapshots')}
                                className="px-3 py-1.5 text-xs font-medium rounded border border-default bg-surface hover:bg-surface-secondary text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                            >
                                {t(
                                    'editor.visualExplain.compare.viewSavedSnapshots',
                                    'View saved snapshots ({{count}})',
                                    {
                                        count: snapshots.length,
                                    },
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0 text-xs">
            {/* Context & Sub-navigation Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-default bg-base/60">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className="text-muted font-medium">
                            {t('editor.visualExplain.compare.baseline', 'Baseline')}:
                        </span>
                        {snapshots.length > 0 && onSelectBaseline ? (
                            <select
                                value={baselineSnapshot?.id ?? ''}
                                onChange={(e) => onSelectBaseline(e.target.value)}
                                aria-label={t(
                                    'editor.visualExplain.compare.selectBaseline',
                                    'Select baseline plan',
                                )}
                                className="bg-surface border border-default text-primary rounded px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                            >
                                {!snapshots.some((s) => s.id === baselineSnapshot?.id) && (
                                    <option value="">
                                        {baselineSnapshot?.title ??
                                            baselineName ??
                                            t(
                                                'editor.visualExplain.compare.unnamedBaseline',
                                                'Baseline Plan',
                                            )}
                                    </option>
                                )}
                                {snapshots.map((snap) => (
                                    <option key={snap.id} value={snap.id}>
                                        {snap.title} ({snap.context.engine.toUpperCase()})
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span className="font-semibold text-primary">
                                {baselineSnapshot?.title ??
                                    baselineName ??
                                    t(
                                        'editor.visualExplain.compare.unnamedBaseline',
                                        'Baseline Plan',
                                    )}
                            </span>
                        )}
                    </div>

                    <ArrowRight size={14} className="text-muted" />

                    <div className="flex items-center gap-1.5">
                        <span className="text-muted font-medium">
                            {t('editor.visualExplain.compare.current', 'Current')}:
                        </span>
                        <span className="font-semibold text-primary">
                            {current.driver.toUpperCase()} (
                            {current.has_analyze_data ? 'ANALYZE' : 'ESTIMATE'})
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-surface-secondary rounded p-0.5">
                        <button
                            type="button"
                            onClick={() => setSubTab('operators')}
                            className={`px-2.5 py-1 rounded transition-colors ${
                                subTab === 'operators'
                                    ? 'bg-blue-900/40 text-blue-300 font-medium'
                                    : 'text-muted hover:text-primary'
                            }`}
                        >
                            {t('editor.visualExplain.compare.operatorsTab', 'Operators')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setSubTab('raw')}
                            className={`px-2.5 py-1 rounded transition-colors ${
                                subTab === 'raw'
                                    ? 'bg-blue-900/40 text-blue-300 font-medium'
                                    : 'text-muted hover:text-primary'
                            }`}
                        >
                            {t('editor.visualExplain.compare.rawDiffTab', 'Raw Diff')}
                        </button>
                        {snapshots.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setSubTab('snapshots')}
                                className={`px-2.5 py-1 rounded transition-colors ${
                                    subTab === 'snapshots'
                                        ? 'bg-blue-900/40 text-blue-300 font-medium'
                                        : 'text-muted hover:text-primary'
                                }`}
                            >
                                {t(
                                    'editor.visualExplain.compare.snapshotsTab',
                                    'Snapshots ({{count}})',
                                    {
                                        count: snapshots.length,
                                    },
                                )}
                            </button>
                        )}
                    </div>

                    {onSaveSnapshot && (
                        <button
                            type="button"
                            onClick={onSaveSnapshot}
                            className="px-2.5 py-1 rounded border border-default bg-surface hover:bg-surface-secondary text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                        >
                            {t('editor.visualExplain.compare.saveSnapshot', 'Save Snapshot')}
                        </button>
                    )}
                </div>
            </div>

            {/* Incompatibility Warnings & Mismatch Alerts */}
            {comparison && !comparison.engineCompatible && (
                <div className="flex items-start gap-2.5 p-3 m-3 rounded border border-yellow-800/50 bg-yellow-950/20 text-yellow-200">
                    <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                        <div className="font-semibold mb-0.5">
                            {t(
                                'editor.visualExplain.compare.incompatibleEngines',
                                'Incompatible Engine Types',
                            )}
                        </div>
                        <div className="text-xs text-yellow-300/90 leading-relaxed">
                            {comparison.incompatibilityReason}
                        </div>
                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={() => setSubTab('raw')}
                                className="underline hover:text-yellow-100"
                            >
                                {t(
                                    'editor.visualExplain.compare.switchToRawDiff',
                                    'Switch to raw text diff to inspect differences',
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {comparison &&
                comparison.engineCompatible &&
                comparison.analyzeKind === 'analyze_mismatch' && (
                    <div className="flex items-start gap-2.5 p-3 m-3 rounded border border-blue-800/40 bg-blue-950/20 text-blue-200">
                        <AlertTriangle size={16} className="text-blue-400 shrink-0 mt-0.5" />
                        <div className="text-xs leading-relaxed">
                            {comparison.analyzeMismatchNote}
                        </div>
                    </div>
                )}

            {/* Sub-view Content */}
            <div className="flex-1 overflow-auto min-h-0">
                {subTab === 'raw' ? (
                    <RawTextDiffViewer lines={comparison?.rawTextDiff ?? []} />
                ) : subTab === 'snapshots' ? (
                    <SnapshotsListView
                        snapshots={snapshots}
                        currentBaselineId={baselineSnapshot?.id}
                        onSelectBaseline={onSelectBaseline}
                        onDelete={onDeleteSnapshot}
                        onTogglePin={onTogglePinSnapshot}
                        onExport={onExportSnapshot}
                        onImport={onImportSnapshot}
                    />
                ) : (
                    <div className="p-4 space-y-4">
                        {/* Summary Delta Cards */}
                        {comparison?.engineCompatible && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <MetricDeltaCard
                                    title={t('editor.visualExplain.totalCost', 'Total Cost')}
                                    icon={<DollarSign size={14} className="text-muted" />}
                                    delta={comparison.summaryDeltas.totalCost}
                                    formatter={formatCost}
                                    lowerIsBetter={true}
                                />
                                <MetricDeltaCard
                                    title={t(
                                        'editor.visualExplain.executionTime',
                                        'Execution Time',
                                    )}
                                    icon={<Clock size={14} className="text-muted" />}
                                    delta={comparison.summaryDeltas.executionTime}
                                    formatter={formatTime}
                                    lowerIsBetter={true}
                                />
                                <MetricDeltaCard
                                    title={t('editor.visualExplain.planningTime', 'Planning Time')}
                                    icon={<Clock size={14} className="text-muted" />}
                                    delta={comparison.summaryDeltas.planningTime}
                                    formatter={formatTime}
                                    lowerIsBetter={true}
                                />
                            </div>
                        )}

                        {/* Filter Bar */}
                        <div className="flex items-center justify-between border-b border-default pb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-muted font-medium">
                                    {t('editor.visualExplain.compare.filter', 'Filter')}:
                                </span>
                                <div className="flex items-center gap-1 bg-surface-secondary rounded p-0.5">
                                    {[
                                        'all',
                                        'modified',
                                        'added',
                                        'removed',
                                        'unchanged',
                                        'ambiguous',
                                    ].map((filter) => (
                                        <button
                                            key={filter}
                                            type="button"
                                            onClick={() => setStatusFilter(filter)}
                                            className={`px-2 py-0.5 rounded capitalize ${
                                                statusFilter === filter
                                                    ? 'bg-surface text-primary font-medium'
                                                    : 'text-muted hover:text-primary'
                                            }`}
                                        >
                                            {filter}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <span className="text-muted text-xs font-mono">
                                {t(
                                    'editor.visualExplain.compare.operatorsCount',
                                    '{{count}} nodes',
                                    {
                                        count: filteredNodes.length,
                                    },
                                )}
                            </span>
                        </div>

                        {/* Operators Diff Table */}
                        <div className="border border-default rounded overflow-x-auto bg-surface">
                            <table className="w-full border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-default bg-base/50 text-muted font-semibold">
                                        <th className="p-2.5 w-28">
                                            {t('editor.visualExplain.compare.status', 'Status')}
                                        </th>
                                        <th className="p-2.5">
                                            {t('editor.visualExplain.nodeType', 'Operator')}
                                        </th>
                                        <th className="p-2.5">
                                            {t(
                                                'editor.visualExplain.relation',
                                                'Relation / Detail',
                                            )}
                                        </th>
                                        <th className="p-2.5 text-right">
                                            {t('editor.visualExplain.cost', 'Total Cost')}
                                        </th>
                                        <th className="p-2.5 text-right">
                                            {t('editor.visualExplain.selfCost', 'Self Cost')}
                                        </th>
                                        <th className="p-2.5 text-right">
                                            {t('editor.visualExplain.estRows', 'Rows')}
                                        </th>
                                        {comparison?.analyzeKind === 'both_analyzed' && (
                                            <th className="p-2.5 text-right">
                                                {t('editor.visualExplain.selfTime', 'Self Time')}
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredNodes.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="p-6 text-center text-muted">
                                                {t(
                                                    'editor.visualExplain.compare.noNodesMatched',
                                                    'No nodes match the selected filter',
                                                )}
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredNodes.map((node) => (
                                            <AlignedNodeRow
                                                key={node.id}
                                                node={node}
                                                showTime={
                                                    comparison?.analyzeKind === 'both_analyzed'
                                                }
                                            />
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatusBadge({status}: {status: ExplainNodeDiffStatus}) {
    switch (status) {
        case 'added':
            return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-950/40 border border-green-800/40 text-green-300">
                    <Plus size={10} /> Added
                </span>
            );
        case 'removed':
            return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-950/40 border border-red-800/40 text-red-300">
                    <Minus size={10} /> Removed
                </span>
            );
        case 'modified':
            return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-950/40 border border-amber-800/40 text-amber-300">
                    <ArrowRight size={10} /> Modified
                </span>
            );
        case 'ambiguous':
            return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-950/40 border border-purple-800/40 text-purple-300">
                    <HelpCircle size={10} /> Ambiguous
                </span>
            );
        case 'unchanged':
        default:
            return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-secondary border border-default text-muted">
                    <CheckCircle2 size={10} /> Unchanged
                </span>
            );
    }
}

function AlignedNodeRow({node, showTime}: {node: ExplainAlignedNode; showTime: boolean}) {
    const bNode = node.baselineNode;
    const cNode = node.currentNode;

    const opLabel = useMemo(() => {
        if (!bNode && cNode) return cNode.node_type;
        if (bNode && !cNode) return bNode.node_type;
        if (bNode && cNode) {
            if (bNode.node_type === cNode.node_type) return cNode.node_type;
            return `${bNode.node_type} → ${cNode.node_type}`;
        }
        return '-';
    }, [bNode, cNode]);

    const relLabel = useMemo(() => {
        const rel = cNode?.relation ?? bNode?.relation;
        const cond =
            cNode?.index_condition ?? cNode?.filter ?? bNode?.index_condition ?? bNode?.filter;
        if (rel && cond) return `${rel} (${cond})`;
        return rel || cond || '-';
    }, [bNode, cNode]);

    return (
        <tr className="border-b border-default/30 hover:bg-surface-secondary/40 transition-colors">
            <td className="p-2.5">
                <StatusBadge status={node.status} />
            </td>
            <td className="p-2.5 font-medium text-primary">
                <div>{opLabel}</div>
                {node.isAmbiguous && (
                    <div className="text-[10px] text-purple-400 mt-0.5">
                        Multiple candidate operators match this signature
                    </div>
                )}
            </td>
            <td className="p-2.5 text-secondary font-mono truncate max-w-xs" title={relLabel}>
                {relLabel}
            </td>
            <td className="p-2.5 text-right font-mono">
                <MetricCell delta={node.costDelta} formatter={formatCost} />
            </td>
            <td className="p-2.5 text-right font-mono">
                <MetricCell delta={node.selfCostDelta} formatter={formatCost} />
            </td>
            <td className="p-2.5 text-right font-mono">
                <MetricCell delta={node.rowsDelta} formatter={formatRows} />
            </td>
            {showTime && (
                <td className="p-2.5 text-right font-mono">
                    <MetricCell delta={node.selfTimeDelta} formatter={formatTime} />
                </td>
            )}
        </tr>
    );
}

function MetricCell({
    delta,
    formatter,
}: {
    delta: ExplainMetricDelta | null;
    formatter: (n: number) => string;
}) {
    if (!delta || (delta.baseline == null && delta.current == null)) {
        return <span className="text-muted">-</span>;
    }

    if (delta.baseline == null && delta.current != null) {
        return <span className="text-green-400 font-semibold">{formatter(delta.current)}</span>;
    }

    if (delta.baseline != null && delta.current == null) {
        return <span className="text-red-400 line-through">{formatter(delta.baseline)}</span>;
    }

    const c = delta.current!;
    const diff = delta.delta ?? 0;

    let deltaClass = 'text-muted';
    let icon = null;

    if (diff < -0.001) {
        deltaClass = 'text-green-400 font-medium';
        icon = <ArrowDownRight size={10} className="inline ml-0.5 text-green-400" />;
    } else if (diff > 0.001) {
        deltaClass = 'text-red-400 font-medium';
        icon = <ArrowUpRight size={10} className="inline ml-0.5 text-red-400" />;
    }

    return (
        <div className="flex flex-col items-end">
            <span className="text-primary">{formatter(c)}</span>
            {Math.abs(diff) > 0.001 && (
                <span className={`text-[10px] ${deltaClass}`}>
                    {diff > 0 ? '+' : ''}
                    {formatter(diff)} (
                    {delta.percentChange != null
                        ? `${delta.percentChange > 0 ? '+' : ''}${delta.percentChange}%`
                        : ''}
                    ){icon}
                </span>
            )}
        </div>
    );
}

function MetricDeltaCard({
    title,
    icon,
    delta,
    formatter,
    lowerIsBetter,
}: {
    title: string;
    icon: React.ReactNode;
    delta: ExplainMetricDelta | null;
    formatter: (n: number) => string;
    lowerIsBetter: boolean;
}) {
    if (!delta || delta.baseline == null || delta.current == null) {
        return (
            <div className="p-3 rounded border border-default bg-surface">
                <div className="flex items-center justify-between text-muted mb-1">
                    <span className="font-medium">{title}</span>
                    {icon}
                </div>
                <div className="text-xs text-muted">Unavailable</div>
            </div>
        );
    }

    const diff = delta.delta ?? 0;
    const isImproved = lowerIsBetter ? diff < -0.001 : diff > 0.001;
    const isRegressed = lowerIsBetter ? diff > 0.001 : diff < -0.001;

    let deltaColor = 'text-muted';
    if (isImproved) deltaColor = 'text-green-400';
    if (isRegressed) deltaColor = 'text-red-400';

    return (
        <div className="p-3 rounded border border-default bg-surface shadow-xs">
            <div className="flex items-center justify-between text-muted mb-1">
                <span className="font-medium">{title}</span>
                {icon}
            </div>
            <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold font-mono text-primary">
                    {formatter(delta.current)}
                </span>
                <span className="text-xs font-mono text-muted line-through">
                    {formatter(delta.baseline)}
                </span>
            </div>
            {Math.abs(diff) > 0.001 && (
                <div
                    className={`mt-1 text-xs font-mono font-medium flex items-center gap-1 ${deltaColor}`}
                >
                    {diff > 0 ? '+' : ''}
                    {formatter(diff)} (
                    {delta.percentChange != null
                        ? `${delta.percentChange > 0 ? '+' : ''}${delta.percentChange}%`
                        : ''}
                    ){isImproved ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                </div>
            )}
        </div>
    );
}

function RawTextDiffViewer({
    lines,
}: {
    lines: readonly {
        type: string;
        baselineLineNumber: number | null;
        currentLineNumber: number | null;
        text: string;
    }[];
}) {
    if (lines.length === 0) {
        return (
            <div className="p-8 text-center text-muted text-xs">
                No raw EXPLAIN output available to diff.
            </div>
        );
    }

    return (
        <div className="p-4 font-mono text-xs overflow-x-auto select-text">
            <div className="border border-default rounded bg-base/50 divide-y divide-default/20">
                {lines.map((line, idx) => {
                    let bg = '';
                    let textClass = 'text-primary';
                    let prefix = ' ';

                    if (line.type === 'added') {
                        bg = 'bg-green-950/25';
                        textClass = 'text-green-300 font-medium';
                        prefix = '+';
                    } else if (line.type === 'removed') {
                        bg = 'bg-red-950/25';
                        textClass = 'text-red-300 font-medium';
                        prefix = '-';
                    }

                    return (
                        <div key={idx} className={`flex items-start px-2 py-0.5 ${bg}`}>
                            <span className="w-10 shrink-0 text-right pr-2 text-muted select-none">
                                {line.baselineLineNumber ?? ''}
                            </span>
                            <span className="w-10 shrink-0 text-right pr-2 text-muted select-none border-r border-default/40">
                                {line.currentLineNumber ?? ''}
                            </span>
                            <span className="w-6 shrink-0 text-center font-bold select-none text-muted">
                                {prefix}
                            </span>
                            <span className={`flex-1 whitespace-pre-wrap break-all ${textClass}`}>
                                {line.text}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SnapshotsListView({
    snapshots,
    currentBaselineId,
    onSelectBaseline,
    onDelete,
    onTogglePin,
    onExport,
    onImport,
}: {
    snapshots: readonly ExplainSnapshot[];
    currentBaselineId?: string;
    onSelectBaseline?: (id: string) => void;
    onDelete?: (id: string) => void;
    onTogglePin?: (id: string) => void;
    onExport?: (id: string) => void;
    onImport?: (snapshot: ExplainSnapshot) => void;
}) {
    const {t} = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target?.result;
                if (typeof text === 'string') {
                    const snap = deserializeExplainSnapshot(text);
                    onImport?.(snap);
                }
            } catch (err) {
                console.error('Failed to import explain snapshot:', err);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="p-4 max-w-4xl mx-auto space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-default">
                <div className="flex items-center gap-3">
                    <span className="font-semibold text-primary">
                        {t('editor.visualExplain.compare.savedSnapshots', 'Saved Snapshots')} (
                        {snapshots.length})
                    </span>
                    <span className="text-muted text-[11px]">
                        {t(
                            'editor.visualExplain.compare.pinHint',
                            'Pinned snapshots are exempt from retention limits',
                        )}
                    </span>
                </div>

                {onImport && (
                    <div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept=".json,application/json"
                            className="hidden"
                            onChange={handleFileInputChange}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-default bg-surface hover:bg-surface-secondary text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                            title={t(
                                'editor.visualExplain.compare.importSnapshot',
                                'Import snapshot JSON',
                            )}
                            aria-label={t(
                                'editor.visualExplain.compare.importSnapshot',
                                'Import snapshot JSON',
                            )}
                        >
                            <Upload size={12} />
                            <span>
                                {t('editor.visualExplain.compare.importSnapshot', 'Import JSON')}
                            </span>
                        </button>
                    </div>
                )}
            </div>

            {snapshots.length === 0 ? (
                <div className="p-8 text-center text-muted">
                    {t('editor.visualExplain.compare.noSnapshotsSaved', 'No snapshots saved yet')}
                </div>
            ) : (
                <div className="space-y-2">
                    {snapshots.map((snap) => {
                        const isCurrent = snap.id === currentBaselineId;
                        return (
                            <div
                                key={snap.id}
                                className={`flex items-center justify-between p-3 rounded border transition-colors ${
                                    isCurrent
                                        ? 'border-blue-500/60 bg-blue-950/20'
                                        : 'border-default bg-surface hover:bg-surface-secondary/40'
                                }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-primary truncate">
                                            {snap.title}
                                        </span>
                                        {isCurrent && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-900/50 text-blue-300">
                                                {t(
                                                    'editor.visualExplain.compare.activeBaseline',
                                                    'Active Baseline',
                                                )}
                                            </span>
                                        )}
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-surface-secondary text-muted">
                                            {snap.context.engine}
                                        </span>
                                    </div>
                                    <div className="text-muted text-[11px] truncate font-mono">
                                        {snap.sql}
                                    </div>
                                    <div className="text-muted text-[10px] mt-1">
                                        {new Date(snap.createdAt).toLocaleString()} ·{' '}
                                        {snap.context.database ?? 'default db'}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 ml-4 shrink-0">
                                    {onTogglePin && (
                                        <button
                                            type="button"
                                            onClick={() => onTogglePin(snap.id)}
                                            className={`p-1.5 rounded transition-colors ${
                                                snap.isPinned
                                                    ? 'text-yellow-400 bg-yellow-950/30'
                                                    : 'text-muted hover:text-primary'
                                            }`}
                                            title={
                                                snap.isPinned
                                                    ? t(
                                                          'editor.visualExplain.compare.unpinSnapshot',
                                                          'Unpin snapshot',
                                                      )
                                                    : t(
                                                          'editor.visualExplain.compare.pinSnapshot',
                                                          'Pin snapshot',
                                                      )
                                            }
                                            aria-label={
                                                snap.isPinned
                                                    ? t(
                                                          'editor.visualExplain.compare.unpinSnapshot',
                                                          'Unpin snapshot',
                                                      )
                                                    : t(
                                                          'editor.visualExplain.compare.pinSnapshot',
                                                          'Pin snapshot',
                                                      )
                                            }
                                        >
                                            <Pin
                                                size={14}
                                                className={snap.isPinned ? 'fill-yellow-400' : ''}
                                            />
                                        </button>
                                    )}
                                    {!isCurrent && onSelectBaseline && (
                                        <button
                                            type="button"
                                            onClick={() => onSelectBaseline(snap.id)}
                                            className="px-2.5 py-1 text-xs rounded border border-default bg-surface hover:bg-surface-secondary text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                                        >
                                            {t(
                                                'editor.visualExplain.compare.setAsBaseline',
                                                'Set as baseline',
                                            )}
                                        </button>
                                    )}
                                    {onExport && (
                                        <button
                                            type="button"
                                            onClick={() => onExport(snap.id)}
                                            className="p-1.5 rounded text-muted hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                                            title={t(
                                                'editor.visualExplain.compare.exportSnapshot',
                                                'Export snapshot JSON',
                                            )}
                                            aria-label={t(
                                                'editor.visualExplain.compare.exportSnapshot',
                                                'Export snapshot JSON',
                                            )}
                                        >
                                            <Download size={14} />
                                        </button>
                                    )}
                                    {onDelete && (
                                        <button
                                            type="button"
                                            onClick={() => onDelete(snap.id)}
                                            className="p-1.5 rounded text-muted hover:text-red-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                                            title={t(
                                                'editor.visualExplain.compare.deleteSnapshot',
                                                'Delete snapshot',
                                            )}
                                            aria-label={t(
                                                'editor.visualExplain.compare.deleteSnapshot',
                                                'Delete snapshot',
                                            )}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
