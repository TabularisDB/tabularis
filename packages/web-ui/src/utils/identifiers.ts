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
    return quoteIdentifierWith(identifier, getQuoteChar(driver));
}

/**
 * Quotes `identifier` with an explicit opening quote character, for callers
 * that already resolved the driver's `identifier_quote` (see `getQuoteChar`).
 * `[` (SQL Server style) closes with `]`, and the closing character is doubled
 * inside the name.
 */
export function quoteIdentifierWith(identifier: string, quote: string): string {
    const close = quote === '[' ? ']' : quote;
    const escaped = identifier.replaceAll(close, `${close}${close}`);
    return `${quote}${escaped}${close}`;
}

// Unquoted identifiers keep their case on MySQL/MariaDB, SQLite and SQL Server,
// so only the character set matters there. Oracle folds unquoted names to
// upper case, PostgreSQL (PG_SAFE_IDENTIFIER above) to lower case.
const PLAIN_SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ORACLE_SAFE_IDENTIFIER = /^[A-Z][A-Z0-9_$#]*$/;

// Words that cannot be used as a bare table or column name in at least one of
// the supported dialects. Quoting a word the connection's dialect does not
// reserve is harmless, so one shared set covers every dialect:
//
// - PostgreSQL: every reserved keyword, including the ones that can only be
//   function or type names (categories R and T of `pg_get_keywords()`, 17).
// - SQLite: every keyword its parser rejects as a bare table or column name.
// - Oracle: the SQL reserved words.
// - MySQL 8 / MariaDB and SQL Server: the reserved words that are plausible
//   table or column names. Their full lists also hold data types, interval
//   units and engine options (`tinyint`, `day_hour`, `sql_big_result`,
//   `fillfactor`) that are left out.
const words = (list: string): string[] => list.trim().split(/\s+/);
const RESERVED_IN_POSTGRES = words(`
    all analyse analyze and any array as asc asymmetric authorization binary both case cast
    check collate collation column concurrently constraint create cross current_catalog
    current_date current_role current_schema current_time current_timestamp current_user
    default deferrable desc distinct do else end except false fetch for foreign freeze from
    full grant group having ilike in initially inner intersect into is isnull join lateral
    leading left like limit localtime localtimestamp natural not notnull null offset on only
    or order outer overlaps placing primary references returning right select session_user
    similar some symmetric system_user table tablesample then to trailing true union unique
    user using variadic verbose when where window with
`);
const RESERVED_IN_SQLITE = words(`
    add all alter and as autoincrement between case cast check collate commit constraint
    create default deferrable delete distinct drop else escape except exists foreign from
    group having if in index insert intersect into is isnull join limit not nothing notnull
    null on or order primary raise references returning select set table then to transaction
    union unique update using values when where
`);
const RESERVED_IN_ORACLE = words(`
    access add all alter and any as asc audit between by char check cluster column comment
    compress connect create current date decimal default delete desc distinct drop else
    exclusive exists file float for from grant group having identified immediate in
    increment index initial insert integer intersect into is level like lock long maxextents
    minus mlslabel mode modify noaudit nocompress not nowait null number of offline on
    online option or order pctfree prior public raw rename resource revoke row rowid rownum
    rows select session set share size smallint start successful synonym sysdate table then
    to trigger uid union unique update user validate values varchar varchar2 view whenever
    where with
`);
const RESERVED_IN_MYSQL = words(`
    accessible before call cascade change character condition cube cume_dist cursor database
    databases delayed dense_rank describe div dual each empty exit explain first_value force
    fulltext function generated get grouping groups ignore interval key keys kill lag
    last_value lead leave linear lines load loop match mod nth_value ntile out over
    partition percent_rank precision procedure purge range rank read reads recursive regexp
    release repeat replace require restrict return rlike row_number schema sensitive
    separator show signal spatial specific sql ssl starting stored system undo unlock usage
    use virtual while write
`);
const RESERVED_IN_MSSQL = words(`
    backup begin break browse bulk checkpoint close clustered compute contains continue
    cursor deny disk distributed dump exec execute exit external identity kill lineno load
    merge national off open percent pivot plan print proc procedure replication restore
    revert rollback rowcount rule save statistics top tran transaction truncate unpivot view
    waitfor
`);
const RESERVED_IDENTIFIERS = new Set([
    ...RESERVED_IN_POSTGRES,
    ...RESERVED_IN_SQLITE,
    ...RESERVED_IN_ORACLE,
    ...RESERVED_IN_MYSQL,
    ...RESERVED_IN_MSSQL,
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
