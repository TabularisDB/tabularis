import { describe, it, expect } from "vitest";
import { getDialectKeywords } from "../../src/utils/sqlDialectKeywords";

const BASE = ["SELECT", "FROM", "IF"] as const;

describe("sqlDialectKeywords", () => {
  describe("getDialectKeywords", () => {
    it("returns the base list for dialects without extras", () => {
      for (const dialect of ["postgres", "mysql", "generic", undefined, null, "unknown", "__proto__"]) {
        expect(getDialectKeywords(BASE, dialect)).toBe(BASE);
      }
    });

    it("appends GoogleSQL keywords and functions for bigquery", () => {
      const keywords = getDialectKeywords(BASE, "bigquery");
      expect(keywords.slice(0, BASE.length)).toEqual([...BASE]);
      for (const kw of [
        "QUALIFY", "PIVOT", "UNPIVOT", "TABLESAMPLE SYSTEM", "UNNEST", "MERGE",
        "SAFE_CAST", "SAFE.", "STRUCT", "ARRAY", "EXCEPT", "REPLACE",
        "REGEXP_CONTAINS", "JSON_VALUE", "ST_DISTANCE", "APPROX_COUNT_DISTINCT",
        "DATE_TRUNC", "TIMESTAMP_DIFF",
      ]) {
        expect(keywords).toContain(kw);
      }
    });

    it("does not repeat keywords", () => {
      const keywords = getDialectKeywords(BASE, "bigquery");
      expect(new Set(keywords).size).toBe(keywords.length);
    });
  });
});
