import type { TableColumn } from "../types/editor";
import { isBlobColumn } from "./blob";
import { USE_DEFAULT_SENTINEL } from "./dataGrid";
import { isGeometricType } from "./geometry";
import { isHstoreColumn, isJsonColumn } from "./json";

/**
 * Describes how rows of the current result can be uniquely identified when
 * building UPDATE/DELETE statements.
 */
export interface RowIdentity {
	/** Columns whose values identify a row in a WHERE clause. */
	columns: string[];
	/**
	 * True when the table has no primary key and the identity falls back to
	 * matching every comparable column of the row (DBeaver/TablePro-style).
	 */
	isKeyless: boolean;
}

/**
 * Approximate (floating-point) numeric types. Their stored values are not
 * exactly representable, so an equality comparison against the decimal
 * representation shown in the grid may not match (e.g. a MySQL FLOAT column
 * compared with a decimal literal). Exact numerics (decimal/numeric) are fine.
 */
const APPROXIMATE_NUMERIC_TYPES = new Set([
	"float",
	"float4",
	"float8",
	"double",
	"double precision",
	"real",
]);

function isApproximateNumericType(dataType: string): boolean {
	const base = dataType
		.toLowerCase()
		.replace(/\(.*$/, "")
		.replace(/\s+unsigned$/, "")
		.trim();
	return APPROXIMATE_NUMERIC_TYPES.has(base);
}

/**
 * Returns true when a column's value can be safely compared with `=` (or
 * `IS NULL`) in a WHERE clause. Binary, geometric, JSON, hstore and
 * floating-point columns are excluded: the grid holds display/wire
 * representations of their values, which would not match the stored value in
 * an equality comparison.
 */
export function isComparableColumn(column: TableColumn): boolean {
	return (
		!isBlobColumn(column.data_type, column.character_maximum_length) &&
		!isGeometricType(column.data_type) &&
		!isJsonColumn(column.data_type) &&
		!isHstoreColumn(column.data_type) &&
		!isApproximateNumericType(column.data_type)
	);
}

/**
 * Resolves the set of columns used to identify a row for editing.
 *
 * - With a primary key, the PK columns are the identity (current behavior).
 * - Without a primary key, falls back to all comparable physical columns,
 *   but only when the result set exposes every physical column of the table:
 *   a subset SELECT could not distinguish rows that differ only in omitted
 *   columns, so editing stays disabled there.
 * - Returns null when no safe identity exists (editing must stay disabled).
 */
export function resolveRowIdentity(
	pkColumns: string[] | null | undefined,
	columnMetadata: TableColumn[] | null | undefined,
	resultColumns: string[] | null | undefined,
): RowIdentity | null {
	if (pkColumns && pkColumns.length > 0) {
		return { columns: pkColumns, isKeyless: false };
	}

	if (!columnMetadata || columnMetadata.length === 0) return null;
	if (!resultColumns || resultColumns.length === 0) return null;

	const resultSet = new Set(resultColumns.map((c) => c.toLowerCase()));
	const allPhysicalPresent = columnMetadata.every((c) =>
		resultSet.has(c.name.toLowerCase()),
	);
	if (!allPhysicalPresent) return null;

	const comparable = columnMetadata
		.filter(isComparableColumn)
		.map((c) => c.name);
	if (comparable.length === 0) return null;

	return { columns: comparable, isKeyless: true };
}

/** A single UPDATE to run for a keyless row, with the WHERE map to use. */
export interface KeylessUpdateStep {
	colName: string;
	newVal: unknown;
	/** Identity map valid at the time this step runs. */
	pkMap: Record<string, unknown>;
}

/**
 * Plans the sequential UPDATEs for one row of a keyless table.
 *
 * Without a primary key the WHERE clause matches every identity column, so
 * each UPDATE invalidates the stored value of the column it just changed.
 * Steps must therefore run in order, each with an identity map that reflects
 * the changes already applied.
 *
 * Values whose stored result is unknown client-side (currently only the
 * DEFAULT sentinel) are ordered last: after such an update the row can no
 * longer be re-identified through that column, so it is dropped from the
 * WHERE maps of any later step instead of matching a value we don't know.
 */
export function buildKeylessUpdatePlan(
	identityMap: Record<string, unknown>,
	changes: Record<string, unknown>,
): KeylessUpdateStep[] {
	const isOpaque = (value: unknown) => value === USE_DEFAULT_SENTINEL;
	const entries = Object.entries(changes).sort(
		(a, b) => Number(isOpaque(a[1])) - Number(isOpaque(b[1])),
	);

	const current: Record<string, unknown> = { ...identityMap };
	return entries.map(([colName, newVal]) => {
		const step: KeylessUpdateStep = { colName, newVal, pkMap: { ...current } };
		if (colName in current) {
			if (isOpaque(newVal)) {
				delete current[colName];
			} else {
				current[colName] = newVal;
			}
		}
		return step;
	});
}
