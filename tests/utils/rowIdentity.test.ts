import { describe, it, expect } from "vitest";
import {
	buildKeylessUpdatePlan,
	isComparableColumn,
	resolveRowIdentity,
} from "../../src/utils/rowIdentity";
import { USE_DEFAULT_SENTINEL } from "../../src/utils/dataGrid";
import type { TableColumn } from "../../src/types/editor";

function col(
	name: string,
	dataType = "varchar",
	overrides: Partial<TableColumn> = {},
): TableColumn {
	return {
		name,
		data_type: dataType,
		is_pk: false,
		is_nullable: true,
		is_auto_increment: false,
		...overrides,
	};
}

describe("rowIdentity", () => {
	describe("isComparableColumn", () => {
		it("should accept common scalar types", () => {
			expect(isComparableColumn(col("a", "varchar"))).toBe(true);
			expect(isComparableColumn(col("a", "int"))).toBe(true);
			expect(isComparableColumn(col("a", "datetime"))).toBe(true);
			expect(isComparableColumn(col("a", "decimal"))).toBe(true);
			expect(isComparableColumn(col("a", "TEXT"))).toBe(true);
		});

		it("should reject blob types", () => {
			expect(isComparableColumn(col("a", "blob"))).toBe(false);
			expect(isComparableColumn(col("a", "LONGBLOB"))).toBe(false);
			expect(isComparableColumn(col("a", "bytea"))).toBe(false);
		});

		it("should accept small fixed-size binary columns rendered as text", () => {
			// VARBINARY(36) (e.g. UUIDs) is displayed as text, so it stays comparable
			expect(
				isComparableColumn(
					col("a", "varbinary", { character_maximum_length: 36 }),
				),
			).toBe(true);
		});

		it("should reject geometric types", () => {
			expect(isComparableColumn(col("a", "geometry"))).toBe(false);
			expect(isComparableColumn(col("a", "POINT"))).toBe(false);
			expect(isComparableColumn(col("a", "geography"))).toBe(false);
		});

		it("should reject json, jsonb and hstore types", () => {
			expect(isComparableColumn(col("a", "json"))).toBe(false);
			expect(isComparableColumn(col("a", "JSONB"))).toBe(false);
			expect(isComparableColumn(col("a", "hstore"))).toBe(false);
		});

		it("should reject approximate numeric types", () => {
			// Stored floats are not exactly representable, so equality against
			// the grid's decimal representation may not match (e.g. MySQL FLOAT).
			expect(isComparableColumn(col("a", "float"))).toBe(false);
			expect(isComparableColumn(col("a", "FLOAT"))).toBe(false);
			expect(isComparableColumn(col("a", "double"))).toBe(false);
			expect(isComparableColumn(col("a", "double precision"))).toBe(false);
			expect(isComparableColumn(col("a", "double unsigned"))).toBe(false);
			expect(isComparableColumn(col("a", "real"))).toBe(false);
			expect(isComparableColumn(col("a", "float4"))).toBe(false);
			expect(isComparableColumn(col("a", "float8"))).toBe(false);
			expect(isComparableColumn(col("a", "FLOAT(10)"))).toBe(false);
			expect(isComparableColumn(col("a", "FLOAT64"))).toBe(false);
			expect(isComparableColumn(col("a", "float32"))).toBe(false);
			expect(isComparableColumn(col("a", "BINARY_DOUBLE"))).toBe(false);
		});

		it("should reject struct, nested array, map and record types", () => {
			expect(isComparableColumn(col("a", "STRUCT<name STRING, age INT64>"))).toBe(false);
			expect(isComparableColumn(col("a", "STRUCT"))).toBe(false);
			expect(isComparableColumn(col("a", "ARRAY<STRING>"))).toBe(false);
			expect(isComparableColumn(col("a", "ARRAY<STRUCT<x INT64>>"))).toBe(false);
			expect(isComparableColumn(col("a", "RECORD"))).toBe(false);
			expect(isComparableColumn(col("a", "REPEATED"))).toBe(false);
			expect(isComparableColumn(col("a", "MAP"))).toBe(false);
			expect(isComparableColumn(col("a", "MAP<STRING, INT64>"))).toBe(false);
			expect(isComparableColumn(col("a", "Map(String, UInt64)"))).toBe(false);
			expect(isComparableColumn(col("a", "Tuple(UInt8, String)"))).toBe(false);
			expect(isComparableColumn(col("a", "Nested(id UInt32)"))).toBe(false);
			expect(isComparableColumn(col("a", "ROW(a INTEGER)"))).toBe(false);
			expect(isComparableColumn(col("a", "RANGE<DATE>"))).toBe(false);
			expect(isComparableColumn(col("a", "SUPER"))).toBe(false);
		});

		it("should keep plain PostgreSQL arrays and ranges comparable", () => {
			expect(isComparableColumn(col("a", "ARRAY"))).toBe(true);
			expect(isComparableColumn(col("a", "array"))).toBe(true);
			expect(isComparableColumn(col("a", "integer[]"))).toBe(true);
			expect(isComparableColumn(col("a", "text[]"))).toBe(true);
			expect(isComparableColumn(col("a", "int4range"))).toBe(true);
			expect(isComparableColumn(col("a", "tstzrange"))).toBe(true);
		});

		it("should reject semi-structured document types", () => {
			expect(isComparableColumn(col("a", "JSON"))).toBe(false);
			expect(isComparableColumn(col("a", "VARIANT"))).toBe(false);
			expect(isComparableColumn(col("a", "object"))).toBe(false);
			expect(isComparableColumn(col("a", "GEOGRAPHY"))).toBe(false);
		});

		it("should not mistake scalar types that share a structured prefix", () => {
			expect(isComparableColumn(col("a", "rowversion"))).toBe(true);
			expect(isComparableColumn(col("a", "int4range"))).toBe(true);
			expect(isComparableColumn(col("a", "STRING"))).toBe(true);
			expect(isComparableColumn(col("a", "INT64"))).toBe(true);
			expect(isComparableColumn(col("a", "NUMERIC(38, 9)"))).toBe(true);
		});

		it("should keep exact numeric types comparable", () => {
			expect(isComparableColumn(col("a", "numeric"))).toBe(true);
			expect(isComparableColumn(col("a", "decimal"))).toBe(true);
			expect(isComparableColumn(col("a", "bigint"))).toBe(true);
		});
	});

	describe("resolveRowIdentity", () => {
		const keylessColumns = [
			col("ora_inizio", "varchar"),
			col("ora_fine", "varchar"),
			col("descrizione", "varchar"),
			col("stanza_id", "int", { is_nullable: false }),
		];
		const keylessResult = [
			"ora_inizio",
			"ora_fine",
			"descrizione",
			"stanza_id",
		];

		it("should use primary key columns when available", () => {
			expect(
				resolveRowIdentity(["id"], keylessColumns, keylessResult),
			).toEqual({ columns: ["id"], isKeyless: false });
		});

		it("should keep composite primary keys intact", () => {
			expect(resolveRowIdentity(["a", "b"], null, null)).toEqual({
				columns: ["a", "b"],
				isKeyless: false,
			});
		});

		it("should fall back to all columns when the table has no PK", () => {
			expect(
				resolveRowIdentity(null, keylessColumns, keylessResult),
			).toEqual({
				columns: ["ora_inizio", "ora_fine", "descrizione", "stanza_id"],
				isKeyless: true,
			});
		});

		it("should treat an empty pkColumns array like a missing PK", () => {
			expect(resolveRowIdentity([], keylessColumns, keylessResult)).toEqual({
				columns: ["ora_inizio", "ora_fine", "descrizione", "stanza_id"],
				isKeyless: true,
			});
		});

		it("should return null without column metadata", () => {
			expect(resolveRowIdentity(null, null, keylessResult)).toBeNull();
			expect(resolveRowIdentity(null, [], keylessResult)).toBeNull();
		});

		it("should return null without result columns", () => {
			expect(resolveRowIdentity(null, keylessColumns, null)).toBeNull();
			expect(resolveRowIdentity(null, keylessColumns, [])).toBeNull();
		});

		it("should return null when the result omits a physical column", () => {
			expect(
				resolveRowIdentity(null, keylessColumns, [
					"ora_inizio",
					"ora_fine",
					"descrizione",
				]),
			).toBeNull();
		});

		it("should match result columns case-insensitively", () => {
			expect(
				resolveRowIdentity(
					null,
					keylessColumns,
					keylessResult.map((c) => c.toUpperCase()),
				),
			).toEqual({
				columns: ["ora_inizio", "ora_fine", "descrizione", "stanza_id"],
				isKeyless: true,
			});
		});

		it("should exclude non-comparable columns from the fallback identity", () => {
			const columns = [
				col("name", "varchar"),
				col("payload", "blob"),
				col("shape", "geometry"),
				col("meta", "json"),
				col("score", "float"),
			];
			expect(
				resolveRowIdentity(null, columns, [
					"name",
					"payload",
					"shape",
					"meta",
					"score",
				]),
			).toEqual({ columns: ["name"], isKeyless: true });
		});

		it("should keep only scalar columns of a keyless table with nested fields", () => {
			const columns = [
				col("id", "INT64"),
				col("address", "STRUCT<city STRING, zip STRING>"),
				col("tags", "ARRAY<STRING>"),
				col("ratio", "FLOAT64"),
				col("area", "GEOGRAPHY"),
			];
			expect(
				resolveRowIdentity(null, columns, ["id", "address", "tags", "ratio", "area"]),
			).toEqual({ columns: ["id"], isKeyless: true });
		});

		it("should keep PostgreSQL array columns in a keyless identity", () => {
			const columns = [
				col("name", "text"),
				col("tags", "ARRAY"),
				col("labels", "text[]"),
				col("score", "float8"),
			];
			expect(
				resolveRowIdentity(null, columns, ["name", "tags", "labels", "score"]),
			).toEqual({ columns: ["name", "tags", "labels"], isKeyless: true });
		});

		it("should return null when no column is comparable", () => {
			const columns = [col("payload", "blob"), col("meta", "json")];
			expect(
				resolveRowIdentity(null, columns, ["payload", "meta"]),
			).toBeNull();
		});

		it("should ignore extra computed columns present only in the result", () => {
			expect(
				resolveRowIdentity(null, keylessColumns, [
					...keylessResult,
					"computed_total",
				]),
			).toEqual({
				columns: ["ora_inizio", "ora_fine", "descrizione", "stanza_id"],
				isKeyless: true,
			});
		});
	});

	describe("buildKeylessUpdatePlan", () => {
		const identity = { a: 1, b: "x", c: null };

		it("should return one step per changed column", () => {
			const plan = buildKeylessUpdatePlan(identity, { a: 2 });
			expect(plan).toEqual([{ colName: "a", newVal: 2, pkMap: identity }]);
		});

		it("should thread applied changes into subsequent WHERE maps", () => {
			const plan = buildKeylessUpdatePlan(identity, { a: 2, b: "y" });
			expect(plan[0]).toEqual({
				colName: "a",
				newVal: 2,
				pkMap: { a: 1, b: "x", c: null },
			});
			expect(plan[1]).toEqual({
				colName: "b",
				newVal: "y",
				pkMap: { a: 2, b: "x", c: null },
			});
		});

		it("should not mutate the caller's identity map", () => {
			buildKeylessUpdatePlan(identity, { a: 2, b: "y" });
			expect(identity).toEqual({ a: 1, b: "x", c: null });
		});

		it("should keep changes to non-identity columns out of the WHERE map", () => {
			const plan = buildKeylessUpdatePlan(
				{ a: 1 },
				{ payload: "blob-data", a: 2 },
			);
			// "payload" is not part of the identity: its change must not leak
			// into subsequent WHERE maps.
			const aStep = plan.find((s) => s.colName === "a");
			expect(aStep?.pkMap).toEqual({ a: 1 });
		});

		it("should order DEFAULT-sentinel updates last", () => {
			const plan = buildKeylessUpdatePlan(identity, {
				a: USE_DEFAULT_SENTINEL,
				b: "y",
			});
			expect(plan.map((s) => s.colName)).toEqual(["b", "a"]);
			expect(plan[1].pkMap).toEqual({ a: 1, b: "y", c: null });
		});

		it("should drop DEFAULT-sentinel columns from subsequent WHERE maps", () => {
			// After SET a = DEFAULT the stored value of "a" is unknown
			// client-side: later steps must omit it from their WHERE map
			// instead of matching the sentinel string (guaranteed 0 rows).
			const plan = buildKeylessUpdatePlan(identity, {
				a: USE_DEFAULT_SENTINEL,
				b: USE_DEFAULT_SENTINEL,
			});
			expect(plan.map((s) => s.colName)).toEqual(["a", "b"]);
			expect(plan[0].pkMap).toEqual({ a: 1, b: "x", c: null });
			expect(plan[1].pkMap).toEqual({ b: "x", c: null });
		});

		it("should return an empty plan for no changes", () => {
			expect(buildKeylessUpdatePlan(identity, {})).toEqual([]);
		});
	});
});
