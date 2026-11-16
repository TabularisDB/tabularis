import type {ExplainNode, ExplainPlan} from './types';
import type {ExplainNodeMetrics} from './metrics';

export interface ExplainSnapshotContext {
    connectionId?: string;
    connectionName?: string;
    databaseName?: string;
    schema?: string;
    engine: string;
    version?: string;
}

export interface ExplainSnapshot {
    id: string;
    name: string;
    createdAt: string;
    sql: string;
    context: ExplainSnapshotContext;
    hasAnalyzeData: boolean;
    planningTimeMs: number | null;
    executionTimeMs: number | null;
    totalCost: number | null;
    rawOutput: string | null;
    plan: ExplainPlan;
    isPinned?: boolean;
}

export interface NodeMetricDelta {
    baselineValue: number | null;
    currentValue: number | null;
    delta: number | null;
    ratio: number | null; // e.g. 1.5 = 50% increase, 0.8 = 20% decrease
}

export interface NodeComparison {
    baselineNodeId: string | null;
    currentNodeId: string | null;
    operatorChanged: boolean;
    baselineNodeType: string | null;
    currentNodeType: string | null;
    relation: string | null;
    status: 'matched' | 'added' | 'removed';
    costDelta: NodeMetricDelta;
    timeDelta: NodeMetricDelta;
    rowsDelta: NodeMetricDelta;
    isAmbiguous?: boolean;
}

export interface PlanComparisonResult {
    isCompatible: boolean;
    incompatibilityReason?: string;
    hasAnalyzeMismatch: boolean;
    baselineSnapshotId: string;
    currentSnapshotId: string;
    summary: {
        totalCostDelta: NodeMetricDelta;
        executionTimeDelta: NodeMetricDelta;
        planningTimeDelta: NodeMetricDelta;
        nodesAdded: number;
        nodesRemoved: number;
        operatorsChanged: number;
    };
    nodeComparisons: NodeComparison[];
}

/**
 * Check engine compatibility between baseline and current plans/snapshots.
 * Costs and units are not comparable across different database engines.
 */
export function checkEngineCompatibility(
    baselineEngine: string,
    currentEngine: string,
): {compatible: boolean; reason?: string} {
    const b = (baselineEngine || '').toLowerCase().trim();
    const c = (currentEngine || '').toLowerCase().trim();

    if (b && c && b !== c) {
        return {
            compatible: false,
            reason: `Engines differ (${b} vs ${c}). Explain metrics and costs cannot be compared across different database engines.`,
        };
    }

    return {compatible: true};
}

/**
 * Calculate absolute and relative delta between two nullable metric numbers.
 */
export function calculateMetricDelta(
    baselineValue: number | null | undefined,
    currentValue: number | null | undefined,
): NodeMetricDelta {
    const b = baselineValue ?? null;
    const c = currentValue ?? null;

    if (b == null || c == null) {
        return {
            baselineValue: b,
            currentValue: c,
            delta: null,
            ratio: null,
        };
    }

    const delta = c - b;
    const ratio = b !== 0 ? c / b : null;

    return {
        baselineValue: b,
        currentValue: c,
        delta,
        ratio,
    };
}

interface FlattenedNode {
    node: ExplainNode;
    path: string; // e.g. "0.1.0"
    depth: number;
}

function flattenTree(root: ExplainNode, prefix = '0', depth = 0): FlattenedNode[] {
    const result: FlattenedNode[] = [{node: root, path: prefix, depth}];
    root.children.forEach((child, i) => {
        result.push(...flattenTree(child, `${prefix}.${i}`, depth + 1));
    });
    return result;
}

/**
 * Align nodes between baseline and current execution plans using deterministic heuristics:
 * 1. Exact tree path match if node types/relations match.
 * 2. Relation and operator matching within relative subtree depth.
 * 3. Identifies added and removed nodes without fabricating metrics.
 */
