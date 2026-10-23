import type {DriverCapabilities, PluginManifest} from '@/types/plugins';

/** Narrows a `driver` argument down to its `DriverCapabilities`, whether it
 * arrived as a full `PluginManifest`, a bare `DriverCapabilities`, or neither. */
function capabilitiesOf(
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): DriverCapabilities | null {
    if (typeof driver !== 'object' || driver === null) return null;
    return 'capabilities' in driver ? driver.capabilities : driver;
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
        typeof driver === 'object' && driver !== null && 'id' in driver
            ? driver.id
            : typeof driver === 'string'
              ? driver
              : undefined;
    return driverStr === 'mysql' || driverStr === 'mariadb' ? '`' : '"';
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
/** Quotes identifiers for PostgreSQL dialects; see `isPostgresDialect`. */
export function shouldQuoteIdentifiers(
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
    return isPostgresDialect(driver);
}

/**
 * True when the driver uses the PostgreSQL SQL dialect.
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
export function isPostgresDialect(
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
    const caps = capabilitiesOf(driver);
    if (caps) {
        return (caps.sql_dialect ?? 'postgres') === 'postgres';
    }
    return driver === 'postgres' || driver === 'postgresql';
}

/** True for MySQL SQL dialect capabilities or the builtin "mysql" driver id. */
export function isMysqlDialect(
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
    const caps = capabilitiesOf(driver);
    if (caps) {
        return caps.sql_dialect === 'mysql';
    }
    return driver === 'mysql';
}

// PostgreSQL folds unquoted identifiers to lowercase and only needs quotes for
// reserved words, mixed case, or special characters — mirroring quote_ident().
const PG_SAFE_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/;
const PG_RESERVED = new Set([
    'select',
    'from',
    'where',
    'table',
    'user',
    'order',
    'group',
    'join',
    'and',
    'or',
    'as',
    'in',
    'on',
    'by',
    'null',
    'true',
    'false',
    'default',
    'check',
    'column',
    'limit',
    'offset',
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
    const escaped = identifier.replaceAll(quote, `${quote}${quote}`);
    return `${quote}${escaped}${quote}`;
}

// Unquoted identifiers keep their case on MySQL/MariaDB, SQLite and SQL Server,
// so only the character set matters there. Oracle folds unquoted names to
// upper case, PostgreSQL (PG_SAFE_IDENTIFIER above) to lower case.
const PLAIN_SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ORACLE_SAFE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]*$/;

// Words reserved in at least one of the supported dialects that are plausible
// table or column names. Quoting a word a dialect does not reserve is harmless,
// so one shared list covers every dialect.
const RESERVED_IDENTIFIERS = new Set([
    ...PG_RESERVED,
    'add',
    'all',
    'alter',
    'analyze',
    'any',
    'asc',
    'between',
    'both',
    'call',
    'cascade',
    'case',
    'cast',
    'change',
    'collate',
    'constraint',
    'create',
    'cross',
    'current_date',
    'current_time',
    'current_timestamp',
    'current_user',
    'database',
    'databases',
    'delete',
    'desc',
    'describe',
    'distinct',
    'div',
    'drop',
    'else',
    'end',
    'escape',
    'except',
    'exists',
    'explain',
    'fetch',
    'for',
    'force',
    'foreign',
    'full',
    'fulltext',
    'function',
    'grant',
    'having',
    'if',
    'ignore',
    'index',
    'inner',
    'insert',
    'interval',
    'intersect',
    'into',
    'is',
    'key',
    'keys',
    'leading',
    'left',
    'like',
    'lock',
    'match',
    'mod',
    'natural',
    'not',
    'option',
    'outer',
    'over',
    'partition',
    'primary',
    'procedure',
    'range',
    'rank',
    'read',
    'references',
    'regexp',
    'rename',
    'replace',
    'require',
    'restrict',
    'return',
    'revoke',
    'right',
    'rlike',
    'row',
    'rows',
    'schema',
    'set',
    'show',
    'then',
    'to',
    'trailing',
    'trigger',
    'union',
    'unique',
    'unlock',
    'update',
    'usage',
    'use',
    'using',
    'values',
    'when',
    'while',
    'window',
    'with',
    'write',
]);

/**
 * True when `identifier` must be quoted to be used as-is in the driver's
 * dialect: it contains characters outside `[A-Za-z0-9_]` (a hyphen, a space,
 * ...), starts with a digit, is a reserved word, or (PostgreSQL / Oracle) its
 * case differs from the one the server folds unquoted names to.
 */
export function identifierNeedsQuoting(
    identifier: string,
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
    if (identifier === '') return false;
    if (RESERVED_IDENTIFIERS.has(identifier.toLowerCase())) return true;
    if (isPostgresDialect(driver)) return !PG_SAFE_IDENTIFIER.test(identifier);
    if (capabilitiesOf(driver)?.sql_dialect === 'oracle') {
        return !ORACLE_SAFE_IDENTIFIER.test(identifier);
    }
    return !PLAIN_SAFE_IDENTIFIER.test(identifier);
}

/**
 * Quotes `identifier` with the driver's identifier quote (see
 * `quoteIdentifier`) only when `identifierNeedsQuoting` says it must be, so
 * plain names such as `users` stay unquoted. Used where the user keeps typing
 * around the inserted name, e.g. the SQL editor's autocomplete.
 */
export function quoteIdentifierIfNeeded(
    identifier: string,
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): string {
    return identifierNeedsQuoting(identifier, driver)
        ? quoteIdentifier(identifier, driver)
        : identifier;
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
