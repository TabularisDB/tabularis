import {describe, expect, it, beforeEach} from 'vitest';
import type {ExplainPlan} from '@tabularis/explain';
import {
    deleteExplainSnapshot,
    getCompatibleBaselineSnapshots,
    loadExplainSnapshots,
    saveExplainSnapshot,
    togglePinExplainSnapshot,
    MAX_EXPLAIN_SNAPSHOTS,
} from '../../src/utils/explainSnapshots';

function makeMockPlan(query = 'SELECT 1', engine = 'postgres'): ExplainPlan {
    return {
        root: {
            id: 'n1',
            node_type: 'Seq Scan',
            relation: 'users',
            startup_cost: 0,
            total_cost: 100,
            plan_rows: 10,
            actual_rows: 10,
            actual_time_ms: 5,
            actual_loops: 1,
            buffers_hit: 5,
            buffers_read: 0,
            filter: null,
            index_condition: null,
            join_type: null,
            hash_condition: null,
            extra: {},
            children: [],
        },
        planning_time_ms: 1,
        execution_time_ms: 6,
        original_query: query,
        driver: engine,
        has_analyze_data: true,
        raw_output: 'Seq Scan on users',
    };
}

describe('explainSnapshots store', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads plan snapshots', () => {
        expect(loadExplainSnapshots()).toEqual([]);

        const plan = makeMockPlan('SELECT * FROM orders', 'postgres');
        const snap = saveExplainSnapshot(plan, 'Orders Baseline', {engine: 'postgres'});

        const all = loadExplainSnapshots();
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe('Orders Baseline');
        expect(all[0].sql).toBe('SELECT * FROM orders');
        expect(all[0].totalCost).toBe(100);
    });

    it('toggles pin and deletes snapshots correctly', () => {
        const plan = makeMockPlan();
        const snap = saveExplainSnapshot(plan, 'Test Snap', {engine: 'postgres'});

        expect(loadExplainSnapshots()[0].isPinned).toBe(false);

        togglePinExplainSnapshot(snap.id);
        expect(loadExplainSnapshots()[0].isPinned).toBe(true);

        deleteExplainSnapshot(snap.id);
        expect(loadExplainSnapshots()).toHaveLength(0);
    });

    it('filters compatible baseline snapshots by engine', () => {
        const pgPlan = makeMockPlan('SELECT 1', 'postgres');
        const myPlan = makeMockPlan('SELECT 1', 'mysql');

        saveExplainSnapshot(pgPlan, 'PG Snap', {engine: 'postgres'});
        saveExplainSnapshot(myPlan, 'MySQL Snap', {engine: 'mysql'});

        const all = loadExplainSnapshots();
        expect(all).toHaveLength(2);

        const pgCompatible = getCompatibleBaselineSnapshots('postgres', all);
        expect(pgCompatible).toHaveLength(1);
        expect(pgCompatible[0].name).toBe('PG Snap');

        const mysqlCompatible = getCompatibleBaselineSnapshots('mysql', all);
        expect(mysqlCompatible).toHaveLength(1);
        expect(mysqlCompatible[0].name).toBe('MySQL Snap');
    });

    it('propagates QuotaExceededError and prevents corrupting persisted state when setItem fails', () => {
        const plan = makeMockPlan();
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            const err = new DOMException('Quota exceeded', 'QuotaExceededError');
            throw err;
        });

        expect(() => {
            saveExplainSnapshot(plan, 'Fail Snap', {engine: 'postgres'});
        }).toThrow(/Quota exceeded/);

        setItemSpy.mockRestore();
        expect(loadExplainSnapshots()).toEqual([]);
    });

    it('propagates failure when pinning or deleting snapshots fails to persist', () => {
        const plan = makeMockPlan();
        const snap = saveExplainSnapshot(plan, 'Initial Snap', {engine: 'postgres'});
        expect(loadExplainSnapshots()).toHaveLength(1);

        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Storage unavailable', 'QuotaExceededError');
        });

        expect(() => {
            togglePinExplainSnapshot(snap.id);
        }).toThrow();

        expect(() => {
            deleteExplainSnapshot(snap.id);
        }).toThrow();

        setItemSpy.mockRestore();
    });
});
