import {describe, it, expect} from 'vitest';
import {
    BAR_GAP,
    MAX_BAR_SIZE,
    getBarCategoryGap,
    MAX_CHART_POINTS,
    MAX_CHART_SERIES,
    buildTemporalFormatters,
    formatChartTick,
    formatChartValue,
    getSeriesDash,
    getSeriesSlots,
    truncateChartLabel,
    buildDefaultResultChartConfig,
    classifyResultColumns,
    getChartUnavailableReason,
    getChartValueColumns,
    getResultChartScope,
    isNumericValue,
    isTemporalValue,
    reconcileResultChartConfig,
    setChartLabelColumn,
    shapeResultChartData,
    toggleChartValueColumn,
} from '@/utils/resultChart';
import type {QueryResult} from '@/types/editor';
import type {CellChartConfig} from '@/types/notebook';

function makeResult(
    columns: string[],
    rows: unknown[][],
    overrides: Partial<QueryResult> = {},
): QueryResult {
    return {columns, rows, affected_rows: 0, ...overrides};
}

const sales = makeResult(
    ['id', 'region', 'revenue', 'cost'],
    [
        [1, 'North', 100, 40],
        [2, 'South', 200, 80],
        [3, 'East', 150, 60],
    ],
);

const monthly = makeResult(
    ['month', 'orders', 'revenue'],
    [
        ['2024-01-01', 10, '1200.50'],
        ['2024-02-01', 12, '1350.00'],
        ['2024-03-01', null, '990.10'],
    ],
);

