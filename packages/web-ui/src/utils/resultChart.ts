import type {QueryResult} from '@/types/editor';

/** Which presentation a result panel shows. */
export type ResultView = 'grid' | 'chart';

/** Chart types offered for ordinary query results (first milestone). */
export const RESULT_CHART_TYPES = ['bar', 'line'] as const;
export type ResultChartType = (typeof RESULT_CHART_TYPES)[number];

/**
 * Upper bound on plotted points. Keeps an "all rows" page from freezing the
 * SVG renderer; the chart says so when it applies.
 */
export const MAX_CHART_POINTS = 1000;

export type ChartColumnKind = 'numeric' | 'temporal' | 'text' | 'empty';

// No leading zeros ("01234" is a ZIP or phone code, not a number), except "0.5".
const NUMERIC_STRING = /^\s*-?((0|[1-9]\d*)(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
// The whole value must be a date or timestamp, optionally with a UTC offset.
const TEMPORAL_STRING =
    /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?( ?(Z|UTC|[+-]\d{2}(:?\d{2})?))?$/;
const ID_COLUMN = /(^id$|_id$)/i;

/** A finite number, a bigint, or a string drivers use for exact numerics (DECIMAL). */
export function isNumericValue(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'bigint') return true;
    if (typeof value === 'string') return NUMERIC_STRING.test(value);
    return false;
}

/** An ISO-like date or timestamp string (`2024-01`, `2024-01-31`, `2024-01-31 10:00`). */
export function isTemporalValue(value: unknown): boolean {
    return typeof value === 'string' && TEMPORAL_STRING.test(value);
}

// Results are replaced, never mutated, so the classification of one can be
// reused by every helper below (config changes call several of them).
const kindsByResult = new WeakMap<QueryResult, readonly ChartColumnKind[]>();

/**
 * Classifies every column from its non-null values in the rows a chart can
 * plot (the first `MAX_CHART_POINTS`): numeric when all of them are numbers,
 * temporal when all are date-like strings, otherwise text. A column with no
 * non-null values is `empty`. Computed once per result.
 */
export function classifyResultColumns(result: QueryResult): readonly ChartColumnKind[] {
    const cached = kindsByResult.get(result);
    if (cached) return cached;
    const rowCount = Math.min(result.rows.length, MAX_CHART_POINTS);
    const kinds = result.columns.map((_, colIndex): ChartColumnKind => {
        let seen = false;
        let numeric = true;
        let temporal = true;
        for (let r = 0; r < rowCount; r++) {
            const value = result.rows[r][colIndex];
            if (value === null || value === undefined) continue;
            seen = true;
            if (numeric && !isNumericValue(value)) numeric = false;
            if (temporal && !isTemporalValue(value)) temporal = false;
            if (!numeric && !temporal) break;
        }
        if (!seen) return 'empty';
        if (numeric) return 'numeric';
        if (temporal) return 'temporal';
        return 'text';
    });
    kindsByResult.set(result, kinds);
    return kinds;
}

/**
 * A chart over a query result. Columns are referenced by index, not name: a
 * result can repeat a name (`SELECT a.id, b.id ...`) and each copy is its own
 * column.
 */
export interface ResultChartConfig {
    type: ResultChartType;
    /** Index of the X column in `result.columns`. */
    labelIndex: number;
    /** Indexes of the Y columns. */
    valueIndices: number[];
    /**
     * The result's column names when the config was made, so a re-run that
     * moves columns keeps plotting the same ones.
     */
    columns: readonly string[];
}

/** Indexes of the columns that can be plotted on the Y axis. */
export function getChartValueColumns(result: QueryResult): number[] {
    const kinds = classifyResultColumns(result);
    const indices: number[] = [];
    kinds.forEach((kind, i) => {
        if (kind === 'numeric') indices.push(i);
    });
    return indices;
}

/**
 * A display name per column. A name the result repeats gets its occurrence
 * number from the second copy on (`id`, `id (2)`), so pickers and tooltips
 * can tell the copies apart.
 */
export function getChartColumnLabels(columns: readonly string[]): string[] {
    const seen = new Map<string, number>();
    return columns.map((name) => {
        const n = (seen.get(name) ?? 0) + 1;
        seen.set(name, n);
        return n === 1 ? name : `${name} (${n})`;
    });
}

/** The Recharts data key of a Y column; never collides with the `label` key. */
export function chartSeriesKey(index: number): string {
    return `c${index}`;
}

export type ChartUnavailableReason = 'noRows' | 'noNumeric';

/** Why a result cannot be charted, or null when it can. */
export function getChartUnavailableReason(result: QueryResult): ChartUnavailableReason | null {
    if (result.columns.length === 0 || result.rows.length === 0) return 'noRows';
    if (getChartValueColumns(result).length === 0) return 'noNumeric';
    return null;
}

function pickDefaultValueColumn(
    result: QueryResult,
    valueIndices: readonly number[],
    labelIndex: number,
): number | undefined {
    const candidates = valueIndices.filter((i) => i !== labelIndex);
    return candidates.find((i) => !ID_COLUMN.test(result.columns[i])) ?? candidates[0];
}

/**
 * Picks a sensible starting chart from column types:
 * - a date-like column goes on X and the chart is a line;
 * - otherwise the first text column goes on X and the chart is a bar;
 * - an all-numeric result uses its first column as X.
 * Y is the first numeric column other than X, preferring non-id columns.
 */
export function buildDefaultResultChartConfig(result: QueryResult): ResultChartConfig | null {
    if (getChartUnavailableReason(result) !== null) return null;
    const kinds = classifyResultColumns(result);
    const valueIndices = getChartValueColumns(result);

    const temporalIdx = kinds.indexOf('temporal');
    const textIdx = kinds.indexOf('text');
    const labelIndex = temporalIdx !== -1 ? temporalIdx : textIdx !== -1 ? textIdx : 0;

    const valueIndex = pickDefaultValueColumn(result, valueIndices, labelIndex);
    if (valueIndex === undefined) return null;

    return {
        type: temporalIdx !== -1 ? 'line' : 'bar',
        labelIndex,
        valueIndices: [valueIndex],
        columns: result.columns,
    };
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
    return a === b || (a.length === b.length && a.every((name, i) => name === b[i]));
}

/**
 * Where column `index` of `from` is in `to`: the same name, and the same copy
 * of it when the name repeats. -1 when it is gone.
 */
function remapColumn(index: number, from: readonly string[], to: readonly string[]): number {
    const name = from[index];
    if (name === undefined) return -1;
    let copy = 0;
    for (let i = 0; i < index; i++) if (from[i] === name) copy++;
    for (let i = 0; i < to.length; i++) {
        if (to[i] !== name) continue;
        if (copy === 0) return i;
        copy--;
    }
    return -1;
}

/**
 * Keeps a stored chart config valid for the current result: follows columns
 * that moved, drops value columns that disappeared or are no longer numeric,
 * and falls back to the defaults when the X column vanished or no Y column is
 * left.
 */
export function reconcileResultChartConfig(
    config: ResultChartConfig | null,
    result: QueryResult,
): ResultChartConfig | null {
    if (getChartUnavailableReason(result) !== null) return null;
    if (!config) return buildDefaultResultChartConfig(result);

    const moved = !sameColumns(config.columns, result.columns);
    const remap = (index: number) =>
        moved ? remapColumn(index, config.columns, result.columns) : index;
    const type = config.type;

    const labelIndex = remap(config.labelIndex);
    if (labelIndex < 0 || labelIndex >= result.columns.length) {
        const fallback = buildDefaultResultChartConfig(result);
        return fallback ? {...fallback, type} : null;
    }

    const numeric = getChartValueColumns(result);
    const valueIndices = config.valueIndices
        .map(remap)
        .filter((i) => i !== labelIndex && numeric.includes(i));
    if (valueIndices.length === 0) {
        const valueIndex = pickDefaultValueColumn(result, numeric, labelIndex);
        if (valueIndex === undefined) return null;
        return {type, labelIndex, valueIndices: [valueIndex], columns: result.columns};
    }

    if (
        !moved &&
        labelIndex === config.labelIndex &&
        valueIndices.length === config.valueIndices.length
    ) {
        return config;
    }
    return {type, labelIndex, valueIndices, columns: result.columns};
}

/**
 * Adds or removes a Y column, never leaving the chart without one and never
 * going past `maxSeries`.
 */
export function toggleChartValueColumn(
    config: ResultChartConfig,
    index: number,
    maxSeries = MAX_CHART_SERIES,
): ResultChartConfig {
    const selected = config.valueIndices.includes(index);
    if (selected) {
        if (config.valueIndices.length === 1) return config;
        return {
            ...config,
            valueIndices: config.valueIndices.filter((i) => i !== index),
        };
    }
    if (config.valueIndices.length >= maxSeries) return config;
    return {...config, valueIndices: [...config.valueIndices, index]};
}

/** Sets the X column, removing it from the Y columns if it was plotted there. */
export function setChartLabelColumn(
    config: ResultChartConfig,
    index: number,
    result: QueryResult,
): ResultChartConfig {
    const next = {
        ...config,
        labelIndex: index,
        valueIndices: config.valueIndices.filter((i) => i !== index),
    };
    return reconcileResultChartConfig(next, result) ?? next;
}

export interface ResultChartScope {
    /** Rows drawn in the chart. */
    plotted: number;
    /** Rows loaded in the result panel. */
    loaded: number;
    /** True when `MAX_CHART_POINTS` cut the loaded rows. */
    capped: boolean;
    /** True when the server has rows that were not loaded. */
    hasMore: boolean;
}

export function getResultChartScope(
    result: QueryResult,
    maxPoints = MAX_CHART_POINTS,
): ResultChartScope {
    const loaded = result.rows.length;
    return {
        plotted: Math.min(loaded, maxPoints),
        loaded,
        capped: loaded > maxPoints,
        hasMore: !!result.pagination?.has_more || !!result.truncated,
    };
}

/**
 * One X category and its Y values, keyed by `chartSeriesKey`. A null value is
 * missing data, not zero.
 */
export interface ResultChartPoint {
    label: string;
    [key: string]: string | number | null;
}

/** The value to plot for a cell, or null when there is nothing to plot. */
function toChartNumber(value: unknown): number | null {
    return isNumericValue(value) ? Number(value) : null;
}

/**
 * Shapes the loaded rows into chart points: `label` plus one key per Y
 * column. Unlike the notebook transform, NULLs stay null so lines show a gap
 * and bars leave the slot empty, instead of drawing a false 0.
 */
export function shapeResultChartData(
    result: QueryResult,
    config: ResultChartConfig,
    maxPoints = MAX_CHART_POINTS,
): ResultChartPoint[] {
    const width = result.columns.length;
    const labelIdx = config.labelIndex;
    if (labelIdx < 0 || labelIdx >= width) return [];
    const valueIndices = config.valueIndices.filter((i) => i >= 0 && i < width);
    if (valueIndices.length === 0) return [];

    const rows = result.rows.length > maxPoints ? result.rows.slice(0, maxPoints) : result.rows;
    return rows.map((row) => {
        const point: ResultChartPoint = {
            label: row[labelIdx] != null ? String(row[labelIdx]) : '',
        };
        for (const idx of valueIndices) point[chartSeriesKey(idx)] = toChartNumber(row[idx]);
        return point;
    });
}

/**
 * Indexes of points with a value under `key` but none on either side. A line
 * can't draw them, so they need a marker to stay visible.
 */
export function getIsolatedPoints(data: ResultChartPoint[], key: string): Set<number> {
    const has = (i: number) => typeof data[i]?.[key] === 'number';
    const isolated = new Set<number>();
    data.forEach((_, i) => {
        if (has(i) && !has(i - 1) && !has(i + 1)) isolated.add(i);
    });
    return isolated;
}

/** Dash patterns that tell line series apart without relying on colour. */
const SERIES_DASHES = [undefined, '6 3', '2 3', '8 3 2 3', '1 3', '10 4'];

/** Dash pattern for the n-th visible line; the first one is solid. */
export function getSeriesDash(rank: number): string | undefined {
    return SERIES_DASHES[rank % SERIES_DASHES.length];
}

/**
 * Most series a chart shows at once. Every built-in theme has at least this
 * many distinct series colours; past ~5 overlapping series a chart stops
 * being readable anyway.
 */
export const MAX_CHART_SERIES = 5;

/**
 * Colour slot for every Y column the chart can show, by column index, in slot
 * order. Slots follow the column, not the selection order, so hiding one
 * series never repaints the others. Id-like columns come last so the usual
 * single series gets the first colour.
 */
export function getSeriesSlots(result: QueryResult, labelIndex: number): Map<number, number> {
    const candidates = getChartValueColumns(result).filter((i) => i !== labelIndex);
    const isId = (i: number) => ID_COLUMN.test(result.columns[i]);
    const ordered = [...candidates.filter((i) => !isId(i)), ...candidates.filter(isId)];
    return new Map(ordered.map((index, slot) => [index, slot]));
}

function safeNumberFormat(locale: string, options: Intl.NumberFormatOptions) {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch {
        return new Intl.NumberFormat('en', options);
    }
}

/** A row count for the chart toolbar and caption: grouped digits. */
export function formatChartCount(count: number, locale: string): string {
    return safeNumberFormat(locale, {maximumFractionDigits: 0}).format(count);
}

/** A value for tooltips: grouped digits, at most four decimals. */
export function formatChartValue(value: unknown, locale: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return safeNumberFormat(locale, {maximumFractionDigits: 4}).format(value);
}

/** An axis tick: compact (1.2K, 3.4M) so long numbers never crowd the axis. */
export function formatChartTick(value: unknown, locale: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    return safeNumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
}

/** Shortens a category label for the axis; the tooltip shows it in full. */
export function truncateChartLabel(label: string, max = 16): string {
    return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

const TEMPORAL_PARTS = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export interface TemporalFormatters {
    /** Short form for axis ticks. */
    tick: (label: string) => string;
    /** Full form for tooltips. */
    full: (label: string) => string;
}

/**
 * Formats date-like labels as written (wall-clock, no time-zone shift),
 * choosing the precision the data actually has: months, days, minutes or
 * seconds.
 * Ticks leave out what every label shares (the year, or the whole date for
 * timestamps within one day); the tooltip always shows the full value.
 */
export function buildTemporalFormatters(labels: string[], locale: string): TemporalFormatters {
    const parsed = labels.map((l) => TEMPORAL_PARTS.exec(l));
    const valid = parsed.filter((m): m is RegExpExecArray => m !== null);
    const hasSeconds = valid.some((m) => m[6] !== undefined && m[6] !== '00');
    const hasTime =
        hasSeconds || valid.some((m) => m[4] !== undefined && (m[4] !== '00' || m[5] !== '00'));
    // Month-start dates (2024-01-01, 2024-02-01, ...) are monthly data: show months.
    const hasDay = hasTime || valid.some((m) => m[3] !== undefined && m[3] !== '01');
    const years = new Set(valid.map((m) => m[1]));
    const days = new Set(valid.map((m) => `${m[1]}-${m[2]}-${m[3] ?? ''}`));
    // Timestamps within one day: the date is the same everywhere, ticks show the time.
    const timeOnlyTicks = hasTime && days.size === 1;
    const showYearInTick = years.size > 1 || !hasDay;

    const make = (options: Intl.DateTimeFormatOptions) => {
        let format: Intl.DateTimeFormat;
        try {
            format = new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'});
        } catch {
            format = new Intl.DateTimeFormat('en', {...options, timeZone: 'UTC'});
        }
        return (label: string) => {
            const m = TEMPORAL_PARTS.exec(label);
            if (!m) return label;
            const date = new Date(
                Date.UTC(
                    Number(m[1]),
                    Number(m[2]) - 1,
                    m[3] ? Number(m[3]) : 1,
                    m[4] ? Number(m[4]) : 0,
                    m[5] ? Number(m[5]) : 0,
                    m[6] ? Number(m[6]) : 0,
                ),
            );
            return Number.isNaN(date.getTime()) ? label : format.format(date);
        };
    };

    const time: Intl.DateTimeFormatOptions = hasTime
        ? {hour: '2-digit', minute: '2-digit', ...(hasSeconds ? {second: '2-digit'} : {})}
        : {};
    const tick = make(
        timeOnlyTicks
            ? time
            : {
                  ...(showYearInTick ? {year: 'numeric'} : {}),
                  month: 'short',
                  ...(hasDay ? {day: 'numeric'} : {}),
                  ...time,
              },
    );
    const full = make({
        year: 'numeric',
        month: 'short',
        ...(hasDay ? {day: 'numeric'} : {}),
        ...time,
    });
    return {tick, full};
}

/** Thickest bar drawn; wider bars read as blocks rather than marks. */
export const MAX_BAR_SIZE = 24;
/** Space between bars of one category. */
export const BAR_GAP = 2;

/**
 * Recharts' `barCategoryGap`, in pixels: the space kept on each side of a
 * category's bars, so the bars sit together (2px apart, at most
 * `MAX_BAR_SIZE` wide) and the rest of the band is air. Falls back to the
 * library default until the plot width is known.
 */
export function getBarCategoryGap(
    plotWidth: number,
    categories: number,
    seriesCount: number,
): number | string {
    if (plotWidth <= 0 || categories <= 0 || seriesCount <= 0) return '10%';
    const band = plotWidth / categories;
    const group = seriesCount * MAX_BAR_SIZE + (seriesCount - 1) * BAR_GAP;
    return Math.max(band * 0.1, (band - group) / 2);
}
