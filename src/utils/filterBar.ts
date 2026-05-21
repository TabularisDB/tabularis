import type { TableColumn } from "../types/editor";
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
  | "IS NULL"
  | "IS NOT NULL"
  | "IN"
  | "NOT IN"
  | "BETWEEN";

export type FilterMode = "sql" | "structured";

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
    return [...base, "LIKE", "NOT LIKE", "IN", "NOT IN"];
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
  driver?: string | null
): string {
  const col = formatSqlIdentifier(filter.column, driver);
    const op = filter.operator;

  if (op === "IS NULL") {
    return `${col} IS NULL`;
  }

  if (op === "IS NOT NULL") {
    return `${col} IS NOT NULL`;
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
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Builds a complete WHERE clause string from an array of StructuredFilter joined by AND.
 * Returns empty string if filters array is empty.
 */
export function buildStructuredFilterClause(
  filters: StructuredFilter[],
  driver?: string | null
): string {
  const clauses = filters
    .filter((f) => f.column && f.enabled !== false)
    .map((f) => buildSingleFilterClause(f, driver));
  return clauses.join(" AND ");
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
