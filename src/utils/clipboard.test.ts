import { describe, it, expect } from "vitest";
import { columnValuesToText, columnValuesToInClause } from "./clipboard";

describe("columnValuesToText", () => {
  it("joins the column's values with newlines", () => {
    const rows = [
      [1, "Alice"],
      [2, "Bob"],
    ];
    expect(columnValuesToText(rows, 0)).toBe("1\n2");
    expect(columnValuesToText(rows, 1)).toBe("Alice\nBob");
  });

  it("renders null cells with the null label", () => {
    expect(columnValuesToText([[null], ["x"]], 0)).toBe("null\nx");
  });
});

describe("columnValuesToInClause", () => {
  it("quotes strings and leaves numbers raw", () => {
    const rows = [
      [1, "Alice"],
      [2, "Bob"],
    ];
    expect(columnValuesToInClause(rows, 0)).toBe("1, 2");
    expect(columnValuesToInClause(rows, 1)).toBe("'Alice', 'Bob'");
  });

  it("escapes single quotes and renders NULL", () => {
    expect(columnValuesToInClause([["O'Brien"], [null]], 0)).toBe(
      "'O''Brien', NULL",
    );
  });
});
