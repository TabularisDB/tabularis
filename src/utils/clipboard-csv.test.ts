import { describe, expect, it } from "vitest";
import { rowToCSV, rowsToCSV, rowsToCSVWithHeaders } from "./clipboard";

describe("CSV clipboard quoting", () => {
  it("quotes a value that contains the delimiter", () => {
    expect(rowToCSV(["Rome, Italy", 3])).toBe('"Rome, Italy",3');
  });

  it("quotes a value with a double quote and doubles the quote", () => {
    expect(rowToCSV(['say "hi"'])).toBe('"say ""hi"""');
  });

  it("quotes a value with a line break", () => {
    expect(rowsToCSV([["line1\nline2", "x"]])).toBe('"line1\nline2",x');
  });

  it("leaves plain values unquoted", () => {
    expect(rowsToCSV([["a", 1, null]])).toBe("a,1,null");
  });

  it("quotes header names the same way as the body", () => {
    expect(rowsToCSVWithHeaders([["Rome, Italy"]], ["city, name"])).toBe('"city, name"\n"Rome, Italy"');
  });
});
