import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { quoteIdentifier } from "./identifiers";
import { formatSqlValueForColumnComparison } from "./foreignKeys";

export type CellValueFilterOperator =
  | "="
  | "<>"
  | "IS NULL"
  | "IS NOT NULL"
  | "IN";

/** Cap on the number of clipboard values turned into an IN list. */
export const MAX_CLIPBOARD_FILTER_VALUES = 1000;

/**
 * Split clipboard text into a deduplicated list of trimmed values for an IN
 * filter. Lines are split on line breaks; blank lines (including a trailing
 * newline) are ignored and duplicates collapse to their first occurrence.
 *
 * More than {@link MAX_CLIPBOARD_FILTER_VALUES} distinct values are dropped and
 * reported via `truncated`, so the caller can toast about the cut-off.
 */
export function parseClipboardInList(text: string): {
  values: string[];
  truncated: boolean;
} {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const value = line.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    if (values.length < MAX_CLIPBOARD_FILTER_VALUES) values.push(value);
  }
  return { values, truncated: seen.size > MAX_CLIPBOARD_FILTER_VALUES };
}

/**
 * Build a WHERE-clause fragment that filters the current table by a cell value.
 * Output: `"col" = 42`, `"col" <> 'escaped''value'`, `"col" IS NULL`,
 * `"col" IS NOT NULL`, or `"col" IN (1, 2, 3)` (the value must be an array).
 *
 * `columnType` is the data type of the column the user clicked on; it decides
 * whether a numeric-looking string is emitted unquoted (numeric column) or
 * quoted (everything else), mirroring `buildForeignKeyFilterClause`.
 */
export function buildCellValueFilterClause(
  column: string,
  operator: CellValueFilterOperator,
  value: unknown,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  columnType?: string,
): string {
  const col = quoteIdentifier(column, driver);
  if (operator === "IS NULL") return `${col} IS NULL`;
  if (operator === "IS NOT NULL") return `${col} IS NOT NULL`;
  if (operator === "IN") {
    const list = Array.isArray(value) ? value : [value];
    const literals = list.map((item) =>
      formatSqlValueForColumnComparison(item, driver, columnType),
    );
    return `${col} IN (${literals.join(", ")})`;
  }
  return `${col} ${operator} ${formatSqlValueForColumnComparison(value, driver, columnType)}`;
}

/**
 * Combine a newly added filter clause with the tab's existing one. The
 * existing clause is parenthesised so a filter that already contains OR keeps
 * its meaning when AND-ed with the new condition.
 */
export function combineFilterClauses(
  existing: string | undefined | null,
  added: string,
): string {
  const trimmed = existing?.trim();
  if (!trimmed) return added;
  return `(${trimmed}) AND ${added}`;
}

/**
 * Operators offered for a cell: NULL cells only offer the IS NULL /
 * IS NOT NULL pair, everything else (including empty strings) offers = / <>.
 *
 * A masked cell also only offers IS NULL / IS NOT NULL, whatever its value:
 * `=` / `<>` would copy the real value into the WHERE input, and offering the
 * same pair for NULL and non-NULL cells keeps the menu from hinting which one
 * the masked cell holds.
 */
export function getCellValueFilterOperators(
  value: unknown,
  options: { masked?: boolean } = {},
): CellValueFilterOperator[] {
  if (options.masked || value === null || value === undefined) {
    return ["IS NULL", "IS NOT NULL"];
  }
  return ["=", "<>"];
}
