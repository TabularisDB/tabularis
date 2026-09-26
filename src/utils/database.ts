import type { DriverCapabilities } from '../types/plugins';

export interface TableDataChangeScope {
  schema?: string;
  database?: string;
}

/**
 * Returns true when a driver supports cross-database access from a single connection
 * (e.g. MySQL). Postgres uses schemas; SQLite/DuckDB are file-based or folder-based.
 */
export function isMultiDatabaseCapable(capabilities: DriverCapabilities | null | undefined): boolean {
  if (!capabilities) return false;
  if (capabilities.no_connection_required) return false;
  // A flat single-database store (e.g. Meilisearch) has nothing to select.
  if (capabilities.single_database) return false;
  return (
    capabilities.file_based === false &&
    !capabilities.folder_based &&
    capabilities.schemas === false
  );
}

/**
 * Returns true when a schema-based driver (e.g. PostgreSQL) is eligible to
 * browse multiple databases on one connection, driving a nested
 * database -> schema -> table tree instead of MySQL-style flat
 * database -> table. Capability-only check — mirrors `isMultiDatabaseCapable`
 * but for `schemas === true` drivers. Use this to decide whether the
 * connection dialog's database picker should be offered at all.
 */
export function isSchemaBasedMultiDbCapable(
  capabilities: DriverCapabilities | null | undefined,
): boolean {
  if (!capabilities) return false;
  if (capabilities.no_connection_required) return false;
  if (capabilities.single_database) return false;
  return capabilities.file_based === false && !capabilities.folder_based && capabilities.schemas === true;
}

/**
 * Returns true when a schema-based driver (e.g. PostgreSQL) is being browsed
 * across multiple databases on one connection. Unlike `isMultiDatabaseCapable`
 * (flat database -> table drivers like MySQL), this drives a nested
 * database -> schema -> table tree.
 *
 * Mirrors `usesMultiDatabaseLayout`'s selection-driven gating: it only
 * activates once the connection has an explicit database selection, so a
 * plain single-database Postgres connection (no selection at all) keeps
 * using today's flat schema-only layout untouched.
 */
export function isSchemaBasedMultiDb(
  capabilities: DriverCapabilities | null | undefined,
  selectedDatabases: string[],
): boolean {
  return isSchemaBasedMultiDbCapable(capabilities) && selectedDatabases.length >= 1;
}

export function getTableDataChangeScope(
  capabilities: DriverCapabilities | null | undefined,
  tabSchema: string | null | undefined,
  activeSchema: string | null | undefined,
): TableDataChangeScope {
  if (isMultiDatabaseCapable(capabilities) && tabSchema) {
    return { database: tabSchema };
  }

  if (capabilities?.schemas === true) {
    const schema = tabSchema ?? activeSchema;
    return schema ? { schema } : {};
  }

  return {};
}

/**
 * Returns true when an open connection should use the multi-database
 * presentation (db-qualified queries, per-database sidebar tree).
 *
 * `selectedDatabases` is populated only by the multi-database connect path,
 * so any non-empty value means the connection was opened in that mode — this
 * includes "all databases" connections that currently expose a single
 * database, which still have no default schema and need qualified queries.
 */
export function usesMultiDatabaseLayout(
  capabilities: DriverCapabilities | null | undefined,
  selectedDatabases: string[],
): boolean {
  return isMultiDatabaseCapable(capabilities) && selectedDatabases.length >= 1;
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

/**
 * Reconciles a saved database selection against the databases that actually
 * exist on the server. Preserves the saved order; entries that no longer
 * exist are reported in `removed` so callers can persist the pruned list.
 */
export function reconcileDatabaseSelection(
  saved: string[],
  available: string[],
): { selection: string[]; removed: string[] } {
  const availableSet = new Set(available);
  const selection: string[] = [];
  const removed: string[] = [];
  for (const db of saved) {
    if (availableSet.has(db)) {
      selection.push(db);
    } else {
      removed.push(db);
    }
  }
  return { selection, removed };
}
