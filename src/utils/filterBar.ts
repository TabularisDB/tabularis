import type { TableColumn } from "../types/editor";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import {
  formatSqlIdentifier,
  isPostgresDialect,
  quoteIdentifier,
  quoteTableRef,
} from "./identifiers";
import { formatSqlValueForColumnComparison, isMysqlFloatColumn } from "./foreignKeys";


export type FilterOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "LIKE"
  | "NOT LIKE"
  | "contains"
  | "starts with"
  | "ends with"
  | "is empty"
  | "is not empty"
  | "IS NULL"
  | "IS NOT NULL"
  | "IN"
  | "NOT IN"
  | "BETWEEN";

export type FilterMode = "sql" | "structured";

export type FilterCombinator = "AND" | "OR";

export interface StructuredFilter {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
  value2?: string; // for BETWEEN only
  enabled?: boolean; // defaults to true when building clause
  /**
   * Case sensitivity for the literal text operators (`contains`,
   * `starts with`, `ends with`). Defaults to `true`, which keeps emitting the
   * `LIKE` every dialect has always produced; `false` emits `ILIKE`, which
   * only a PostgreSQL dialect can run. Other dialects ignore the flag, so a
   * row reused on another connection keeps its previous SQL.
   */
  matchCase?: boolean;
}

const NUMERIC_TYPES = [
  "int",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "float",
  "double",
  "decimal",
  "numeric",
  "real",
  "number",
  "serial",
  "bigserial",
];

const STRING_TYPES = [
  "char",
  "varchar",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "nchar",
  "nvarchar",
  "clob",
  "string",
];

const MAX_AUTOCOMPLETE_SUGGESTIONS = 10;

/**
 * Returns column suggestions matching the given prefix (case-insensitive, max 10).
 */
export function filterColumnSuggestions(
  columns: TableColumn[],
  prefix: string
): TableColumn[] {
  if (!columns || columns.length === 0) return [];
  const lowerPrefix = prefix.toLowerCase();
  const filtered = lowerPrefix
    ? columns.filter((c) => c.name.toLowerCase().startsWith(lowerPrefix))
    : columns;
  return filtered.slice(0, MAX_AUTOCOMPLETE_SUGGESTIONS);
}

/**
 * Extracts the word (identifier token) being typed at the given cursor position.
 * Identifier characters: a-z, A-Z, 0-9, underscore.
 */
export function getCurrentWordPrefix(
  input: string,
  cursorPos: number
): string {
  const before = input.slice(0, cursorPos);
  const match = before.match(/[a-zA-Z0-9_]+$/);
  return match ? match[0] : "";
}

/**
 * Replaces the word at cursorPos with the given replacement string.
 * Returns the new input string.
 */
export function replaceCurrentWord(
  input: string,
  cursorPos: number,
  replacement: string
): string {
  const before = input.slice(0, cursorPos);
  const after = input.slice(cursorPos);
  const wordMatch = before.match(/[a-zA-Z0-9_]+$/);
  const wordStart = wordMatch
    ? cursorPos - wordMatch[0].length
    : cursorPos;
  const afterWordMatch = after.match(/^[a-zA-Z0-9_]*/);
  const wordEnd = cursorPos + (afterWordMatch ? afterWordMatch[0].length : 0);
  return input.slice(0, wordStart) + replacement + input.slice(wordEnd);
}

/**
 * Returns the list of applicable filter operators for a given SQL data type.
 */
export function getOperatorsForType(dataType: string): FilterOperator[] {
  const lower = dataType.toLowerCase();
  const isNumeric = NUMERIC_TYPES.some((t) => lower.includes(t));
  const isString = STRING_TYPES.some((t) => lower.includes(t));

  const base: FilterOperator[] = ["=", "!=", "IS NULL", "IS NOT NULL"];

  if (isNumeric) {
    return [...base, ">", "<", ">=", "<=", "BETWEEN", "IN", "NOT IN"];
  }

  if (isString) {
    return [
      ...base,
      "LIKE",
      "NOT LIKE",
      "contains",
      "starts with",
      "ends with",
      "is empty",
      "is not empty",
      "IN",
      "NOT IN",
    ];
  }

  // Default: all operators
  return [
    "=",
    "!=",
    ">",
    "<",
    ">=",
    "<=",
    "LIKE",
    "NOT LIKE",
    "IS NULL",
    "IS NOT NULL",
    "IN",
    "NOT IN",
    "BETWEEN",
  ];
}

