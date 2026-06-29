import type { PluginManifest } from "../types/plugins";

/**
 * Returns the appropriate quote character for SQL identifiers based on the database driver.
 * Accepts a driver string or a PluginManifest object.
 * When a manifest is provided, the identifier_quote from capabilities is used.
 * MySQL/MariaDB use backticks (`), while PostgreSQL and SQLite use double quotes (").
 */
export function getQuoteChar(
  driver: string | PluginManifest | null | undefined,
): string {
  if (typeof driver === "object" && driver?.capabilities?.identifier_quote) {
    return driver.capabilities.identifier_quote;
  }
  // legacy fallback for string driver names
  const driverStr = typeof driver === "object" ? driver?.id : driver;
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
/** True when identifiers in generated SQL fragments should be double-quoted (PostgreSQL). */
export function shouldQuoteIdentifiers(
  driver: string | null | undefined,
): boolean {
  return driver === "postgres";
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
  driver: string | null | undefined,
): string {
  if (!shouldQuoteIdentifiers(driver)) return identifier;
  if (PG_SAFE_IDENTIFIER.test(identifier) && !PG_RESERVED.has(identifier)) {
    return identifier;
  }
  return quoteIdentifier(identifier, driver);
}

export function quoteIdentifier(
  identifier: string,
  driver: string | null | undefined,
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
  driver: string | null | undefined,
  schema?: string | null,
): string {
  if (schema) {
    return `${quoteIdentifier(schema, driver)}.${quoteIdentifier(table, driver)}`;
  }
  return quoteIdentifier(table, driver);
}

