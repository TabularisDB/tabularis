import type {DriverCapabilities} from '@/types/plugins';

/** Apply a saved connection policy without mutating the driver's manifest. */
export function effectiveConnectionCapabilities(
    capabilities: DriverCapabilities | null,
    readOnly: boolean | undefined,
): DriverCapabilities | null {
    if (!capabilities || !readOnly) return capabilities;
    return {
        ...capabilities,
        readonly: true,
        manage_tables: false,
        alter_column: false,
        alter_primary_key: false,
        create_foreign_keys: false,
        table_import: false,
        routine_management: false,
        user_management: false,
        // Visual EXPLAIN has no protected driver contract. Raw EXPLAIN remains
        // available through the SQL editor's protected execution path.
        explain: false,
    };
}

export function supportsReadOnlyQueries(capabilities: DriverCapabilities | undefined): boolean {
    return capabilities?.readonly === true || capabilities?.read_only_queries === true;
}
