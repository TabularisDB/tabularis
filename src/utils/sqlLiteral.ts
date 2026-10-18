import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { resolveSqlSyntax, type StringEscapeStyle } from "./sqlSyntax";

export type { StringEscapeStyle } from "./sqlSyntax";

type DriverRef = string | PluginManifest | DriverCapabilities | null | undefined;

/**
 * Resolves the string-literal escape style of a driver from its resolved SQL
 * syntax (`sql_syntax.string_escape`, else the `sql_dialect` preset). A bare
 * driver id, or capabilities that declare neither, only know the built-in
 * MySQL/MariaDB ids.
 */
export function stringEscapeStyle(driver: DriverRef): StringEscapeStyle {
  if (typeof driver === "string") {
    return driver === "mysql" || driver === "mariadb" ? "mysql" : "standard";
  }
  if (!driver) return "standard";
  const caps = "capabilities" in driver ? driver.capabilities : driver;
  if (caps?.sql_dialect || caps?.sql_syntax) return resolveSqlSyntax(caps).stringEscape;
  const id = "id" in driver ? driver.id : undefined;
  return id === "mysql" || id === "mariadb" ? "mysql" : "standard";
}

/**
 * Whether the driver's SQL supports `LIKE … ESCAPE '\'`. False only when a
 * declared `sql_syntax` says `like_escape: false`.
 */
export function supportsLikeEscape(driver: DriverRef): boolean {
  if (typeof driver !== "object" || driver === null) return true;
  return resolveSqlSyntax(driver).likeEscape;
}

/** Quotes `value` as a single-quoted string literal in `style`. */
export function quoteSqlStringWithStyle(value: string, style: StringEscapeStyle): string {
  switch (style) {
    case "backslash":
      return `'${escapeBackslashString(value)}'`;
    case "mysql":
      return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
    default:
      return `'${value.replace(/'/g, "''")}'`;
  }
}

/** Quotes `value` as a single-quoted string literal for the driver's syntax. */
export function quoteSqlString(value: string, driver: DriverRef): string {
  return quoteSqlStringWithStyle(value, stringEscapeStyle(driver));
}

function escapeBackslashString(value: string): string {
  return value
    .replace(/[\\']/g, (ch) => `\\${ch}`)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
