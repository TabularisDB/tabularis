import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { quoteIdentifier, quoteTableRef } from "./identifiers";

export type ObjectNameCopyFormat = "name" | "quoted" | "qualified";

export function formatObjectNameForCopy(
  name: string,
  format: ObjectNameCopyFormat,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  schema?: string,
): string {
  if (format === "name") return name;
  if (format === "quoted") return quoteIdentifier(name, driver);
  return quoteTableRef(name, driver, schema);
}

/**
 * Formats column names in result-column order as a comma-separated list of
 * SQL identifiers quoted with the active driver's identifier quote.
 */
export function formatColumnNamesAsSqlList(
  columns: string[],
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): string {
  return columns
    .map((column) => formatObjectNameForCopy(column, "quoted", driver))
    .join(", ");
}

/**
 * Returns whether the active driver or capability set represents a SQL-capable
 * surface with identifier quoting support.
 */
export function isSqlCapableDriver(
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
  if (typeof driver === "object" && driver !== null) {
    if (
      "paradigms" in driver &&
      Array.isArray(driver.paradigms) &&
      driver.paradigms.length > 0 &&
      !driver.paradigms.includes("sql")
    ) {
      return false;
    }
    const caps = "capabilities" in driver ? driver.capabilities : driver;
    if (caps.identifier_quote === "") {
      return false;
    }
  }
  return true;
}

