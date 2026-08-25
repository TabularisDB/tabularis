import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATE_TABLE_TARGET,
  getCreateTableRefreshPlan,
  resolveCreateTableSchema,
  type CreateTableTarget,
} from "../../src/utils/createTable";

describe("createTable", () => {
  describe("getCreateTableRefreshPlan", () => {
    it("refreshes the flat connection table list for the default target", () => {
      expect(getCreateTableRefreshPlan(DEFAULT_CREATE_TABLE_TARGET)).toEqual({
        scope: "connection",
        schema: null,
      });
    });

    it("refreshes schema data for schema-scoped table creation", () => {
      const target: CreateTableTarget = { kind: "schema", schema: "public" };

      expect(getCreateTableRefreshPlan(target)).toEqual({
        scope: "schema",
        schema: "public",
      });
    });

    it("refreshes database data for multi-database table creation", () => {
      const target: CreateTableTarget = { kind: "database", schema: "analytics" };

      expect(getCreateTableRefreshPlan(target)).toEqual({
        scope: "database",
        schema: "analytics",
      });
    });
  });

  describe("resolveCreateTableSchema", () => {
    it("uses the active schema when no override is provided", () => {
      expect(resolveCreateTableSchema(undefined, "public")).toBe("public");
    });

    it("uses an explicit schema override", () => {
      expect(resolveCreateTableSchema("analytics", "public")).toBe("analytics");
    });

    it("uses null override to create without a schema", () => {
      expect(resolveCreateTableSchema(null, "public")).toBeNull();
    });
  });
});
