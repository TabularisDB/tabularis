import type { ForeignKey } from "../types/schema";
import { quoteIdentifier } from "./identifiers";

const NUMERIC_TYPE_KEYWORDS = [
  "int",
  "decimal",
  "numeric",
  "real",
  "double",
  "float",
  "serial",
  "number",
  "money",
  "bit",
];

/**
 * Returns a map of column name → primary foreign key.
 *
 * V1 limitation: only single-column FKs are included. FKs that share a
 * `name` (constraint name) with one or more other entries are treated as
 * composite and skipped. When the same source column is referenced by
 * multiple distinct single-column FKs, the first occurrence wins so the
 * mapping stays deterministic across renders.
 */
export function pickPrimaryForeignKeyByColumn(
  fks: ForeignKey[] | undefined | null,
): Map<string, ForeignKey> {
  const result = new Map<string, ForeignKey>();
  if (!fks || fks.length === 0) return result;

  const byConstraint = new Map<string, ForeignKey[]>();
  for (const fk of fks) {
    const list = byConstraint.get(fk.name) ?? [];
    list.push(fk);
    byConstraint.set(fk.name, list);
  }

  for (const [, group] of byConstraint) {
    if (group.length !== 1) continue;
    const fk = group[0];
    if (!result.has(fk.column_name)) {
      result.set(fk.column_name, fk);
    }
  }
  return result;
}

/**
 * Returns true when the cell value can be used to navigate to a referenced row.
 * Null, undefined, and empty strings are not navigable.
 */
export function isForeignKeyValueNavigable(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * Build a WHERE-clause fragment that filters the referenced table by the FK value.
 * Output: `"ref_col" = 42` or `"ref_col" = 'escaped''value'`.
 *
 * `sourceColumnType` is the data type of the *source* column the user clicked on.
 * In well-formed schemas it matches the referenced column type, so we use it to
 * decide whether to emit the value unquoted (numeric) or quoted (string).
 */
export function buildForeignKeyFilterClause(
  fk: ForeignKey,
  value: unknown,
  driver: string | null | undefined,
  sourceColumnType?: string,
): string {
  const col = quoteIdentifier(fk.ref_column, driver);
  return `${col} = ${formatSqlValueForFilter(value, sourceColumnType)}`;
}

export function isNumericColumnType(type: string | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return NUMERIC_TYPE_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatSqlValueForFilter(value: unknown, columnType?: string): string {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  const str = String(value);
  if (isNumericColumnType(columnType) && /^-?\d+(\.\d+)?$/.test(str)) {
    return str;
  }
  return `'${str.replace(/'/g, "''")}'`;
}
