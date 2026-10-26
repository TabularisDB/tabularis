import {describe, it, expect} from 'vitest';
import {
    BAR_GAP,
    MAX_BAR_SIZE,
    getBarCategoryGap,
    MAX_CHART_POINTS,
    MAX_CHART_SERIES,
    buildTemporalFormatters,
    formatChartCount,
    formatChartTick,
    formatChartValue,
    getSeriesDash,
    getSeriesSlots,
    truncateChartLabel,
    ROW_NUMBER,
    buildDefaultResultChartConfig,
    buildRowNumberFormatters,
    chartSeriesKey,
    getChartColumnLabels,
    classifyResultColumns,
    getChartUnavailableReason,
    getChartValueColumns,
    getIsolatedPoints,
    getSoleValueColumn,
    getResultChartScope,
    isNumericValue,
    isTemporalValue,
    reconcileResultChartConfig,
    setChartLabelColumn,
    shapeResultChartData,
    toggleChartValueColumn,
    type ResultChartConfig,
} from '@/utils/resultChart';
import type {QueryResult} from '@/types/editor';

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
            expect(isNumericValue('0')).toBe(true);
            expect(isNumericValue('0.5')).toBe(true);
            expect(isNumericValue('-0.25')).toBe(true);
            expect(isNumericValue('.5')).toBe(true);
        });

        it('rejects zero-padded codes such as ZIP or phone numbers', () => {
            expect(isNumericValue('01234')).toBe(false);
            expect(isNumericValue('007')).toBe(false);
            expect(isNumericValue('-01')).toBe(false);
            expect(isNumericValue('00.5')).toBe(false);
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
            expect(isTemporalValue('2024-01-31 10:15:00+00')).toBe(true);
            expect(isTemporalValue('2024-01-31T10:15:00+05:30')).toBe(true);
            expect(isTemporalValue('2024-01-31 10:15:00 UTC')).toBe(true);
        });

        it('rejects values that only start like a date', () => {
            expect(isTemporalValue('2024-01-01abc')).toBe(false);
            expect(isTemporalValue('2024-01-31 10:15:00 later')).toBe(false);
            expect(isTemporalValue('2024-01-31 (Wed)')).toBe(false);
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

        it('treats zero-padded codes as text', () => {
            const result = makeResult(['zip'], [['01234'], ['10115']]);
            expect(classifyResultColumns(result)).toEqual(['text']);
        });

        it('treats a column mixing numbers and text as text', () => {
            const result = makeResult(['mixed'], [[1], ['two']]);
            expect(classifyResultColumns(result)).toEqual(['text']);
        });

        it('classifies a result once and reuses it', () => {
            const result = makeResult(['a', 'b'], [['x', 1]]);
            const kinds = classifyResultColumns(result);
            expect(classifyResultColumns(result)).toBe(kinds);
            // A new result (a re-run or another page) is classified afresh.
            expect(classifyResultColumns(makeResult(['a', 'b'], [['x', 'y']]))).toEqual([
                'text',
                'text',
            ]);
        });

        it('looks only at the rows a chart can plot', () => {
            const rows: unknown[][] = Array.from({length: MAX_CHART_POINTS}, (_, i) => [i]);
            rows.push(['not a number']);
            expect(classifyResultColumns(makeResult(['n'], rows))).toEqual(['numeric']);
        });
    });

    describe('getChartValueColumns', () => {
        it('returns the indexes of numeric columns', () => {
            expect(getChartValueColumns(sales)).toEqual([0, 2, 3]);
        });
    });

    describe('getChartColumnLabels', () => {
        it('keeps unique names and numbers repeated ones from the second copy on', () => {
            expect(getChartColumnLabels(['id', 'name', 'id', 'total', 'id'])).toEqual([
                'id',
                'name',
                'id (2)',
                'total',
                'id (3)',
            ]);
            expect(getChartColumnLabels(sales.columns)).toEqual(sales.columns);
        });
    });

    describe('chartSeriesKey', () => {
        it('gives each column index its own key, apart from the label key', () => {
            expect(chartSeriesKey(0)).not.toBe(chartSeriesKey(1));
            expect(chartSeriesKey(0)).not.toBe('label');
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

        it('reports a single value with nothing to plot it against', () => {
            // SELECT COUNT(*) AS n FROM t
            expect(getChartUnavailableReason(makeResult(['n'], [[42]]))).toBe('singleValue');
            // An all-NULL column can't serve as X either.
            expect(getChartUnavailableReason(makeResult(['n', 'note'], [[42, null]]))).toBe(
                'singleValue',
            );
        });

        it('charts a single row when another column can go on X', () => {
            expect(getChartUnavailableReason(makeResult(['region', 'n'], [['North', 4]]))).toBe(
                null,
            );
            expect(getChartUnavailableReason(makeResult(['a', 'b'], [[1, 2]]))).toBeNull();
        });

        it('charts a single numeric column once there are several rows', () => {
            expect(getChartUnavailableReason(makeResult(['n'], [[1], [2]]))).toBeNull();
        });
    });

    describe('getSoleValueColumn', () => {
        it('returns the only numeric column, or null when there are several', () => {
            expect(getSoleValueColumn(makeResult(['region', 'n'], [['North', 4]]))).toBe(1);
            expect(getSoleValueColumn(sales)).toBeNull();
        });
    });

    describe('buildDefaultResultChartConfig', () => {
        it('uses the first text column as X with a bar chart, skipping id columns for Y', () => {
            expect(buildDefaultResultChartConfig(sales)).toEqual({
                type: 'bar',
                labelIndex: 1,
                valueIndices: [2],
                columns: sales.columns,
            });
        });

        it('prefers a date-like X column and starts as a line chart', () => {
            expect(buildDefaultResultChartConfig(monthly)).toEqual({
                type: 'line',
                labelIndex: 0,
                valueIndices: [1],
                columns: monthly.columns,
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
            expect(buildDefaultResultChartConfig(result)).toMatchObject({
                type: 'bar',
                labelIndex: 0,
                valueIndices: [1],
            });
        });

        it('falls back to an id column when it is the only numeric column', () => {
            const result = makeResult(['user_id', 'name'], [[7, 'Ada']]);
            expect(buildDefaultResultChartConfig(result)).toMatchObject({
                labelIndex: 1,
                valueIndices: [0],
            });
        });

        it('plots a single numeric column by row number', () => {
            const result = makeResult(['amount'], [[5], [8], [3]]);
            expect(buildDefaultResultChartConfig(result)).toEqual({
                type: 'bar',
                labelIndex: ROW_NUMBER,
                valueIndices: [0],
                columns: result.columns,
            });
        });

        it('skips all-NULL columns when picking X', () => {
            const result = makeResult(
                ['note', 'a', 'b'],
                [
                    [null, 1, 2],
                    [null, 3, 4],
                ],
            );
            expect(buildDefaultResultChartConfig(result)).toMatchObject({
                labelIndex: 1,
                valueIndices: [2],
            });
        });

        it('returns null when there is nothing to plot', () => {
            expect(buildDefaultResultChartConfig(makeResult(['a'], []))).toBeNull();
            expect(buildDefaultResultChartConfig(makeResult(['n'], [[42]]))).toBeNull();
            expect(buildDefaultResultChartConfig(makeResult(['name'], [['Ada']]))).toBeNull();
        });
    });

    describe('reconcileResultChartConfig', () => {
        const stored: ResultChartConfig = {
            type: 'line',
            labelIndex: 1,
            valueIndices: [2, 3],
            columns: sales.columns,
        };

        it('builds defaults when nothing is stored', () => {
            expect(reconcileResultChartConfig(null, sales)).toEqual(
                buildDefaultResultChartConfig(sales),
            );
        });

        it('returns the same object when it still fits the result', () => {
            expect(reconcileResultChartConfig(stored, sales)).toBe(stored);
            // A re-run returns a new but equal column list.
            expect(
                reconcileResultChartConfig(stored, {...sales, columns: [...sales.columns]}),
            ).toBe(stored);
        });

        it('follows columns that moved', () => {
            const changed = makeResult(['cost', 'region', 'revenue'], [[1, 'North', 2]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelIndex: 1,
                valueIndices: [2, 0],
                columns: changed.columns,
            });
        });

        it('drops value columns that disappeared', () => {
            const changed = makeResult(['region', 'revenue'], [['North', 1]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelIndex: 0,
                valueIndices: [1],
                columns: changed.columns,
            });
        });

        it('drops value columns that are no longer numeric', () => {
            const changed = makeResult(
                ['id', 'region', 'revenue', 'cost'],
                [[1, 'North', 1, 'n/a']],
            );
            expect(reconcileResultChartConfig(stored, changed)?.valueIndices).toEqual([2]);
        });

        it('picks a new Y column when none of the stored ones remain', () => {
            const changed = makeResult(['region', 'profit'], [['North', 5]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelIndex: 0,
                valueIndices: [1],
                columns: changed.columns,
            });
        });

        it('falls back to defaults but keeps the chart type when X disappeared', () => {
            const changed = makeResult(['country', 'revenue'], [['IT', 5]]);
            expect(reconcileResultChartConfig(stored, changed)).toEqual({
                type: 'line',
                labelIndex: 0,
                valueIndices: [1],
                columns: changed.columns,
            });
        });

        it('tells repeated column names apart when columns move', () => {
            const joined = makeResult(['id', 'name', 'id'], [[1, 'Ada', 10]]);
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 1,
                valueIndices: [2],
                columns: joined.columns,
            };
            // The second "id" is still the second "id" after a column is added in front.
            const moved = makeResult(['n', 'id', 'name', 'id'], [[0, 1, 'Ada', 10]]);
            expect(reconcileResultChartConfig(config, moved)).toMatchObject({
                labelIndex: 2,
                valueIndices: [3],
            });
        });

        it('starts over instead of plotting nothing when X holds the only numeric column', () => {
            const result = makeResult(['region', 'revenue'], [['North', 1]]);
            const stuck: ResultChartConfig = {
                type: 'line',
                labelIndex: 1,
                valueIndices: [],
                columns: result.columns,
            };
            expect(reconcileResultChartConfig(stuck, result)).toEqual({
                type: 'line',
                labelIndex: 0,
                valueIndices: [1],
                columns: result.columns,
            });

            const single = makeResult(['amount'], [[5], [8]]);
            expect(
                reconcileResultChartConfig({...stuck, labelIndex: 0, columns: ['amount']}, single),
            ).toMatchObject({labelIndex: ROW_NUMBER, valueIndices: [0]});
        });

        it('keeps plotting by row number when columns move', () => {
            const byRow: ResultChartConfig = {
                type: 'bar',
                labelIndex: ROW_NUMBER,
                valueIndices: [2],
                columns: sales.columns,
            };
            const moved = makeResult(['revenue', 'region'], [[1, 'North']]);
            expect(reconcileResultChartConfig(byRow, moved)).toMatchObject({
                labelIndex: ROW_NUMBER,
                valueIndices: [0],
            });
        });

        it('returns null for results that cannot be charted', () => {
            expect(reconcileResultChartConfig(stored, makeResult(['a'], []))).toBeNull();
            expect(reconcileResultChartConfig(stored, makeResult(['n'], [[42]]))).toBeNull();
        });
    });

    describe('toggleChartValueColumn', () => {
        const config: ResultChartConfig = {
            type: 'bar',
            labelIndex: 1,
            valueIndices: [2],
            columns: sales.columns,
        };

        it('adds and removes columns', () => {
            const added = toggleChartValueColumn(config, 3);
            expect(added.valueIndices).toEqual([2, 3]);
            expect(toggleChartValueColumn(added, 2).valueIndices).toEqual([3]);
        });

        it('never removes the last column', () => {
            expect(toggleChartValueColumn(config, 2)).toBe(config);
        });

        it('never goes past the series limit', () => {
            const full: ResultChartConfig = {
                ...config,
                valueIndices: Array.from({length: MAX_CHART_SERIES}, (_, i) => i + 10),
            };
            expect(toggleChartValueColumn(full, 99)).toBe(full);
            expect(toggleChartValueColumn(config, 3, 1)).toBe(config);
        });
    });

    describe('setChartLabelColumn', () => {
        it('removes the new X column from Y and keeps the rest', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 1,
                valueIndices: [2, 3],
                columns: sales.columns,
            };
            expect(setChartLabelColumn(config, 2, sales)).toEqual({
                type: 'bar',
                labelIndex: 2,
                valueIndices: [3],
                columns: sales.columns,
            });
        });

        it('picks another Y column when X takes the only one', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 1,
                valueIndices: [2],
                columns: sales.columns,
            };
            expect(setChartLabelColumn(config, 2, sales)).toEqual({
                type: 'bar',
                labelIndex: 2,
                valueIndices: [3],
                columns: sales.columns,
            });
        });

        it('switches X to the row number and keeps every Y column', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 1,
                valueIndices: [2, 3],
                columns: sales.columns,
            };
            expect(setChartLabelColumn(config, ROW_NUMBER, sales)).toEqual({
                ...config,
                labelIndex: ROW_NUMBER,
            });
        });

        it('picks the second of two columns with the same name', () => {
            const joined = makeResult(
                ['id', 'id', 'total'],
                [
                    [1, 10, 5],
                    [2, 20, 6],
                ],
            );
            const config = buildDefaultResultChartConfig(joined)!;
            const next = setChartLabelColumn(config, 1, joined);
            expect(next.labelIndex).toBe(1);
            expect(shapeResultChartData(joined, next).map((p) => p.label)).toEqual(['10', '20']);
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
        const key = chartSeriesKey;

        it('maps rows to labelled points and converts numeric strings', () => {
            const config: ResultChartConfig = {
                type: 'line',
                labelIndex: 0,
                valueIndices: [2],
                columns: monthly.columns,
            };
            expect(shapeResultChartData(monthly, config)).toEqual([
                {label: '2024-01-01', [key(2)]: 1200.5},
                {label: '2024-02-01', [key(2)]: 1350},
                {label: '2024-03-01', [key(2)]: 990.1},
            ]);
        });

        it('plots several Y columns per point', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 1,
                valueIndices: [2, 3],
                columns: sales.columns,
            };
            expect(shapeResultChartData(sales, config)[1]).toEqual({
                label: 'South',
                [key(2)]: 200,
                [key(3)]: 80,
            });
        });

        it('keeps the values of columns that share a name apart', () => {
            const joined = makeResult(['name', 'total', 'total'], [['Ada', 1, 2]]);
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 0,
                valueIndices: [1, 2],
                columns: joined.columns,
            };
            expect(shapeResultChartData(joined, config)).toEqual([
                {label: 'Ada', [key(1)]: 1, [key(2)]: 2},
            ]);
        });

        it('labels points with their row number', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: ROW_NUMBER,
                valueIndices: [2],
                columns: sales.columns,
            };
            expect(shapeResultChartData(sales, config)).toEqual([
                {label: '1', [key(2)]: 100},
                {label: '2', [key(2)]: 200},
                {label: '3', [key(2)]: 150},
            ]);
        });

        it('keeps a column named "label" apart from the X label', () => {
            const result = makeResult(['name', 'label'], [['Ada', 3]]);
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 0,
                valueIndices: [1],
                columns: result.columns,
            };
            expect(shapeResultChartData(result, config)).toEqual([{label: 'Ada', [key(1)]: 3}]);
        });

        it('keeps NULLs as missing values instead of plotting 0', () => {
            const config: ResultChartConfig = {
                type: 'line',
                labelIndex: 0,
                valueIndices: [1, 2],
                columns: monthly.columns,
            };
            expect(shapeResultChartData(monthly, config)[2]).toEqual({
                label: '2024-03-01',
                [key(1)]: null,
                [key(2)]: 990.1,
            });
        });

        it('keeps real zeros and handles sparse columns', () => {
            const sparse = makeResult(
                ['month', 'signups'],
                [
                    ['2024-01', 5],
                    ['2024-02', null],
                    ['2024-03', 0],
                    ['2024-04', undefined],
                    ['2024-05', '7'],
                    ['2024-06', BigInt(9)],
                ],
            );
            const config: ResultChartConfig = {
                type: 'line',
                labelIndex: 0,
                valueIndices: [1],
                columns: sparse.columns,
            };
            expect(shapeResultChartData(sparse, config).map((p) => p[key(1)])).toEqual([
                5,
                null,
                0,
                null,
                7,
                9,
            ]);
        });

        it('returns no points when the columns are gone', () => {
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 9,
                valueIndices: [2],
                columns: sales.columns,
            };
            expect(shapeResultChartData(sales, config)).toEqual([]);
            expect(
                shapeResultChartData(sales, {...config, labelIndex: 1, valueIndices: [9]}),
            ).toEqual([]);
        });

        it('caps the number of points', () => {
            const rows = Array.from({length: MAX_CHART_POINTS + 5}, (_, i) => [`r${i}`, i]);
            const config: ResultChartConfig = {
                type: 'bar',
                labelIndex: 0,
                valueIndices: [1],
                columns: ['a', 'b'],
            };
            const data = shapeResultChartData(makeResult(['a', 'b'], rows), config);
            expect(data).toHaveLength(MAX_CHART_POINTS);
            expect(data[data.length - 1].label).toBe(`r${MAX_CHART_POINTS - 1}`);
        });
    });

    describe('getIsolatedPoints', () => {
        it('finds values with no neighbour to draw a line to', () => {
            const data = [
                {label: 'a', v: 1},
                {label: 'b', v: null},
                {label: 'c', v: 3},
                {label: 'd', v: null},
                {label: 'e', v: 5},
                {label: 'f', v: 0},
            ];
            expect([...getIsolatedPoints(data, 'v')]).toEqual([0, 2]);
            expect(getIsolatedPoints([{label: 'a', v: 1}], 'v')).toEqual(new Set([0]));
            expect(getIsolatedPoints([], 'v').size).toBe(0);
        });
    });

    describe('getSeriesSlots', () => {
        it('assigns slots by column, id-like columns last, skipping X', () => {
            // sales: id 0, region 1, revenue 2, cost 3
            expect([...getSeriesSlots(sales, 1)]).toEqual([
                [2, 0],
                [3, 1],
                [0, 2],
            ]);
            expect([...getSeriesSlots(sales, 2)]).toEqual([
                [3, 0],
                [0, 1],
            ]);
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
            expect(formatChartValue(null, 'en')).toBe('—');
            expect(formatChartValue(Number.NaN, 'en')).toBe('—');
        });

        it('falls back to English for an invalid locale', () => {
            expect(formatChartValue(1000, 'not a locale!')).toBe('1,000');
        });
    });

    describe('formatChartCount', () => {
        it('groups digits for the locale and falls back to English', () => {
            expect(formatChartCount(1234567, 'en')).toBe('1,234,567');
            expect(formatChartCount(1000, 'de')).toBe('1.000');
            expect(formatChartCount(1000, 'not a locale!')).toBe('1,000');
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

        it('shows seconds when timestamps differ by seconds', () => {
            const f = buildTemporalFormatters(
                ['2024-05-01 09:30:05', '2024-05-01 09:30:10', '2024-05-01 09:30:15'],
                'en',
            );
            expect(f.tick('2024-05-01 09:30:05')).toBe('09:30:05 AM');
            expect(f.tick('2024-05-01 09:30:10')).not.toBe(f.tick('2024-05-01 09:30:05'));
            expect(f.full('2024-05-01 09:30:15')).toMatch(/May 1, 2024.*09:30:15/);
        });

        it('leaves seconds out when every timestamp is on the minute', () => {
            const f = buildTemporalFormatters(['2024-05-01 09:30:00', '2024-05-01 09:31:00'], 'en');
            expect(f.tick('2024-05-01 09:31:00')).toBe('09:31 AM');
        });

        it('leaves unparseable labels unchanged', () => {
            const f = buildTemporalFormatters(['2024-01-05'], 'en');
            expect(f.tick('n/a')).toBe('n/a');
        });
    });

    describe('buildRowNumberFormatters', () => {
        it('groups digits on ticks and names the row in the tooltip', () => {
            const f = buildRowNumberFormatters('de', (row) => `Zeile ${row}`);
            expect(f.tick('1204')).toBe('1.204');
            expect(f.full('1204')).toBe('Zeile 1.204');
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
