import {useState, useCallback, useEffect, useMemo, useRef} from 'react';
import type {KeyboardEvent, MouseEvent, ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronRight, ChevronDown, Download, RotateCcw} from 'lucide-react';
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
import type {ExplainTableRowData} from '../plan';
import {
    EXPLAIN_TABLE_ANALYZE_COLUMNS,
    EXPLAIN_TABLE_COLUMNS,
    isDefaultExplainTableColumnOrder,
    moveExplainTableColumn,
    normalizeExplainTableColumnOrder,
    shiftExplainTableColumn,
    type ExplainTableColumnId,
} from '../tableColumns';
import {ExplainDiagnosticChips} from './ExplainDiagnosticChips';
import {ExplainNodeDetails} from './ExplainNodeDetails';
import {startColumnDrag} from './columnDrag';

export interface ExplainTableViewProps {
    plan: ExplainPlan;
    metrics: ExplainMetrics;
    diagnostics: Map<string, ExplainDiagnostic[]>;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onExportCsv?: () => void;
    isExportingCsv?: boolean;
    /**
     * Column order, `#` excluded. Without it the view keeps its own order,
     * which is lost when it unmounts; pass it with `onColumnOrderChange` to keep
     * the user's order.
     */
    columnOrder?: readonly ExplainTableColumnId[];
    onColumnOrderChange?: (order: readonly ExplainTableColumnId[]) => void;
}

const COLUMN_LABEL_KEYS: Record<ExplainTableColumnId, string> = {
    operation: 'editor.visualExplain.nodeType',
    relation: 'editor.visualExplain.relation',
    cost: 'editor.visualExplain.cost',
    estRows: 'editor.visualExplain.estRows',
    actualRows: 'editor.visualExplain.actualRows',
    loops: 'editor.visualExplain.loops',
    selfTime: 'editor.visualExplain.selfTime',
    estimateGap: 'editor.visualExplain.largestEstimateGap',
    filter: 'editor.visualExplain.filter',
};

const LEFT_ALIGNED_COLUMNS: ReadonlySet<ExplainTableColumnId> = new Set([
    'operation',
    'relation',
    'filter',
]);

