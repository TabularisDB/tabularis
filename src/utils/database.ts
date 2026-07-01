import type { DriverCapabilities } from '../types/plugins';

/**
 * Returns true when a connection can hold and browse more than one database
 * (server-based drivers: MySQL/MariaDB, PostgreSQL). File-based (SQLite) and
 * folder-based (DuckDB) drivers, and drivers that need no connection, are excluded.
 *
 * Note: this no longer requires `schemas === false`. Schema-based drivers
 * (PostgreSQL) are multi-database capable too — they just present an extra
 * `database → schema → table` level. Use {@link isSchemaBasedMultiDb} to tell
 * the two layouts apart.
 */
export function isMultiDatabaseCapable(capabilities: DriverCapabilities | null | undefined): boolean {
  if (!capabilities) return false;
  if (capabilities.no_connection_required) return false;
  return capabilities.file_based === false && !capabilities.folder_based;
}

/**
 * Returns true for multi-database drivers whose databases contain schemas
 * (PostgreSQL). These need a hierarchical `database → schema → table` sidebar
 * and per-database connection pools, unlike the flat `database → table` layout
 * of MySQL/MariaDB.
 */
export function isSchemaBasedMultiDb(capabilities: DriverCapabilities | null | undefined): boolean {
  return isMultiDatabaseCapable(capabilities) && capabilities?.schemas === true;
}

/**
 * Returns true when the database param is an array (multi-database selection).
 */
export function isMultiDatabaseSelection(db: string | string[]): db is string[] {
  return Array.isArray(db);
}

/**
 * Normalizes a database param (string or string[]) into an array of database names.
 * An empty string or empty array returns an empty array.
 */
export function getDatabaseList(db: string | string[]): string[] {
  if (Array.isArray(db)) {
    return db;
  }
  return db ? [db] : [];
}

/**
 * Returns the primary (first) database name from a string or string[].
 * Falls back to '' when the array is empty or the string is empty.
 */
export function getEffectiveDatabase(db: string | string[]): string {
  if (Array.isArray(db)) {
    return db[0] ?? '';
  }
  return db;
}

/** The `schema` / `database` params a table-scoped backend call should carry. */
export interface TableRoutingParams {
  schema?: string;
  database?: string;
}

/**
 * Builds the `{ schema, database }` params for any table-scoped backend call
 * (`get_columns`, `get_foreign_keys`, `update_record`, `insert_record`,
 * `delete_record`, …) from an editor tab's own schema/database plus the
 * connection's active schema.
 *
 * Why `database` matters: on schema-based multi-database connections
 * (PostgreSQL) the backend keeps a separate connection pool per database, so a
 * tab opened on `erp_demo.inventory.products` must route its metadata/DML to
 * the `erp_demo` pool. If the database is dropped, the call hits the
 * connection's primary database, finds no matching table, and returns no
 * columns / no primary key — which silently turns the grid read-only. The data
 * query already routes by `tabDatabase`; metadata calls must match it.
 *
 * The tab's `schema` takes precedence over the connection's `activeSchema`
 * (the active schema is a single global, but each tab can view a different
 * one). `database` is only emitted when the tab actually carries one, so flat
 * multi-database drivers (MySQL, where the tab has no separate `database`) are
 * unaffected.
 */
export function buildTableRoutingParams(
  tabSchema: string | null | undefined,
  tabDatabase: string | null | undefined,
  activeSchema: string | null | undefined,
): TableRoutingParams {
  const schema = tabSchema ?? activeSchema ?? undefined;
  const params: TableRoutingParams = {};
  if (schema) params.schema = schema;
  if (tabDatabase) params.database = tabDatabase;
  return params;
}