/**
 * Builds a single SQL clause fragment from a StructuredFilter.
 * String values are single-quoted. IS NULL / IS NOT NULL ignore the value.
 * BETWEEN uses value AND value2. IN/NOT IN parse comma-separated values.
 */
export type FilterQuoteMode = "auto" | "always";

export function buildSingleFilterClause(
  filter: StructuredFilter,
  driver?: string | PluginManifest | DriverCapabilities | null,
  quoteMode: FilterQuoteMode = "auto",
  columnType?: string,
): string {
  const col =
    quoteMode === "always"
      ? quoteIdentifier(filter.column, driver)
      : formatSqlIdentifier(filter.column, driver);
  const op = filter.operator;

  if (op === "IS NULL") {
    return `${col} IS NULL`;
  }

  if (op === "IS NOT NULL") {
    return `${col} IS NOT NULL`;
  }

  if (op === "is empty") {
    return `(${col} IS NULL OR ${col} = '')`;
  }

  if (op === "is not empty") {
    return `NOT (${col} IS NULL OR ${col} = '')`;
  }

  if (op === "contains" || op === "starts with" || op === "ends with") {
    return buildLiteralLikeClause(col, filter.value, op, driver, isMatchCaseEnabled(filter));
  }

  if (op === "BETWEEN") {
    const v1 = quoteValue(filter.value);
    const v2 = quoteValue(filter.value2 ?? "");
    return `${col} BETWEEN ${v1} AND ${v2}`;
  }

  if (op === "IN" || op === "NOT IN") {
    const values = splitFilterValues(filter.value)
      .filter((v) => v !== "")
      .map((value) => quoteValue(value, true))
      .join(", ");
    return `${col} ${op} (${values})`;
  }

  const val = quoteValue(filter.value);
  return `${col} ${op} ${val}`;

  function quoteValue(value: string, doubleQuotedValue = false): string {
    if (isMysqlFloatColumn(driver, columnType) && /^-?\d+(\.\d+)?$/.test(value)) {
      return formatSqlValueForColumnComparison(Number(value), driver, columnType);
    }
    // Escape at clause construction, including values the picker already quoted.
    // Stored filter values stay dialect-independent when the picker reopens.
    return quoteIfNeeded(
      usesBackslashStringEscapes(driver) ? value.replace(/\\/g, "\\\\") : value,
      doubleQuotedValue,
    );
  }
}

/** Where a literal LIKE match may sit inside the column value. */
export type LikeMatchMode = "contains" | "starts with" | "ends with";

/**
 * Whether a row's literal text match is case-sensitive. Only `contains`,
 * `starts with` and `ends with` read it, and only a PostgreSQL dialect can act
 * on it. `matchCase` is `true` unless the user turned it off, so filters saved
 * before the setting existed keep generating `LIKE`.
 */
export function isMatchCaseEnabled(filter: StructuredFilter): boolean {
  return filter.matchCase !== false;
}

/**
 * Builds `col LIKE '<pattern>' ESCAPE '!'` that matches `value` literally:
 * `%`, `_` and the escape character in the value are escaped, so they don't
 * act as wildcards, and the pattern is wrapped with `%` according to `mode`.
 * `col` must already be a quoted/formatted identifier.
 *
 * `matchCase` swaps `LIKE` for `ILIKE` on PostgreSQL dialects only. The
 * pattern and its escaping are identical in both modes, so turning the setting
 * off changes case sensitivity and nothing else.
 */
