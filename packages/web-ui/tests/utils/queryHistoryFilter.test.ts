import {describe, it, expect} from 'vitest';
import type {QueryHistoryEntry} from '@/types/queryHistory';
import {
    filterQueryHistoryEntries,
    getQueryHistoryDatabaseChoices,
    isQueryHistoryDatabaseFilterAvailable,
    isQueryHistoryFilterActive,
    queryHistoryDatabaseFilterFor,
    validateQueryHistoryDateRange,
} from '@/utils/queryHistoryFilter';

const NOW = new Date('2026-04-15T14:00:00.000Z');

function entry(
    overrides: Partial<QueryHistoryEntry> & Pick<QueryHistoryEntry, 'id' | 'sql'>,
): QueryHistoryEntry {
    return {
        executedAt: '2026-04-15T13:30:00.000Z',
        executionTimeMs: 10,
        status: 'success',
        rowsAffected: 1,
        error: null,
        database: null,
        ...overrides,
    };
}

const SAMPLE: QueryHistoryEntry[] = [
    entry({
        id: 'ok-recent',
        sql: 'SELECT * FROM users',
        executedAt: '2026-04-15T13:45:00.000Z',
        status: 'success',
    }),
    entry({
        id: 'fail-recent',
        sql: 'SELECT * FROM missing',
        executedAt: '2026-04-15T13:50:00.000Z',
        status: 'error',
        error: 'relation missing does not exist',
    }),
    entry({
        id: 'ok-yesterday',
        sql: 'SELECT id FROM users',
        executedAt: '2026-04-14T12:00:00.000Z',
        status: 'success',
    }),
    entry({
        id: 'fail-week',
        sql: 'DELETE FROM users WHERE id = 1',
        executedAt: '2026-04-10T10:00:00.000Z',
        status: 'error',
    }),
    entry({
        id: 'ok-mid',
        sql: 'ANALYZE',
        executedAt: '2026-03-25T10:00:00.000Z',
        status: 'success',
    }),
    entry({
        id: 'ok-old',
        sql: 'VACUUM',
        executedAt: '2026-03-01T10:00:00.000Z',
        status: 'success',
    }),
];

