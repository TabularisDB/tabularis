import { describe, expect, it } from "vitest";
import {
  isPostgresDriver,
  defaultTriggerBody,
  triggerFunctionName,
  buildTriggerFunctionSql,
  buildTriggerSql,
  type TriggerSqlInput,
} from "../../src/utils/triggerSql";

describe("triggerSql", () => {
  describe("isPostgresDriver", () => {
    it("is true for the builtin postgres driver", () => {
      expect(isPostgresDriver("postgres")).toBe(true);
    });

    it("is true for the postgresql plugin", () => {
      expect(isPostgresDriver("postgresql")).toBe(true);
    });

    it("is false for mysql and sqlite", () => {
      expect(isPostgresDriver("mysql")).toBe(false);
      expect(isPostgresDriver("sqlite")).toBe(false);
      expect(isPostgresDriver(undefined)).toBe(false);
    });
  });

  describe("defaultTriggerBody", () => {
    it("has no inline BEGIN/END for postgres — it's a function body, not a trigger body", () => {
      const body = defaultTriggerBody("postgres");
      expect(body).not.toContain("BEGIN");
      expect(body).not.toContain("END");
      expect(body).toContain("RETURN NEW;");
    });

    it("uses an inline BEGIN/END block for mysql and sqlite", () => {
      expect(defaultTriggerBody("mysql")).toBe("BEGIN\n  -- trigger body\nEND");
      expect(defaultTriggerBody("sqlite")).toBe("BEGIN\n  -- trigger body\nEND");
    });
  });

  describe("triggerFunctionName", () => {
    it("suffixes the trigger name", () => {
      expect(triggerFunctionName("trg_products_audit")).toBe("trg_products_audit_fn");
    });
  });

  const base: TriggerSqlInput = {
    name: "trg_products_audit",
    tableName: "products",
    schema: "store",
    timing: "AFTER",
    events: ["INSERT"],
    body: "-- no-op\n  RETURN NEW;",
    driver: "postgres",
  };

  describe("buildTriggerFunctionSql", () => {
    it("wraps the body in a CREATE OR REPLACE FUNCTION ... RETURNS TRIGGER statement", () => {
      const sql = buildTriggerFunctionSql(base);
      expect(sql).toContain('CREATE OR REPLACE FUNCTION "store"."trg_products_audit_fn"()');
      expect(sql).toContain("RETURNS TRIGGER AS $$");
      expect(sql).toContain("LANGUAGE plpgsql");
      expect(sql).toContain(base.body);
    });

    it("omits the schema prefix when no schema is given", () => {
      const sql = buildTriggerFunctionSql({ ...base, schema: undefined });
      expect(sql).toContain('CREATE OR REPLACE FUNCTION "trg_products_audit_fn"()');
    });
  });

  describe("buildTriggerSql", () => {
    it(
      "regression (#837): postgres has no inline body — it references the trigger function, " +
        "not a literal BEGIN/END block copy-pasted from a MySQL-style default",
      () => {
        const sql = buildTriggerSql(base);
        expect(sql).toBe(
          [
            'CREATE TRIGGER "trg_products_audit"',
            "AFTER INSERT",
            'ON "store"."products"',
            "FOR EACH ROW",
            'EXECUTE FUNCTION "store"."trg_products_audit_fn"();',
          ].join("\n"),
        );
        expect(sql).not.toContain("BEGIN");
        expect(sql).not.toContain(base.body);
      },
    );

    it("still executes the body inline for mysql (unaffected by the postgres fix)", () => {
      const sql = buildTriggerSql({ ...base, driver: "mysql", body: "BEGIN\n  -- trigger body\nEND" });
      expect(sql).toBe(
        [
          "CREATE TRIGGER `trg_products_audit`",
          "AFTER INSERT",
          "ON `products`", // MySQL omits the schema prefix (error 1435) and quotes with backticks
          "FOR EACH ROW",
          "BEGIN\n  -- trigger body\nEND",
        ].join("\n"),
      );
    });

    it("still executes the body inline for sqlite, including the schema prefix", () => {
      const sql = buildTriggerSql({ ...base, driver: "sqlite", body: "BEGIN\n  -- trigger body\nEND" });
      expect(sql).toContain('ON "store"."products"');
      expect(sql).toContain("BEGIN\n  -- trigger body\nEND");
    });

    it("recognizes the postgresql plugin driver id the same as the builtin postgres driver", () => {
      const sql = buildTriggerSql({ ...base, driver: "postgresql" });
      expect(sql).toContain('EXECUTE FUNCTION "store"."trg_products_audit_fn"();');
    });

    it("omits the schema prefix for postgres when no schema is given", () => {
      const sql = buildTriggerSql({ ...base, schema: undefined });
      expect(sql).toContain('ON "products"');
      expect(sql).toContain('EXECUTE FUNCTION "trg_products_audit_fn"();');
    });

    it(
      "regression: the function reference always matches CREATE FUNCTION's own qualification, " +
        "since the two run as separate calls that can't rely on sharing a search_path " +
        "(observed failure: 'function trg_x_fn() does not exist' when only the table, not " +
        "the function, was schema-qualified)",
      () => {
        const functionSql = buildTriggerFunctionSql(base);
        const triggerSql = buildTriggerSql(base);
        const created = functionSql.match(/CREATE OR REPLACE FUNCTION (\S+)\(\)/)?.[1];
        const referenced = triggerSql.match(/EXECUTE FUNCTION (\S+)\(\);/)?.[1];
        expect(created).toBeDefined();
        expect(referenced).toBe(created);
      },
    );

    it("joins multiple events with OR", () => {
      const sql = buildTriggerSql({ ...base, events: ["INSERT", "UPDATE"] });
      expect(sql).toContain("AFTER INSERT OR UPDATE");
    });
  });
});
