import {describe, it, expect} from 'vitest';
import type {ExplainNode, ExplainPlan} from '../src/types';
import {
    createExplainSnapshot,
    pruneExplainSnapshots,
    serializeExplainSnapshot,
    deserializeExplainSnapshot,
    EXPLAIN_SNAPSHOT_SCHEMA_VERSION,
} from '../src/snapshot';

function makeNode(overrides: Partial<ExplainNode> = {}): ExplainNode {
    return {
        id: 'node_0',
        node_type: 'Seq Scan',
        relation: 'users',
        startup_cost: 0,
        total_cost: 100,
        plan_rows: 1000,
        actual_rows: 950,
        actual_time_ms: 12.5,
        actual_loops: 1,
        buffers_hit: 50,
        buffers_read: 10,
        filter: 'active = true',
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
        original_query: 'SELECT * FROM users WHERE active = true',
        driver: 'postgres',
        has_analyze_data: true,
        raw_output: 'Seq Scan on users  (cost=0.00..100.00 rows=1000 width=32)',
        ...overrides,
    };
}

describe('snapshot', () => {
    describe('createExplainSnapshot', () => {
        it('creates a snapshot capturing plan, raw output and context without mutating plan', () => {
            const plan = makePlan(makeNode());
            const snapshot = createExplainSnapshot({
                sql: plan.original_query,
                context: {
                    connectionId: 'conn-1',
                    connectionName: 'Production DB',
                    database: 'app_main',
                    schema: 'public',
                    engine: 'postgres',
                    engineVersion: '16.1',
                },
                plan,
            });

            expect(snapshot.id).toBeDefined();
            expect(snapshot.sql).toBe(plan.original_query);
            expect(snapshot.plan.raw_output).toBe(plan.raw_output);
            expect(snapshot.context.engine).toBe('postgres');
            expect(snapshot.context.database).toBe('app_main');
            expect(snapshot.context.engineVersion).toBe('16.1');
            expect(snapshot.isPinned).toBe(false);
            expect(snapshot.title).toContain('POSTGRES');
        });

        it('normalizes engine to lower case and omits undefined credentials', () => {
            const plan = makePlan(makeNode());
            const snapshot = createExplainSnapshot({
                title: 'Baseline Before Index',
                sql: 'SELECT 1',
                context: {
                    engine: 'MySQL',
                },
                plan,
                isPinned: true,
            });

            expect(snapshot.title).toBe('Baseline Before Index');
            expect(snapshot.context.engine).toBe('mysql');
            expect(snapshot.context.connectionId).toBeUndefined();
            expect(snapshot.context.database).toBeNull();
            expect(snapshot.isPinned).toBe(true);
        });
    });

    describe('pruneExplainSnapshots', () => {
        it('never prunes pinned snapshots regardless of count', () => {
            const plan = makePlan(makeNode());
            const snapshots = [
                createExplainSnapshot({
                    id: 'pinned_1',
                    sql: 's1',
                    context: {engine: 'postgres'},
                    plan,
                    isPinned: true,
                    createdAt: '2026-01-01T00:00:00Z',
                }),
                createExplainSnapshot({
                    id: 'pinned_2',
                    sql: 's2',
                    context: {engine: 'postgres'},
                    plan,
                    isPinned: true,
                    createdAt: '2026-01-02T00:00:00Z',
                }),
                createExplainSnapshot({
                    id: 'unpinned_old',
                    sql: 's3',
                    context: {engine: 'postgres'},
                    plan,
                    createdAt: '2026-01-03T00:00:00Z',
                }),
                createExplainSnapshot({
                    id: 'unpinned_new',
                    sql: 's4',
                    context: {engine: 'postgres'},
                    plan,
                    createdAt: '2026-01-04T00:00:00Z',
                }),
            ];

            // Retain max 1 unpinned snapshot
            const pruned = pruneExplainSnapshots(snapshots, 1);

            expect(pruned.map((s) => s.id)).toEqual(['unpinned_new', 'pinned_2', 'pinned_1']);
            expect(pruned.find((s) => s.id === 'unpinned_old')).toBeUndefined();
        });

        it('orders pruned snapshots by createdAt descending', () => {
            const plan = makePlan(makeNode());
            const s1 = createExplainSnapshot({
                id: '1',
                sql: 's1',
                context: {engine: 'postgres'},
                plan,
                createdAt: '2026-02-01T10:00:00Z',
            });
            const s2 = createExplainSnapshot({
                id: '2',
                sql: 's2',
                context: {engine: 'postgres'},
                plan,
                createdAt: '2026-02-01T12:00:00Z',
            });
            const s3 = createExplainSnapshot({
                id: '3',
                sql: 's3',
                context: {engine: 'postgres'},
                plan,
                createdAt: '2026-02-01T11:00:00Z',
            });

            const pruned = pruneExplainSnapshots([s1, s2, s3], 2);
            expect(pruned.map((s) => s.id)).toEqual(['2', '3']);
        });
    });

    describe('serialization and deserialization', () => {
        it('round-trips snapshot with schema version', () => {
            const plan = makePlan(makeNode());
            const original = createExplainSnapshot({
                id: 'test_snap',
                title: 'Prod Test',
                sql: 'SELECT * FROM users',
                context: {
                    connectionId: 'c1',
                    database: 'db1',
                    engine: 'postgres',
                    engineVersion: '15.4',
                },
                plan,
                isPinned: true,
            });

            const serialized = serializeExplainSnapshot(original);
            expect(serialized).toContain(`"version": ${EXPLAIN_SNAPSHOT_SCHEMA_VERSION}`);

            const deserialized = deserializeExplainSnapshot(serialized);
            expect(deserialized.id).toBe(original.id);
            expect(deserialized.title).toBe(original.title);
            expect(deserialized.sql).toBe(original.sql);
            expect(deserialized.context.engine).toBe('postgres');
            expect(deserialized.context.engineVersion).toBe('15.4');
            expect(deserialized.plan.raw_output).toBe(original.plan.raw_output);
            expect(deserialized.isPinned).toBe(true);
        });

        it('handles directly unwrapped snapshot objects', () => {
            const plan = makePlan(makeNode());
            const rawObj = {
                id: 'direct_snap',
                title: 'Direct Object',
                sql: 'SELECT 42',
                context: {engine: 'sqlite'},
                plan,
            };

            const deserialized = deserializeExplainSnapshot(JSON.stringify(rawObj));
            expect(deserialized.id).toBe('direct_snap');
            expect(deserialized.sql).toBe('SELECT 42');
            expect(deserialized.context.engine).toBe('sqlite');
        });

        it('throws descriptive error on invalid or missing required properties', () => {
            expect(() => deserializeExplainSnapshot('not-a-json')).toThrow(
                /Invalid JSON for EXPLAIN snapshot/,
            );
            expect(() => deserializeExplainSnapshot('{}')).toThrow(/missing required field "sql"/);
            expect(() => deserializeExplainSnapshot(JSON.stringify({sql: 'SELECT 1'}))).toThrow(
                /missing required field "plan"/,
            );
            expect(() =>
                deserializeExplainSnapshot(JSON.stringify({sql: 'SELECT 1', plan: {}})),
            ).toThrow(/plan missing "root" node/);
        });
    });
});
