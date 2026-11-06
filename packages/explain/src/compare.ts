import type {ExplainNode, ExplainPlan} from './types';
import type {ExplainMetrics, ExplainNodeMetrics} from './metrics';
import {computeExplainMetrics} from './metrics';
import type {ExplainSnapshot} from './snapshot';

export type ExplainNodeDiffStatus = 'unchanged' | 'modified' | 'added' | 'removed' | 'ambiguous';

export interface ExplainMetricDelta {
    baseline: number | null;
    current: number | null;
    delta: number | null;
    percentChange: number | null;
}

export interface ExplainAlignedNode {
    id: string;
    status: ExplainNodeDiffStatus;
    baselineNode: ExplainNode | null;
    currentNode: ExplainNode | null;
    baselineMetrics: ExplainNodeMetrics | null;
    currentMetrics: ExplainNodeMetrics | null;
    // Metric deltas
    costDelta: ExplainMetricDelta | null;
    selfCostDelta: ExplainMetricDelta | null;
    rowsDelta: ExplainMetricDelta | null;
    timeDelta: ExplainMetricDelta | null;
    selfTimeDelta: ExplainMetricDelta | null;
    buffersDelta: ExplainMetricDelta | null;
    // Match heuristics notes
    matchReason?: string;
    isAmbiguous?: boolean;
    ambiguousCandidates?: string[];
}

export type ExplainAnalyzeComparisonKind = 'both_analyzed' | 'both_estimated' | 'analyze_mismatch';

export interface RawTextDiffLine {
    type: 'same' | 'added' | 'removed';
    baselineLineNumber: number | null;
    currentLineNumber: number | null;
    text: string;
}

export interface ExplainPlanComparison {
    engineCompatible: boolean;
    incompatibilityReason?: string;
    baselineEngine: string;
    currentEngine: string;
    analyzeKind: ExplainAnalyzeComparisonKind;
    analyzeMismatchNote?: string;
    alignedNodes: ExplainAlignedNode[];
    unmatchedBaselineNodes: ExplainNode[];
    unmatchedCurrentNodes: ExplainNode[];
    ambiguousNodes: ExplainAlignedNode[];
    summaryDeltas: {
        totalCost: ExplainMetricDelta | null;
        executionTime: ExplainMetricDelta | null;
        planningTime: ExplainMetricDelta | null;
    };
    rawTextDiff: RawTextDiffLine[];
}

/**
 * Check whether two execution plan engines are compatible for cost/metric comparison.
 * Unlike database engines (e.g. Postgres vs MySQL vs SQLite) have fundamentally
 * incompatible cost models and units (page fetches vs abstract cost units vs opcode steps).
 */
export function checkEngineCompatibility(
    baselineEngine: string,
    currentEngine: string,
): {compatible: boolean; message?: string} {
    const normBase = (baselineEngine || '').toLowerCase().trim();
    const normCurr = (currentEngine || '').toLowerCase().trim();

    if (!normBase || !normCurr) {
        return {
            compatible: true,
        };
    }

    if (normBase !== normCurr) {
        return {
            compatible: false,
            message: `Incompatible database engines: baseline is "${normBase}" while current plan is "${normCurr}". Cost models and metric units cannot be compared across different engines.`,
        };
    }

    return {compatible: true};
}

/**
 * Check compatibility between estimated and analyzed execution plans.
 */
export function checkAnalyzeCompatibility(
    hasBaselineAnalyze: boolean,
    hasCurrentAnalyze: boolean,
): {analyzeKind: ExplainAnalyzeComparisonKind; message?: string} {
    if (hasBaselineAnalyze && hasCurrentAnalyze) {
        return {analyzeKind: 'both_analyzed'};
    }

    if (!hasBaselineAnalyze && !hasCurrentAnalyze) {
        return {analyzeKind: 'both_estimated'};
    }

    return {
        analyzeKind: 'analyze_mismatch',
        message: hasBaselineAnalyze
            ? 'Baseline plan contains ANALYZE runtime metrics, but current plan is estimated-only. Actual execution times and buffer metrics are unavailable for comparison.'
            : 'Current plan contains ANALYZE runtime metrics, but baseline plan is estimated-only. Actual execution times and buffer metrics are unavailable for comparison.',
    };
}

/**
 * Compute delta and percentage difference between baseline and current numbers.
 */
