import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { quoteTableRef } from "./identifiers";
import { supportsPluginDropTableSql } from "./driverCapabilities";

/**
 * Statement used by the explorer to drop a table. A plugin can return its own
 * statement through the optional `get_drop_table_sql` RPC (for table kinds a
 * plain `DROP TABLE` cannot remove); when it returns nothing usable (null,
 * blank or a non-string value), the generic statement is built with the
 * driver's identifier quoting.
 */
export function resolveDropTableSql(
  pluginStatement: unknown,
  table: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  schema?: string | null,
): string {
  const custom = typeof pluginStatement === "string" ? pluginStatement.trim() : "";
  if (custom) return custom;
  return `DROP TABLE ${quoteTableRef(table, driver, schema)}`;
}

/**
 * Builds the explorer's drop statement. `fetchPluginStatement` (the
 * `get_drop_table_sql` command) is only called when the active capabilities
 * declare `drop_table_sql`; every other driver gets the generic statement
 * without a round trip.
 */
export async function buildDropTableSql(
  capabilities: DriverCapabilities | null | undefined,
  fetchPluginStatement: () => Promise<unknown>,
  table: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  schema?: string | null,
): Promise<string> {
  const pluginStatement = supportsPluginDropTableSql(capabilities)
    ? await fetchPluginStatement()
    : null;
  return resolveDropTableSql(pluginStatement, table, driver, schema);
}
