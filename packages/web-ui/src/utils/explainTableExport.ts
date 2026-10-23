import type {ExplainPlan, ExplainMetrics} from '@tabularis/explain';
import {getExplainTableRows} from '@tabularis/explain';
import type {PlatformCapabilities} from '@/platform/capabilities';
import {csvField} from './clipboard';
import {downloadTextFile} from './fileDownloads';

export const EXPLAIN_TABLE_CSV_HEADERS = [
    'index',
    'depth',
    'node_type',
    'relation',
    'startup_cost',
    'total_cost',
    'est_rows',
    'actual_rows',
    'self_time_ms',
    'estimate_gap',
    'filter',
] as const;

export interface FormatExplainTableCsvOptions {
    metrics?: ExplainMetrics;
    delimiter?: string;
    headers?: readonly string[];
}

/** RFC 4180 record separator. */
const CSV_LINE_ENDING = '\r\n';

/**
 * Decimals kept for values Tabularis derives itself (self time, estimate gap),
 * which would otherwise carry floating point noise such as 3.0000000000000004.
 * Costs and row counts are written exactly as the database reported them.
 */
const DERIVED_VALUE_DECIMALS = 3;

/**
 * `String(value)` without exponent notation: `1e+21` becomes
 * `1000000000000000000000` and `1.5e-7` becomes `0.00000015`. The digits are
 * the ones `String` picks, the shortest that round-trip, so no precision is
 * lost or invented. Expects a finite number.
 */
function plainDecimal(value: number): string {
    const text = String(value);
    const exponentAt = text.indexOf('e');
    if (exponentAt === -1) return text;

    const sign = text.startsWith('-') ? '-' : '';
    const mantissa = text.slice(sign.length, exponentAt);
    const exponent = Number(text.slice(exponentAt + 1));
    const [intDigits, fracDigits = ''] = mantissa.split('.');
    const digits = intDigits + fracDigits;
    // Where the decimal point lands once the exponent is applied.
    const point = intDigits.length + exponent;

    if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
    if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A plain number a spreadsheet can sort and chart: no unit, no suffix, no
 * thousands separator and no exponent notation. Unavailable or non-finite
 * values become an empty cell, never 0.
 */
function csvNumber(value: number | null, decimals?: number): string {
    if (value == null || !Number.isFinite(value)) return '';
    const rounded = decimals == null ? value : Number(value.toFixed(decimals));
    return plainDecimal(rounded);
}

/**
 * Format a complete EXPLAIN plan tree as an RFC 4180 CSV string, every record
 * ending with CRLF. Rows come from the same `getExplainTableRows` the table
 * view renders, in tree order and including collapsed branches. Numeric
 * columns hold plain numbers, and unavailable metrics stay empty rather than 0.
 */
export function formatExplainTableCsv(
    plan: ExplainPlan,
    options: FormatExplainTableCsvOptions = {},
): string {
    const delimiter = options.delimiter ?? ',';
    const headers = options.headers ?? EXPLAIN_TABLE_CSV_HEADERS;
    const rows = getExplainTableRows(plan, options.metrics);

    const headerLine = headers.map((header) => csvField(header, delimiter)).join(delimiter);

    const bodyLines = rows.map((row) => {
        const cells: string[] = [
            String(row.index),
            String(row.depth),
            row.nodeType,
            row.relation ?? '',
            csvNumber(row.startupCost),
            csvNumber(row.totalCost),
            csvNumber(row.planRows),
            csvNumber(row.actualRows),
            csvNumber(row.exclusiveTimeMs, DERIVED_VALUE_DECIMALS),
            csvNumber(row.estimateGap, DERIVED_VALUE_DECIMALS),
            row.filter ?? '',
        ];

        return cells.map((val) => csvField(val, delimiter)).join(delimiter);
    });

    return [headerLine, ...bodyLines].map((line) => `${line}${CSV_LINE_ENDING}`).join('');
}

/**
 * Save the complete EXPLAIN table as CSV through the platform download.
 * Returns true if saved successfully, or false if cancelled by the user.
 */
export function saveExplainTableCsv(
    platform: PlatformCapabilities,
    plan: ExplainPlan,
    metrics?: ExplainMetrics,
    defaultPath = 'explain-plan.csv',
): Promise<boolean> {
    return downloadTextFile(platform, {
        fileName: defaultPath,
        contents: formatExplainTableCsv(plan, {metrics}),
        mimeType: 'text/csv',
        filters: [{name: 'CSV', extensions: ['csv']}],
    });
}
