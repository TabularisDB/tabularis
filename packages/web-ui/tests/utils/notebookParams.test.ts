import { describe, it, expect } from "vitest";
import {
  extractParamReferences,
  hasParamReferences,
  resolveParams,
  validateParamName,
  createParam,
  updateParam,
  removeParam,
  addParam,
} from "../../src/utils/notebookParams";
import type { NotebookParam } from "../../src/types/notebook";

describe("notebookParams", () => {
  describe("extractParamReferences", () => {
    it("should extract single param", () => {
      const refs = extractParamReferences("SELECT * WHERE date > @start_date");
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({ match: "@start_date", name: "start_date" });
    });

    it("should extract multiple params", () => {
      const refs = extractParamReferences(
        "SELECT * WHERE date BETWEEN @start AND @end",
      );
      expect(refs).toHaveLength(2);
      expect(refs[0].name).toBe("start");
      expect(refs[1].name).toBe("end");
    });

    it("should return empty for no params", () => {
      expect(extractParamReferences("SELECT 1")).toEqual([]);
    });

    it("should handle email-like strings correctly", () => {
      const refs = extractParamReferences("SELECT * WHERE name = @user_name");
      expect(refs).toHaveLength(1);
      expect(refs[0].name).toBe("user_name");
    });
  });

  describe("hasParamReferences", () => {
    it("should return true when params exist", () => {
      expect(hasParamReferences("SELECT @foo")).toBe(true);
    });

    it("should return false when no params", () => {
      expect(hasParamReferences("SELECT 1")).toBe(false);
    });
  });

  describe("resolveParams", () => {
    const params: NotebookParam[] = [
      { name: "start_date", value: "'2026-01-01'" },
      { name: "limit", value: "100" },
    ];

    it("should replace param references with values", () => {
      const result = resolveParams(
        "SELECT * WHERE date > @start_date LIMIT @limit",
        params,
      );
      expect(result.sql).toBe(
        "SELECT * WHERE date > '2026-01-01' LIMIT 100",
      );
      expect(result.unresolvedParams).toEqual([]);
    });

    it("should report unresolved params", () => {
      const result = resolveParams("SELECT @unknown", params);
      expect(result.unresolvedParams).toEqual(["unknown"]);
    });

    it("should return original SQL when no params", () => {
      const result = resolveParams("SELECT 1", params);
      expect(result.sql).toBe("SELECT 1");
    });

    it("should replace all occurrences of same param", () => {
      const result = resolveParams(
        "SELECT @limit, @limit",
        params,
      );
      expect(result.sql).toBe("SELECT 100, 100");
    });

    it("should keep regex replacement patterns in values literal", () => {
      const result = resolveParams("SELECT * FROM t WHERE a = @p", [
        { name: "p", value: "100$&2" },
      ]);
      expect(result.sql).toBe("SELECT * FROM t WHERE a = 100$&2");
    });

    it("should not expand $' or $` in values", () => {
      const result = resolveParams("SELECT @p FROM t", [
        { name: "p", value: "$' OR $` OR $$" },
      ]);
      expect(result.sql).toBe("SELECT $' OR $` OR $$ FROM t");
    });

    it("should resolve ${name} template syntax", () => {
      const result = resolveParams("SELECT * FROM t WHERE id = ${email}", [
        { name: "email", value: "'user@example.com'" },
      ]);
      expect(result.sql).toBe(
        "SELECT * FROM t WHERE id = 'user@example.com'",
      );
      expect(result.unresolvedParams).toEqual([]);
    });

    it("should resolve mixed @name and ${name} syntax", () => {
      const result = resolveParams(
        "SELECT * FROM t WHERE a = @limit AND b = ${email}",
        [
          { name: "limit", value: "100" },
          { name: "email", value: "'test@example.com'" },
        ],
      );
      expect(result.sql).toBe(
        "SELECT * FROM t WHERE a = 100 AND b = 'test@example.com'",
      );
    });

    it("should report unresolved ${name} template params", () => {
      const result = resolveParams("SELECT ${unknown}", []);
      expect(result.unresolvedParams).toEqual(["unknown"]);
    });

    it("should extract ${name} template references", () => {
      const refs = extractParamReferences(
        "SELECT * WHERE id = ${user_id} AND name = ${name}",
      );
      expect(refs).toHaveLength(2);
      expect(refs[0]).toEqual({ match: "${user_id}", name: "user_id" });
      expect(refs[1]).toEqual({ match: "${name}", name: "name" });
    });

    it("should detect ${name} with hasParamReferences", () => {
      expect(hasParamReferences("SELECT ${foo}")).toBe(true);
      expect(hasParamReferences("SELECT 1")).toBe(false);
    });
  });

  describe("validateParamName", () => {
    it("should accept valid names", () => {
      expect(validateParamName("start_date")).toBe(true);
      expect(validateParamName("x")).toBe(true);
      expect(validateParamName("limit123")).toBe(true);
    });

    it("should reject empty string", () => {
      expect(validateParamName("")).toBe(false);
    });

    it("should reject names with special chars", () => {
      expect(validateParamName("start-date")).toBe(false);
      expect(validateParamName("start date")).toBe(false);
    });
  });

  describe("CRUD operations", () => {
    const params: NotebookParam[] = [
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ];

    it("createParam should create a param", () => {
      expect(createParam("x", "10")).toEqual({ name: "x", value: "10" });
    });

    it("updateParam should update matching param", () => {
      const updated = updateParam(params, "a", "99");
      expect(updated[0].value).toBe("99");
      expect(updated[1].value).toBe("2");
    });

    it("removeParam should remove matching param", () => {
      const result = removeParam(params, "a");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("b");
    });

    it("addParam should add new param", () => {
      const result = addParam(params, { name: "c", value: "3" });
      expect(result).toHaveLength(3);
    });

    it("addParam should not add duplicate", () => {
      const result = addParam(params, { name: "a", value: "new" });
      expect(result).toHaveLength(2);
    });
  });
});