export function buildLiteralLikeClause(
  col: string,
  value: string,
  mode: LikeMatchMode,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  matchCase = true,
): string {
  const escaped = escapeLikePattern(value);
  let pattern: string;
  if (mode === "contains") {
    pattern = `%${escaped}%`;
  } else if (mode === "starts with") {
    pattern = `${escaped}%`;
  } else {
    pattern = `%${escaped}`;
  }
  // MySQL/MariaDB (default sql_mode) treat backslash as an escape inside
  // string literals, so a literal backslash must be doubled to survive.
  const literal = usesBackslashStringEscapes(driver)
    ? pattern.replace(/\\/g, "\\\\")
    : pattern;
  // ILIKE exists only in PostgreSQL. Everywhere else the flag is ignored, so
  // the toggle can never produce SQL the connection's dialect rejects.
  const operator = matchCase || !isPostgresDialect(driver) ? "LIKE" : "ILIKE";
  return `${col} ${operator} ${quoteLiteral(literal)} ESCAPE '${LIKE_ESCAPE}'`;
}

/**
 * Escape character used in generated LIKE … ESCAPE clauses.
 * `!` rather than a backslash: `ESCAPE '\'` is a syntax error on MySQL/MariaDB with
 * the default sql_mode (the backslash escapes the closing quote), while `!`
 * has no special meaning inside string literals on any supported dialect.
 */
const LIKE_ESCAPE = "!";

/**
 * Escapes LIKE wildcards and the escape character so the value matches literally.
 * `value` is a raw UI filter string (not a pre-escaped SQL fragment). Escape
 * the escape character first, then % and _, so user-typed wildcards are
 * matched literally. Do not reorder unless the input contract changes.
 */
function escapeLikePattern(value: string): string {
  return value
    .replace(/!/g, "!!")
    .replace(/%/g, "!%")
    .replace(/_/g, "!_");
}

/**
 * True for dialects whose string literals treat backslash as an escape
 * character by default (MySQL and MariaDB without NO_BACKSLASH_ESCAPES).
 */
function usesBackslashStringEscapes(
  driver: string | PluginManifest | DriverCapabilities | null | undefined
): boolean {
  if (typeof driver === "string") {
    return driver === "mysql" || driver === "mariadb";
  }
  if (!driver) return false;
  const caps = "capabilities" in driver ? driver.capabilities : driver;
  if (caps?.sql_dialect) return caps.sql_dialect === "mysql";
  const id = "id" in driver ? driver.id : undefined;
  return id === "mysql" || id === "mariadb";
}

/** Always quote a SQL string literal, doubling embedded single quotes. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Split IN / NOT IN values on commas outside quoted literals. A naive
 * split(",") mangles values such as 'New York, NY' or 'O''Brien'.
 * Preserve quoted empty strings ('') while ignoring empty list entries.
 */
function splitFilterValues(input: string): string[] {
  const values: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        if (input[i + 1] === quote) {
          i++; // doubled quote belongs to the literal
        } else {
          quote = null;
        }
      }
    } else if (char === "'" || char === '"') {
      // Apostrophes and inch marks inside an unquoted value are data, not
      // delimiters for the rest of the list.
      if (input.slice(start, i).trim() === "") quote = char;
    } else if (char === ",") {
      values.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  values.push(input.slice(start).trim());
  return values;
}

function quoteIfNeeded(value: string, doubleQuotedValue = false): string {
  if (value === "") return "''";
  // If it's a pure number (integer or decimal), don't quote
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // Single-quoted SQL literals are already escaped by the user. For IN lists,
  // interpret double-quoted items as values; other operators keep their
  // existing identifier behavior.
  if (value.startsWith("'") && value.endsWith("'")) {
    return value;
  }
  if (doubleQuotedValue && value.startsWith('"') && value.endsWith('"')) {
    return quoteLiteral(value.slice(1, -1).replace(/""/g, '"'));
  }
  if (value.startsWith('"') && value.endsWith('"')) return value;
  // Escape single quotes inside the value
  return quoteLiteral(value);
}

/** Operators that take no value: the value input is hidden and never read. */
export const NO_VALUE_OPS: FilterOperator[] = [
  "IS NULL",
  "IS NOT NULL",
  "is empty",
  "is not empty",
];

/**
 * Whether a filter has everything its operator needs to produce a valid clause.
 * Operators in NO_VALUE_OPS need no value; BETWEEN needs both bounds; IN / NOT IN
 * need at least one non-empty item; every other operator needs a value. Values
 * made only of whitespace count as empty.
 */
