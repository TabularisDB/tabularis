import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {isDialect} from './sqlSplitter';

export function isLocalDriver(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.file_based === true || capabilities?.folder_based === true;
}

/** Path a file-based driver declaring `in_memory` opens as a temporary database. */
export const IN_MEMORY_DATABASE = ':memory:';

export function supportsInMemoryDatabase(capabilities?: DriverCapabilities | null): boolean {
    return (
        capabilities?.file_based === true &&
        (capabilities.in_memory === true || capabilities.inMemory === true)
    );
}

export function supportsAlterColumn(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.alter_column === true;
}

/** The driver's DDL builders accept a column description (ColumnDefinition.comment). */
export function supportsColumnComments(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.column_comments === true;
}

/** The plugin builds its own drop statement through the optional get_drop_table_sql RPC. */
export function supportsPluginDropTableSql(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.drop_table_sql === true;
}

export function supportsCreateForeignKeys(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.create_foreign_keys === true;
}

export function supportsExplain(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.explain === true;
}

/**
 * Dialects the host's generic statistics / value picker SQL is written for:
 * `COUNT(DISTINCT col)`, `MIN` / `MAX`, `GROUP BY col ORDER BY 2 DESC, 1
 * LIMIT n`. `mssql` and `oracle` have no `LIMIT`, and `generic` promises no
 * particular syntax.
 */
const GENERIC_SQL_DIALECTS: ReadonlySet<string> = new Set(['postgres', 'mysql', 'sqlite']);

/**
 * True when the driver explicitly declares a dialect the host's generic SQL
 * runs on, through `sql_syntax.extends` (which takes precedence, as it does
 * for the syntax preset, unless it isn't a valid dialect) or `sql_dialect`.
 * Declaring neither does not count, even though the statement splitter treats
 * it as postgres (see issue #614): a plugin has to say it speaks SQL before
 * the host sends it SQL it didn't write.
 */
export function speaksGenericSql(capabilities?: DriverCapabilities | null): boolean {
    const extendsDialect = capabilities?.sql_syntax?.extends;
    const dialect = isDialect(extendsDialect) ? extendsDialect : capabilities?.sql_dialect;
    return typeof dialect === 'string' && GENERIC_SQL_DIALECTS.has(dialect);
}

/** The plugin computes column statistics itself (get_column_stats RPC). */
export function supportsColumnStatsRpc(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.column_stats === true;
}

export function findDriverManifest(
    driverId: string,
    drivers: PluginManifest[],
): PluginManifest | null {
    return drivers.find((d) => d.id === driverId) ?? null;
}

export function isReadonly(capabilities?: DriverCapabilities | null): boolean {
    return capabilities?.readonly === true;
}

export function supportsManageTables(capabilities?: DriverCapabilities | null): boolean {
    if (capabilities?.readonly === true) return false;
    return capabilities?.manage_tables !== false;
}

export function getCapabilitiesForDriver(
    driverId: string,
    drivers: PluginManifest[],
): DriverCapabilities | null {
    return findDriverManifest(driverId, drivers)?.capabilities ?? null;
}
