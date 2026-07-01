/**
 * Formats the count of database objects (tables, views, routines, triggers) into a compact summary string.
 *
 * @example formatObjectCount(3, 2, 1) // "3T / 2V / 1R"
 * @example formatObjectCount(3, 2, 1, 4) // "3T / 2V / 1R / 4Tr"
 */
export function formatObjectCount(
  tables: number,
  views: number,
  routines: number,
  triggers?: number,
): string {
  let result = `${tables}T / ${views}V / ${routines}R`;
  if (triggers && triggers > 0) {
    result += ` / ${triggers}Tr`;
  }
  return result;
}

/**
 * Filters a list of saved/selected schema names against the schemas actually
 * available in the current database, removing any stale entries.
 */
export function filterValidSchemas(
  saved: string[],
  available: string[],
): string[] {
  const availableSet = new Set(available);
  return saved.filter((s) => availableSet.has(s));
}

/**
 * Returns a sensible default schema from a list of available schemas.
 * Prefers "public" (the PostgreSQL default) when present; otherwise returns the first entry.
 * Returns undefined when the list is empty.
 */
export function getDefaultSchema(
  schemas: string[],
): string | undefined {
  if (schemas.length === 0) return undefined;
  if (schemas.includes("public")) return "public";
  return schemas[0];
}

/**
 * Resolves which schema the TablePro-style active-schema dropdown should show,
 * given the locally picked schema, the connection's active schema, and the
 * schemas available in the database. Precedence:
 *   1. the locally picked schema, if still available;
 *   2. the connection's active schema, if it belongs to this database;
 *   3. otherwise a sensible default ("public" or the first schema).
 * Returns null when no schema is available.
 */
export function resolveActiveSchema(
  picked: string | null | undefined,
  connectionActive: string | null | undefined,
  available: string[] | undefined,
): string | null {
  if (!available || available.length === 0) return null;
  if (picked && available.includes(picked)) return picked;
  if (connectionActive && available.includes(connectionActive)) {
    return connectionActive;
  }
  return getDefaultSchema(available) ?? null;
}