export function computeMetricDelta(
    baseline: number | null | undefined,
    current: number | null | undefined,
): ExplainMetricDelta | null {
    if (baseline == null && current == null) {
        return null;
    }

    const bVal = baseline ?? null;
    const cVal = current ?? null;

    if (bVal == null || cVal == null) {
        return {
            baseline: bVal,
            current: cVal,
            delta: null,
            percentChange: null,
        };
    }

    const delta = cVal - bVal;
    let percentChange: number | null = null;
    if (bVal !== 0) {
        percentChange = (delta / Math.abs(bVal)) * 100;
    }

    return {
        baseline: bVal,
        current: cVal,
        delta: Number(delta.toFixed(4)),
        percentChange: percentChange !== null ? Number(percentChange.toFixed(2)) : null,
    };
}

interface FlatNodeEntry {
    node: ExplainNode;
    index: number;
    depth: number;
    path: string;
    parentIndex: number | null;
}

function flattenTree(root: ExplainNode): FlatNodeEntry[] {
    const list: FlatNodeEntry[] = [];

    function traverse(node: ExplainNode, depth: number, path: string, parentIdx: number | null) {
        const currentIndex = list.length;
        list.push({
            node,
            index: currentIndex,
            depth,
            path,
            parentIndex: parentIdx,
        });

        for (let i = 0; i < node.children.length; i++) {
            traverse(node.children[i], depth + 1, `${path}/${i}`, currentIndex);
        }
    }

    traverse(root, 0, '0', null);
    return list;
}

/**
 * Node Alignment Heuristic:
 *
 * Execution plan comparison aligns nodes using a multi-pass heuristic:
 *
 * 1. Pass 1 (Exact Signature Match):
 *    Nodes sharing identical (relation, node_type, index_condition, filter, join_type)
 *    prioritizing identical structural depth / path.
 *
 * 2. Pass 2 (Relation-Targeted Operator Transition):
 *    If a node targets a specific relation (e.g. `users`), matches the scan or access
 *    method (e.g. `Seq Scan users` -> `Index Scan users`). This captures index creation
 *    and access path transformations.
 *
 * 3. Pass 3 (Structural Non-Relation Operators):
 *    For join, sorting, or grouping operators without a specific target relation (e.g.
 *    `Hash Join`, `Sort`, `Aggregate`), matches in pre-order traversal sequence at similar depth.
 *
 * 4. Pass 4 (Ambiguity Detection):
 *    When multiple identical operators exist at the same depth without distinguishing relation
 *    or condition qualifiers, they are aligned with an `ambiguous` flag and candidates exposed.
 *
 * 5. Remaining Nodes:
 *    Unmatched baseline nodes are marked `removed`.
 *    Unmatched current nodes are marked `added`.
 */
