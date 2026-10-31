import type {PluginQueryResult} from '@tabularis/plugin-api';

export function databaseSummary(result: PluginQueryResult): {
    name: string;
    version: string;
    details: string;
} {
    const row = result.rows[0] ?? [];
    const value = (column: string) => {
        const found = row[result.columns.indexOf(column)];
        return typeof found === 'string' ? found : '';
    };
    const details = value('version');
    return {
        name: value('database'),
        version: /^PostgreSQL\s+(\S+)/i.exec(details)?.[1] ?? '',
        details,
    };
}
