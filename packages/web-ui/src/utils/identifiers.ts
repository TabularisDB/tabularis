import type { DriverCapabilities, PluginManifest } from "../types/plugins";

/** Narrows a `driver` argument down to its `DriverCapabilities`, whether it
 * arrived as a full `PluginManifest`, a bare `DriverCapabilities`, or neither. */
function capabilitiesOf(
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): DriverCapabilities | null {
  if (typeof driver !== "object" || driver === null) return null;
  return "capabilities" in driver ? driver.capabilities : driver;
}

/**
 * Returns the appropriate quote character for SQL identifiers based on the database driver.
 * Accepts a driver string, a PluginManifest, or a bare DriverCapabilities object.
 * When an object is provided, the identifier_quote from capabilities is used.
 * MySQL/MariaDB use backticks (`), while PostgreSQL and SQLite use double quotes (").
 */
export function getQuoteChar(
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): string {
  const caps = capabilitiesOf(driver);
  if (caps?.identifier_quote) {
    return caps.identifier_quote;
  }
  // legacy fallback for string driver names (or an object with no id, e.g. a
  // bare DriverCapabilities that omitted identifier_quote)
  const driverStr =
    typeof driver === "object" && driver !== null && "id" in driver
      ? driver.id
      : typeof driver === "string"
        ? driver
        : undefined;
  return driverStr === "mysql" || driverStr === "mariadb" ? "`" : '"';
}

/**
 * Quotes a SQL identifier (table name, column name, view name, etc.) using the appropriate
 * quote character for the given database driver.
 *
 * @param identifier - The identifier to quote (e.g., table name, column name)
 * @param driver - The database driver ("mysql", "mariadb", "postgres", "sqlite")
 * @returns The quoted identifier
 *
 * @example
 * quoteIdentifier("my table", "mysql") // returns: `my table`
 * quoteIdentifier("my_table", "postgres") // returns: "my_table"
 */
/**
 * True when identifiers in generated SQL fragments should be double-quoted.
 * Capability-driven when a manifest/capabilities object is available (issue
 * #614): checks `sql_dialect`, not the driver id string, so a postgres-
 * compatible driver registered under a different id (e.g. a standalone
 * PostgreSQL plugin) is quoted identically to the builtin "postgres" driver.
 * An omitted `sql_dialect` defaults to "postgres" per the manifest schema —
 * matching the same fallback `src/utils/sqlSplitter/index.ts` already uses.
 * Falls back to a literal string check when only a bare driver id is
 * available (no capabilities object in scope) — covers both "postgres"
 * (builtin) and "postgresql" (the shipped plugin's id, per PR #588) so
 * bare-string callers keep working without a manifest in scope.
 */
export function shouldQuoteIdentifiers(
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
  const caps = capabilitiesOf(driver);
  if (caps) {
    return (caps.sql_dialect ?? "postgres") === "postgres";
  }
  return driver === "postgres" || driver === "postgresql";
}

// PostgreSQL folds unquoted identifiers to lowercase and only needs quotes for
// reserved words, mixed case, or special characters — mirroring quote_ident().
const PG_SAFE_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/;
const PG_RESERVED = new Set([
  "select", "from", "where", "table", "user", "order", "group", "join", "and", "or",
  "as", "in", "on", "by", "null", "true", "false", "default", "check", "column", "limit", "offset",
]);

/**
 * Formats a SQL identifier for WHERE / ORDER BY fragments.
 * Quotes only when required (PostgreSQL); otherwise returns the name unchanged.
 */
export function formatSqlIdentifier(
  identifier: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): string {
  if (!shouldQuoteIdentifiers(driver)) return identifier;
  if (PG_SAFE_IDENTIFIER.test(identifier) && !PG_RESERVED.has(identifier)) {
    return identifier;
  }
  return quoteIdentifier(identifier, driver);
}

export function quoteIdentifier(
  identifier: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
): string {
  const quote = getQuoteChar(driver);
  const escaped =
    quote === "`"
      ? identifier.replace(/`/g, "``")
      : identifier.replace(/"/g, '""');
  return `${quote}${escaped}${quote}`;
}

/**
 * Returns a schema-qualified, quoted table reference for use in SQL queries.
 * When a schema is provided, returns "schema"."table" (or `schema`.`table` for MySQL).
 * Otherwise returns just the quoted table name.
 */
export function quoteTableRef(
  table: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  schema?: string | null,
): string {
  if (schema) {
    return `${quoteIdentifier(schema, driver)}.${quoteIdentifier(table, driver)}`;
  }
  return quoteIdentifier(table, driver);
}

