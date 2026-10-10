import { describe, expect, it } from "vitest";
import {
  fileUriToPath,
  normalizeLocalDatabasePath,
  sanitizeLocalFilePath,
} from "../../src/utils/fsPath";

describe("sanitizeLocalFilePath", () => {
  it("leaves plain paths alone", () => {
    expect(
      sanitizeLocalFilePath(
        String.raw`C:\Users\Administrator\Downloads\companies.db`,
      ),
    ).toBe(String.raw`C:\Users\Administrator\Downloads\companies.db`);
    expect(sanitizeLocalFilePath("  /tmp/data.db  ")).toBe("/tmp/data.db");
    expect(sanitizeLocalFilePath("/home/u/my%20db.db")).toBe(
      "/home/u/my%20db.db",
    );
    expect(sanitizeLocalFilePath("filedata.db")).toBe("filedata.db");
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

  it("strips invisible noise", () => {
    expect(sanitizeLocalFilePath('\uFEFF\u200B"/tmp/a.db"')).toBe("/tmp/a.db");
  });

  it("converts file URIs", () => {
    expect(sanitizeLocalFilePath("file:///C:/Users/a/companies.db")).toBe(
      "C:/Users/a/companies.db",
    );
    expect(sanitizeLocalFilePath("file:///C|/Users/a/companies.db")).toBe(
      "C:/Users/a/companies.db",
    );
    expect(sanitizeLocalFilePath("file:///home/u/a.db")).toBe("/home/u/a.db");
    expect(sanitizeLocalFilePath("FILE:/home/u/a.db")).toBe("/home/u/a.db");
    expect(sanitizeLocalFilePath('"file:///home/u/a.db"')).toBe(
      "/home/u/a.db",
    );
  });

  it("drops the localhost authority", () => {
    expect(sanitizeLocalFilePath("file://localhost/home/u/a.db")).toBe(
      "/home/u/a.db",
    );
    expect(sanitizeLocalFilePath("file://localhost/C:/data/a.db")).toBe(
      "C:/data/a.db",
    );
  });

  it("keeps a remote authority as a UNC path", () => {
    expect(sanitizeLocalFilePath("file://server/share/a.db")).toBe(
      "//server/share/a.db",
    );
  });

  it("decodes percent-encoding", () => {
    expect(sanitizeLocalFilePath("file:///home/u/my%20db.db")).toBe(
      "/home/u/my db.db",
    );
    expect(sanitizeLocalFilePath("file:///C:/Users/J%C3%BCrgen/a.db")).toBe(
      "C:/Users/Jürgen/a.db",
    );
  });

  it("ignores unmatched quotes", () => {
    expect(sanitizeLocalFilePath(`"/tmp/a.csv`)).toBe(`"/tmp/a.csv`);
    expect(sanitizeLocalFilePath("")).toBe("");
  });
});

describe("fileUriToPath", () => {
  it("returns null for non-file values", () => {
    expect(fileUriToPath("/tmp/a.db")).toBeNull();
    expect(fileUriToPath("file")).toBeNull();
    expect(fileUriToPath("sqlite:///tmp/a.db")).toBeNull();
  });
});

describe("normalizeLocalDatabasePath", () => {
  it("sanitizes single and multiple entries", () => {
    expect(normalizeLocalDatabasePath("'/tmp/a.db'")).toBe("/tmp/a.db");
    expect(normalizeLocalDatabasePath(['"/tmp/a.csv"', "`/tmp/b.parquet`"])).toEqual(
      ["/tmp/a.csv", "/tmp/b.parquet"],
    );
    expect(normalizeLocalDatabasePath(undefined)).toBeUndefined();
  });
});
