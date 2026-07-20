import type { DriverCapabilities } from '../types/plugins';

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
