import { describe, expect, it } from "vitest";
import { formatObjectNameForCopy } from "../../src/utils/objectNameCopy";

describe("formatObjectNameForCopy", () => {
  it("leaves a plain name unchanged", () => {
    expect(formatObjectNameForCopy('my"table', "name", "postgres", "public")).toBe('my"table');
  });

  it.each([
    ["postgres", '"my""table"', '"my""schema"."my""table"'],
    ["sqlite", '"my""table"', '"my""schema"."my""table"'],
    ["sqlserver", '"my""table"', '"my""schema"."my""table"'],
  ])("quotes names for %s", (driver, quoted, qualified) => {
    expect(formatObjectNameForCopy('my"table', "quoted", driver)).toBe(quoted);
    expect(formatObjectNameForCopy('my"table', "qualified", driver, 'my"schema')).toBe(qualified);
  });

  it("escapes backticks for MySQL", () => {
    expect(formatObjectNameForCopy("my`table", "quoted", "mysql")).toBe("`my``table`");
    expect(formatObjectNameForCopy("my`table", "qualified", "mysql", "my`schema")).toBe(
      "`my``schema`.`my``table`",
    );
  });

  it("quotes without a schema when none is available", () => {
    expect(formatObjectNameForCopy("orders", "qualified", "postgres")).toBe('"orders"');
  });
});
