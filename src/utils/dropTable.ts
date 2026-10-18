import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { quoteTableRef } from "./identifiers";

/**
 * Statement used by the explorer to drop a table. A plugin can return its own
 * statement through the optional `get_drop_table_sql` RPC (for table kinds a
 * plain `DROP TABLE` cannot remove); when it returns nothing, the generic
 * statement is built with the driver's identifier quoting.
 */
export function resolveDropTableSql(
  pluginStatement: string | null | undefined,
  table: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  schema?: string | null,
): string {
  const custom = pluginStatement?.trim();
  if (custom) return custom;
  return `DROP TABLE ${quoteTableRef(table, driver, schema)}`;
}