export function alignExplainNodes(
    baselineRoot: ExplainNode | null,
    currentRoot: ExplainNode | null,
    baselineMetrics?: ExplainMetrics | null,
    currentMetrics?: ExplainMetrics | null,
    canCompareAnalyze = true,
): {
    alignedNodes: ExplainAlignedNode[];
    unmatchedBaseline: ExplainNode[];
    unmatchedCurrent: ExplainNode[];
    ambiguousNodes: ExplainAlignedNode[];
} {
    if (!baselineRoot && !currentRoot) {
        return {
            alignedNodes: [],
            unmatchedBaseline: [],
            unmatchedCurrent: [],
            ambiguousNodes: [],
        };
    }

    if (!baselineRoot && currentRoot) {
        const flatCurrent = flattenTree(currentRoot);
        const aligned = flatCurrent.map((entry, idx) => ({
            id: `align_add_${idx}`,
            status: 'added' as const,
            baselineNode: null,
            currentNode: entry.node,
            baselineMetrics: null,
            currentMetrics: currentMetrics?.byId.get(entry.node.id) ?? null,
            costDelta: null,
            selfCostDelta: null,
            rowsDelta: null,
            timeDelta: null,
            selfTimeDelta: null,
            buffersDelta: null,
            matchReason: 'Node added in current plan',
        }));
        return {
            alignedNodes: aligned,
            unmatchedBaseline: [],
            unmatchedCurrent: flatCurrent.map((e) => e.node),
            ambiguousNodes: [],
        };
    }

    if (baselineRoot && !currentRoot) {
        const flatBaseline = flattenTree(baselineRoot);
        const aligned = flatBaseline.map((entry, idx) => ({
            id: `align_rem_${idx}`,
            status: 'removed' as const,
            baselineNode: entry.node,
            currentNode: null,
            baselineMetrics: baselineMetrics?.byId.get(entry.node.id) ?? null,
            currentMetrics: null,
            costDelta: null,
            selfCostDelta: null,
            rowsDelta: null,
            timeDelta: null,
            selfTimeDelta: null,
            buffersDelta: null,
            matchReason: 'Node removed from baseline plan',
        }));
        return {
            alignedNodes: aligned,
            unmatchedBaseline: flatBaseline.map((e) => e.node),
            unmatchedCurrent: [],
            ambiguousNodes: [],
        };
    }

    const baselineList = flattenTree(baselineRoot!);
    const currentList = flattenTree(currentRoot!);

    const matchedBaseline = new Set<number>();
    const matchedCurrent = new Set<number>();
    const matches: Array<{
        baselineIdx: number;
        currentIdx: number;
        reason: string;
        isAmbiguous?: boolean;
        candidates?: string[];
    }> = [];

    // Helper: Build signature
    const signature = (n: ExplainNode) =>
        `${n.node_type}::${n.relation ?? ''}::${n.index_condition ?? ''}::${n.filter ?? ''}::${n.join_type ?? ''}`;

    // Count signatures to detect duplicate / ambiguous operators
    const baseSigCounts = new Map<string, number>();
    for (const b of baselineList) {
        const sig = signature(b.node);
        baseSigCounts.set(sig, (baseSigCounts.get(sig) ?? 0) + 1);
    }
    const currSigCounts = new Map<string, number>();
    for (const c of currentList) {
        const sig = signature(c.node);
        currSigCounts.set(sig, (currSigCounts.get(sig) ?? 0) + 1);
    }

    // Pass 1: Exact signature + same tree path/depth
    for (let b = 0; b < baselineList.length; b++) {
        if (matchedBaseline.has(b)) continue;
        const bEntry = baselineList[b];
        const bSig = signature(bEntry.node);
        const isDuplicateSig =
            (baseSigCounts.get(bSig) ?? 0) > 1 || (currSigCounts.get(bSig) ?? 0) > 1;

        for (let c = 0; c < currentList.length; c++) {
            if (matchedCurrent.has(c)) continue;
            const cEntry = currentList[c];
            if (signature(cEntry.node) === bSig && bEntry.depth === cEntry.depth) {
                matchedBaseline.add(b);
                matchedCurrent.add(c);
                const candidates = isDuplicateSig
                    ? currentList
                          .filter((ce) => signature(ce.node) === bSig)
                          .map((ce) => ce.node.id)
                    : undefined;
                matches.push({
                    baselineIdx: b,
                    currentIdx: c,
                    reason: isDuplicateSig
                        ? `Ambiguous match: duplicate operator "${bEntry.node.node_type}" with identical signature`
                        : 'Exact signature and tree depth match',
                    isAmbiguous: isDuplicateSig,
                    candidates,
                });
                break;
            }
        }
    }

    // Pass 1b: Exact signature anywhere in tree
    for (let b = 0; b < baselineList.length; b++) {
        if (matchedBaseline.has(b)) continue;
        const bEntry = baselineList[b];
        const bSig = signature(bEntry.node);
        const isDuplicateSig =
            (baseSigCounts.get(bSig) ?? 0) > 1 || (currSigCounts.get(bSig) ?? 0) > 1;

        for (let c = 0; c < currentList.length; c++) {
            if (matchedCurrent.has(c)) continue;
            const cEntry = currentList[c];
            if (signature(cEntry.node) === bSig) {
                matchedBaseline.add(b);
                matchedCurrent.add(c);
                const candidates = isDuplicateSig
                    ? currentList
                          .filter((ce) => signature(ce.node) === bSig)
                          .map((ce) => ce.node.id)
                    : undefined;
                matches.push({
                    baselineIdx: b,
                    currentIdx: c,
                    reason: isDuplicateSig
                        ? `Ambiguous match: duplicate operator "${bEntry.node.node_type}" with identical signature`
                        : 'Exact signature match',
                    isAmbiguous: isDuplicateSig,
                    candidates,
                });
                break;
            }
        }
    }

    // Pass 2: Relation match (e.g. Seq Scan users -> Index Scan users)
    for (let b = 0; b < baselineList.length; b++) {
        if (matchedBaseline.has(b)) continue;
        const bEntry = baselineList[b];
        if (!bEntry.node.relation) continue;

        for (let c = 0; c < currentList.length; c++) {
            if (matchedCurrent.has(c)) continue;
            const cEntry = currentList[c];
            if (cEntry.node.relation === bEntry.node.relation) {
                matchedBaseline.add(b);
                matchedCurrent.add(c);
                matches.push({
                    baselineIdx: b,
                    currentIdx: c,
                    reason: `Matched by relation "${bEntry.node.relation}" (${bEntry.node.node_type} -> ${cEntry.node.node_type})`,
                });
                break;
            }
        }
    }

    // Pass 3: Operator type match for non-relation structural nodes
    for (let b = 0; b < baselineList.length; b++) {
        if (matchedBaseline.has(b)) continue;
        const bEntry = baselineList[b];

        // Find candidate matches with same node_type
        const candidateIndices: number[] = [];
        for (let c = 0; c < currentList.length; c++) {
            if (matchedCurrent.has(c)) continue;
            if (currentList[c].node.node_type === bEntry.node.node_type) {
                candidateIndices.push(c);
            }
        }

        if (candidateIndices.length === 1) {
            const c = candidateIndices[0];
            matchedBaseline.add(b);
            matchedCurrent.add(c);
            matches.push({
                baselineIdx: b,
                currentIdx: c,
                reason: `Matched by operator type "${bEntry.node.node_type}"`,
            });
        } else if (candidateIndices.length > 1) {
            // Pick candidate closest in depth
            let bestC = candidateIndices[0];
            let minDiff = Math.abs(currentList[bestC].depth - bEntry.depth);
            for (let i = 1; i < candidateIndices.length; i++) {
                const diff = Math.abs(currentList[candidateIndices[i]].depth - bEntry.depth);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestC = candidateIndices[i];
                }
            }

            matchedBaseline.add(b);
            matchedCurrent.add(bestC);
            matches.push({
                baselineIdx: b,
                currentIdx: bestC,
                reason: `Ambiguous match for operator "${bEntry.node.node_type}"`,
                isAmbiguous: true,
                candidates: candidateIndices.map((idx) => currentList[idx].node.id),
            });
        }
    }

    const alignedNodes: ExplainAlignedNode[] = [];
    const ambiguousNodes: ExplainAlignedNode[] = [];

    // Construct aligned nodes for matched pairs
    for (let i = 0; i < matches.length; i++) {
        const {baselineIdx, currentIdx, reason, isAmbiguous, candidates} = matches[i];
        const bNode = baselineList[baselineIdx].node;
        const cNode = currentList[currentIdx].node;
        const bMet = baselineMetrics?.byId.get(bNode.id) ?? null;
        const cMet = currentMetrics?.byId.get(cNode.id) ?? null;

        const costDelta = computeMetricDelta(bNode.total_cost, cNode.total_cost);
        const selfCostDelta = computeMetricDelta(bMet?.exclusiveCost, cMet?.exclusiveCost);
        const rowsDelta = computeMetricDelta(bNode.plan_rows, cNode.plan_rows);

        const timeDelta = canCompareAnalyze
            ? computeMetricDelta(bNode.actual_time_ms, cNode.actual_time_ms)
            : null;
        const selfTimeDelta = canCompareAnalyze
            ? computeMetricDelta(bMet?.exclusiveTimeMs, cMet?.exclusiveTimeMs)
            : null;
        const buffersDelta = canCompareAnalyze
            ? computeMetricDelta(
                  (bNode.buffers_hit ?? 0) + (bNode.buffers_read ?? 0),
                  (cNode.buffers_hit ?? 0) + (cNode.buffers_read ?? 0),
              )
            : null;

        // Determine if node is modified, ambiguous, or unchanged
        const hasMetricOrStructuralChange =
            bNode.node_type !== cNode.node_type ||
            bNode.relation !== cNode.relation ||
            bNode.index_condition !== cNode.index_condition ||
            bNode.filter !== cNode.filter ||
            (costDelta?.delta != null && Math.abs(costDelta.delta) > 0.001) ||
            (timeDelta?.delta != null && Math.abs(timeDelta.delta) > 0.001) ||
            (rowsDelta?.delta != null && Math.abs(rowsDelta.delta) > 0);

        let status: ExplainNodeDiffStatus = 'unchanged';
        if (hasMetricOrStructuralChange) {
            status = 'modified';
        } else if (isAmbiguous) {
            status = 'ambiguous';
        }

        const alignedEntry: ExplainAlignedNode = {
            id: `align_match_${i}`,
            status,
            baselineNode: bNode,
            currentNode: cNode,
            baselineMetrics: bMet,
            currentMetrics: cMet,
            costDelta,
            selfCostDelta,
            rowsDelta,
            timeDelta,
            selfTimeDelta,
            buffersDelta,
            matchReason: reason,
            isAmbiguous: Boolean(isAmbiguous),
            ambiguousCandidates: candidates,
        };

        alignedNodes.push(alignedEntry);
        if (isAmbiguous) {
            ambiguousNodes.push(alignedEntry);
        }
    }

    // Append unmatched baseline nodes (removed)
    const unmatchedBaseline: ExplainNode[] = [];
    for (let b = 0; b < baselineList.length; b++) {
        if (!matchedBaseline.has(b)) {
            const bNode = baselineList[b].node;
            unmatchedBaseline.push(bNode);
            const bMet = baselineMetrics?.byId.get(bNode.id) ?? null;
            alignedNodes.push({
                id: `align_rem_${b}`,
                status: 'removed',
                baselineNode: bNode,
                currentNode: null,
                baselineMetrics: bMet,
                currentMetrics: null,
                costDelta: null,
                selfCostDelta: null,
                rowsDelta: null,
                timeDelta: null,
                selfTimeDelta: null,
                buffersDelta: null,
                matchReason: 'Node was removed from plan',
            });
        }
    }

    // Append unmatched current nodes (added)
    const unmatchedCurrent: ExplainNode[] = [];
    for (let c = 0; c < currentList.length; c++) {
        if (!matchedCurrent.has(c)) {
            const cNode = currentList[c].node;
            unmatchedCurrent.push(cNode);
            const cMet = currentMetrics?.byId.get(cNode.id) ?? null;
            alignedNodes.push({
                id: `align_add_${c}`,
                status: 'added',
                baselineNode: null,
                currentNode: cNode,
                baselineMetrics: null,
                currentMetrics: cMet,
                costDelta: null,
                selfCostDelta: null,
                rowsDelta: null,
                timeDelta: null,
                selfTimeDelta: null,
                buffersDelta: null,
                matchReason: 'Node was added to plan',
            });
        }
    }

    return {
        alignedNodes,
        unmatchedBaseline,
        unmatchedCurrent,
        ambiguousNodes,
    };
}

