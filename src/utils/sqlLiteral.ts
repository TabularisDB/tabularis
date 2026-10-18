import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { resolveSqlSyntax, type StringEscapeStyle } from "./sqlSyntax";

export type { StringEscapeStyle } from "./sqlSyntax";

type DriverRef = string | PluginManifest | DriverCapabilities | null | undefined;

/** Driver ids whose literals were MySQL-escaped before capabilities existed. */
const MYSQL_ESCAPE_DRIVER_IDS = new Set(["mysql", "mariadb"]);

/**
 * Resolves the string-literal escape style of a driver from its resolved SQL
 * syntax (`sql_syntax.string_escape`, else the `sql_dialect` preset).
 *
 * When nothing concrete is declared (a bare driver id, or capabilities with
 * no `sql_syntax` and no or a `generic` `sql_dialect`), only the built-in
 * MySQL/MariaDB ids are known, read from `driverId` or the manifest's `id`.
 * That keeps a `mariadb` plugin without a dialect doubling backslashes as it
 * did before capabilities were consulted.
 */
export function stringEscapeStyle(
  driver: DriverRef,
  driverId?: string | null,
): StringEscapeStyle {
  const byId = (id: string | null | undefined): StringEscapeStyle =>
    id && MYSQL_ESCAPE_DRIVER_IDS.has(id) ? "mysql" : "standard";
  if (typeof driver === "string") return byId(driver);
  if (!driver) return byId(driverId);
  const caps = "capabilities" in driver ? driver.capabilities : driver;
  const declared =
    !!caps?.sql_syntax || (!!caps?.sql_dialect && caps.sql_dialect !== "generic");
  if (declared) return resolveSqlSyntax(caps).stringEscape;
  return byId(driverId ?? ("id" in driver ? driver.id : undefined));
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
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
