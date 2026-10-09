import { describe, it, expect } from "vitest";
import {
  buildCreateTriggerSql,
  parseTriggerDefinition,
  normalizeSelection,
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

  it("postgres BEFORE row handles DELETE", () => {
    const sql = buildCreateTriggerSql({
      ...base,
      dialect: "postgres",
      timing: "BEFORE",
      events: ["DELETE"],
    });
    expect(sql).toContain("RETURN OLD");
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
});
