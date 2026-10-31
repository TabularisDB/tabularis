/** Read-only provider results rendered by the host's native data grid. */
export interface PluginDataGridProps {
    columns: string[];
    rows: unknown[][];
    connectionId?: string | null;
    label?: string;
}
