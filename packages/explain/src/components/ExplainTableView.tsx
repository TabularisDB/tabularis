import {useState, useCallback, useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronRight, ChevronDown, Download} from 'lucide-react';
import clsx from 'clsx';
import type {ExplainNode, ExplainPlan} from '../types';
import type {ExplainMetrics, ExplainNodeMetrics} from '../metrics';
import type {ExplainDiagnostic} from '../diagnostics';
import {
    findExplainNode,
    formatCost,
    formatRatio,
    formatRows,
    formatTime,
    getExplainTableRow,
} from '../plan';
import {ExplainDiagnosticChips} from './ExplainDiagnosticChips';
import {ExplainNodeDetails} from './ExplainNodeDetails';

export interface ExplainTableViewProps {
    plan: ExplainPlan;
    metrics: ExplainMetrics;
    diagnostics: Map<string, ExplainDiagnostic[]>;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onExportCsv?: () => void;
    isExportingCsv?: boolean;
}

export function ExplainTableView({
    plan,
    metrics,
    diagnostics,
    selectedId,
    onSelect,
    onExportCsv,
    isExportingCsv,
}: ExplainTableViewProps) {
    const {t} = useTranslation();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
        collectExpandedIds(plan.root),
    );

    useEffect(() => {
        setExpandedIds(collectExpandedIds(plan.root));
    }, [plan]);

    const toggleExpand = useCallback((id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const selectedNode = findExplainNode(plan.root, selectedId);

    return (
        <div className="flex h-full">
            <div className="flex-1 flex flex-col min-w-0 border-r border-default">
                {onExportCsv && (
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-default bg-base/50 text-xs shrink-0">
                        <span className="text-muted font-medium">
                            {t('editor.visualExplain.tableTitle', 'Plan Tree')}
                        </span>
                        <button
                            type="button"
                            onClick={onExportCsv}
                            disabled={isExportingCsv}
                            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-secondary hover:text-primary hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                            aria-label={t('editor.visualExplain.exportCsv', 'Export CSV')}
                            title={t('editor.visualExplain.exportCsv', 'Export CSV')}
                        >
                            <Download size={13} aria-hidden="true" />
                            <span>
                                {isExportingCsv
                                    ? t('editor.visualExplain.exportingCsv', 'Exporting...')
                                    : t('editor.visualExplain.exportCsv', 'Export CSV')}
                            </span>
                        </button>
                    </div>
                )}
                <div className="flex-1 overflow-auto min-h-0">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-base border-b border-default">
                            <tr>
                                <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    #
                                </th>
                                <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.nodeType')}
                                </th>
                                <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.relation')}
                                </th>
                                <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.cost')}
                                </th>
                                <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.estRows')}
                                </th>
                                {plan.has_analyze_data && (
                                    <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                        {t('editor.visualExplain.actualRows')}
                                    </th>
                                )}
                                <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.selfTime')}
                                </th>
                                <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.largestEstimateGap')}
                                </th>
                                <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    {t('editor.visualExplain.filter')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <TreeRows
                                node={plan.root}
                                depth={0}
                                expandedIds={expandedIds}
                                selectedId={selectedId}
                                onToggle={toggleExpand}
                                onSelect={onSelect}
                                hasAnalyzeData={plan.has_analyze_data}
                                metrics={metrics}
                                diagnostics={diagnostics}
                            />
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
                <ExplainNodeDetails
                    node={selectedNode}
                    hasAnalyzeData={plan.has_analyze_data}
                    metrics={selectedNode ? (metrics.byId.get(selectedNode.id) ?? null) : null}
                    diagnostics={selectedNode ? (diagnostics.get(selectedNode.id) ?? []) : []}
                />
            </div>
        </div>
    );
}

interface TreeRowsProps {
    node: ExplainNode;
    depth: number;
    expandedIds: Set<string>;
    selectedId: string | null;
    onToggle: (id: string) => void;
    onSelect: (id: string) => void;
    hasAnalyzeData: boolean;
    metrics: ExplainMetrics;
    diagnostics: Map<string, ExplainDiagnostic[]>;
}

function TreeRows({
    node,
    depth,
    expandedIds,
    selectedId,
    onToggle,
    onSelect,
    hasAnalyzeData,
    metrics,
    diagnostics,
}: TreeRowsProps) {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedId === node.id;
    const nodeMetrics: ExplainNodeMetrics | undefined = metrics.byId.get(node.id);
    const nodeDiagnostics = diagnostics.get(node.id) ?? [];

    const row = getExplainTableRow(node, hasAnalyzeData, nodeMetrics);

    const costStr =
        row.startupCost != null && row.totalCost != null
            ? `${formatCost(row.startupCost)} - ${formatCost(row.totalCost)}`
            : row.totalCost != null
              ? formatCost(row.totalCost)
              : '-';

    const timeStr = row.exclusiveTimeMs != null ? formatTime(row.exclusiveTimeMs) : '-';

    const rowsStr = row.planRows != null ? formatRows(row.planRows) : '-';
    const actualRowsStr = row.actualRows != null ? formatRows(row.actualRows) : '-';
    const ratioStr = row.estimateGap != null ? formatRatio(row.estimateGap) : '-';

    return (
        <>
            <tr
                className={clsx(
                    'cursor-pointer transition-colors border-b border-default/30',
                    isSelected ? 'bg-blue-900/30' : 'hover:bg-surface-hover',
                )}
                onClick={() => onSelect(node.id)}
            >
                <td className="px-3 py-1.5 font-mono text-[10px] text-muted whitespace-nowrap">
                    {nodeMetrics ? `#${nodeMetrics.index}` : ''}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                    <div
                        className="flex items-center gap-1"
                        style={{paddingLeft: `${depth * 20}px`}}
                    >
                        {hasChildren ? (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggle(node.id);
                                }}
                                className="p-0.5 text-muted hover:text-primary"
                            >
                                {isExpanded ? (
                                    <ChevronDown size={12} />
                                ) : (
                                    <ChevronRight size={12} />
                                )}
                            </button>
                        ) : (
                            <span className="w-4" />
                        )}
                        <span className="text-primary font-medium">{node.node_type}</span>
                        {nodeDiagnostics.length > 0 && (
                            <ExplainDiagnosticChips diagnostics={nodeDiagnostics} iconsOnly />
                        )}
                    </div>
                </td>
                <td className="px-3 py-1.5 text-secondary whitespace-nowrap">
                    {row.relation ?? ''}
                </td>
                <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
                    {costStr}
                </td>
                <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
                    {rowsStr}
                </td>
                {hasAnalyzeData && (
                    <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
                        {actualRowsStr}
                    </td>
                )}
                <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
                    {timeStr}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <span
                        className={clsx(
                            'font-mono',
                            row.estimateGap != null && row.estimateGap >= 4
                                ? 'text-amber-300'
                                : 'text-secondary',
                        )}
                    >
                        {ratioStr}
                    </span>
                </td>
                <td className="px-3 py-1.5 text-muted truncate max-w-[200px]">
                    {row.filter ?? ''}
                </td>
            </tr>
            {isExpanded &&
                node.children.map((child) => (
                    <TreeRows
                        key={child.id}
                        node={child}
                        depth={depth + 1}
                        expandedIds={expandedIds}
                        selectedId={selectedId}
                        onToggle={onToggle}
                        onSelect={onSelect}
                        hasAnalyzeData={hasAnalyzeData}
                        metrics={metrics}
                        diagnostics={diagnostics}
                    />
                ))}
        </>
    );
}

function collectExpandedIds(root: ExplainNode): Set<string> {
    const ids = new Set<string>();

    function walk(node: ExplainNode) {
        ids.add(node.id);
        for (const child of node.children) {
            walk(child);
        }
    }

    walk(root);

    return ids;
}
