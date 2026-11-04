import type {PluginQueryResult} from '@tabularis/plugin-api';

export function displayValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function objectRows(rows: Record<string, unknown>[]): PluginQueryResult {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return {columns, rows: rows.map((row) => columns.map((column) => row[column]))};
}
