import type { DriverCapabilities, PluginManifest } from "../types/plugins";

export function isLocalDriver(
  capabilities?: DriverCapabilities | null,
): boolean {
  return (
    capabilities?.file_based === true || capabilities?.folder_based === true
  );
}

export function supportsAlterColumn(
  capabilities?: DriverCapabilities | null,
): boolean {
  return capabilities?.alter_column === true;
}

export function supportsCreateForeignKeys(
  capabilities?: DriverCapabilities | null,
): boolean {
  return capabilities?.create_foreign_keys === true;
}

export function supportsExplain(
  capabilities?: DriverCapabilities | null,
): boolean {
  return capabilities?.explain === true;
}

/**
 * Dialects the host's generic statistics / value picker SQL is written for:
 * `COUNT(DISTINCT col)`, `MIN` / `MAX`, `GROUP BY col ORDER BY 2 DESC, 1
 * LIMIT n`. `mssql` and `oracle` have no `LIMIT`, and `generic` promises no
 * particular syntax.
 */
const GENERIC_SQL_DIALECTS: ReadonlySet<string> = new Set(["postgres", "mysql", "sqlite"]);

/**
 * True when the driver explicitly declares a `sql_dialect` the host's generic
 * SQL runs on. An omitted `sql_dialect` does not count, even though the
 * statement splitter treats it as postgres (see issue #614): a plugin has to
 * say it speaks SQL before the host sends it SQL it didn't write.
 */
export function speaksGenericSql(
  capabilities?: DriverCapabilities | null,
): boolean {
  const dialect = capabilities?.sql_dialect;
  return typeof dialect === "string" && GENERIC_SQL_DIALECTS.has(dialect);
}

/** The plugin computes column statistics itself (get_column_stats RPC). */
export function supportsColumnStatsRpc(
  capabilities?: DriverCapabilities | null,
): boolean {
  return capabilities?.column_stats === true;
}

export function findDriverManifest(
  driverId: string,
  drivers: PluginManifest[],
): PluginManifest | null {
  return drivers.find((d) => d.id === driverId) ?? null;
}

export function isReadonly(
  capabilities?: DriverCapabilities | null,
): boolean {
  return capabilities?.readonly === true;
}

export function supportsManageTables(
  capabilities?: DriverCapabilities | null,
): boolean {
  if (capabilities?.readonly === true) return false;
  return capabilities?.manage_tables !== false;
}

export function getCapabilitiesForDriver(
  driverId: string,
  drivers: PluginManifest[],
): DriverCapabilities | null {
  return findDriverManifest(driverId, drivers)?.capabilities ?? null;
}
