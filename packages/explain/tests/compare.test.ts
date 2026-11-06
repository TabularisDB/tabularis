import {describe, it, expect} from 'vitest';
import type {ExplainNode, ExplainPlan} from '../src/types';
import {
    checkEngineCompatibility,
    checkAnalyzeCompatibility,
    computeMetricDelta,
    alignExplainNodes,
    computeRawTextDiff,
    compareExplainPlans,
} from '../src/compare';
import {computeExplainMetrics} from '../src/metrics';

function makeNode(overrides: Partial<ExplainNode> = {}): ExplainNode {
    return {
        id: 'node_0',
        node_type: 'Seq Scan',
        relation: 'orders',
        startup_cost: 0,
        total_cost: 150,
        plan_rows: 500,
        actual_rows: 480,
        actual_time_ms: 18.2,
        actual_loops: 1,
        buffers_hit: 80,
        buffers_read: 12,
        filter: 'status = "completed"',
        index_condition: null,
        join_type: null,
        hash_condition: null,
        extra: {},
        children: [],
        ...overrides,
    };
}

function makePlan(root: ExplainNode, overrides: Partial<ExplainPlan> = {}): ExplainPlan {
    return {
        root,
        planning_time_ms: 1.5,
        execution_time_ms: 22.0,
        original_query: 'SELECT * FROM orders WHERE status = "completed"',
        driver: 'postgres',
        has_analyze_data: true,
        raw_output: 'Seq Scan on orders\n  Filter: status = "completed"',
        ...overrides,
    };
}