describe('resultChart', () => {
    describe('isNumericValue', () => {
        it('accepts finite numbers, bigints and numeric strings', () => {
            expect(isNumericValue(42)).toBe(true);
            expect(isNumericValue(-1.5)).toBe(true);
            expect(isNumericValue(BigInt(9))).toBe(true);
            expect(isNumericValue('1200.50')).toBe(true);
            expect(isNumericValue('-3')).toBe(true);
            expect(isNumericValue('1e6')).toBe(true);
        });

        it('rejects text, empty strings, booleans and non-finite numbers', () => {
            expect(isNumericValue('abc')).toBe(false);
            expect(isNumericValue('')).toBe(false);
            expect(isNumericValue('12 apples')).toBe(false);
            expect(isNumericValue(true)).toBe(false);
            expect(isNumericValue(Number.NaN)).toBe(false);
            expect(isNumericValue(Number.POSITIVE_INFINITY)).toBe(false);
            expect(isNumericValue(null)).toBe(false);
        });
    });

    describe('isTemporalValue', () => {
        it('matches ISO-like dates and timestamps', () => {
            expect(isTemporalValue('2024-01')).toBe(true);
            expect(isTemporalValue('2024-01-31')).toBe(true);
            expect(isTemporalValue('2024-01-31 10:15:00')).toBe(true);
            expect(isTemporalValue('2024-01-31T10:15:00.123Z')).toBe(true);
        });

        it('rejects other values', () => {
            expect(isTemporalValue('North')).toBe(false);
            expect(isTemporalValue('2024')).toBe(false);
            expect(isTemporalValue(20240131)).toBe(false);
        });
    });

    describe('classifyResultColumns', () => {
        it('classifies numeric, temporal and text columns from loaded values', () => {
            expect(classifyResultColumns(sales)).toEqual(['numeric', 'text', 'numeric', 'numeric']);
            expect(classifyResultColumns(monthly)).toEqual(['temporal', 'numeric', 'numeric']);
        });

        it('ignores nulls and marks all-null columns as empty', () => {
            const result = makeResult(
                ['a', 'b'],
                [
                    [null, 1],
                    [null, null],
                ],
            );
            expect(classifyResultColumns(result)).toEqual(['empty', 'numeric']);
        });

        it('treats a column mixing numbers and text as text', () => {
            const result = makeResult(['mixed'], [[1], ['two']]);
            expect(classifyResultColumns(result)).toEqual(['text']);
        });
    });

    describe('getChartValueColumns', () => {
        it('returns only numeric columns', () => {
            expect(getChartValueColumns(sales)).toEqual(['id', 'revenue', 'cost']);
        });
    });

    describe('getChartUnavailableReason', () => {
        it('reports results without rows or columns', () => {
            expect(getChartUnavailableReason(makeResult(['a'], []))).toBe('noRows');
            expect(getChartUnavailableReason(makeResult([], []))).toBe('noRows');
        });

        it('reports results without numeric columns', () => {
            const result = makeResult(['name', 'email'], [['Ada', 'ada@x.dev']]);
            expect(getChartUnavailableReason(result)).toBe('noNumeric');
        });

        it('returns null for chartable results', () => {
            expect(getChartUnavailableReason(sales)).toBeNull();
        });
    });

    describe('buildDefaultResultChartConfig', () => {
        it('uses the first text column as X with a bar chart, skipping id columns for Y', () => {
            expect(buildDefaultResultChartConfig(sales)).toEqual({
                type: 'bar',
                labelColumn: 'region',
                valueColumns: ['revenue'],
            });
        });

        it('prefers a date-like X column and starts as a line chart', () => {
            expect(buildDefaultResultChartConfig(monthly)).toEqual({
                type: 'line',
                labelColumn: 'month',
                valueColumns: ['orders'],
            });
        });

        it('uses the first column as X when every column is numeric', () => {
            const result = makeResult(
                ['year', 'total'],
                [
                    [2023, 10],
                    [2024, 20],
                ],
            );
            expect(buildDefaultResultChartConfig(result)).toEqual({
                type: 'bar',
                labelColumn: 'year',
                valueColumns: ['total'],
            });
        });

        it('falls back to an id column when it is the only numeric column', () => {
            const result = makeResult(['user_id', 'name'], [[7, 'Ada']]);
            expect(buildDefaultResultChartConfig(result)).toEqual({
                type: 'bar',
                labelColumn: 'name',
                valueColumns: ['user_id'],
            });
        });

        it('returns null when there is nothing to plot', () => {
            expect(buildDefaultResultChartConfig(makeResult(['a'], []))).toBeNull();
            expect(buildDefaultResultChartConfig(makeResult(['only'], [[1], [2]]))).toBeNull();
            expect(buildDefaultResultChartConfig(makeResult(['name'], [['Ada']]))).toBeNull();
        });
    });

    describe('reconcileResultChartConfig', () => {
        const stored: CellChartConfig = {
            type: 'line',
            labelColumn: 'region',
            valueColumns: ['revenue', 'cost'],
        };

        it('builds defaults when nothing is stored', () => {
            expect(reconcileResultChartConfig(null, sales)).toEqual(
                buildDefaultResultChartConfig(sales),
            );
        });

        it('returns the same object when it still fits the result', () => {
            expect(reconcileResultChartConfig(stored, sales)).toBe(stored);
        });

        it('drops value columns that disappeared', () => {
            const changed = makeResult(['region', 'revenue'], [['North', 1]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelColumn: 'region',
                valueColumns: ['revenue'],
            });
        });

        it('drops value columns that are no longer numeric', () => {
            const changed = makeResult(['region', 'revenue', 'cost'], [['North', 1, 'n/a']]);
            expect(reconcileResultChartConfig(stored, changed)?.valueColumns).toEqual(['revenue']);
        });

        it('picks a new Y column when none of the stored ones remain', () => {
            const changed = makeResult(['region', 'profit'], [['North', 5]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelColumn: 'region',
                valueColumns: ['profit'],
            });
        });

        it('falls back to defaults but keeps the chart type when X disappeared', () => {
            const changed = makeResult(['country', 'revenue'], [['IT', 5]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelColumn: 'country',
                valueColumns: ['revenue'],
            });
        });

        it('maps chart types that results do not offer to bar', () => {
            const pie: CellChartConfig = {...stored, type: 'pie'};
            expect(reconcileResultChartConfig(pie, sales)?.type).toBe('bar');
        });

        it('returns null for results that cannot be charted', () => {
            expect(reconcileResultChartConfig(stored, makeResult(['a'], []))).toBeNull();
        });
    });

    describe('toggleChartValueColumn', () => {
        const config: CellChartConfig = {
            type: 'bar',
            labelColumn: 'region',
            valueColumns: ['revenue'],
        };

        it('adds and removes columns', () => {
            const added = toggleChartValueColumn(config, 'cost');
            expect(added.valueColumns).toEqual(['revenue', 'cost']);
            expect(toggleChartValueColumn(added, 'revenue').valueColumns).toEqual(['cost']);
        });

        it('never removes the last column', () => {
            expect(toggleChartValueColumn(config, 'revenue')).toBe(config);
        });

        it('never goes past the series limit', () => {
            const full: CellChartConfig = {
                ...config,
                valueColumns: Array.from({length: MAX_CHART_SERIES}, (_, i) => `c${i}`),
            };
            expect(toggleChartValueColumn(full, 'extra')).toBe(full);
            expect(toggleChartValueColumn(config, 'cost', 1)).toBe(config);
        });
    });

    describe('setChartLabelColumn', () => {
        it('removes the new X column from Y and keeps the rest', () => {
            const config: CellChartConfig = {
                type: 'bar',
                labelColumn: 'region',
                valueColumns: ['revenue', 'cost'],
            };
            expect(setChartLabelColumn(config, 'revenue', sales)).toEqual({
                type: 'bar',
                labelColumn: 'revenue',
                valueColumns: ['cost'],
            });
        });

        it('picks another Y column when X takes the only one', () => {
            const config: CellChartConfig = {
                type: 'bar',
                labelColumn: 'region',
                valueColumns: ['revenue'],
            };
            expect(setChartLabelColumn(config, 'revenue', sales)).toEqual({
                type: 'bar',
                labelColumn: 'revenue',
                valueColumns: ['cost'],
            });
        });
    });

    describe('getResultChartScope', () => {
        it('reports loaded rows and pagination', () => {
            const paged = makeResult(['a', 'b'], [['x', 1]], {
                pagination: {page: 1, page_size: 1, total_rows: null, has_more: true},
            });
            expect(getResultChartScope(paged)).toEqual({
                plotted: 1,
                loaded: 1,
                capped: false,
                hasMore: true,
            });
        });

        it('reports a truncated result as having more rows', () => {
            const truncated = makeResult(['a'], [[1]], {truncated: true});
            expect(getResultChartScope(truncated).hasMore).toBe(true);
        });

        it('reports when the point cap applies', () => {
            const rows = Array.from({length: 5}, (_, i) => [`r${i}`, i]);
            expect(getResultChartScope(makeResult(['a', 'b'], rows), 3)).toEqual({
                plotted: 3,
                loaded: 5,
                capped: true,
                hasMore: false,
            });
        });
    });

    describe('shapeResultChartData', () => {
        it('maps rows to labelled points and converts numeric strings', () => {
            const config: CellChartConfig = {
                type: 'line',
                labelColumn: 'month',
                valueColumns: ['revenue'],
            };
            expect(shapeResultChartData(monthly, config)).toEqual([
                {label: '2024-01-01', revenue: 1200.5},
                {label: '2024-02-01', revenue: 1350},
                {label: '2024-03-01', revenue: 990.1},
            ]);
        });

        it('plots several Y columns per point', () => {
            const config: CellChartConfig = {
                type: 'bar',
                labelColumn: 'region',
                valueColumns: ['revenue', 'cost'],
            };
            expect(shapeResultChartData(sales, config)[1]).toEqual({
                label: 'South',
                revenue: 200,
                cost: 80,
            });
        });

        it('caps the number of points', () => {
            const rows = Array.from({length: MAX_CHART_POINTS + 5}, (_, i) => [`r${i}`, i]);
            const config: CellChartConfig = {
                type: 'bar',
                labelColumn: 'a',
                valueColumns: ['b'],
            };
            const data = shapeResultChartData(makeResult(['a', 'b'], rows), config);
            expect(data).toHaveLength(MAX_CHART_POINTS);
            expect(data[data.length - 1].label).toBe(`r${MAX_CHART_POINTS - 1}`);
        });
    });

    describe('getSeriesSlots', () => {
        it('assigns slots by column, id-like columns last, skipping X', () => {
            expect(getSeriesSlots(sales, 'region')).toEqual({
                revenue: 0,
                cost: 1,
                id: 2,
            });
            expect(getSeriesSlots(sales, 'revenue')).toEqual({cost: 0, id: 1});
        });
    });

    describe('getSeriesDash', () => {
        it('keeps the first series solid and dashes the rest', () => {
            expect(getSeriesDash(0)).toBeUndefined();
            expect(getSeriesDash(1)).toMatch(/\d/);
            expect(getSeriesDash(1)).not.toBe(getSeriesDash(2));
        });
    });

    describe('formatChartValue', () => {
        it('groups digits and limits decimals', () => {
            expect(formatChartValue(1234567.891234, 'en')).toBe('1,234,567.8912');
            expect(formatChartValue(1234.5, 'de')).toBe('1.234,5');
        });

        it('shows a dash for missing values', () => {
            expect(formatChartValue(undefined, 'en')).toBe('—');
            expect(formatChartValue(Number.NaN, 'en')).toBe('—');
        });

        it('falls back to English for an invalid locale', () => {
            expect(formatChartValue(1000, 'not a locale!')).toBe('1,000');
        });
    });

    describe('formatChartTick', () => {
        it('uses compact notation', () => {
            expect(formatChartTick(1500, 'en')).toBe('1.5K');
            expect(formatChartTick(2_000_000, 'en')).toBe('2M');
            expect(formatChartTick(12, 'en')).toBe('12');
            expect(formatChartTick('x', 'en')).toBe('');
        });
    });

    describe('truncateChartLabel', () => {
        it('shortens long labels with an ellipsis', () => {
            expect(truncateChartLabel('short')).toBe('short');
            expect(truncateChartLabel('a very long category name', 10)).toBe('a very lo…');
        });
    });

    describe('buildTemporalFormatters', () => {
        it('drops the year from day ticks within one year but keeps it in the tooltip', () => {
            const f = buildTemporalFormatters(['2024-01-05', '2024-02-10'], 'en');
            expect(f.tick('2024-01-05')).toBe('Jan 5');
            expect(f.full('2024-01-05')).toBe('Jan 5, 2024');
        });

        it('keeps the year when labels span several years', () => {
            const f = buildTemporalFormatters(['2023-12-31', '2024-01-01'], 'en');
            expect(f.tick('2023-12-31')).toBe('Dec 31, 2023');
        });

        it('formats month-only labels with their year', () => {
            const f = buildTemporalFormatters(['2024-01', '2024-02'], 'en');
            expect(f.tick('2024-02')).toBe('Feb 2024');
        });

        it('shows the time only when the data has one, without shifting time zones', () => {
            const f = buildTemporalFormatters(['2024-03-01 23:30:00', '2024-03-02 08:15:00'], 'en');
            expect(f.full('2024-03-01 23:30:00')).toMatch(/Mar 1, 2024.*11:30/);
            const midnight = buildTemporalFormatters(
                ['2024-03-01 00:00:00', '2024-03-02 00:00:00'],
                'en',
            );
            expect(midnight.tick('2024-03-01 00:00:00')).toBe('Mar 1');
        });

        it('treats month-start dates as monthly data', () => {
            const f = buildTemporalFormatters(['2024-01-01', '2024-02-01'], 'en');
            expect(f.tick('2024-02-01')).toBe('Feb 2024');
            expect(f.full('2024-02-01')).toBe('Feb 2024');
        });

        it('shows only the time on ticks for timestamps within one day', () => {
            const f = buildTemporalFormatters(['2024-05-01 00:00:00', '2024-05-01 09:30:00'], 'en');
            expect(f.tick('2024-05-01 09:30:00')).toBe('09:30 AM');
            expect(f.full('2024-05-01 09:30:00')).toMatch(/May 1, 2024.*09:30/);
        });

        it('leaves unparseable labels unchanged', () => {
            const f = buildTemporalFormatters(['2024-01-05'], 'en');
            expect(f.tick('n/a')).toBe('n/a');
        });
    });

    describe('getBarCategoryGap', () => {
        it('falls back to a relative gap before the width is known', () => {
            expect(getBarCategoryGap(0, 5, 1)).toBe('10%');
            expect(getBarCategoryGap(600, 0, 1)).toBe('10%');
        });

        it('keeps the bars of one category together, capped in width', () => {
            // 6 categories in 600px: 100px bands, two 24px bars + 2px gap = 50px.
            const gap = getBarCategoryGap(600, 6, 2) as number;
            const band = 100;
            const barWidth = (band - 2 * gap - BAR_GAP) / 2;
            expect(barWidth).toBeCloseTo(MAX_BAR_SIZE);
        });

        it('keeps some air when bars would be narrower than the cap', () => {
            expect(getBarCategoryGap(600, 60, 3)).toBeCloseTo(1);
        });
    });
});
