import {describe, expect, it} from 'vitest';
import {formatQueryHistoryAsSql} from '@/utils/queryHistoryExport';
import type {QueryHistoryEntry} from '@/types/queryHistory';

const entry: QueryHistoryEntry = {
    id: '1',
    sql: 'SELECT 1',
    executedAt: '2026-10-27T09:14:02.000Z',
    executionTimeMs: 12,
    status: 'success',
    rowsAffected: 1,
    error: null,
    database: 'main',
};

describe('formatQueryHistoryAsSql', () => {
    it('writes timestamps, outcomes and durations in the supplied order', () => {
        expect(
            formatQueryHistoryAsSql(
                [
                    entry,
                    {
                        ...entry,
                        sql: 'SELECT nme FROM users;',
                        status: 'error',
                        error: 'column nme does not exist',
                    },
                ],
                'UTC',
            ),
        ).toBe(
            '-- 2026-10-27 09:14:02 · success · 12 ms\nSELECT 1;\n\n' +
                '-- 2026-10-27 09:14:02 · failed · 12 ms\n-- ERROR: column nme does not exist\nSELECT nme FROM users;\n',
        );
    });

    it('uses the display timezone and omits an unrecorded duration', () => {
        expect(formatQueryHistoryAsSql([{...entry, executionTimeMs: null}], 'Asia/Tokyo')).toBe(
            '-- 2026-10-27 18:14:02 · success\nSELECT 1;\n',
        );
    });

    it.each([
        [0, '0 ms'],
        [12.300000011920929, '12 ms'],
        [1234.5, '1.23 s'],
    ])('formats recorded duration %s without floating-point noise', (executionTimeMs, duration) => {
        expect(formatQueryHistoryAsSql([{...entry, executionTimeMs}], 'UTC')).toBe(
            `-- 2026-10-27 09:14:02 · success · ${duration}\nSELECT 1;\n`,
        );
    });

    it('keeps every line of an error inside a comment, including Unicode separators', () => {
        const error = 'bad SQL\r\nDROP TABLE users;\rnext\n*/\u0085--\u2028/*\u2029last';
        expect(formatQueryHistoryAsSql([{...entry, status: 'error', error}], 'UTC')).toBe(
            '-- 2026-10-27 09:14:02 · failed · 12 ms\n' +
                '-- ERROR: bad SQL\n-- DROP TABLE users;\n-- next\n-- */\n-- --\n-- /*\n-- last\nSELECT 1;\n',
        );
    });

    it('keeps invalid timestamps on one comment line', () => {
        expect(
            formatQueryHistoryAsSql([{...entry, executedAt: 'invalid\nDROP TABLE users;'}], 'UTC'),
        ).toBe('-- invalid DROP TABLE users; · success · 12 ms\nSELECT 1;\n');
    });

    it.each([
        ['SELECT 1;  \n', 'SELECT 1;'],
        ['SELECT 1 -- note', 'SELECT 1 -- note\n;'],
        ['SELECT 1 -- note;', 'SELECT 1 -- note;\n;'],
        ['SELECT 1 # note', 'SELECT 1 # note\n;'],
        ['SELECT 1 # note;', 'SELECT 1 # note;\n;'],
        ["SELECT 'first;\nsecond'", "SELECT 'first;\nsecond';"],
    ])('terminates SQL without rewriting its contents: %s', (sql, expected) => {
        expect(formatQueryHistoryAsSql([{...entry, sql}], 'UTC')).toBe(
            `-- 2026-10-27 09:14:02 · success · 12 ms\n${expected}\n`,
        );
    });

    it('returns no content for an empty history', () => {
        expect(formatQueryHistoryAsSql([], 'UTC')).toBe('');
    });
});
