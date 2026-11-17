import {describe, it, expect} from 'vitest';
import type {QueryResult} from '@/types/editor';
import type {CellKpiConfig} from '@/types/notebook';
import {
    KPI_MAX_DECIMALS,
    buildDefaultKpiConfig,
    computeKpiState,
    formatExactDecimal,
    normalizeKpiDecimals,
    parseExactDecimal,
    roundExactDecimal,
    sanitizeKpiConfig,
} from '@/utils/notebookKpi';

function oneRow(columns: string[], row: unknown[]): QueryResult {
    return {columns, rows: [row], affected_rows: 0};
}

function format(value: unknown, decimals: number | null = null, locale = 'en-US'): string {
    const exact = parseExactDecimal(value);
    if (!exact) throw new Error(`not numeric: ${String(value)}`);
    return formatExactDecimal(exact, decimals, locale);
}

describe('notebookKpi', () => {
    describe('parseExactDecimal', () => {
        it.each([
            [0, {negative: false, integer: '0', fraction: ''}],
            [-0, {negative: false, integer: '0', fraction: ''}],
            [1240, {negative: false, integer: '1240', fraction: ''}],
            [-12.5, {negative: true, integer: '12', fraction: '5'}],
            [1e21, {negative: false, integer: '1' + '0'.repeat(21), fraction: ''}],
            [1.5e-7, {negative: false, integer: '0', fraction: '00000015'}],
            [
                12345678901234567890n,
                {negative: false, integer: '12345678901234567890', fraction: ''},
            ],
            ['00042.5000', {negative: false, integer: '42', fraction: '5'}],
            ['-0.000', {negative: false, integer: '0', fraction: ''}],
            ['+.5', {negative: false, integer: '0', fraction: '5'}],
            ['  7  ', {negative: false, integer: '7', fraction: ''}],
            ['1.25E3', {negative: false, integer: '1250', fraction: ''}],
            [
                '123456789012345678901234567890.123456789012345678901234567890',
                {
                    negative: false,
                    integer: '123456789012345678901234567890',
                    fraction: '12345678901234567890123456789',
                },
            ],
        ])('parses %s exactly', (value, expected) => {
            expect(parseExactDecimal(value)).toEqual(expected);
        });

        it.each([
            NaN,
            Infinity,
            -Infinity,
            '',
            '.',
            '-',
            'abc',
            '1,240',
            '12a',
            'NaN',
            'Infinity',
            '1e99999',
            true,
            null,
            undefined,
            {},
            [1],
        ])('rejects %s', (value) => {
            expect(parseExactDecimal(value)).toBeNull();
        });
    });

    describe('roundExactDecimal', () => {
        const round = (value: string, decimals: number) => {
            const r = roundExactDecimal(parseExactDecimal(value)!, decimals);
            return `${r.negative ? '-' : ''}${r.integer}${r.fraction ? `.${r.fraction}` : ''}`;
        };

        it('rounds half away from zero', () => {
            expect(round('2.5', 0)).toBe('3');
            expect(round('-2.5', 0)).toBe('-3');
            expect(round('2.45', 1)).toBe('2.5');
            expect(round('2.44', 1)).toBe('2.4');
        });

        it('carries through nines', () => {
            expect(round('9.995', 2)).toBe('10.00');
            expect(round('999999999999999999999.5', 0)).toBe('1000000000000000000000');
        });

        it('pads with zeros up to the requested places', () => {
            expect(round('3', 2)).toBe('3.00');
            expect(round('0.1', 3)).toBe('0.100');
        });

        it('drops the sign of values that round to zero', () => {
            expect(round('-0.004', 2)).toBe('0.00');
        });

        it('stays exact where floating point does not', () => {
            // 1.005 is 1.00499999999999989... as a double.
            expect(round('1.005', 2)).toBe('1.01');
            expect(round('0.1234567890123456789', 18)).toBe('0.123456789012345679');
        });
    });

    describe('formatExactDecimal', () => {
        it('groups digits for the locale', () => {
            expect(format(1240)).toBe('1,240');
            expect(format('1234567.891', null, 'de-DE')).toBe('1.234.567,891');
            expect(format('-1234.5', 2, 'fr-FR')).toMatch(/^-1\s234,50$/u);
        });

        it('keeps large integers exact', () => {
            expect(format('12345678901234567890')).toBe('12,345,678,901,234,567,890');
            expect(format(9007199254740993n)).toBe('9,007,199,254,740,993');
            expect(format('-98765432109876543210.75', 1)).toBe('-98,765,432,109,876,543,210.8');
        });

        it('keeps every fraction digit when decimals is not set', () => {
            expect(format('0.10000000000000000555')).toBe('0.10000000000000000555');
        });

        it('formats zero and negatives', () => {
            expect(format(0)).toBe('0');
            expect(format(0, 2)).toBe('0.00');
            expect(format(-42)).toBe('-42');
        });

        it('falls back to English for an unknown locale tag', () => {
            expect(format(1240, null, 'not a locale!')).toBe('1,240');
        });
    });

    describe('computeKpiState', () => {
        const config: CellKpiConfig = {column: 'active_users', label: 'Active users'};

        it('shows the formatted value of a one-row result', () => {
            const result = oneRow(['active_users'], [1240]);
            expect(computeKpiState(result, undefined, config, 'en-US')).toEqual({
                kind: 'value',
                text: '1,240',
            });
        });

        it('applies decimals, prefix and suffix', () => {
            const result = oneRow(['revenue'], ['15230.456']);
            const state = computeKpiState(
                result,
                undefined,
                {column: 'revenue', decimals: 2, prefix: '$', suffix: ' USD'},
                'en-US',
            );
            expect(state).toEqual({kind: 'value', text: '$15,230.46 USD'});
        });

        it('reports an error before anything else', () => {
            const result = oneRow(['active_users'], [1]);
            expect(computeKpiState(result, 'boom', config, 'en')).toEqual({kind: 'error'});
        });

        it('reports absent output', () => {
            expect(computeKpiState(null, undefined, config, 'en')).toEqual({kind: 'noOutput'});
            expect(computeKpiState(undefined, undefined, config, 'en')).toEqual({
                kind: 'noOutput',
            });
        });

        it('reports zero rows', () => {
            const result: QueryResult = {columns: ['active_users'], rows: [], affected_rows: 0};
            expect(computeKpiState(result, undefined, config, 'en')).toEqual({kind: 'noRows'});
        });

        it('never uses the first row of a multi-row result', () => {
            const result: QueryResult = {
                columns: ['active_users'],
                rows: [[1], [2], [3]],
                affected_rows: 0,
            };
            expect(computeKpiState(result, undefined, config, 'en')).toEqual({
                kind: 'multipleRows',
                count: 3,
            });
        });

        it('reports a configured column the result no longer has', () => {
            const result = oneRow(['users'], [5]);
            expect(computeKpiState(result, undefined, config, 'en')).toEqual({
                kind: 'missingColumn',
                column: 'active_users',
            });
        });

        it('follows a result-column change to a column that exists', () => {
            const result = oneRow(['users', 'errors'], [5, '-3']);
            expect(computeKpiState(result, undefined, {column: 'errors'}, 'en')).toEqual({
                kind: 'value',
                text: '-3',
            });
        });

        it.each([null, undefined])('reports a %s value as NULL', (value) => {
            const result = oneRow(['active_users'], [value]);
            expect(computeKpiState(result, undefined, config, 'en')).toEqual({kind: 'null'});
        });

        it.each([
            ['abc', 'abc'],
            [true, 'true'],
            [{a: 1}, '{"a":1}'],
            ['NaN', 'NaN'],
        ])('reports non-numeric data %s', (value, raw) => {
            const result = oneRow(['active_users'], [value]);
            expect(computeKpiState(result, undefined, config, 'en')).toEqual({
                kind: 'notNumeric',
                raw,
            });
        });
    });

    describe('buildDefaultKpiConfig', () => {
        it('picks the first numeric column of the first row', () => {
            expect(buildDefaultKpiConfig(oneRow(['name', 'total'], ['a', '12.5']))).toEqual({
                column: 'total',
                label: 'total',
            });
        });

        it('falls back to the first column', () => {
            expect(buildDefaultKpiConfig(oneRow(['name'], ['a']))).toEqual({
                column: 'name',
                label: 'name',
            });
            expect(buildDefaultKpiConfig({columns: ['n'], rows: [], affected_rows: 0})).toEqual({
                column: 'n',
                label: 'n',
            });
        });

        it('returns null without columns', () => {
            expect(buildDefaultKpiConfig(null)).toBeNull();
            expect(buildDefaultKpiConfig({columns: [], rows: [], affected_rows: 3})).toBeNull();
        });
    });

    describe('normalizeKpiDecimals', () => {
        it.each([
            [2, 2],
            [0, 0],
            [-1, 0],
            [2.7, 2],
            [99, KPI_MAX_DECIMALS],
            [NaN, null],
            [Infinity, null],
            ['2', null],
            [null, null],
        ])('normalizes %s to %s', (value, expected) => {
            expect(normalizeKpiDecimals(value)).toBe(expected);
        });
    });

    describe('sanitizeKpiConfig', () => {
        it('keeps a full configuration', () => {
            const config = {column: 'c', label: 'L', decimals: 2, prefix: '$', suffix: '%'};
            expect(sanitizeKpiConfig(config)).toEqual(config);
        });

        it('drops malformed fields', () => {
            expect(
                sanitizeKpiConfig({column: 'c', label: 3, decimals: 'x', prefix: null, extra: 1}),
            ).toEqual({column: 'c'});
            expect(sanitizeKpiConfig({column: 'c', decimals: 500})).toEqual({
                column: 'c',
                decimals: KPI_MAX_DECIMALS,
            });
        });

        it.each([null, undefined, 'c', 1, {}, {column: ''}, {column: 7}])('rejects %s', (raw) => {
            expect(sanitizeKpiConfig(raw)).toBeNull();
        });
    });
});
