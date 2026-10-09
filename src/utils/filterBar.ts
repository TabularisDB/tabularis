import type { TableColumn } from "../types/editor";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { formatSqlIdentifier } from "./identifiers";


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
export function buildSingleFilterClause(
  filter: StructuredFilter,
  driver?: string | PluginManifest | DriverCapabilities | null
): string {
  const col = formatSqlIdentifier(filter.column, driver);
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
    const escaped = escapeLikePattern(filter.value);
    let pattern: string;
    if (op === "contains") {
      pattern = `%${escaped}%`;
    } else if (op === "starts with") {
      pattern = `${escaped}%`;
    } else {
      pattern = `%${escaped}`;
    }
    // MySQL/MariaDB (default sql_mode) treat backslash as an escape inside
    // string literals, so a literal backslash must be doubled to survive.
    const literal = usesBackslashStringEscapes(driver)
      ? pattern.replace(/\\/g, "\\\\")
      : pattern;
    return `${col} LIKE ${quoteLiteral(literal)} ESCAPE '${LIKE_ESCAPE}'`;
  }

  if (op === "BETWEEN") {
    const v1 = quoteIfNeeded(filter.value);
    const v2 = quoteIfNeeded(filter.value2 ?? "");
    return `${col} BETWEEN ${v1} AND ${v2}`;
  }

  if (op === "IN" || op === "NOT IN") {
    const values = filter.value
      .split(",")
      .map((v) => quoteIfNeeded(v.trim()))
      .filter((v) => v !== "''")
      .join(", ");
    return `${col} ${op} (${values})`;
  }

  const val = quoteIfNeeded(filter.value);
  return `${col} ${op} ${val}`;
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

function quoteIfNeeded(value: string): string {
  if (value === "") return "''";
  // If it's a pure number (integer or decimal), don't quote
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // Already quoted
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value;
  }
  // Escape single quotes inside the value
  return quoteLiteral(value);
}

/**
 * Builds a complete WHERE clause string from an array of StructuredFilter joined
 * by the given combinator (AND by default). OR output with several clauses is
 * wrapped in parentheses so it composes safely with other clauses.
 * Returns empty string if there is no active filter.
 */
export function buildStructuredFilterClause(
  filters: StructuredFilter[],
  driver?: string | PluginManifest | DriverCapabilities | null,
  combinator: FilterCombinator = "AND"
): string {
  const clauses = filters
    .filter((f) => f.column && f.enabled !== false)
    .map((f) => buildSingleFilterClause(f, driver));
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
