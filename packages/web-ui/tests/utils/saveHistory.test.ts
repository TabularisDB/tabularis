import {describe, expect, it} from 'vitest';
import {
    canApplyRestore,
    describeCellImage,
    formatRecordKey,
    groupUpdatesByRow,
    nonRestorableReasonKey,
    planStatusKey,
    recordingFailed,
    shouldRecordSaves,
} from '@/utils/saveHistory';
import type {RestorePlanStatus} from '@/types/saveHistory';

const labels = {nullLabel: 'NULL', omittedLabel: 'not captured', missingLabel: '—'};

describe('saveHistory', () => {
    describe('groupUpdatesByRow', () => {
        it('groups the cell updates of one row, whatever the key order', () => {
            const rows = groupUpdatesByRow([
                {pkVal: {a: 1, b: 2}, colName: 'status', newVal: 'x'},
                {pkVal: {b: 2, a: 1}, colName: 'note', newVal: null},
                {pkVal: {a: 9, b: 2}, colName: 'status', newVal: 'y'},
            ]);
            expect(rows).toHaveLength(2);
            expect(rows[0].changes).toEqual({status: 'x', note: null});
            expect(rows[1].pkMap).toEqual({a: 9, b: 2});
        });

        it('keeps the last value written to a column', () => {
            const rows = groupUpdatesByRow([
                {pkVal: {id: 1}, colName: 'status', newVal: 'first'},
                {pkVal: {id: 1}, colName: 'status', newVal: 'second'},
            ]);
            expect(rows[0].changes).toEqual({status: 'second'});
        });

        it('returns nothing for no updates', () => {
            expect(groupUpdatesByRow([])).toEqual([]);
        });
    });

    describe('shouldRecordSaves', () => {
        it('records only when supported, enabled and addressed by a real key', () => {
            expect(shouldRecordSaves({supported: true, enabled: true}, false)).toBe(true);
            expect(shouldRecordSaves({supported: true, enabled: true}, true)).toBe(false);
            expect(shouldRecordSaves({supported: true, enabled: false}, false)).toBe(false);
            expect(shouldRecordSaves({supported: false, enabled: true}, false)).toBe(false);
            expect(shouldRecordSaves(null, false)).toBe(false);
            expect(shouldRecordSaves(undefined, false)).toBe(false);
        });
    });

    describe('describeCellImage', () => {
        it('tells NULL, empty text and a missing value apart', () => {
            expect(describeCellImage({kind: 'null'}, labels)).toEqual({kind: 'null', text: 'NULL'});
            expect(describeCellImage({kind: 'text', value: ''}, labels)).toEqual({
                kind: 'text',
                text: '',
            });
            expect(describeCellImage(null, labels)).toEqual({kind: 'omitted', text: '—'});
            expect(describeCellImage({kind: 'omitted', reason: 'too_large'}, labels)).toEqual({
                kind: 'omitted',
                text: 'not captured',
            });
        });

        it('shows numeric and binary text exactly as recorded', () => {
            expect(describeCellImage({kind: 'text', value: '10.50'}, labels).text).toBe('10.50');
            expect(describeCellImage({kind: 'text', value: '\\xdeadbeef'}, labels).text).toBe(
                '\\xdeadbeef',
            );
        });

        it('cuts long text and marks the cut', () => {
            const view = describeCellImage({kind: 'text', value: 'a'.repeat(20)}, labels, 5);
            expect(view.text).toBe('aaaaa…');
        });
    });

    describe('formatRecordKey', () => {
        it('lists the key columns in a stable order', () => {
            expect(formatRecordKey({tenant: 'a', id: 7})).toBe('id = 7, tenant = "a"');
        });
    });

    describe('status and reason keys', () => {
        it('maps every plan status to its own message', () => {
            const statuses: RestorePlanStatus[] = [
                'ready',
                'conflict',
                'row_missing',
                'not_restorable',
                'already_restored',
                'target_changed',
                'restored',
            ];
            const keys = statuses.map(planStatusKey);
            expect(new Set(keys).size).toBe(statuses.length);
            for (const key of keys) expect(key).toMatch(/^saveHistory\.status\./);
        });

        it('maps every reason to its own message and falls back for none', () => {
            const keys = [
                'key_changed',
                'table_has_triggers',
                'generated_column',
                'value_not_captured',
            ].map((reason) =>
                nonRestorableReasonKey(reason as Parameters<typeof nonRestorableReasonKey>[0]),
            );
            expect(new Set(keys).size).toBe(4);
            expect(nonRestorableReasonKey(null)).toBe('saveHistory.reason.unknown');
        });
    });

    describe('canApplyRestore', () => {
        it('allows a restore only from the ready state', () => {
            expect(canApplyRestore('ready')).toBe(true);
            for (const status of [
                'conflict',
                'row_missing',
                'not_restorable',
                'already_restored',
                'target_changed',
                'restored',
            ] as const)
                expect(canApplyRestore(status)).toBe(false);
            expect(canApplyRestore(null)).toBe(false);
            expect(canApplyRestore(undefined)).toBe(false);
        });
    });

    describe('recordingFailed', () => {
        it('flags only a history that could not be written', () => {
            const response = {affected: 1, recordId: null};
            expect(recordingFailed({...response, skippedReason: 'storage_error'})).toBe(true);
            expect(recordingFailed({...response, skippedReason: 'not_a_base_table'})).toBe(false);
            expect(recordingFailed({...response, skippedReason: 'unchanged'})).toBe(false);
            expect(recordingFailed({...response, skippedReason: null})).toBe(false);
        });
    });
});
