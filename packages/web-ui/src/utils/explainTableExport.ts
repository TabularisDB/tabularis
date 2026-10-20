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
 * A plain number a spreadsheet can sort and chart: no unit, no suffix, no
 * thousands separator. Unavailable or non-finite values become an empty cell,
 * never 0.
 */
function csvNumber(value: number | null, decimals?: number): string {
    if (value == null || !Number.isFinite(value)) return '';
    const rounded = decimals == null ? value : Number(value.toFixed(decimals));
    return String(rounded);
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
