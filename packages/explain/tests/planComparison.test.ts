import {describe, expect, it} from 'vitest';
import type {ExplainNode, ExplainPlan} from '../src/types';
import {
    alignPlanNodes,
    calculateMetricDelta,
    checkEngineCompatibility,
    comparePlanSnapshots,
    type ExplainSnapshot,
} from '../src/planComparison';

function makeNode(overrides: Partial<ExplainNode> = {}): ExplainNode {
    return {
        id: 'node-1',
        node_type: 'Seq Scan',
        relation: 'users',
        startup_cost: 0,
        total_cost: 100,
        plan_rows: 1000,
        actual_rows: 500,
        actual_time_ms: 12.5,
        actual_loops: 1,
        buffers_hit: 10,
        buffers_read: 2,
        filter: null,
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
        planning_time_ms: 1.2,
        execution_time_ms: 15.4,
        original_query: 'SELECT * FROM users',
        driver: 'postgres',
        has_analyze_data: true,
        raw_output: 'Seq Scan on users',
        ...overrides,
    };
}

function makeSnapshot(
    id: string,
    plan: ExplainPlan,
    overrides: Partial<ExplainSnapshot> = {},
): ExplainSnapshot {
    return {
        id,
        name: `Snapshot ${id}`,
        createdAt: '2026-11-07T10:00:00Z',
        sql: plan.original_query,
        context: {
            engine: 'postgres',
            databaseName: 'testdb',
        },
        hasAnalyzeData: plan.has_analyze_data,
        planningTimeMs: plan.planning_time_ms,
        executionTimeMs: plan.execution_time_ms,
        totalCost: plan.root.total_cost,
        rawOutput: plan.raw_output,
        plan,
        ...overrides,
    };
}

describe('planComparison', () => {
    describe('checkEngineCompatibility', () => {
        it('allows comparison between identical engines', () => {
            expect(checkEngineCompatibility('postgres', 'Postgres').compatible).toBe(true);
            expect(checkEngineCompatibility('mysql', 'mysql').compatible).toBe(true);
        });

        it('disallows comparison between different database engines', () => {
            const result = checkEngineCompatibility('postgres', 'mysql');
            expect(result.compatible).toBe(false);
            expect(result.reason).toContain('Engines differ (postgres vs mysql)');
        });
    });

    describe('calculateMetricDelta', () => {
        it('calculates absolute delta and ratio correctly', () => {
            const delta = calculateMetricDelta(100, 150);
            expect(delta.baselineValue).toBe(100);
            expect(delta.currentValue).toBe(150);
            expect(delta.delta).toBe(50);
            expect(delta.ratio).toBe(1.5);
        });

        it('handles nulls safely without inventing zeroes', () => {
            const delta = calculateMetricDelta(100, null);
            expect(delta.delta).toBeNull();
            expect(delta.ratio).toBeNull();
            expect(delta.currentValue).toBeNull();
        });
    });

    describe('alignPlanNodes', () => {
        it('detects operator change when index scan replaces seq scan on same relation', () => {
            const baseline = makeNode({
                id: 'b1',
                node_type: 'Seq Scan',
                relation: 'orders',
                total_cost: 500,
                actual_time_ms: 25.0,
            });

            const current = makeNode({
                id: 'c1',
                node_type: 'Index Scan',
                relation: 'orders',
                total_cost: 15,
                actual_time_ms: 0.8,
            });

            const comparisons = alignPlanNodes(baseline, current);
            expect(comparisons).toHaveLength(1);
            expect(comparisons[0].status).toBe('matched');
            expect(comparisons[0].operatorChanged).toBe(true);
            expect(comparisons[0].baselineNodeType).toBe('Seq Scan');
            expect(comparisons[0].currentNodeType).toBe('Index Scan');
            expect(comparisons[0].costDelta.delta).toBe(-485);
            expect(comparisons[0].timeDelta.delta).toBeCloseTo(-24.2);
        });

        it('detects added and removed nodes in plan trees', () => {
            const baseline = makeNode({
                id: 'b1',
                node_type: 'Hash Join',
                children: [
                    makeNode({id: 'b2', node_type: 'Seq Scan', relation: 'users'}),
                    makeNode({id: 'b3', node_type: 'Seq Scan', relation: 'orders'}),
                ],
            });

            const current = makeNode({
                id: 'c1',
                node_type: 'Seq Scan',
                relation: 'users',
                children: [],
            });

            const comparisons = alignPlanNodes(baseline, current);
            expect(comparisons.some((c) => c.status === 'removed' && c.relation === 'orders')).toBe(
                true,
            );
        });
    });

    describe('comparePlanSnapshots', () => {
        it('identifies analyze mismatch and incompatible engine checks', () => {
            const plan1 = makePlan(makeNode());
            const plan2 = makePlan(makeNode(), {has_analyze_data: false});

            const snap1 = makeSnapshot('1', plan1, {
                context: {engine: 'postgres'},
            });
            const snap2 = makeSnapshot('2', plan2, {
                context: {engine: 'mysql'},
            });

            const comparison = comparePlanSnapshots(snap1, snap2);
            expect(comparison.isCompatible).toBe(false);
            expect(comparison.hasAnalyzeMismatch).toBe(true);
            expect(comparison.incompatibilityReason).toBeDefined();
        });

        it('summarizes cost, time, and node changes accurately', () => {
            const plan1 = makePlan(makeNode({total_cost: 200}), {execution_time_ms: 50});
            const plan2 = makePlan(makeNode({total_cost: 120}), {execution_time_ms: 20});

            const snap1 = makeSnapshot('1', plan1);
            const snap2 = makeSnapshot('2', plan2);

            const comparison = comparePlanSnapshots(snap1, snap2);
            expect(comparison.isCompatible).toBe(true);
            expect(comparison.summary.totalCostDelta.delta).toBe(-80);
            expect(comparison.summary.executionTimeDelta.delta).toBe(-30);
        });
    });
});
