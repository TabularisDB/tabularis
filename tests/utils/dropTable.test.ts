import { describe, it, expect } from "vitest";
import { resolveDropTableSql } from "../../src/utils/dropTable";
import type { DriverCapabilities } from "../../src/types/plugins";

const backtickPlugin: DriverCapabilities = {
  schemas: true,
  views: true,
  routines: false,
  file_based: false,
  folder_based: false,
  identifier_quote: "`",
  alter_primary_key: false,
  sql_dialect: "generic",
};

describe("dropTable", () => {
  describe("resolveDropTableSql", () => {
    it("should use the plugin statement when one is returned", () => {
      expect(
        resolveDropTableSql(
          "DROP SNAPSHOT TABLE `proj.sales.daily`",
          "daily",
          backtickPlugin,
          "sales",
        ),
      ).toBe("DROP SNAPSHOT TABLE `proj.sales.daily`");
    });

    it("should trim the plugin statement", () => {
      expect(resolveDropTableSql("  DROP EXTERNAL TABLE x \n", "x", "postgres")).toBe(
        "DROP EXTERNAL TABLE x",
      );
    });

    it("should fall back to a generic DROP TABLE with the plugin quote", () => {
      expect(resolveDropTableSql(null, "daily", backtickPlugin, "sales")).toBe(
        "DROP TABLE `sales`.`daily`",
      );
    });

    it("should fall back when the plugin statement is blank or missing", () => {
      expect(resolveDropTableSql("   ", "users", "postgres", "public")).toBe(
        'DROP TABLE "public"."users"',
      );
      expect(resolveDropTableSql(undefined, "users", "mysql")).toBe("DROP TABLE `users`");
    });
  });
});
