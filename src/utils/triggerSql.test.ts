import { describe, it, expect } from "vitest";
import {
  buildCreateTriggerSql,
  buildCreateTriggerStatements,
  parseTriggerDefinition,
  normalizeSelection,
  splitSqlStatements,
  resolveTriggerDialect,
} from "./triggerSql";

const base = {
  name: "t",
  schema: "store",
  table: "products",
  forEach: "ROW" as const,
  body: "  -- x",
};

describe("triggerSql", () => {
  it("postgres emits function + trigger", () => {
    const sql = buildCreateTriggerSql({
      ...base,
      dialect: "postgres",
      timing: "AFTER",
      events: ["INSERT", "UPDATE"],
    });
    expect(sql).toContain("RETURNS TRIGGER");
    expect(sql).toContain("AFTER INSERT OR UPDATE ON");
    expect(sql).toContain("EXECUTE FUNCTION");
    expect(sql).toContain("RETURN NULL;");
  });

  it("postgres returns two statements", () => {
    const s = buildCreateTriggerStatements({
      ...base,
      dialect: "postgres",
      timing: "AFTER",
      events: ["INSERT"],
    });
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("CREATE OR REPLACE FUNCTION");
    expect(s[1]).toContain("CREATE TRIGGER");
  });

  it("postgres BEFORE row handles DELETE", () => {
    const sql = buildCreateTriggerSql({
      ...base,
      dialect: "postgres",
      timing: "BEFORE",
      events: ["DELETE"],
    });
    expect(sql).toContain("RETURN OLD");
  });

  it("postgres edit reuses the existing function", () => {
    const s = buildCreateTriggerStatements({
      ...base,
      dialect: "postgres",
      timing: "AFTER",
      events: ["INSERT", "DELETE"],
      existingTail: "EXECUTE FUNCTION public.audit()",
    });
    expect(s).toHaveLength(1);
    expect(s[0]).toContain("EXECUTE FUNCTION public.audit();");
    expect(s[0]).not.toContain("CREATE OR REPLACE FUNCTION");
  });

  it("mysql never qualifies the table with the schema", () => {
    const sql = buildCreateTriggerSql({
      ...base,
      dialect: "mysql",
      timing: "AFTER",
      events: ["INSERT"],
      body: "BEGIN\nEND",
    });
    expect(sql).toContain("ON `products`");
    expect(sql).not.toContain("store");
  });

  it("mysql keeps a single event", () => {
    expect(
      normalizeSelection("mysql", "AFTER", ["INSERT", "UPDATE"]).events,
    ).toEqual(["INSERT"]);
  });

  it("mysql rejects INSTEAD OF", () => {
    expect(normalizeSelection("mysql", "INSTEAD OF", ["INSERT"]).timing).toBe(
      "BEFORE",
    );
  });

  it("parses all events", () => {
    expect(
      parseTriggerDefinition(
        "CREATE TRIGGER x BEFORE INSERT OR UPDATE OR DELETE ON t",
      ).events,
    ).toEqual(["INSERT", "UPDATE", "DELETE"]);
  });

  it("splits statements without breaking $$ bodies", () => {
    const parts = splitSqlStatements(
      "CREATE FUNCTION f() RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;\nCREATE TRIGGER t AFTER INSERT ON a FOR EACH ROW EXECUTE FUNCTION f();",
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("RETURN NEW; END;");
  });

  it("resolves dialect", () => {
    expect(resolveTriggerDialect("mysql")).toBe("mysql");
    expect(resolveTriggerDialect("sqlite")).toBe("sqlite");
    expect(resolveTriggerDialect("postgres")).toBe("postgres");
  });
});