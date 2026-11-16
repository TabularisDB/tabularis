import {describe, expect, it} from 'vitest';
import {
    BATCH_SNAPSHOT_ROW_CAP,
    batchSnapshotLimit,
    isSnapshotResult,
    snapshotPage,
} from '@/utils/batchSnapshot';
import type {QueryResult} from '@/types/editor';

function result(rowCount: number, hasMore = false): QueryResult {
    return {
        columns: ['id', 'label'],
        rows: Array.from({length: rowCount}, (_, i) => [i + 1, `row-${i + 1}`]),
        affected_rows: 0,
        pagination: {
            page: 1,
            page_size: BATCH_SNAPSHOT_ROW_CAP,
            total_rows: null,
            has_more: hasMore,
        },
    };
}

describe('batchSnapshotLimit', () => {
    it('requests at least the snapshot cap', () => {
        expect(batchSnapshotLimit(50)).toBe(BATCH_SNAPSHOT_ROW_CAP);
    });

    it('keeps a page size larger than the cap', () => {
        expect(batchSnapshotLimit(5000)).toBe(5000);
    });

    it('leaves pagination off when the page size is "All"', () => {
        expect(batchSnapshotLimit(undefined)).toBeUndefined();
        expect(batchSnapshotLimit(0)).toBeUndefined();
    });
});

describe('isSnapshotResult', () => {
    it('accepts a paged row result', () => {
        expect(isSnapshotResult(result(3))).toBe(true);
    });

    it('rejects results without pagination or columns', () => {
        expect(isSnapshotResult(null)).toBe(false);
        expect(isSnapshotResult({...result(3), pagination: undefined})).toBe(false);
        expect(isSnapshotResult({columns: [], rows: [], affected_rows: 4})).toBe(false);
    });
});

describe('snapshotPage', () => {
    it('cuts pages from the captured rows', () => {
        const snapshot = result(6);
        const page2 = snapshotPage(snapshot, 2, 2);
        expect(page2.rows).toEqual([
            [3, 'row-3'],
            [4, 'row-4'],
        ]);
        expect(page2.pagination).toEqual({page: 2, page_size: 2, total_rows: 6, has_more: true});
        expect(page2.truncated).toBe(false);
    });

    it('reports no more rows on the last page', () => {
        const last = snapshotPage(result(5), 3, 2);
        expect(last.rows).toEqual([[5, 'row-5']]);
        expect(last.pagination?.has_more).toBe(false);
    });

    it('clamps out-of-range pages', () => {
        expect(snapshotPage(result(5), 99, 2).pagination?.page).toBe(3);
        expect(snapshotPage(result(5), 0, 2).pagination?.page).toBe(1);
    });

    it('handles an empty result', () => {
        const empty = snapshotPage(result(0), 1, 10);
        expect(empty.rows).toEqual([]);
        expect(empty.pagination).toEqual({page: 1, page_size: 10, total_rows: 0, has_more: false});
    });

    it('flags snapshots that stopped at the cap', () => {
        const capped = snapshotPage(result(BATCH_SNAPSHOT_ROW_CAP, true), 1, 100);
        expect(capped.truncated).toBe(true);
        expect(capped.pagination?.total_rows).toBe(BATCH_SNAPSHOT_ROW_CAP);
    });

    it('does not mutate the snapshot', () => {
        const snapshot = result(4);
        snapshotPage(snapshot, 2, 2);
        expect(snapshot.rows).toHaveLength(4);
        expect(snapshot.pagination?.page).toBe(1);
    });
});
