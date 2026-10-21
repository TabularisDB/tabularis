import {describe, it, expect, vi} from 'vitest';
import {
    COLUMN_STATS_TOP_VALUES_LIMIT,
    buildColumnStatsQuery,
    buildColumnStatsRequest,
    formatColumnStatValue,
    fromPluginColumnStats,
    getColumnStatsSource,
    getColumnStatsSupport,
    isColumnStatsAbort,
    loadColumnStats,
    loadPluginColumnStats,
    parseColumnStats,
    percentOf,
} from '@/utils/columnStats';
import type {ColumnStatsSupport} from '@/utils/columnStats';
import type {DriverCapabilities} from '@/types/plugins';

const ALL: ColumnStatsSupport = {distinct: true, minMax: true, topValues: true};
const COUNTS_ONLY: ColumnStatsSupport = {distinct: false, minMax: false, topValues: false};

describe('columnStats', () => {
    describe('getColumnStatsSupport', () => {
        it.each([
            'integer',
            'BIGINT',
            'numeric(10,2)',
            'double precision',
            'decimal(8,3)',
            'real',
            'date',
            'datetime(3)',
            'timestamp(6) with time zone',
            'timestamptz',
            'time',
        ])('computes min / max for %s', (type) => {
            expect(getColumnStatsSupport(type)).toEqual(ALL);
        });

        it.each([
            'ARRAY<INT64>',
            'STRUCT<name STRING, age INT64>',
            'ARRAY<STRUCT<id INT64>>',
            'MAP<STRING, INT64>',
            'RECORD',
            'STRING REPEATED',
        ])('only counts rows and NULLs for the nested type %s', (type) => {
            expect(getColumnStatsSupport(type)).toEqual(COUNTS_ONLY);
        });

        it('keeps PostgreSQL arrays groupable', () => {
            expect(getColumnStatsSupport('ARRAY')).toEqual({
                distinct: true,
                minMax: false,
                topValues: true,
            });
        });

        it.each(['varchar(255)', 'text', 'uuid', 'boolean', "enum('a','b')", ''])(
            'skips min / max but lists top values for %s',
            (type) => {
                expect(getColumnStatsSupport(type)).toEqual({
                    distinct: true,
                    minMax: false,
                    topValues: true,
                });
            },
        );

        it.each(['BLOB', 'longblob', 'bytea', 'varbinary(70000)'])(
            'only counts rows, NULLs and distinct values for binary %s',
            (type) => {
                expect(getColumnStatsSupport(type)).toEqual({
                    distinct: true,
                    minMax: false,
                    topValues: false,
                });
            },
        );

        it('keeps top values off for a short VARBINARY, like the value picker', () => {
            expect(getColumnStatsSupport('varbinary(16)', {characterMaximumLength: 16})).toEqual({
                distinct: true,
                minMax: false,
                topValues: false,
            });
        });

        it.each([
            'json',
            'JSONB',
            'xml',
            'geometry',
            'POINT',
            'multipolygon',
            'geography(Point,4326)',
            'box',
            'circle',
            'line',
            'lseg',
            'path',
        ])('only counts rows and NULLs for %s', (type) => {
            expect(getColumnStatsSupport(type)).toEqual(COUNTS_ONLY);
        });

        it('never computes min / max or top values for a masked column', () => {
            expect(getColumnStatsSupport('integer', {masked: true})).toEqual({
                distinct: true,
                minMax: false,
                topValues: false,
            });
            expect(getColumnStatsSupport('varchar', {masked: true})).toEqual({
                distinct: true,
                minMax: false,
                topValues: false,
            });
        });
    });

    describe('buildColumnStatsQuery', () => {
        it('builds the aggregates for postgres with a schema', () => {
            expect(
                buildColumnStatsQuery({
                    table: 'orders',
                    schema: 'public',
                    column: 'Total',
                    driver: 'postgres',
                    support: ALL,
                }),
            ).toBe(
                'SELECT COUNT(*), COUNT(*) - COUNT("Total"), COUNT(DISTINCT "Total"), ' +
                    'MIN("Total"), MAX("Total") FROM "public"."orders"',
            );
        });

        it('uses backticks for mysql and mariadb', () => {
            for (const driver of ['mysql', 'mariadb']) {
                expect(
                    buildColumnStatsQuery({
                        table: 'orders',
                        column: 'order',
                        driver,
                        support: ALL,
                    }),
                ).toBe(
                    'SELECT COUNT(*), COUNT(*) - COUNT(`order`), COUNT(DISTINCT `order`), ' +
                        'MIN(`order`), MAX(`order`) FROM `orders`',
                );
            }
        });

        it('uses double quotes for sqlite', () => {
            expect(
                buildColumnStatsQuery({
                    table: 'orders',
                    column: 'status',
                    driver: 'sqlite',
                    support: {distinct: true, minMax: false, topValues: true},
                }),
            ).toBe(
                'SELECT COUNT(*), COUNT(*) - COUNT("status"), COUNT(DISTINCT "status") FROM "orders"',
            );
        });

        it('follows the identifier quote from driver capabilities', () => {
            const caps = {identifier_quote: '`', sql_dialect: 'mysql'} as DriverCapabilities;
            expect(
                buildColumnStatsQuery({
                    table: 't',
                    schema: 'db',
                    column: 'c',
                    driver: caps,
                    support: COUNTS_ONLY,
                }),
            ).toBe('SELECT COUNT(*), COUNT(*) - COUNT(`c`) FROM `db`.`t`');
        });

        it('escapes quote characters inside identifiers', () => {
            expect(
                buildColumnStatsQuery({
                    table: 't',
                    column: 'we"ird',
                    driver: 'postgres',
                    support: COUNTS_ONLY,
                }),
            ).toBe('SELECT COUNT(*), COUNT(*) - COUNT("we""ird") FROM "t"');
            expect(
                buildColumnStatsQuery({
                    table: 't',
                    column: 'we`ird',
                    driver: 'mysql',
                    support: COUNTS_ONLY,
                }),
            ).toBe('SELECT COUNT(*), COUNT(*) - COUNT(`we``ird`) FROM `t`');
        });

        it('applies the current filter in parentheses', () => {
            expect(
                buildColumnStatsQuery({
                    table: 'orders',
                    column: 'status',
                    driver: 'sqlite',
                    where: '  a = 1 OR b = 2 ',
                    support: COUNTS_ONLY,
                }),
            ).toBe(
                'SELECT COUNT(*), COUNT(*) - COUNT("status") FROM "orders" WHERE (a = 1 OR b = 2)',
            );
        });

        it('ignores a blank filter', () => {
            expect(
                buildColumnStatsQuery({
                    table: 't',
                    column: 'c',
                    driver: 'sqlite',
                    where: '   ',
                    support: COUNTS_ONLY,
                }),
            ).not.toContain('WHERE');
        });
    });

    describe('parseColumnStats', () => {
        it('reads the columns in the order they were built', () => {
            expect(parseColumnStats([[10, 2, 7, 1, 99]], ALL)).toEqual({
                rowCount: 10,
                nullCount: 2,
                distinctCount: 7,
                min: 1,
                max: 99,
            });
        });

        it('skips the columns that were not computed', () => {
            expect(parseColumnStats([[10, 2]], COUNTS_ONLY)).toEqual({
                rowCount: 10,
                nullCount: 2,
                distinctCount: null,
                min: null,
                max: null,
            });
            expect(
                parseColumnStats([[10, 2, 7]], {distinct: true, minMax: false, topValues: true}),
            ).toMatchObject({distinctCount: 7, min: null, max: null});
        });

        it('accepts counts returned as strings (64-bit integers)', () => {
            expect(
                parseColumnStats([['9007199254740993', '0', '12']], {
                    distinct: true,
                    minMax: false,
                    topValues: false,
                }),
            ).toMatchObject({rowCount: 9007199254740992, nullCount: 0, distinctCount: 12});
        });

        it('keeps NULL min / max for a NULL-only column', () => {
            expect(parseColumnStats([[3, 3, 0, null, null]], ALL)).toEqual({
                rowCount: 3,
                nullCount: 3,
                distinctCount: 0,
                min: null,
                max: null,
            });
        });

        it('returns zeros when no row came back', () => {
            expect(parseColumnStats([], ALL)).toEqual({
                rowCount: 0,
                nullCount: 0,
                distinctCount: 0,
                min: null,
                max: null,
            });
        });
    });

    describe('loadColumnStats', () => {
        const options = {
            table: 'orders',
            column: 'status',
            driver: 'postgres',
            support: {distinct: true, minMax: false, topValues: true},
        };

        it('runs the aggregates, then the top values with the same filter and a small limit', async () => {
            const run = vi
                .fn()
                .mockResolvedValueOnce({rows: [[5, 1, 2]]})
                .mockResolvedValueOnce({
                    rows: [
                        ['open', 3],
                        ['closed', 1],
                    ],
                });

            const stats = await loadColumnStats(run, {...options, where: 'id > 1'});

            expect(run).toHaveBeenCalledTimes(2);
            expect(run.mock.calls[0][0]).toBe(
                'SELECT COUNT(*), COUNT(*) - COUNT("status"), COUNT(DISTINCT "status") ' +
                    'FROM "orders" WHERE (id > 1)',
            );
            expect(run.mock.calls[1][0]).toBe(
                'SELECT "status", COUNT(*) FROM "orders" WHERE "status" IS NOT NULL AND (id > 1) ' +
                    `GROUP BY "status" ORDER BY 2 DESC, 1 LIMIT ${COLUMN_STATS_TOP_VALUES_LIMIT}`,
            );
            expect(stats).toEqual({
                rowCount: 5,
                nullCount: 1,
                distinctCount: 2,
                min: null,
                max: null,
                topValues: [
                    {value: 'open', count: 3},
                    {value: 'closed', count: 1},
                ],
                filtered: true,
            });
        });

        it('skips the top values query when every value is NULL or the table is empty', async () => {
            for (const row of [
                [4, 4, 0],
                [0, 0, 0],
            ]) {
                const run = vi.fn().mockResolvedValue({rows: [row]});
                const stats = await loadColumnStats(run, options);
                expect(run).toHaveBeenCalledTimes(1);
                expect(stats.topValues).toEqual([]);
                expect(stats.filtered).toBe(false);
            }
        });

        it("skips the top values query when the column doesn't support them", async () => {
            const run = vi.fn().mockResolvedValue({rows: [[4, 0]]});
            const stats = await loadColumnStats(run, {...options, support: COUNTS_ONLY});
            expect(run).toHaveBeenCalledTimes(1);
            expect(stats.topValues).toBeNull();
            expect(stats.distinctCount).toBeNull();
        });

        it('passes the signal to the runner and starts nothing once aborted', async () => {
            const controller = new AbortController();
            const run = vi.fn().mockImplementation(async () => {
                controller.abort();
                return {rows: [[5, 0, 5]]};
            });

            const result = loadColumnStats(run, options, controller.signal);

            await expect(result).rejects.toSatisfy(isColumnStatsAbort);
            expect(run).toHaveBeenCalledTimes(1);
            expect(run.mock.calls[0][1]).toBe(controller.signal);
        });

        it('does not run anything with an already aborted signal', async () => {
            const controller = new AbortController();
            controller.abort();
            const run = vi.fn();
            await expect(loadColumnStats(run, options, controller.signal)).rejects.toSatisfy(
                isColumnStatsAbort,
            );
            expect(run).not.toHaveBeenCalled();
        });

        it('propagates query errors', async () => {
            const run = vi.fn().mockRejectedValue(new Error('permission denied'));
            await expect(loadColumnStats(run, options)).rejects.toThrow('permission denied');
            expect(isColumnStatsAbort(new Error('permission denied'))).toBe(false);
        });
    });

    describe('formatColumnStatValue', () => {
        it('formats numbers, strings and objects', () => {
            expect(formatColumnStatValue(42)).toBe('42');
            expect(formatColumnStatValue('2024-01-01')).toBe('2024-01-01');
            expect(formatColumnStatValue({a: 1})).toBe('{"a":1}');
            expect(formatColumnStatValue(null)).toBe('');
        });
    });

    describe('percentOf', () => {
        it('returns the share as a percentage and 0 for an empty total', () => {
            expect(percentOf(1, 4)).toBe(25);
            expect(percentOf(3, 0)).toBe(0);
        });
    });
});