export function isFilterComplete(filter: StructuredFilter): boolean {
  if (NO_VALUE_OPS.includes(filter.operator)) return true;
  switch (filter.operator) {
    case "BETWEEN":
      return filter.value.trim() !== "" && (filter.value2 ?? "").trim() !== "";
    case "IN":
    case "NOT IN":
      return splitFilterValues(filter.value).some((v) => v !== "");
    default:
      return filter.value.trim() !== "";
  }
}

/**
 * Builds a complete WHERE clause string from an array of StructuredFilter joined
 * by the given combinator (AND by default). Disabled and incomplete filters
 * (e.g. the empty row added when the panel opens) are ignored. OR output with several clauses is
 * wrapped in parentheses so it composes safely with other clauses.
 * Returns empty string if there is no active filter.
 */
export function buildStructuredFilterClause(
  filters: StructuredFilter[],
  driver?: string | PluginManifest | DriverCapabilities | null,
  combinator: FilterCombinator = "AND",
  quoteMode: FilterQuoteMode = "auto",
  columns?: readonly TableColumn[],
): string {
  const clauses = filters
    .filter((f) => f.column && f.enabled !== false && isFilterComplete(f))
    .map((f) =>
      buildSingleFilterClause(
        f,
        driver,
        quoteMode,
        columns?.find((c) => c.name === f.column)?.data_type,
      ),
    );
  const joined = clauses.join(` ${combinator} `);
  return combinator === "OR" && clauses.length > 1 ? `(${joined})` : joined;
}

/**
 * Creates a new empty StructuredFilter with the first available column.
 */
