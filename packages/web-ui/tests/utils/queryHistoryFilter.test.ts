import {describe, it, expect} from 'vitest';
import type {QueryHistoryEntry} from '@/types/queryHistory';
import {
    filterQueryHistoryEntries,
    getQueryHistoryDatabaseChoices,
    isQueryHistoryDatabaseFilterAvailable,
    isQueryHistoryFilterActive,
    parseQueryHistoryMinDuration,
    queryHistoryDatabaseFilterFor,
    validateQueryHistoryDateRange,
    validateQueryHistoryMinDuration,
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

describe('queryHistoryFilter minimum duration (#1397)', () => {
    const TIMED: QueryHistoryEntry[] = [
        entry({id: 'zero', sql: 'SELECT 0', executionTimeMs: 0}),
        entry({id: 'fast', sql: 'SELECT 1', executionTimeMs: 10}),
        entry({id: 'edge', sql: 'SELECT 2', executionTimeMs: 500, status: 'error'}),
        entry({id: 'slow', sql: 'SELECT 3', executionTimeMs: 1500, database: 'sales'}),
        entry({id: 'unknown', sql: 'SELECT 4', executionTimeMs: null}),
    ];

    describe('validateQueryHistoryMinDuration', () => {
        it('accepts an empty field and plain decimal numbers', () => {
            expect(validateQueryHistoryMinDuration(undefined)).toBeNull();
            expect(validateQueryHistoryMinDuration('')).toBeNull();
            expect(validateQueryHistoryMinDuration('   ')).toBeNull();
            expect(validateQueryHistoryMinDuration('0')).toBeNull();
            expect(validateQueryHistoryMinDuration(' 500 ')).toBeNull();
            expect(validateQueryHistoryMinDuration('2.5')).toBeNull();
            expect(validateQueryHistoryMinDuration('.5')).toBeNull();
        });

        it('rejects anything that is not a plain decimal number', () => {
            expect(validateQueryHistoryMinDuration('abc')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('500ms')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('1e3')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('0x10')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('Infinity')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('NaN')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('1,000')).toBe('invalid');
            expect(validateQueryHistoryMinDuration('1'.repeat(400))).toBe('invalid');
        });

        it('reports a negative number separately', () => {
            expect(validateQueryHistoryMinDuration('-1')).toBe('negative');
            expect(validateQueryHistoryMinDuration('-0.5')).toBe('negative');
            // A stray sign without digits is not a negative number.
            expect(validateQueryHistoryMinDuration('-')).toBe('invalid');
        });
    });

    describe('parseQueryHistoryMinDuration', () => {
        it('returns the threshold in milliseconds, or null when empty or unusable', () => {
            expect(parseQueryHistoryMinDuration('')).toBeNull();
            expect(parseQueryHistoryMinDuration(undefined)).toBeNull();
            expect(parseQueryHistoryMinDuration('0')).toBe(0);
            expect(parseQueryHistoryMinDuration(' 500 ')).toBe(500);
            expect(parseQueryHistoryMinDuration('2.5')).toBe(2.5);
            expect(parseQueryHistoryMinDuration('abc')).toBeNull();
            expect(parseQueryHistoryMinDuration('-1')).toBeNull();
        });
    });

    describe('isQueryHistoryFilterActive', () => {
        it('counts any typed threshold, zero included, but not whitespace', () => {
            expect(isQueryHistoryFilterActive({minDurationMs: ''})).toBe(false);
            expect(isQueryHistoryFilterActive({minDurationMs: '  '})).toBe(false);
            expect(isQueryHistoryFilterActive({minDurationMs: '0'})).toBe(true);
            expect(isQueryHistoryFilterActive({minDurationMs: '500'})).toBe(true);
            expect(isQueryHistoryFilterActive({minDurationMs: 'abc'})).toBe(true);
        });
    });

    describe('filterQueryHistoryEntries', () => {
        it('returns the same array when the threshold is unset', () => {
            expect(filterQueryHistoryEntries(TIMED, {minDurationMs: ''})).toBe(TIMED);
            expect(filterQueryHistoryEntries(TIMED, {minDurationMs: '   '})).toBe(TIMED);
        });

        it('keeps entries at or above the threshold', () => {
            const ids = filterQueryHistoryEntries(TIMED, {minDurationMs: '500'}).map((e) => e.id);
            expect(ids).toEqual(['edge', 'slow']);
        });

        it('treats zero as a threshold and hides entries without a duration', () => {
            const ids = filterQueryHistoryEntries(TIMED, {minDurationMs: '0'}).map((e) => e.id);
            expect(ids).toEqual(['zero', 'fast', 'edge', 'slow']);
        });

        it('keeps a recorded zero distinct from a missing duration', () => {
            const ids = filterQueryHistoryEntries(TIMED, {minDurationMs: '0.0'}).map((e) => e.id);
            expect(ids).toContain('zero');
            expect(ids).not.toContain('unknown');
        });

        it('accepts fractional thresholds and surrounding whitespace', () => {
            expect(
                filterQueryHistoryEntries(TIMED, {minDurationMs: ' 9.5 '}).map((e) => e.id),
            ).toEqual(['fast', 'edge', 'slow']);
        });

        it('matches nothing for a negative, nonnumeric or nonfinite threshold', () => {
            expect(filterQueryHistoryEntries(TIMED, {minDurationMs: '-1'})).toEqual([]);
            expect(filterQueryHistoryEntries(TIMED, {minDurationMs: 'abc'})).toEqual([]);
            expect(filterQueryHistoryEntries(TIMED, {minDurationMs: 'Infinity'})).toEqual([]);
            expect(filterQueryHistoryEntries(TIMED, {minDurationMs: '1e3'})).toEqual([]);
        });

        it('combines the threshold with the other filters using AND', () => {
            expect(
                filterQueryHistoryEntries(TIMED, {minDurationMs: '500', outcome: 'failed'}).map(
                    (e) => e.id,
                ),
            ).toEqual(['edge']);
            expect(
                filterQueryHistoryEntries(TIMED, {
                    minDurationMs: '500',
                    database: queryHistoryDatabaseFilterFor('sales'),
                }).map((e) => e.id),
            ).toEqual(['slow']);
            expect(
                filterQueryHistoryEntries(TIMED, {minDurationMs: '500', search: 'select 3'}).map(
                    (e) => e.id,
                ),
            ).toEqual(['slow']);
            expect(
                filterQueryHistoryEntries(TIMED, {
                    minDurationMs: '500',
                    timeRange: 'lastHour',
                    now: NOW,
                }).map((e) => e.id),
            ).toEqual(['edge', 'slow']);
            expect(
                filterQueryHistoryEntries(TIMED, {minDurationMs: '2000', outcome: 'any'}),
            ).toEqual([]);
        });
    });
});

describe('queryHistoryFilter error message search', () => {
    const ERROR_ENTRIES: QueryHistoryEntry[] = [
        entry({
            id: 'denied',
            sql: 'SELECT * FROM payroll',
            status: 'error',
            error: 'ERROR: Permission denied for table payroll',
            database: 'hr',
            executionTimeMs: 40,
        }),
        entry({
            id: 'sql-mentions-it',
            sql: "SELECT 'permission denied' AS note",
            database: 'hr',
        }),
        entry({
            id: 'other-error',
            sql: 'SELECT * FROM missing',
            status: 'error',
            error: 'relation missing does not exist',
            database: 'sales',
        }),
        entry({id: 'legacy-failure', sql: 'DELETE FROM users', status: 'error', error: null}),
        entry({
            id: 'old-denied',
            sql: 'UPDATE payroll SET paid = true',
            executedAt: '2026-03-01T10:00:00.000Z',
            status: 'error',
            error: 'permission denied for table payroll',
            database: 'hr',
            executionTimeMs: 5,
        }),
    ];

    const ids = (options: Parameters<typeof filterQueryHistoryEntries>[1]) =>
        filterQueryHistoryEntries(ERROR_ENTRIES, {now: NOW, timeZone: 'UTC', ...options}).map(
            (e) => e.id,
        );

    it('searches the SQL only by default', () => {
        expect(ids({search: 'permission denied'})).toEqual(['sql-mentions-it']);
        expect(ids({search: 'permission denied', searchErrors: false})).toEqual([
            'sql-mentions-it',
        ]);
    });

    it('matches the SQL or the recorded error when enabled', () => {
        expect(ids({search: 'permission denied', searchErrors: true})).toEqual([
            'denied',
            'sql-mentions-it',
            'old-denied',
        ]);
    });

    it('matches an entry through its error message alone', () => {
        expect(ids({search: 'does not exist', searchErrors: true})).toEqual(['other-error']);
        expect(ids({search: 'does not exist'})).toEqual([]);
    });

    it('still matches through the SQL when enabled', () => {
        expect(ids({search: 'from users', searchErrors: true})).toEqual(['legacy-failure']);
    });

    it('ignores case and surrounding spaces in the error search', () => {
        expect(ids({search: '  PERMISSION Denied  ', searchErrors: true})).toEqual([
            'denied',
            'sql-mentions-it',
            'old-denied',
        ]);
    });

    it('treats a missing error as no match instead of failing', () => {
        const noError = [
            entry({id: 'null-error', sql: 'SELECT 1', status: 'error', error: null}),
            entry({id: 'empty-error', sql: 'SELECT 2', status: 'error', error: ''}),
            {
                ...entry({id: 'undefined-error', sql: 'SELECT 3', status: 'error'}),
                error: undefined as unknown as string | null,
            },
        ];
        expect(
            filterQueryHistoryEntries(noError, {search: 'denied', searchErrors: true, now: NOW}),
        ).toEqual([]);
        expect(
            filterQueryHistoryEntries(noError, {
                search: 'select',
                searchErrors: true,
                now: NOW,
            }).map((e) => e.id),
        ).toEqual(['null-error', 'empty-error', 'undefined-error']);
    });

    it('matches every entry for an empty or blank query', () => {
        expect(filterQueryHistoryEntries(ERROR_ENTRIES, {searchErrors: true, now: NOW})).toBe(
            ERROR_ENTRIES,
        );
        expect(
            filterQueryHistoryEntries(ERROR_ENTRIES, {search: '   ', searchErrors: true, now: NOW}),
        ).toBe(ERROR_ENTRIES);
    });

    it('combines the text match with outcome, date, database and duration using AND', () => {
        expect(ids({search: 'permission denied', searchErrors: true, outcome: 'failed'})).toEqual([
            'denied',
            'old-denied',
        ]);
        expect(ids({search: 'permission denied', searchErrors: true, timeRange: 'today'})).toEqual([
            'denied',
            'sql-mentions-it',
        ]);
        expect(
            ids({
                search: 'permission denied',
                searchErrors: true,
                timeRange: 'custom',
                from: '2026-03-01',
                to: '2026-03-01',
            }),
        ).toEqual(['old-denied']);
        expect(
            ids({
                search: 'denied',
                searchErrors: true,
                database: queryHistoryDatabaseFilterFor('sales'),
            }),
        ).toEqual([]);
        expect(ids({search: 'denied', searchErrors: true, minDurationMs: '20'})).toEqual([
            'denied',
        ]);
    });

    it('leaves the entries untouched', () => {
        const before = structuredClone(ERROR_ENTRIES);
        ids({search: 'permission denied', searchErrors: true, outcome: 'failed'});
        expect(ERROR_ENTRIES).toEqual(before);
    });
});
