import {describe, it, expect, vi} from 'vitest';
import type {ExplainNode, ExplainPlan, ExplainSnapshot} from '@tabularis/explain';
import {createExplainSnapshot} from '@tabularis/explain';
import {
    addExplainSnapshot,
    exportExplainSnapshot,
    importExplainSnapshotFromText,
    normalizeExplainSnapshots,
    removeExplainSnapshot,
    toggleExplainSnapshotPin,
} from '@/utils/explainSnapshots';
import type {PlatformCapabilities} from '@/platform/capabilities';

function makePlan(): ExplainPlan {
    const root: ExplainNode = {
        id: 'n0',
        node_type: 'Seq Scan',
        relation: 'users',
        startup_cost: 0,
        total_cost: 100,
        plan_rows: 50,
        actual_rows: 50,
        actual_time_ms: 10,
        actual_loops: 1,
        buffers_hit: 5,
        buffers_read: 2,
        filter: null,
        index_condition: null,
        join_type: null,
        hash_condition: null,
        extra: {},
        children: [],
    };
    return {
        root,
        planning_time_ms: 1,
        execution_time_ms: 10,
        original_query: 'SELECT * FROM users',
        driver: 'postgres',
        has_analyze_data: true,
        raw_output: 'Seq Scan on users',
    };
}

describe('explainSnapshots utility', () => {
    describe('normalizeExplainSnapshots', () => {
        it('filters out invalid or non-object entries', () => {
            const valid = createExplainSnapshot({
                sql: 'SELECT 1',
                context: {engine: 'postgres'},
                plan: makePlan(),
            });
            const raw = [null, 'invalid', {id: 'missing-fields'}, valid];
            const normalized = normalizeExplainSnapshots(raw);

            expect(normalized).toHaveLength(1);
            expect(normalized[0].id).toBe(valid.id);
        });

        it('returns empty array when input is not an array', () => {
            expect(normalizeExplainSnapshots(null)).toEqual([]);
            expect(normalizeExplainSnapshots({})).toEqual([]);
        });
    });

    describe('addExplainSnapshot & removeExplainSnapshot', () => {
        it('adds a snapshot and drops oldest unpinned when retention exceeded', () => {
            const snap1 = createExplainSnapshot({
                id: 's1',
                sql: 'q1',
                context: {engine: 'postgres'},
                plan: makePlan(),
                createdAt: '2026-01-01T00:00:00Z',
            });
            const snap2 = createExplainSnapshot({
                id: 's2',
                sql: 'q2',
                context: {engine: 'postgres'},
                plan: makePlan(),
                createdAt: '2026-01-02T00:00:00Z',
            });
            const snap3 = createExplainSnapshot({
                id: 's3',
                sql: 'q3',
                context: {engine: 'postgres'},
                plan: makePlan(),
                createdAt: '2026-01-03T00:00:00Z',
            });

            // max retention of 2 unpinned
            let list = addExplainSnapshot([snap1], snap2, 2);
            list = addExplainSnapshot(list, snap3, 2);

            expect(list).toHaveLength(2);
            expect(list.map((s) => s.id)).toEqual(['s3', 's2']);
            expect(list.find((s) => s.id === 's1')).toBeUndefined();
        });

        it('removes a snapshot by id', () => {
            const snap1 = createExplainSnapshot({
                id: 's1',
                sql: 'q1',
                context: {engine: 'postgres'},
                plan: makePlan(),
            });
            const snap2 = createExplainSnapshot({
                id: 's2',
                sql: 'q2',
                context: {engine: 'postgres'},
                plan: makePlan(),
            });

            const updated = removeExplainSnapshot([snap1, snap2], 's1');
            expect(updated).toHaveLength(1);
            expect(updated[0].id).toBe('s2');
        });
    });

    describe('toggleExplainSnapshotPin', () => {
        it('toggles isPinned flag', () => {
            const snap = createExplainSnapshot({
                id: 's1',
                sql: 'q1',
                context: {engine: 'postgres'},
                plan: makePlan(),
                isPinned: false,
            });

            const pinned = toggleExplainSnapshotPin([snap], 's1');
            expect(pinned[0].isPinned).toBe(true);

            const unpinned = toggleExplainSnapshotPin(pinned, 's1');
            expect(unpinned[0].isPinned).toBe(false);
        });
    });

    describe('exportExplainSnapshot & importExplainSnapshotFromText', () => {
        it('exports and imports snapshot round-trip', async () => {
            const original = createExplainSnapshot({
                id: 'export-snap',
                title: 'Baseline Test',
                sql: 'SELECT * FROM users',
                context: {
                    connectionId: 'c1',
                    database: 'db_main',
                    engine: 'postgres',
                    engineVersion: '16.0',
                },
                plan: makePlan(),
                isPinned: true,
            });

            let savedContent = '';
            const mockPlatform = {
                supports: () => true,
                downloadFile: vi.fn().mockImplementation(async (opts) => {
                    savedContent =
                        typeof opts.contents === 'string'
                            ? opts.contents
                            : new TextDecoder().decode(opts.contents);
                    return true;
                }),
            } as unknown as PlatformCapabilities;

            const exported = await exportExplainSnapshot(mockPlatform, original);
            expect(exported).toBe(true);
            expect(savedContent).toContain('Baseline Test');

            const imported = importExplainSnapshotFromText(savedContent);
            expect(imported.id).toBe(original.id);
            expect(imported.title).toBe(original.title);
            expect(imported.sql).toBe(original.sql);
            expect(imported.context.engine).toBe('postgres');
            expect(imported.isPinned).toBe(true);
        });
    });
});
