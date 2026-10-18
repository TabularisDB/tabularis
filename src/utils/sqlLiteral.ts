import type { DriverCapabilities, PluginManifest } from "../types/plugins";

type DriverRef = string | PluginManifest | DriverCapabilities | null | undefined;

/**
 * How a dialect escapes characters inside a single-quoted string literal:
 *
 * - `standard`: a quote is doubled (`'O''Brien'`), backslash is plain text.
 * - `mysql`: a quote is doubled and backslash is an escape character, so a
 *   literal backslash is doubled too (MySQL/MariaDB default sql_mode).
 * - `bigquery`: GoogleSQL has no doubled-quote escape and a quoted literal
 *   can't hold a raw newline, so quote, backslash and line breaks are all
 *   backslash-escaped (`'O\'Brien'`).
 */
export type StringEscapeStyle = "standard" | "mysql" | "bigquery";

/**
 * Resolves the string-literal escape style from the driver's declared
 * `sql_dialect`. A bare driver id only knows the built-in MySQL/MariaDB ids.
 */
export function stringEscapeStyle(driver: DriverRef): StringEscapeStyle {
  if (typeof driver === "string") {
    return driver === "mysql" || driver === "mariadb" ? "mysql" : "standard";
  }
  if (!driver) return "standard";
  const caps = "capabilities" in driver ? driver.capabilities : driver;
  if (caps?.sql_dialect === "mysql") return "mysql";
  if (caps?.sql_dialect === "bigquery") return "bigquery";
  if (caps?.sql_dialect) return "standard";
  const id = "id" in driver ? driver.id : undefined;
  return id === "mysql" || id === "mariadb" ? "mysql" : "standard";
}

/** Quotes `value` as a single-quoted string literal for the driver's dialect. */
export function quoteSqlString(value: string, driver: DriverRef): string {
  switch (stringEscapeStyle(driver)) {
    case "bigquery":
      return `'${escapeGoogleSqlString(value)}'`;
    case "mysql":
      return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
    default:
      return `'${value.replace(/'/g, "''")}'`;
  }
}

function escapeGoogleSqlString(value: string): string {
  return value
    .replace(/[\\']/g, (ch) => `\\${ch}`)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