describe('queryHistoryFilter', () => {
    describe('isQueryHistoryFilterActive', () => {
        it('is false when everything is default', () => {
            expect(isQueryHistoryFilterActive({})).toBe(false);
            expect(
                isQueryHistoryFilterActive({
                    search: '  ',
                    outcome: 'any',
                    timeRange: 'all',
                }),
            ).toBe(false);
        });

        it('is true when search, outcome, or time range is set', () => {
            expect(isQueryHistoryFilterActive({search: 'select'})).toBe(true);
            expect(isQueryHistoryFilterActive({outcome: 'failed'})).toBe(true);
            expect(isQueryHistoryFilterActive({timeRange: 'today'})).toBe(true);
        });

        it('is true when a database choice other than all is set', () => {
            expect(isQueryHistoryFilterActive({database: 'all'})).toBe(false);
            expect(isQueryHistoryFilterActive({database: 'none'})).toBe(true);
            expect(
                isQueryHistoryFilterActive({
                    database: queryHistoryDatabaseFilterFor('sales'),
                }),
            ).toBe(true);
        });

        it('is true when either side of the custom date range is set', () => {
            expect(isQueryHistoryFilterActive({from: '2026-04-10'})).toBe(true);
            expect(isQueryHistoryFilterActive({to: '2026-04-10'})).toBe(true);
            expect(isQueryHistoryFilterActive({from: '  ', to: ''})).toBe(false);
        });

        it('is false when the custom range mode is picked without dates', () => {
            expect(isQueryHistoryFilterActive({timeRange: 'custom'})).toBe(false);
        });
    });

    describe('validateQueryHistoryDateRange', () => {
        it('accepts an empty range', () => {
            expect(validateQueryHistoryDateRange()).toBeNull();
            expect(validateQueryHistoryDateRange('', '')).toBeNull();
            expect(validateQueryHistoryDateRange('   ', undefined)).toBeNull();
        });

        it('accepts a range with one open-ended side', () => {
            expect(validateQueryHistoryDateRange('2026-04-10', '')).toBeNull();
            expect(validateQueryHistoryDateRange('', '2026-04-10')).toBeNull();
        });

        it('accepts a same-day range', () => {
            expect(validateQueryHistoryDateRange('2026-04-10', '2026-04-10')).toBeNull();
        });

        it('rejects an unparseable boundary', () => {
            expect(validateQueryHistoryDateRange('2026-04-31', '2026-04-10')).toBe('invalidFrom');
            expect(validateQueryHistoryDateRange('2026-04-01', 'not-a-date')).toBe('invalidTo');
        });

        it('rejects an inverted range', () => {
            expect(validateQueryHistoryDateRange('2026-04-15', '2026-04-10')).toBe('inverted');
        });
    });

    describe('filterQueryHistoryEntries', () => {
        it('returns the same array when no filter is active', () => {
            const result = filterQueryHistoryEntries(SAMPLE, {now: NOW});
            expect(result).toBe(SAMPLE);
        });

        it('filters by case-insensitive SQL search', () => {
            const result = filterQueryHistoryEntries(SAMPLE, {
                search: 'from users',
                now: NOW,
            });
            expect(result.map((e) => e.id)).toEqual(['ok-recent', 'ok-yesterday', 'fail-week']);
        });

        it('filters by outcome', () => {
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    outcome: 'succeeded',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'ok-yesterday', 'ok-mid', 'ok-old']);

            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    outcome: 'failed',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['fail-recent', 'fail-week']);
        });

        it('filters by last hour as a rolling window', () => {
            const result = filterQueryHistoryEntries(SAMPLE, {
                timeRange: 'lastHour',
                now: NOW,
            });
            expect(result.map((e) => e.id)).toEqual(['ok-recent', 'fail-recent']);
        });

        it('filters by today using the display timezone calendar day', () => {
            // 2026-04-14T16:00Z is already 2026-04-15 in Tokyo, still the 14th in UTC.
            const tokyoEdge = entry({
                id: 'tokyo-edge',
                sql: 'SELECT 1',
                executedAt: '2026-04-14T16:00:00.000Z',
            });
            const entries = [...SAMPLE, tokyoEdge];

            expect(
                filterQueryHistoryEntries(entries, {
                    timeRange: 'today',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent']);

            expect(
                filterQueryHistoryEntries(entries, {
                    timeRange: 'today',
                    now: NOW,
                    timeZone: 'Asia/Tokyo',
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent', 'tokyo-edge']);
        });

        it('filters by last 7 and 30 days as rolling windows', () => {
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    timeRange: 'last7Days',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent', 'ok-yesterday', 'fail-week']);

            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    timeRange: 'last30Days',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent', 'ok-yesterday', 'fail-week', 'ok-mid']);
        });

        it('combines search, outcome, and time range with AND', () => {
            const result = filterQueryHistoryEntries(SAMPLE, {
                search: 'users',
                outcome: 'failed',
                timeRange: 'last7Days',
                now: NOW,
            });
            expect(result.map((e) => e.id)).toEqual(['fail-week']);
        });

        it('excludes future timestamps from relative ranges', () => {
            const future = entry({
                id: 'future',
                sql: 'SELECT 1',
                executedAt: '2026-04-15T15:00:00.000Z',
            });
            expect(
                filterQueryHistoryEntries([future], {
                    timeRange: 'lastHour',
                    now: NOW,
                }),
            ).toEqual([]);
        });

        it('excludes invalid executedAt from time filters', () => {
            const bad = entry({
                id: 'bad-date',
                sql: 'SELECT 1',
                executedAt: 'not-a-date',
            });
            expect(
                filterQueryHistoryEntries([bad], {
                    timeRange: 'today',
                    now: NOW,
                    timeZone: 'UTC',
                }),
            ).toEqual([]);
            expect(
                filterQueryHistoryEntries([bad], {
                    search: 'SELECT',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['bad-date']);
        });
    });

    describe('database filter', () => {
        const DB_ENTRIES: QueryHistoryEntry[] = [
            entry({id: 'sales-1', sql: 'SELECT * FROM orders', database: 'sales'}),
            entry({
                id: 'hr-fail',
                sql: 'SELECT * FROM staff',
                database: 'hr',
                status: 'error',
            }),
            entry({id: 'legacy', sql: 'SELECT * FROM orders', database: null}),
            entry({id: 'empty-db', sql: 'SELECT 2', database: ''}),
            entry({
                id: 'sales-2',
                sql: 'UPDATE orders SET paid = true',
                database: 'sales',
                status: 'error',
            }),
            entry({id: 'sales-upper', sql: 'SELECT 3', database: 'Sales'}),
        ];

        it('keeps only the entries recorded for the chosen database', () => {
            expect(
                filterQueryHistoryEntries(DB_ENTRIES, {
                    database: queryHistoryDatabaseFilterFor('sales'),
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['sales-1', 'sales-2']);
        });

        it('keeps only entries without a recorded database for the none choice', () => {
            expect(
                filterQueryHistoryEntries(DB_ENTRIES, {
                    database: 'none',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['legacy', 'empty-db']);
        });

        it('does not confuse a database named like a choice with that choice', () => {
            const entries = [
                entry({id: 'named-all', sql: 'SELECT 1', database: 'all'}),
                entry({id: 'named-none', sql: 'SELECT 1', database: 'none'}),
                entry({id: 'unrecorded', sql: 'SELECT 1', database: null}),
            ];
            expect(
                filterQueryHistoryEntries(entries, {
                    database: queryHistoryDatabaseFilterFor('none'),
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['named-none']);
            expect(
                filterQueryHistoryEntries(entries, {
                    database: queryHistoryDatabaseFilterFor('all'),
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['named-all']);
        });

        it('combines the database with search, outcome and time range using AND', () => {
            expect(
                filterQueryHistoryEntries(DB_ENTRIES, {
                    database: queryHistoryDatabaseFilterFor('sales'),
                    search: 'orders',
                    outcome: 'failed',
                    timeRange: 'lastHour',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['sales-2']);
            expect(
                filterQueryHistoryEntries(DB_ENTRIES, {
                    database: 'none',
                    search: 'orders',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['legacy']);
        });

        it('lists the loaded databases once, sorted, and flags unrecorded entries', () => {
            expect(getQueryHistoryDatabaseChoices(DB_ENTRIES)).toEqual({
                databases: ['hr', 'sales', 'Sales'],
                hasUnrecorded: true,
            });
            expect(
                getQueryHistoryDatabaseChoices(DB_ENTRIES.filter((e) => e.database === 'sales')),
            ).toEqual({databases: ['sales'], hasUnrecorded: false});
            expect(getQueryHistoryDatabaseChoices([])).toEqual({
                databases: [],
                hasUnrecorded: false,
            });
        });

        it('reports whether a choice still exists among the loaded entries', () => {
            const choices = getQueryHistoryDatabaseChoices(DB_ENTRIES);
            expect(isQueryHistoryDatabaseFilterAvailable('all', choices)).toBe(true);
            expect(isQueryHistoryDatabaseFilterAvailable('none', choices)).toBe(true);
            expect(
                isQueryHistoryDatabaseFilterAvailable(queryHistoryDatabaseFilterFor('hr'), choices),
            ).toBe(true);
            expect(
                isQueryHistoryDatabaseFilterAvailable(
                    queryHistoryDatabaseFilterFor('billing'),
                    choices,
                ),
            ).toBe(false);

            const recordedOnly = getQueryHistoryDatabaseChoices(
                DB_ENTRIES.filter((e) => e.database === 'hr'),
            );
            expect(isQueryHistoryDatabaseFilterAvailable('none', recordedOnly)).toBe(false);
            expect(
                isQueryHistoryDatabaseFilterAvailable('all', {databases: [], hasUnrecorded: false}),
            ).toBe(true);
        });
    });

    describe('filterQueryHistoryEntries custom date range', () => {
        it('applies no rolling window when the range is custom', () => {
            // "custom" is a mode, not a rolling preset: with no explicit bounds it
            // must not fall through to the 30-day window of last30Days.
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    timeRange: 'custom',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual([
                'ok-recent',
                'fail-recent',
                'ok-yesterday',
                'fail-week',
                'ok-mid',
                'ok-old',
            ]);
        });

        it('applies the custom bounds when the range is custom', () => {
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    timeRange: 'custom',
                    from: '2026-04-10',
                    to: '2026-04-14',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['ok-yesterday', 'fail-week']);
        });

        it('includes both boundary days', () => {
            const result = filterQueryHistoryEntries(SAMPLE, {
                from: '2026-04-10',
                to: '2026-04-14',
                now: NOW,
                timeZone: 'UTC',
            });
            expect(result.map((e) => e.id)).toEqual(['ok-yesterday', 'fail-week']);
        });

        it('shifts the boundaries with the display timezone', () => {
            // 2026-04-14T16:00Z is already 2026-04-15 in Tokyo, still the 14th in UTC.
            const tokyoEdge = entry({
                id: 'tokyo-edge',
                sql: 'SELECT 1',
                executedAt: '2026-04-14T16:00:00.000Z',
            });
            const entries = [...SAMPLE, tokyoEdge];

            expect(
                filterQueryHistoryEntries(entries, {
                    from: '2026-04-15',
                    to: '2026-04-15',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent']);

            expect(
                filterQueryHistoryEntries(entries, {
                    from: '2026-04-15',
                    to: '2026-04-15',
                    now: NOW,
                    timeZone: 'Asia/Tokyo',
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent', 'tokyo-edge']);
        });

        it('treats a missing boundary as open-ended', () => {
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    from: '2026-04-15',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'fail-recent']);

            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    to: '2026-04-10',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['fail-week', 'ok-mid', 'ok-old']);
        });

        it('keeps the whole boundary day, from midnight to midnight', () => {
            const dayEntries = [
                entry({
                    id: 'before-day',
                    sql: 'SELECT 1',
                    executedAt: '2026-04-09T23:59:59.999Z',
                }),
                entry({
                    id: 'day-start',
                    sql: 'SELECT 2',
                    executedAt: '2026-04-10T00:00:00.000Z',
                }),
                entry({
                    id: 'day-end',
                    sql: 'SELECT 3',
                    executedAt: '2026-04-10T23:59:59.999Z',
                }),
                entry({
                    id: 'after-day',
                    sql: 'SELECT 4',
                    executedAt: '2026-04-11T00:00:00.000Z',
                }),
            ];

            expect(
                filterQueryHistoryEntries(dayEntries, {
                    from: '2026-04-10',
                    to: '2026-04-10',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['day-start', 'day-end']);
        });

        it('survives a daylight-saving transition', () => {
            // America/New_York springs forward on 2026-03-08, so that calendar day
            // is only 23 hours long - the boundary cannot be a fixed offset.
            const dstEntries = [
                entry({
                    id: 'dst-previous-day',
                    sql: 'SELECT 1',
                    executedAt: '2026-03-08T04:00:00.000Z', // 2026-03-07 23:00 EST
                }),
                entry({
                    id: 'dst-day-start',
                    sql: 'SELECT 2',
                    executedAt: '2026-03-08T05:00:00.000Z', // 2026-03-08 00:00 EST
                }),
                entry({
                    id: 'dst-day-end',
                    sql: 'SELECT 3',
                    executedAt: '2026-03-09T03:59:00.000Z', // 2026-03-08 23:59 EDT
                }),
                entry({
                    id: 'dst-next-day',
                    sql: 'SELECT 4',
                    executedAt: '2026-03-09T04:00:00.000Z', // 2026-03-09 00:00 EDT
                }),
            ];

            expect(
                filterQueryHistoryEntries(dstEntries, {
                    from: '2026-03-08',
                    to: '2026-03-08',
                    now: NOW,
                    timeZone: 'America/New_York',
                }).map((e) => e.id),
            ).toEqual(['dst-day-start', 'dst-day-end']);
        });

        it('returns nothing for an inverted or unparseable range', () => {
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    from: '2026-04-15',
                    to: '2026-04-10',
                    now: NOW,
                    timeZone: 'UTC',
                }),
            ).toEqual([]);

            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    from: '2026-04-31',
                    to: '2026-04-10',
                    now: NOW,
                    timeZone: 'UTC',
                }),
            ).toEqual([]);
        });

        it('combines the custom range with search and outcome', () => {
            // "SELECT * FROM missing" does not contain "users", so only the DELETE
            // entry survives the combined text + outcome + range filter.
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    search: 'users',
                    outcome: 'failed',
                    from: '2026-04-10',
                    to: '2026-04-15',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['fail-week']);
        });

        it('combines the custom range with search alone', () => {
            expect(
                filterQueryHistoryEntries(SAMPLE, {
                    search: 'users',
                    from: '2026-04-10',
                    to: '2026-04-15',
                    now: NOW,
                    timeZone: 'UTC',
                }).map((e) => e.id),
            ).toEqual(['ok-recent', 'ok-yesterday', 'fail-week']);
        });

        it('excludes invalid executedAt from the custom range', () => {
            const bad = entry({
                id: 'bad-date',
                sql: 'SELECT 1',
                executedAt: 'not-a-date',
            });
            expect(
                filterQueryHistoryEntries([bad], {
                    from: '2026-04-10',
                    to: '2026-04-15',
                    now: NOW,
                    timeZone: 'UTC',
                }),
            ).toEqual([]);
        });
    });
});