describe('columnStats for plugin drivers (#1137)', () => {
    const caps = (overrides: Partial<DriverCapabilities> = {}): DriverCapabilities => ({
        schemas: false,
        views: false,
        routines: false,
        file_based: false,
        folder_based: false,
        identifier_quote: '"',
        alter_primary_key: false,
        ...overrides,
    });

    describe('getColumnStatsSource', () => {
        it('uses the plugin RPC when the plugin opts in, whatever its dialect', () => {
            expect(getColumnStatsSource(caps({column_stats: true}))).toBe('plugin');
            expect(getColumnStatsSource(caps({column_stats: true, sql_dialect: 'mysql'}))).toBe(
                'plugin',
            );
        });

        it('keeps the generic SQL for built-in drivers and SQL-compatible plugins', () => {
            expect(getColumnStatsSource(caps({sql_dialect: 'postgres'}), {builtin: true})).toBe(
                'sql',
            );
            expect(getColumnStatsSource(null, {builtin: true})).toBe('sql');
            for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
                expect(getColumnStatsSource(caps({sql_dialect: dialect}))).toBe('sql');
            }
        });

        it('hides the entry for plugins that neither opt in nor speak the generic SQL', () => {
            expect(getColumnStatsSource(caps())).toBeNull();
            expect(getColumnStatsSource(caps({column_stats: false}))).toBeNull();
            for (const dialect of ['mssql', 'oracle', 'generic'] as const) {
                expect(getColumnStatsSource(caps({sql_dialect: dialect}))).toBeNull();
            }
            expect(getColumnStatsSource(null)).toBeNull();
            expect(getColumnStatsSource(undefined)).toBeNull();
        });
    });

    describe('buildColumnStatsRequest', () => {
        it('carries the identifiers unquoted, the filter, the top-N limit and the parts', () => {
            expect(
                buildColumnStatsRequest({
                    table: 'orders',
                    schema: 'sales',
                    column: 'order total',
                    dataType: 'decimal',
                    where: "  status = 'open' ",
                    support: {distinct: true, minMax: false, topValues: true},
                }),
            ).toEqual({
                table: 'orders',
                schema: 'sales',
                column: 'order total',
                data_type: 'decimal',
                filter: "status = 'open'",
                top_values_limit: COLUMN_STATS_TOP_VALUES_LIMIT,
                include: {distinct: true, min_max: false, top_values: true},
            });
        });

        it('sends null for a missing schema, type or blank filter', () => {
            expect(
                buildColumnStatsRequest({
                    table: 't',
                    column: 'c',
                    where: '  ',
                    support: COUNTS_ONLY,
                }),
            ).toMatchObject({schema: null, data_type: null, filter: null});
        });
    });

    describe('fromPluginColumnStats', () => {
        const result = {
            row_count: 10,
            null_count: 2,
            distinct_count: 3,
            min: 1,
            max: 9,
            top_values: [
                {value: 1, count: 5},
                {value: null, count: 2},
                {value: {nested: true}, count: 1},
            ],
        };

        it('maps the plugin result to the popover shape', () => {
            expect(fromPluginColumnStats(result, ALL, true)).toEqual({
                rowCount: 10,
                nullCount: 2,
                distinctCount: 3,
                min: 1,
                max: 9,
                topValues: [
                    {value: '1', count: 5},
                    {value: '{"nested":true}', count: 1},
                ],
                filtered: true,
                sampleSize: null,
            });
        });

        it("drops min / max and top values the host didn't ask for (masked columns)", () => {
            const masked = getColumnStatsSupport('integer', {masked: true});
            expect(fromPluginColumnStats(result, masked, false)).toMatchObject({
                distinctCount: 3,
                min: null,
                max: null,
                topValues: null,
            });
            expect(fromPluginColumnStats(result, COUNTS_ONLY, false).distinctCount).toBeNull();
        });

        it('caps top values at the limit and keeps the sample size', () => {
            const many = Array.from({length: 15}, (_, i) => ({value: i, count: 15 - i}));
            const stats = fromPluginColumnStats(
                {row_count: 100, null_count: 0, top_values: many, sample_size: 50},
                ALL,
                false,
            );
            expect(stats.topValues).toHaveLength(COLUMN_STATS_TOP_VALUES_LIMIT);
            expect(stats.sampleSize).toBe(50);
            expect(stats.distinctCount).toBeNull();
            expect(stats.min).toBeNull();
        });
    });

    describe('loadPluginColumnStats', () => {
        const options = {
            table: 'orders',
            column: 'status',
            where: 'id > 1',
            support: {distinct: true, minMax: false, topValues: true},
        };

        it('sends one request and converts the result', async () => {
            const fetchStats = vi.fn().mockResolvedValue({
                row_count: 5,
                null_count: 1,
                distinct_count: 2,
                top_values: [{value: 'open', count: 3}],
            });
            const signal = new AbortController().signal;
            const stats = await loadPluginColumnStats(fetchStats, options, signal);
            expect(fetchStats).toHaveBeenCalledTimes(1);
            expect(fetchStats.mock.calls[0][0]).toMatchObject({filter: 'id > 1', column: 'status'});
            expect(fetchStats.mock.calls[0][1]).toBe(signal);
            expect(stats).toMatchObject({
                rowCount: 5,
                distinctCount: 2,
                topValues: [{value: 'open', count: 3}],
                filtered: true,
            });
        });

        it("resolves to null when the plugin doesn't implement the method", async () => {
            const fetchStats = vi.fn().mockResolvedValue(null);
            await expect(loadPluginColumnStats(fetchStats, options)).resolves.toBeNull();
        });

        it('sends nothing once aborted and drops a late result', async () => {
            const aborted = new AbortController();
            aborted.abort();
            const idle = vi.fn();
            await expect(loadPluginColumnStats(idle, options, aborted.signal)).rejects.toSatisfy(
                isColumnStatsAbort,
            );
            expect(idle).not.toHaveBeenCalled();

            const controller = new AbortController();
            const late = vi.fn().mockImplementation(async () => {
                controller.abort();
                return {row_count: 1, null_count: 0};
            });
            await expect(loadPluginColumnStats(late, options, controller.signal)).rejects.toSatisfy(
                isColumnStatsAbort,
            );
        });

        it('propagates plugin errors', async () => {
            const fetchStats = vi.fn().mockRejectedValue(new Error('Invalid column statistics'));
            await expect(loadPluginColumnStats(fetchStats, options)).rejects.toThrow(
                'Invalid column statistics',
            );
        });
    });
});