export function ExplainTableView({
    plan,
    metrics,
    diagnostics,
    selectedId,
    onSelect,
    onExportCsv,
    isExportingCsv,
    columnOrder,
    onColumnOrderChange,
}: ExplainTableViewProps) {
    const {t} = useTranslation();
    const [ownColumnOrder, setOwnColumnOrder] =
        useState<readonly ExplainTableColumnId[]>(EXPLAIN_TABLE_COLUMNS);
    const order = useMemo(
        () => normalizeExplainTableColumnOrder(columnOrder ?? ownColumnOrder),
        [columnOrder, ownColumnOrder],
    );
    const visibleColumns = useMemo(
        () => order.filter((id) => plan.has_analyze_data || !EXPLAIN_TABLE_ANALYZE_COLUMNS.has(id)),
        [order, plan.has_analyze_data],
    );
    const isDefaultOrder = isDefaultExplainTableColumnOrder(order);
    const [draggedColumn, setDraggedColumn] = useState<ExplainTableColumnId | null>(null);
    const [dropTarget, setDropTarget] = useState<ExplainTableColumnId | null>(null);

    const changeOrder = useCallback(
        (next: readonly ExplainTableColumnId[]) => {
            if (next === order) return;
            setOwnColumnOrder(next);
            onColumnOrderChange?.(next);
        },
        [order, onColumnOrderChange],
    );

    const headerRowRef = useRef<HTMLTableRowElement>(null);

    /** The movable column whose header spans `x`, if any. */
    const columnAt = useCallback((x: number): ExplainTableColumnId | null => {
        const headers = headerRowRef.current?.querySelectorAll<HTMLElement>('th[data-column]');
        for (const header of headers ?? []) {
            const rect = header.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right) {
                return header.dataset.column as ExplainTableColumnId;
            }
        }
        return null;
    }, []);

    const handleHeaderMouseDown = useCallback(
        (event: MouseEvent<HTMLElement>, column: ExplainTableColumnId) => {
            if (event.button !== 0) return;
            let target: ExplainTableColumnId | null = null;
            startColumnDrag(event.clientX, event.clientY, {
                onDragStart: () => setDraggedColumn(column),
                onDragMove: (x) => {
                    target = columnAt(x);
                    setDropTarget(target);
                },
                onDrop: () => {
                    if (target) changeOrder(moveExplainTableColumn(order, column, target));
                },
                onEnd: () => {
                    setDraggedColumn(null);
                    setDropTarget(null);
                },
            });
        },
        [changeOrder, columnAt, order],
    );

    const handleHeaderKeyDown = useCallback(
        (event: KeyboardEvent<HTMLButtonElement>, column: ExplainTableColumnId) => {
            if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
            event.preventDefault();
            changeOrder(
                shiftExplainTableColumn(
                    order,
                    column,
                    event.key === 'ArrowLeft' ? -1 : 1,
                    visibleColumns,
                ),
            );
        },
        [changeOrder, order, visibleColumns],
    );
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
                {(onExportCsv || !isDefaultOrder) && (
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-default bg-base/50 text-xs shrink-0">
                        <span className="text-muted font-medium">
                            {t('editor.visualExplain.tableTitle', 'Plan Tree')}
                        </span>
                        <div className="flex items-center gap-1">
                            {!isDefaultOrder && (
                                <button
                                    type="button"
                                    onClick={() => changeOrder(EXPLAIN_TABLE_COLUMNS)}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-secondary hover:text-primary hover:bg-surface-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                >
                                    <RotateCcw size={13} aria-hidden="true" />
                                    <span>
                                        {t(
                                            'editor.visualExplain.resetColumnOrder',
                                            'Reset column order',
                                        )}
                                    </span>
                                </button>
                            )}
                            {onExportCsv && (
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
                            )}
                        </div>
                    </div>
                )}
                <div className="flex-1 overflow-auto min-h-0">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-base border-b border-default">
                            <tr ref={headerRowRef}>
                                <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                                    #
                                </th>
                                {visibleColumns.map((column) => (
                                    <th
                                        key={column}
                                        data-column={column}
                                        className={clsx(
                                            'px-3 py-2 text-muted font-semibold whitespace-nowrap transition-colors',
                                            LEFT_ALIGNED_COLUMNS.has(column)
                                                ? 'text-left'
                                                : 'text-right',
                                            draggedColumn === column && 'opacity-50',
                                            dropTarget === column &&
                                                draggedColumn !== column &&
                                                'bg-accent-primary/15',
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onMouseDown={(event) =>
                                                handleHeaderMouseDown(event, column)
                                            }
                                            onKeyDown={(event) =>
                                                handleHeaderKeyDown(event, column)
                                            }
                                            title={t(
                                                'editor.visualExplain.moveColumnHint',
                                                'Drag to reorder, or press Alt+Left / Alt+Right',
                                            )}
                                            className="cursor-grab font-semibold rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                        >
                                            {t(COLUMN_LABEL_KEYS[column])}
                                        </button>
                                    </th>
                                ))}
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
                                columns={visibleColumns}
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
    columns: readonly ExplainTableColumnId[];
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
    columns,
}: TreeRowsProps) {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedId === node.id;
    const nodeMetrics: ExplainNodeMetrics | undefined = metrics.byId.get(node.id);
    const nodeDiagnostics = diagnostics.get(node.id) ?? [];

    const row = getExplainTableRow(node, hasAnalyzeData, nodeMetrics);

    const cells: Record<ExplainTableColumnId, () => ReactNode> = {
        operation: () => (
            <td key="operation" className="px-3 py-1.5 whitespace-nowrap">
                <div className="flex items-center gap-1" style={{paddingLeft: `${depth * 20}px`}}>
                    {hasChildren ? (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggle(node.id);
                            }}
                            className="p-0.5 text-muted hover:text-primary"
                        >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
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
        ),
        relation: () => (
            <td key="relation" className="px-3 py-1.5 text-secondary whitespace-nowrap">
                {row.relation ?? ''}
            </td>
        ),
        cost: () => <NumberCell key="cost" value={formatRowCost(row)} />,
        estRows: () => (
            <NumberCell
                key="estRows"
                value={row.planRows != null ? formatRows(row.planRows) : '-'}
            />
        ),
        actualRows: () => (
            <NumberCell
                key="actualRows"
                value={row.actualRows != null ? formatRows(row.actualRows) : '-'}
            />
        ),
        loops: () => (
            <NumberCell
                key="loops"
                value={row.actualLoops != null ? formatRows(row.actualLoops) : '-'}
                title={row.actualLoops != null ? String(row.actualLoops) : undefined}
            />
        ),
        selfTime: () => (
            <NumberCell
                key="selfTime"
                value={row.exclusiveTimeMs != null ? formatTime(row.exclusiveTimeMs) : '-'}
            />
        ),
        estimateGap: () => (
            <td key="estimateGap" className="px-3 py-1.5 text-right whitespace-nowrap">
                <span
                    className={clsx(
                        'font-mono',
                        row.estimateGap != null && row.estimateGap >= 4
                            ? 'text-amber-300'
                            : 'text-secondary',
                    )}
                >
                    {row.estimateGap != null ? formatRatio(row.estimateGap) : '-'}
                </span>
            </td>
        ),
        filter: () => (
            <td key="filter" className="px-3 py-1.5 text-muted truncate max-w-[200px]">
                {row.filter ?? ''}
            </td>
        ),
    };

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
                {columns.map((column) => cells[column]())}
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
                        columns={columns}
                    />
                ))}
        </>
    );
}

function formatRowCost(row: ExplainTableRowData): string {
    if (row.startupCost != null && row.totalCost != null) {
        return `${formatCost(row.startupCost)} - ${formatCost(row.totalCost)}`;
    }
    return row.totalCost != null ? formatCost(row.totalCost) : '-';
}

function NumberCell({value, title}: {value: string; title?: string}) {
    return (
        <td
            className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap"
            title={title}
        >
            {value}
        </td>
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
