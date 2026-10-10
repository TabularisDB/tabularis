import { describe, it, expect } from "vitest";
import {
  buildCellValueFilterClause,
  combineFilterClauses,
  getCellValueFilterOperators,
} from "../../src/utils/cellValueFilter";

describe("cellValueFilter", () => {
  describe("buildCellValueFilterClause", () => {
    it("quotes string values and escapes embedded single quotes", () => {
      expect(
        buildCellValueFilterClause("name", "=", "O'Brien", "postgres"),
      ).toBe(`"name" = 'O''Brien'`);
    });

    it("emits numbers unquoted", () => {
      expect(buildCellValueFilterClause("id", "=", 42, "postgres")).toBe(
        '"id" = 42',
      );
      expect(buildCellValueFilterClause("id", "=", 42, "mysql")).toBe(
        "`id` = 42",
      );
    });

    it("emits bigint values unquoted", () => {
      expect(
        buildCellValueFilterClause("id", "=", BigInt("9007199254740993"), "sqlite"),
      ).toBe('"id" = 9007199254740993');
    });

    it("keeps numeric-looking strings quoted in varchar columns", () => {
      expect(
        buildCellValueFilterClause("code", "=", "42", "postgres", "varchar(255)"),
      ).toBe(`"code" = '42'`);
    });

    it("emits numeric-looking strings unquoted in numeric columns", () => {
      expect(
        buildCellValueFilterClause("age", "=", "42", "postgres", "integer"),
      ).toBe('"age" = 42');
      expect(
        buildCellValueFilterClause("price", "=", "19.99", "mysql", "DECIMAL(10,2)"),
      ).toBe("`price` = 19.99");
    });

    it("emits booleans as TRUE/FALSE", () => {
      expect(buildCellValueFilterClause("active", "=", true, "postgres")).toBe(
        '"active" = TRUE',
      );
      expect(buildCellValueFilterClause("active", "=", false, "postgres")).toBe(
        '"active" = FALSE',
      );
    });

    it("supports the <> operator", () => {
      expect(buildCellValueFilterClause("id", "<>", 7, "postgres")).toBe(
        '"id" <> 7',
      );
      expect(buildCellValueFilterClause("name", "<>", "O'Brien", "mysql")).toBe(
        "`name` <> 'O''Brien'",
      );
    });

    it("emits IS NULL / IS NOT NULL and ignores the value", () => {
      expect(
        buildCellValueFilterClause("deleted_at", "IS NULL", "DROP TABLE", "mysql"),
      ).toBe("`deleted_at` IS NULL");
      expect(
        buildCellValueFilterClause(
          "deleted_at",
          "IS NOT NULL",
          "DROP TABLE",
          "postgres",
        ),
      ).toBe('"deleted_at" IS NOT NULL');
    });

    it("quotes the identifier per driver", () => {
      expect(buildCellValueFilterClause("my col", "=", 1, "mysql")).toBe(
        "`my col` = 1",
      );
      expect(buildCellValueFilterClause("my col", "=", 1, "postgres")).toBe(
        '"my col" = 1',
      );
      expect(buildCellValueFilterClause("my col", "=", 1, "sqlite")).toBe(
        '"my col" = 1',
      );
    });
  });

  describe("combineFilterClauses", () => {
    const added = '"status" = \'active\'';

    it("returns the added clause when there is no existing one", () => {
      expect(combineFilterClauses(undefined, added)).toBe(added);
      expect(combineFilterClauses(null, added)).toBe(added);
      expect(combineFilterClauses("", added)).toBe(added);
    });

    it("treats whitespace-only existing clauses as empty", () => {
      expect(combineFilterClauses("   ", added)).toBe(added);
    });

    it("ANDs and parenthesises an existing clause", () => {
      expect(
        combineFilterClauses(`"a" = 1 OR "b" = 2`, added),
      ).toBe(`("a" = 1 OR "b" = 2) AND ${added}`);
    });

    it("trims the existing clause", () => {
      expect(combineFilterClauses("  \"a\" = 1  ", added)).toBe(
        `("a" = 1) AND ${added}`,
      );
    });
  });

  describe("getCellValueFilterOperators", () => {
    it("offers the IS NULL / IS NOT NULL pair for null and undefined", () => {
      expect(getCellValueFilterOperators(null)).toEqual([
        "IS NULL",
        "IS NOT NULL",
      ]);
      expect(getCellValueFilterOperators(undefined)).toEqual([
        "IS NULL",
        "IS NOT NULL",
      ]);
    });

    it("offers = / <> for any non-null value, including empty string and zero", () => {
      expect(getCellValueFilterOperators("")).toEqual(["=", "<>"]);
      expect(getCellValueFilterOperators(0)).toEqual(["=", "<>"]);
      expect(getCellValueFilterOperators("abc")).toEqual(["=", "<>"]);
      expect(getCellValueFilterOperators(false)).toEqual(["=", "<>"]);
    });

    it("offers only IS NULL / IS NOT NULL for masked cells, whatever the value", () => {
      for (const value of ["alice@example.com", "", 0, null]) {
        expect(getCellValueFilterOperators(value, { masked: true })).toEqual([
          "IS NULL",
          "IS NOT NULL",
        ]);
      }
      expect(
        getCellValueFilterOperators("abc", { masked: false }),
      ).toEqual(["=", "<>"]);
    });
  });
});