export function alignPlanNodes(
    baselineRoot: ExplainNode | null,
    currentRoot: ExplainNode | null,
    baselineMetrics?: Map<string, ExplainNodeMetrics>,
    currentMetrics?: Map<string, ExplainNodeMetrics>,
): NodeComparison[] {
    if (!baselineRoot && !currentRoot) return [];

    if (!baselineRoot && currentRoot) {
        const currentFlat = flattenTree(currentRoot);
        return currentFlat.map(({node}) => {
            const m = currentMetrics?.get(node.id);
            return {
                baselineNodeId: null,
                currentNodeId: node.id,
                operatorChanged: false,
                baselineNodeType: null,
                currentNodeType: node.node_type,
                relation: node.relation,
                status: 'added',
                costDelta: calculateMetricDelta(null, m?.totalCost ?? node.total_cost),
                timeDelta: calculateMetricDelta(null, m?.inclusiveTimeMs ?? node.actual_time_ms),
                rowsDelta: calculateMetricDelta(
                    null,
                    m?.totalRows ?? node.actual_rows ?? node.plan_rows,
                ),
            };
        });
    }

    if (baselineRoot && !currentRoot) {
        const baselineFlat = flattenTree(baselineRoot);
        return baselineFlat.map(({node}) => {
            const m = baselineMetrics?.get(node.id);
            return {
                baselineNodeId: node.id,
                currentNodeId: null,
                operatorChanged: false,
                baselineNodeType: node.node_type,
                currentNodeType: null,
                relation: node.relation,
                status: 'removed',
                costDelta: calculateMetricDelta(m?.totalCost ?? node.total_cost, null),
                timeDelta: calculateMetricDelta(m?.inclusiveTimeMs ?? node.actual_time_ms, null),
                rowsDelta: calculateMetricDelta(
                    m?.totalRows ?? node.actual_rows ?? node.plan_rows,
                    null,
                ),
            };
        });
    }

    const baselineFlat = flattenTree(baselineRoot!);
    const currentFlat = flattenTree(currentRoot!);

    const matchedCurrent = new Set<string>();
    const matchedBaseline = new Set<string>();
    const comparisons: NodeComparison[] = [];

    // Phase 1: Try path matching first
    const currentByPath = new Map(currentFlat.map((item) => [item.path, item]));
    for (const bItem of baselineFlat) {
        const cItem = currentByPath.get(bItem.path);
        if (cItem && !matchedCurrent.has(cItem.node.id)) {
            // Check if node types match or relations match
            const typeMatch = bItem.node.node_type === cItem.node.node_type;
            const relMatch = bItem.node.relation === cItem.node.relation;

            if (typeMatch || (bItem.node.relation && relMatch)) {
                matchedBaseline.add(bItem.node.id);
                matchedCurrent.add(cItem.node.id);

                const bM = baselineMetrics?.get(bItem.node.id);
                const cM = currentMetrics?.get(cItem.node.id);

                comparisons.push({
                    baselineNodeId: bItem.node.id,
                    currentNodeId: cItem.node.id,
                    operatorChanged: !typeMatch,
                    baselineNodeType: bItem.node.node_type,
                    currentNodeType: cItem.node.node_type,
                    relation: cItem.node.relation ?? bItem.node.relation,
                    status: 'matched',
                    costDelta: calculateMetricDelta(
                        bM?.totalCost ?? bItem.node.total_cost,
                        cM?.totalCost ?? cItem.node.total_cost,
                    ),
                    timeDelta: calculateMetricDelta(
                        bM?.inclusiveTimeMs ?? bItem.node.actual_time_ms,
                        cM?.inclusiveTimeMs ?? cItem.node.actual_time_ms,
                    ),
                    rowsDelta: calculateMetricDelta(
                        bM?.totalRows ?? bItem.node.actual_rows ?? bItem.node.plan_rows,
                        cM?.totalRows ?? cItem.node.actual_rows ?? cItem.node.plan_rows,
                    ),
                });
            }
        }
    }

    // Phase 2: Match remaining nodes by relation + operator
    for (const bItem of baselineFlat) {
        if (matchedBaseline.has(bItem.node.id)) continue;

        const candidate = currentFlat.find(
            (cItem) =>
                !matchedCurrent.has(cItem.node.id) &&
                bItem.node.relation &&
                bItem.node.relation === cItem.node.relation,
        );

        if (candidate) {
            matchedBaseline.add(bItem.node.id);
            matchedCurrent.add(candidate.node.id);

            const bM = baselineMetrics?.get(bItem.node.id);
            const cM = currentMetrics?.get(candidate.node.id);
            const typeMatch = bItem.node.node_type === candidate.node.node_type;

            comparisons.push({
                baselineNodeId: bItem.node.id,
                currentNodeId: candidate.node.id,
                operatorChanged: !typeMatch,
                baselineNodeType: bItem.node.node_type,
                currentNodeType: candidate.node.node_type,
                relation: candidate.node.relation,
                status: 'matched',
                isAmbiguous: true,
                costDelta: calculateMetricDelta(
                    bM?.totalCost ?? bItem.node.total_cost,
                    cM?.totalCost ?? candidate.node.total_cost,
                ),
                timeDelta: calculateMetricDelta(
                    bM?.inclusiveTimeMs ?? bItem.node.actual_time_ms,
                    cM?.inclusiveTimeMs ?? candidate.node.actual_time_ms,
                ),
                rowsDelta: calculateMetricDelta(
                    bM?.totalRows ?? bItem.node.actual_rows ?? bItem.node.plan_rows,
                    cM?.totalRows ?? candidate.node.actual_rows ?? candidate.node.plan_rows,
                ),
            });
        }
    }

    // Phase 3: Add remaining baseline as removed
    for (const bItem of baselineFlat) {
        if (!matchedBaseline.has(bItem.node.id)) {
            const bM = baselineMetrics?.get(bItem.node.id);
            comparisons.push({
                baselineNodeId: bItem.node.id,
                currentNodeId: null,
                operatorChanged: false,
                baselineNodeType: bItem.node.node_type,
                currentNodeType: null,
                relation: bItem.node.relation,
                status: 'removed',
                costDelta: calculateMetricDelta(bM?.totalCost ?? bItem.node.total_cost, null),
                timeDelta: calculateMetricDelta(
                    bM?.inclusiveTimeMs ?? bItem.node.actual_time_ms,
                    null,
                ),
                rowsDelta: calculateMetricDelta(
                    bM?.totalRows ?? bItem.node.actual_rows ?? bItem.node.plan_rows,
                    null,
                ),
            });
        }
    }

    // Phase 4: Add remaining current as added
    for (const cItem of currentFlat) {
        if (!matchedCurrent.has(cItem.node.id)) {
            const cM = currentMetrics?.get(cItem.node.id);
            comparisons.push({
                baselineNodeId: null,
                currentNodeId: cItem.node.id,
                operatorChanged: false,
                baselineNodeType: null,
                currentNodeType: cItem.node.node_type,
                relation: cItem.node.relation,
                status: 'added',
                costDelta: calculateMetricDelta(null, cM?.totalCost ?? cItem.node.total_cost),
                timeDelta: calculateMetricDelta(
                    null,
                    cM?.inclusiveTimeMs ?? cItem.node.actual_time_ms,
                ),
                rowsDelta: calculateMetricDelta(
                    null,
                    cM?.totalRows ?? cItem.node.actual_rows ?? cItem.node.plan_rows,
                ),
            });
        }
    }

    return comparisons;
}

