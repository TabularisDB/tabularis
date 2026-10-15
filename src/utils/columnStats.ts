import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { isBlobColumn } from "./blob";
import { isComparableColumnType } from "./cellValueFilter";
import {
  buildDistinctValuesQuery,
  isValuePickerSupported,
  parseDistinctValues,
} from "./filterBar";
import type { DistinctValue } from "./filterBar";
import { isGeometricType } from "./geometry";
import { quoteIdentifier, quoteTableRef } from "./identifiers";
import { isJsonColumn } from "./json";

// ─── Column statistics (issue #1001) ──────────────────────────────────────────

/** Most frequent values the column statistics popover lists. */
export const COLUMN_STATS_TOP_VALUES_LIMIT = 10;

/** Which parts of the statistics make sense for a column. */
export interface ColumnStatsSupport {
  /** `COUNT(DISTINCT col)`: needs an equality operator on the type. */
  distinct: boolean;
  /** `MIN(col)` / `MAX(col)`: numbers and dates/times only. */
  minMax: boolean;
  /** Top values list (and clicking one to filter the table by it). */
  topValues: boolean;
}

export interface ColumnStatsSupportOptions {
  /** `character_maximum_length`, used to tell short BINARY/VARBINARY from BLOBs. */
  characterMaximumLength?: number;
  /**
   * The column is masked in the grid: min / max and top values would show
   * the real values, so only the counts are computed.
   */
  masked?: boolean;
}

/**
 * Types with no equality operator on at least one supported dialect
 * (PostgreSQL `json`, `xml` and the built-in geometric shapes), so
 * `COUNT(DISTINCT col)` and `GROUP BY col` would fail. Matched exactly
 * (after dropping a length/precision suffix): names like `line` or `path`
 * are too short to match as substrings.
 */
const NO_EQUALITY_TYPES = new Set(["xml", "box", "circle", "line", "lseg", "path"]);

/**
 * Decides which statistics to compute for a column of `dataType`:
 *
 * - JSON, XML and geometry columns only get the row and NULL counts.
 * - BLOB / binary columns also get the distinct count, but no min / max or
 *   top values (the values aren't readable in a list).
 * - Min / max are limited to numeric and date/time columns.
 * - A masked column never gets min / max or top values.
 */
export function getColumnStatsSupport(
  dataType: string | undefined | null,
  options: ColumnStatsSupportOptions = {},
): ColumnStatsSupport {
  const type = (dataType ?? "").trim();
  const baseType = type.toLowerCase().replace(/\([^)]*\)/g, "").trim();
  if (
    isJsonColumn(baseType) ||
    isGeometricType(type) ||
    NO_EQUALITY_TYPES.has(baseType)
  ) {
    return { distinct: false, minMax: false, topValues: false };
  }
  if (type && isBlobColumn(type, options.characterMaximumLength)) {
    return { distinct: true, minMax: false, topValues: false };
  }
  const revealsValues = !options.masked;
  return {
    distinct: true,
    minMax: revealsValues && isComparableColumnType(type),
    topValues: revealsValues && isValuePickerSupported(type),
  };
}

export interface ColumnStatsQueryOptions {
  table: string;
  schema?: string | null;
  column: string;
  driver?: string | PluginManifest | DriverCapabilities | null;
  /** The table's current filter (WHERE clause without the keyword). */
  where?: string;
  support: ColumnStatsSupport;
}

/**
 * Builds the single-row aggregate query behind the popover, e.g. for
 * PostgreSQL on a numeric column with a filter:
 *
 *   SELECT COUNT(*), COUNT(*) - COUNT("price"), COUNT(DISTINCT "price"),
 *   MIN("price"), MAX("price") FROM "public"."orders" WHERE (status = 'open')
 *
 * The distinct count and min / max are only added when `support` allows
 * them; `parseColumnStats` reads the columns in the same order.
 */
export function buildColumnStatsQuery({
  table,
  schema,
  column,
  driver,
  where,
  support,
}: ColumnStatsQueryOptions): string {
  const col = quoteIdentifier(column, driver);
  const select = ["COUNT(*)", `COUNT(*) - COUNT(${col})`];
  if (support.distinct) select.push(`COUNT(DISTINCT ${col})`);
  if (support.minMax) select.push(`MIN(${col})`, `MAX(${col})`);
  const filter = where?.trim();
  return (
    `SELECT ${select.join(", ")} FROM ${quoteTableRef(table, driver, schema)}` +
    (filter ? ` WHERE (${filter})` : "")
  );
}

/** Aggregates computed for one column. */
export interface ColumnStatsCounts {
  rowCount: number;
  nullCount: number;
  /** `null` when the distinct count isn't computed for this type. */
  distinctCount: number | null;
  /** Raw MIN / MAX values; `null` when not computed or every value is NULL. */
  min: unknown;
  max: unknown;
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Reads the row of `buildColumnStatsQuery`, in the order it was built. */
export function parseColumnStats(
  rows: unknown[][],
  support: ColumnStatsSupport,
): ColumnStatsCounts {
  const row = Array.isArray(rows[0]) ? rows[0] : [];
  let index = 0;
  const next = () => row[index++];
  const rowCount = toCount(next());
  const nullCount = toCount(next());
  const distinctCount = support.distinct ? toCount(next()) : null;
  const min = support.minMax ? (next() ?? null) : null;
  const max = support.minMax ? (next() ?? null) : null;
  return { rowCount, nullCount, distinctCount, min, max };
}

/** Everything the popover shows. */
export interface ColumnStats extends ColumnStatsCounts {
  /** Most frequent non-NULL values; `null` when not computed for this column. */
  topValues: DistinctValue[] | null;
  /** True when the counts are limited by the table's current filter. */
  filtered: boolean;
}

/** Runs a read-only query and returns its rows. */
export type ColumnStatsQueryRunner = (
  sql: string,
  signal?: AbortSignal,
) => Promise<{ rows: unknown[][] }>;

function abortError(): Error {
  const error = new Error("Column statistics cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * Loads a column's statistics with at most two queries: the aggregates,
 * then (when supported and there is at least one non-NULL value) the top
 * values, reusing `buildDistinctValuesQuery` with a small LIMIT. Both apply
 * the same filter. Once `signal` is aborted no further query starts and the
 * promise rejects with an `AbortError`.
 */
export async function loadColumnStats(
  run: ColumnStatsQueryRunner,
  options: ColumnStatsQueryOptions,
  signal?: AbortSignal,
): Promise<ColumnStats> {
  const { support } = options;
  if (signal?.aborted) throw abortError();
  const result = await run(buildColumnStatsQuery(options), signal);
  if (signal?.aborted) throw abortError();
  const counts = parseColumnStats(result.rows, support);

  let topValues: DistinctValue[] | null = null;
  if (support.topValues) {
    topValues = [];
    if (counts.rowCount > counts.nullCount) {
      const top = await run(
        buildDistinctValuesQuery({
          table: options.table,
          schema: options.schema,
          column: options.column,
          driver: options.driver,
          where: options.where,
          limit: COLUMN_STATS_TOP_VALUES_LIMIT,
        }),
        signal,
      );
      if (signal?.aborted) throw abortError();
      topValues = parseDistinctValues(top.rows);
    }
  }

  return { ...counts, topValues, filtered: !!options.where?.trim() };
}

/** True for the rejection `loadColumnStats` uses when it is cancelled. */
export function isColumnStatsAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Formats a MIN / MAX value for display. */
export function formatColumnStatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Share of `part` in `total` as a percentage, 0 when `total` is 0. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}