export function createEmptyFilter(columns: TableColumn[]): StructuredFilter {
  const firstColumn = columns.length > 0 ? columns[0].name : "";
  const firstType = columns.length > 0 ? columns[0].data_type : "";
  const operators = getOperatorsForType(firstType);
  return {
    id: `filter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    column: firstColumn,
    operator: operators[0],
    value: "",
    enabled: true,
  };
}

/**
 * Splits an IN / NOT IN value list on commas that sit outside single or
 * double quotes, so a quoted item such as `'Paris, TX'` stays whole. A quote
 * only opens a literal at the start of an item. Items
 * are trimmed and empty items (`a,,b`, a trailing comma) are dropped; an
 * explicitly quoted empty string (`''`) is kept.
 */
export function splitInList(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        // A doubled quote is an escaped quote inside the literal.
        if (value[i + 1] === quote) {
          current += value[++i];
        } else {
          quote = null;
        }
      }
    } else if ((ch === "'" || ch === '"') && current.trim() === "") {
      // Only a quote that opens an item starts a literal, so an apostrophe
      // inside an unquoted value (O'Hare) is kept as typed.
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((v) => v.trim()).filter((v) => v !== "");
}

// ─── Value picker (issue #869) ────────────────────────────────────────────────

/** Most frequent distinct values the value picker loads for a column. */
export const VALUE_PICKER_LIMIT = 100;

/** One distinct column value and how many rows hold it. */
export interface DistinctValue {
  value: string;
  count: number;
}

/** Binary and document types whose values can't be picked from a list. */
const NON_PICKABLE_TYPES = ["blob", "bytea", "binary", "json", "image"];

/**
 * True when the value picker makes sense for a column of this type.
 * BLOB / binary and JSON columns are excluded: their values are neither
 * readable in a list nor comparable with `=` on every dialect.
 */
export function isValuePickerSupported(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return !NON_PICKABLE_TYPES.some((t) => lower.includes(t));
}

export interface DistinctValuesQueryOptions {
  table: string;
  schema?: string | null;
  column: string;
  driver?: string | PluginManifest | DriverCapabilities | null;
  /** WHERE clause (without the keyword) that narrows the counted rows. */
  where?: string;
  limit?: number;
}

/**
 * Builds the query that lists a column's most frequent non-NULL values with
 * their counts, e.g. for MySQL:
 *
 *   SELECT `status`, COUNT(*) FROM `orders` WHERE `status` IS NOT NULL
 *   GROUP BY `status` ORDER BY 2 DESC, 1 LIMIT 100
 *
 * Identifiers are always quoted for the active driver so reserved words and
 * mixed-case names work. NULLs are left out: they can't be matched with `=`
 * or `IN`, and the IS NULL operator already covers them.
 */
export function buildDistinctValuesQuery({
  table,
  schema,
  column,
  driver,
  where,
  limit = VALUE_PICKER_LIMIT,
}: DistinctValuesQueryOptions): string {
  const col = quoteIdentifier(column, driver);
  const conditions = [`${col} IS NOT NULL`];
  if (where && where.trim()) conditions.push(`(${where.trim()})`);
  return (
    `SELECT ${col}, COUNT(*) FROM ${quoteTableRef(table, driver, schema)} ` +
    `WHERE ${conditions.join(" AND ")} GROUP BY ${col} ORDER BY 2 DESC, 1 LIMIT ${limit}`
  );
}

/**
 * WHERE clause the value picker uses to narrow its counts: the other
 * enabled, complete rows of the panel. With "Match any" (OR) the other rows
 * widen the result instead of narrowing it, so nothing is applied.
 */
export function buildValuePickerWhere(
  filters: StructuredFilter[],
  excludeId: string,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  combinator: FilterCombinator,
  columns?: readonly TableColumn[],
): string {
  if (combinator === "OR") return "";
  const others = filters.filter((f) => f.id !== excludeId);
  // Always quote columns so the WHERE matches buildDistinctValuesQuery
  // (quoteIdentifier), including MySQL reserved words like `order` / `group`.
  return buildStructuredFilterClause(others, driver, "AND", "always", columns);
}

function stringifyCell(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Converts `[value, count]` result rows into picker entries, skipping NULLs. */
export function parseDistinctValues(rows: unknown[][]): DistinctValue[] {
  const values: DistinctValue[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [value, count] = row;
    if (value === null || value === undefined) continue;
    values.push({ value: stringifyCell(value), count: Number(count) || 0 });
  }
  return values;
}

/** Case-insensitive substring search over picker entries. */
export function filterDistinctValues(values: DistinctValue[], search: string): DistinctValue[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return values;
  return values.filter((v) => v.value.toLowerCase().includes(needle));
}

/**
 * Formats a picked value for the filter's value field. Plain values stay as
 * they are (the clause builder quotes them); a value is quoted up front when
 * the builder would otherwise misread it: number-like text in a string
 * column, commas (IN lists), edge whitespace (trimmed by IN) or quote
 * characters (a wrapped value would be taken as already quoted).
 */
export function formatPickedValue(value: string, dataType: string): string {
  const isString = STRING_TYPES.some((t) => dataType.toLowerCase().includes(t));
  const needsQuotes =
    value === "" ||
    value !== value.trim() ||
    value.includes(",") ||
    /['"]/.test(value) ||
    (isString && /^-?\d+(\.\d+)?$/.test(value));
  return needsQuotes ? quoteLiteral(value) : value;
}

/**
 * Returns the filter with the picked values applied: one value uses `=`,
 * several use `IN`. A negated filter (`!=` / `NOT IN`) stays negated.
 * Picking nothing leaves the filter untouched.
 */
export function applyPickedValues(
  filter: StructuredFilter,
  values: string[],
  dataType: string,
): StructuredFilter {
  if (values.length === 0) return filter;
  const negated = filter.operator === "!=" || filter.operator === "NOT IN";
  const single = values.length === 1;
  const operator: FilterOperator = single
    ? negated ? "!=" : "="
    : negated ? "NOT IN" : "IN";
  return {
    ...filter,
    operator,
    value: values.map((v) => formatPickedValue(v, dataType)).join(", "),
  };
}

function unquote(item: string): string {
  const q = item[0];
  if (item.length >= 2 && (q === "'" || q === '"') && item.endsWith(q)) {
    return item.slice(1, -1).split(q + q).join(q);
  }
  return item;
}

/**
 * The values currently in an `=`, `!=`, `IN` or `NOT IN` filter, unquoted,
 * so the picker can open with them already ticked.
 */
export function getPickedValues(filter: StructuredFilter): string[] {
  if (filter.value === "") return [];
  if (filter.operator === "=" || filter.operator === "!=") {
    return [unquote(filter.value)];
  }
  if (filter.operator === "IN" || filter.operator === "NOT IN") {
    return splitInList(filter.value).map(unquote);
  }
  return [];
}