/**
 * Compare two plan snapshots and produce a comprehensive comparison result.
 */
export function comparePlanSnapshots(
    baseline: ExplainSnapshot,
    current: ExplainSnapshot,
    baselineMetrics?: Map<string, ExplainNodeMetrics>,
    currentMetrics?: Map<string, ExplainNodeMetrics>,
): PlanComparisonResult {
    const engineCheck = checkEngineCompatibility(baseline.context.engine, current.context.engine);

    const hasAnalyzeMismatch = baseline.hasAnalyzeData !== current.hasAnalyzeData;

    const nodeComparisons = engineCheck.compatible
        ? alignPlanNodes(baseline.plan.root, current.plan.root, baselineMetrics, currentMetrics)
        : [];

    let nodesAdded = 0;
    let nodesRemoved = 0;
    let operatorsChanged = 0;

    for (const cmp of nodeComparisons) {
        if (cmp.status === 'added') nodesAdded++;
        if (cmp.status === 'removed') nodesRemoved++;
        if (cmp.status === 'matched' && cmp.operatorChanged) operatorsChanged++;
    }

    return {
        isCompatible: engineCheck.compatible,
        incompatibilityReason: engineCheck.reason,
        hasAnalyzeMismatch,
        baselineSnapshotId: baseline.id,
        currentSnapshotId: current.id,
        summary: {
            totalCostDelta: calculateMetricDelta(baseline.totalCost, current.totalCost),
            executionTimeDelta: calculateMetricDelta(
                baseline.executionTimeMs,
                current.executionTimeMs,
            ),
            planningTimeDelta: calculateMetricDelta(
                baseline.planningTimeMs,
                current.planningTimeMs,
            ),
            nodesAdded,
            nodesRemoved,
            operatorsChanged,
        },
        nodeComparisons,
    };
}