/**
 * Line-by-line raw text diff fallback.
 * Allows comparing exact raw outputs when plan parsing fails or for raw text plans.
 */
export function computeRawTextDiff(
    baselineRaw: string | null | undefined,
    currentRaw: string | null | undefined,
): RawTextDiffLine[] {
    const baseLines = (baselineRaw ?? '').split(/\r?\n/);
    const currLines = (currentRaw ?? '').split(/\r?\n/);

    if (!baselineRaw && !currentRaw) {
        return [];
    }

    if (!baselineRaw) {
        return currLines.map((text, idx) => ({
            type: 'added',
            baselineLineNumber: null,
            currentLineNumber: idx + 1,
            text,
        }));
    }

    if (!currentRaw) {
        return baseLines.map((text, idx) => ({
            type: 'removed',
            baselineLineNumber: idx + 1,
            currentLineNumber: null,
            text,
        }));
    }

    // Longest Common Subsequence (LCS) line diff
    const m = baseLines.length;
    const n = currLines.length;

    // Use DP table for LCS if sizes are reasonable, or fall back to greedy for massive files
    if (m * n > 250000) {
        // Fast line comparison fallback for very large outputs
        const diff: RawTextDiffLine[] = [];
        const maxLen = Math.max(m, n);
        for (let i = 0; i < maxLen; i++) {
            const b = baseLines[i];
            const c = currLines[i];
            if (b !== undefined && c !== undefined) {
                if (b === c) {
                    diff.push({
                        type: 'same',
                        baselineLineNumber: i + 1,
                        currentLineNumber: i + 1,
                        text: b,
                    });
                } else {
                    diff.push({
                        type: 'removed',
                        baselineLineNumber: i + 1,
                        currentLineNumber: null,
                        text: b,
                    });
                    diff.push({
                        type: 'added',
                        baselineLineNumber: null,
                        currentLineNumber: i + 1,
                        text: c,
                    });
                }
            } else if (b !== undefined) {
                diff.push({
                    type: 'removed',
                    baselineLineNumber: i + 1,
                    currentLineNumber: null,
                    text: b,
                });
            } else if (c !== undefined) {
                diff.push({
                    type: 'added',
                    baselineLineNumber: null,
                    currentLineNumber: i + 1,
                    text: c,
                });
            }
        }
        return diff;
    }

    const dp: number[][] = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));

    for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
            if (baseLines[i] === currLines[j]) {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const diff: RawTextDiffLine[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && baseLines[i - 1] === currLines[j - 1]) {
            diff.push({
                type: 'same',
                baselineLineNumber: i,
                currentLineNumber: j,
                text: baseLines[i - 1],
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diff.push({
                type: 'added',
                baselineLineNumber: null,
                currentLineNumber: j,
                text: currLines[j - 1],
            });
            j--;
        } else if (i > 0) {
            diff.push({
                type: 'removed',
                baselineLineNumber: i,
                currentLineNumber: null,
                text: baseLines[i - 1],
            });
            i--;
        }
    }

    diff.reverse();
    return diff;
}

export interface CompareExplainPlansOptions {
    baselineEngine?: string;
    currentEngine?: string;
}

/**
 * Compare an EXPLAIN plan against a baseline snapshot or another plan.
 */
export function compareExplainPlans(
    baseline: ExplainPlan | ExplainSnapshot,
    current: ExplainPlan | ExplainSnapshot,
    options: CompareExplainPlansOptions = {},
): ExplainPlanComparison {
    const baselinePlan: ExplainPlan = 'plan' in baseline ? baseline.plan : baseline;
    const currentPlan: ExplainPlan = 'plan' in current ? current.plan : current;

    const bEngine =
        options.baselineEngine ??
        ('context' in baseline ? baseline.context.engine : baselinePlan.driver);
    const cEngine =
        options.currentEngine ??
        ('context' in current ? current.context.engine : currentPlan.driver);

    const engineCheck = checkEngineCompatibility(bEngine, cEngine);
    const analyzeCheck = checkAnalyzeCompatibility(
        baselinePlan.has_analyze_data,
        currentPlan.has_analyze_data,
    );

    const canCompareAnalyze =
        engineCheck.compatible && analyzeCheck.analyzeKind === 'both_analyzed';

    // Compute metrics for both plans
    const bMetrics = computeExplainMetrics(baselinePlan);
    const cMetrics = computeExplainMetrics(currentPlan);

    const alignment = engineCheck.compatible
        ? alignExplainNodes(
              baselinePlan.root,
              currentPlan.root,
              bMetrics,
              cMetrics,
              canCompareAnalyze,
          )
        : {
              alignedNodes: [],
              unmatchedBaseline: [],
              unmatchedCurrent: [],
              ambiguousNodes: [],
          };

    // Summary deltas
    const totalCostDelta = engineCheck.compatible
        ? computeMetricDelta(baselinePlan.root?.total_cost, currentPlan.root?.total_cost)
        : null;

    const executionTimeDelta = canCompareAnalyze
        ? computeMetricDelta(baselinePlan.execution_time_ms, currentPlan.execution_time_ms)
        : null;

    const planningTimeDelta = canCompareAnalyze
        ? computeMetricDelta(baselinePlan.planning_time_ms, currentPlan.planning_time_ms)
        : null;

    const rawTextDiff = computeRawTextDiff(baselinePlan.raw_output, currentPlan.raw_output);

    return {
        engineCompatible: engineCheck.compatible,
        incompatibilityReason: engineCheck.message,
        baselineEngine: bEngine,
        currentEngine: cEngine,
        analyzeKind: analyzeCheck.analyzeKind,
        analyzeMismatchNote: analyzeCheck.message,
        alignedNodes: alignment.alignedNodes,
        unmatchedBaselineNodes: alignment.unmatchedBaseline,
        unmatchedCurrentNodes: alignment.unmatchedCurrent,
        ambiguousNodes: alignment.ambiguousNodes,
        summaryDeltas: {
            totalCost: totalCostDelta,
            executionTime: executionTimeDelta,
            planningTime: planningTimeDelta,
        },
        rawTextDiff,
    };
}
