import type {QueryResult} from '@/types/editor';
import type {CellChartConfig, ChartType} from '@/types/notebook';

export interface ChartDataPoint {
    label: string;
    [key: string]: string | number;
}

export function canRenderChart(result: QueryResult): boolean {
    return result.columns.length >= 2 && result.rows.length > 0;
}

/**
 * A string holding a finite number, such as `'1500.00'`. PostgreSQL `NUMERIC`
 * and MySQL `DECIMAL` values (sums and averages included) arrive as strings to
 * keep their precision.
 */
function isNumericString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

/** Every non-NULL value in the column is a numeric string, and there is one. */
function hasOnlyNumericStrings(result: QueryResult, colIndex: number): boolean {
    let found = false;
    for (const row of result.rows) {
        const value = row[colIndex];
        if (value === null || value === undefined) continue;
        if (!isNumericString(value)) return false;
        found = true;
    }
    return found;
}

export function getNumericColumns(result: QueryResult): string[] {
    if (result.rows.length === 0) return [];
    return result.columns.filter(
        (_, colIndex) =>
            result.rows.some((row) => typeof row[colIndex] === 'number') ||
            hasOnlyNumericStrings(result, colIndex),
    );
}

export function getLabelColumns(result: QueryResult): string[] {
    if (result.rows.length === 0) return [];
    return result.columns.filter((_, colIndex) =>
        result.rows.some((row) => typeof row[colIndex] === 'string'),
    );
}

export function buildDefaultChartConfig(result: QueryResult): CellChartConfig | null {
    const labelCols = getLabelColumns(result);
    const numericCols = getNumericColumns(result);

    // A column of numeric strings (a DECIMAL total) is a better value than label.
    const labelColumn =
        labelCols.find((col) => !hasOnlyNumericStrings(result, result.columns.indexOf(col))) ??
        labelCols[0];
    const valueColumn = numericCols.find((col) => col !== labelColumn);
    if (labelColumn === undefined || valueColumn === undefined) return null;

    return {
        type: 'bar' as ChartType,
        labelColumn,
        valueColumns: [valueColumn],
    };
}

export function transformResultToChartData(
    result: QueryResult,
    config: CellChartConfig,
): ChartDataPoint[] {
    const labelIdx = result.columns.indexOf(config.labelColumn);
    if (labelIdx === -1) return [];

    const valueIndices = config.valueColumns
        .map((col) => ({name: col, idx: result.columns.indexOf(col)}))
        .filter((v) => v.idx !== -1);

    if (valueIndices.length === 0) return [];

    return result.rows.map((row) => {
        const point: ChartDataPoint = {
            label: row[labelIdx] != null ? String(row[labelIdx]) : '',
        };
        for (const {name, idx} of valueIndices) {
            const val = row[idx];
            point[name] = typeof val === 'number' ? val : Number(val) || 0;
        }
        return point;
    });
}
