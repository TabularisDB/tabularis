import { describe, expect, it } from "vitest";
import { sanitizeLocalFilePath, unwrapQuotedPath } from "../../src/utils/fsPath";

describe("sanitizeLocalFilePath", () => {
  it("leaves plain paths alone", () => {
    expect(
      sanitizeLocalFilePath(
        String.raw`C:\Users\Administrator\Downloads\companies.db`,
      ),
    ).toBe(String.raw`C:\Users\Administrator\Downloads\companies.db`);
    expect(sanitizeLocalFilePath("  /tmp/data.db  ")).toBe("/tmp/data.db");
  });

  it("strips ascii and curly quotes", () => {
    expect(
      sanitizeLocalFilePath(
        String.raw`"C:\Users\Administrator\Downloads\companies.db"`,
      ),
    ).toBe(String.raw`C:\Users\Administrator\Downloads\companies.db`);
    expect(sanitizeLocalFilePath("'C:/data/file.parquet'")).toBe(
      "C:/data/file.parquet",
    );
    expect(sanitizeLocalFilePath("`/home/u/sheet.xlsx`")).toBe(
      "/home/u/sheet.xlsx",
    );
    expect(sanitizeLocalFilePath("\u201C/tmp/a.csv\u201D")).toBe("/tmp/a.csv");
  });

  it("strips nested matching quotes", () => {
    expect(sanitizeLocalFilePath(`'"/tmp/a.csv"'`)).toBe("/tmp/a.csv");
  });

  it("strips file URIs and invisible noise", () => {
    expect(sanitizeLocalFilePath("file:///C:/Users/a/companies.db")).toBe(
      "C:/Users/a/companies.db",
    );
    expect(sanitizeLocalFilePath("file:///home/u/a.db")).toBe("/home/u/a.db");
    expect(sanitizeLocalFilePath("\uFEFF\u200B\"/tmp/a.db\"")).toBe(
      "/tmp/a.db",
    );
  });

  it("ignores unmatched quotes", () => {
    expect(sanitizeLocalFilePath(`"/tmp/a.csv`)).toBe(`"/tmp/a.csv`);
    expect(sanitizeLocalFilePath("")).toBe("");
  });

  it("keeps unwrapQuotedPath as an alias", () => {
    expect(unwrapQuotedPath('"a.db"')).toBe("a.db");
  });
});
