import type {ExplainPlan, ExplainMetrics} from '@tabularis/explain';
import {getExplainTableRows, formatRatio} from '@tabularis/explain';
import {save} from '@tauri-apps/plugin-dialog';
import {writeTextFile} from '@tauri-apps/plugin-fs';
import {csvField} from './clipboard';

export const EXPLAIN_TABLE_CSV_HEADERS = [
    'index',
    'depth',
    'node_type',
    'relation',
    'cost',
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

/**
 * Format a complete EXPLAIN plan tree as an RFC 4180 compliant CSV string.
 * Preserves tree order, includes depth, formats metrics with explicit units,
 * and leaves unavailable metrics empty rather than converting them to zero.
 * Always exports the complete plan even if UI branches were collapsed.
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
        const formattedSelfTime =
            row.exclusiveTimeMs != null ? String(Number(row.exclusiveTimeMs.toFixed(3))) : '';

        const formattedGap = row.estimateGap != null ? formatRatio(row.estimateGap) : '';

        const cells: string[] = [
            String(row.index),
            String(row.depth),
            row.nodeType,
            row.relation ?? '',
            row.cost ?? '',
            row.planRows != null ? String(row.planRows) : '',
            row.actualRows != null ? String(row.actualRows) : '',
            formattedSelfTime,
            formattedGap,
            row.filter ?? '',
        ];

        return cells.map((val) => csvField(val, delimiter)).join(delimiter);
    });

    return [headerLine, ...bodyLines].join('\n');
}

/**
 * Open the native Tauri save-file dialog and save the complete EXPLAIN table as CSV.
 * Returns true if saved successfully, or false if cancelled by the user.
 */
export async function saveExplainTableCsv(
    plan: ExplainPlan,
    metrics?: ExplainMetrics,
    defaultPath = 'explain-plan.csv',
): Promise<boolean> {
    const filePath = await save({
        defaultPath,
        filters: [{name: 'CSV', extensions: ['csv']}],
    });

    if (!filePath) {
        return false;
    }

    const csv = formatExplainTableCsv(plan, {metrics});
    await writeTextFile(filePath, csv);
    return true;
}