describe('compare', () => {
    describe('checkEngineCompatibility', () => {
        it('allows comparison for identical engines', () => {
            expect(checkEngineCompatibility('postgres', 'postgres').compatible).toBe(true);
            expect(checkEngineCompatibility('MySQL', 'mysql').compatible).toBe(true);
            expect(checkEngineCompatibility('sqlite', 'SQLite').compatible).toBe(true);
        });

        it('disallows comparing across unlike engines to prevent bogus cost equivalence', () => {
            const result = checkEngineCompatibility('postgres', 'mysql');
            expect(result.compatible).toBe(false);
            expect(result.message).toContain('Incompatible database engines');
            expect(result.message).toContain('postgres');
            expect(result.message).toContain('mysql');
        });
    });

    describe('checkAnalyzeCompatibility', () => {
        it('recognizes both analyzed plans', () => {
            expect(checkAnalyzeCompatibility(true, true)).toEqual({
                analyzeKind: 'both_analyzed',
            });
        });

        it('recognizes both estimated plans', () => {
            expect(checkAnalyzeCompatibility(false, false)).toEqual({
                analyzeKind: 'both_estimated',
            });
        });

        it('detects analyze mismatch when one plan is estimated-only', () => {
            const mismatch = checkAnalyzeCompatibility(true, false);
            expect(mismatch.analyzeKind).toBe('analyze_mismatch');
            expect(mismatch.message).toContain('Actual execution times');
        });
    });

    describe('computeMetricDelta', () => {
        it('computes positive delta and percentage increase', () => {
            const delta = computeMetricDelta(100, 150);
            expect(delta).toEqual({
                baseline: 100,
                current: 150,
                delta: 50,
                percentChange: 50,
            });
        });

        it('computes negative delta and percentage reduction', () => {
            const delta = computeMetricDelta(200, 50);
            expect(delta).toEqual({
                baseline: 200,
                current: 50,
                delta: -150,
                percentChange: -75,
            });
        });

        it('handles null values gracefully', () => {
            expect(computeMetricDelta(null, 50)).toEqual({
                baseline: null,
                current: 50,
                delta: null,
                percentChange: null,
            });
            expect(computeMetricDelta(null, null)).toBeNull();
        });
    });

    describe('alignExplainNodes', () => {
        it('matches nodes by relation when access method improves (Seq Scan -> Index Scan)', () => {
            const baseNode = makeNode({
                id: 'b1',
                node_type: 'Seq Scan',
                relation: 'orders',
                total_cost: 200,
                actual_time_ms: 50,
            });
            const currNode = makeNode({
                id: 'c1',
                node_type: 'Index Scan',
                relation: 'orders',
                index_condition: 'orders_idx',
                total_cost: 15,
                actual_time_ms: 1.5,
            });

            const baseMetrics = computeExplainMetrics(makePlan(baseNode));
            const currMetrics = computeExplainMetrics(makePlan(currNode));

            const alignment = alignExplainNodes(baseNode, currNode, baseMetrics, currMetrics, true);

            expect(alignment.alignedNodes).toHaveLength(1);
            const aligned = alignment.alignedNodes[0];
            expect(aligned.status).toBe('modified');
            expect(aligned.baselineNode?.node_type).toBe('Seq Scan');
            expect(aligned.currentNode?.node_type).toBe('Index Scan');
            expect(aligned.costDelta?.delta).toBe(-185);
            expect(aligned.costDelta?.percentChange).toBe(-92.5);
            expect(aligned.timeDelta?.delta).toBe(-48.5);
            expect(aligned.matchReason).toContain('Matched by relation "orders"');
        });

        it('handles structural changes with added and removed nodes', () => {
            // Baseline: Hash Join -> (Seq Scan users, Seq Scan orders)
            const baseRoot = makeNode({
                id: 'b_join',
                node_type: 'Hash Join',
                relation: null,
                children: [
                    makeNode({id: 'b_u', node_type: 'Seq Scan', relation: 'users'}),
                    makeNode({id: 'b_o', node_type: 'Seq Scan', relation: 'orders'}),
                ],
            });

            // Current: Nested Loop -> (Index Scan users, Index Scan orders, Materialize temp)
            const currRoot = makeNode({
                id: 'c_loop',
                node_type: 'Nested Loop',
                relation: null,
                children: [
                    makeNode({id: 'c_u', node_type: 'Index Scan', relation: 'users'}),
                    makeNode({id: 'c_o', node_type: 'Index Scan', relation: 'orders'}),
                    makeNode({id: 'c_mat', node_type: 'Materialize', relation: null}),
                ],
            });

            const alignment = alignExplainNodes(baseRoot, currRoot);

            // Users and Orders should match by relation
            const userAlign = alignment.alignedNodes.find(
                (a) => a.baselineNode?.relation === 'users' && a.currentNode?.relation === 'users',
            );
            expect(userAlign).toBeDefined();
            expect(userAlign?.status).toBe('modified');

            const orderAlign = alignment.alignedNodes.find(
                (a) =>
                    a.baselineNode?.relation === 'orders' && a.currentNode?.relation === 'orders',
            );
            expect(orderAlign).toBeDefined();

            // Materialize should be recorded as added
            const matAlign = alignment.alignedNodes.find(
                (a) => a.currentNode?.node_type === 'Materialize',
            );
            expect(matAlign).toBeDefined();
            expect(matAlign?.status).toBe('added');
            expect(matAlign?.baselineNode).toBeNull();
        });

        it('detects duplicate operators and exposes ambiguous candidates', () => {
            // Baseline has two identical Seq Scans with no relation name
            const baseRoot = makeNode({
                id: 'b_root',
                node_type: 'Append',
                relation: null,
                children: [
                    makeNode({id: 'b_seq1', node_type: 'Seq Scan', relation: null, filter: null}),
                    makeNode({id: 'b_seq2', node_type: 'Seq Scan', relation: null, filter: null}),
                ],
            });

            // Current also has two identical Seq Scans with no relation name
            const currRoot = makeNode({
                id: 'c_root',
                node_type: 'Append',
                relation: null,
                children: [
                    makeNode({id: 'c_seq1', node_type: 'Seq Scan', relation: null, filter: null}),
                    makeNode({id: 'c_seq2', node_type: 'Seq Scan', relation: null, filter: null}),
                ],
            });

            const alignment = alignExplainNodes(baseRoot, currRoot);
            expect(alignment.ambiguousNodes.length).toBeGreaterThanOrEqual(1);
            expect(alignment.ambiguousNodes[0].isAmbiguous).toBe(true);
            expect(alignment.ambiguousNodes[0].ambiguousCandidates).toBeDefined();
            expect(alignment.ambiguousNodes[0].status).toBe('ambiguous');

            // If metrics differ, ambiguous nodes are still flagged as modified
            const currRootWithCost = makeNode({
                id: 'c_root',
                node_type: 'Append',
                relation: null,
                children: [
                    makeNode({
                        id: 'c_seq1',
                        node_type: 'Seq Scan',
                        relation: null,
                        filter: null,
                        total_cost: 999,
                    }),
                    makeNode({
                        id: 'c_seq2',
                        node_type: 'Seq Scan',
                        relation: null,
                        filter: null,
                        total_cost: 999,
                    }),
                ],
            });
            const alignmentModified = alignExplainNodes(baseRoot, currRootWithCost);
            expect(alignmentModified.ambiguousNodes[0].isAmbiguous).toBe(true);
            expect(alignmentModified.ambiguousNodes[0].status).toBe('modified');
        });

        it('omits actual timing deltas when canCompareAnalyze is false', () => {
            const baseNode = makeNode({id: 'b', actual_time_ms: 100});
            const currNode = makeNode({id: 'c', actual_time_ms: 20});

            const alignment = alignExplainNodes(baseNode, currNode, null, null, false);
            const aligned = alignment.alignedNodes[0];

            expect(aligned.timeDelta).toBeNull();
            expect(aligned.selfTimeDelta).toBeNull();
            expect(aligned.buffersDelta).toBeNull();
            // Cost is still compared
            expect(aligned.costDelta).toBeDefined();
        });
    });

    describe('computeRawTextDiff', () => {
        it('computes line additions and removals between raw outputs', () => {
            const raw1 = 'Seq Scan on users\n  Filter: active = true\nTotal runtime: 10ms';
            const raw2 = 'Index Scan on users\n  Index Cond: id > 10\nTotal runtime: 2ms';

            const diff = computeRawTextDiff(raw1, raw2);

            expect(diff.some((l) => l.type === 'removed' && l.text.includes('Seq Scan'))).toBe(
                true,
            );
            expect(diff.some((l) => l.type === 'added' && l.text.includes('Index Scan'))).toBe(
                true,
            );
        });

        it('returns empty array when both inputs are empty', () => {
            expect(computeRawTextDiff(null, null)).toEqual([]);
            expect(computeRawTextDiff('', '')).toEqual([]);
        });
    });

    describe('compareExplainPlans', () => {
        it('produces full plan comparison summary', () => {
            const basePlan = makePlan(makeNode({id: 'b', total_cost: 500, actual_time_ms: 100}), {
                execution_time_ms: 120,
                planning_time_ms: 5,
                driver: 'postgres',
                has_analyze_data: true,
            });

            const currPlan = makePlan(makeNode({id: 'c', total_cost: 100, actual_time_ms: 15}), {
                execution_time_ms: 18,
                planning_time_ms: 2,
                driver: 'postgres',
                has_analyze_data: true,
            });

            const comparison = compareExplainPlans(basePlan, currPlan);

            expect(comparison.engineCompatible).toBe(true);
            expect(comparison.analyzeKind).toBe('both_analyzed');
            expect(comparison.summaryDeltas.totalCost?.delta).toBe(-400);
            expect(comparison.summaryDeltas.executionTime?.delta).toBe(-102);
            expect(comparison.summaryDeltas.planningTime?.delta).toBe(-3);
            expect(comparison.alignedNodes.length).toBeGreaterThan(0);
            expect(comparison.rawTextDiff.length).toBeGreaterThan(0);
        });

        it('flags engine incompatibility across different database systems', () => {
            const basePlan = makePlan(makeNode(), {driver: 'postgres'});
            const currPlan = makePlan(makeNode(), {driver: 'mysql'});

            const comparison = compareExplainPlans(basePlan, currPlan);

            expect(comparison.engineCompatible).toBe(false);
            expect(comparison.incompatibilityReason).toContain('Incompatible database engines');
            expect(comparison.alignedNodes).toEqual([]);
            expect(comparison.summaryDeltas.totalCost).toBeNull();
        });
    });
});
