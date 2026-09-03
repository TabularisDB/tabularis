import { describe, expect, it } from "vitest";
import {
  createSqlFileTab,
  getSqlFileName,
  hasUnsavedSqlFileTabs,
  isSqlFileDirty,
  savedSqlFileTab,
} from "../../src/utils/sqlFile";

describe("sqlFile", () => {
  describe("getSqlFileName", () => {
    it("returns the last segment of Unix and Windows paths", () => {
      expect(getSqlFileName("/home/user/queries/report.sql")).toBe("report.sql");
      expect(getSqlFileName("C:\\queries\\schema.psql")).toBe("schema.psql");
    });

    it("falls back to a generic name for empty paths", () => {
      expect(getSqlFileName("")).toBe("SQL File");
    });
  });

  describe("createSqlFileTab", () => {
    it("creates a console tab named after a Unix file path", () => {
      expect(createSqlFileTab("/tmp/report.sql", "SELECT 1;")).toEqual({
        type: "console",
        title: "report.sql",
        query: "SELECT 1;",
        sourceFilePath: "/tmp/report.sql",
        sourceFileContent: "SELECT 1;",
        sourceFileDirty: false,
      });
    });

    it("supports Windows paths and preserves the selected schema", () => {
      expect(
        createSqlFileTab("C:\\queries\\schema.psql", "CREATE TABLE users ();", "analytics"),
      ).toEqual({
        type: "console",
        title: "schema.psql",
        query: "CREATE TABLE users ();",
        sourceFilePath: "C:\\queries\\schema.psql",
        sourceFileContent: "CREATE TABLE users ();",
        sourceFileDirty: false,
        schema: "analytics",
      });
    });
  });

  describe("savedSqlFileTab", () => {
    it("updates the path and clears the dirty state after Save As", () => {
      expect(savedSqlFileTab("/tmp/renamed.pgsql", "SELECT 2;")).toEqual({
        title: "renamed.pgsql",
        sourceFilePath: "/tmp/renamed.pgsql",
        sourceFileContent: "SELECT 2;",
        sourceFileDirty: false,
      });
    });

    it("stays dirty when the editor changed while the write was in flight", () => {
      expect(
        savedSqlFileTab("/tmp/q.sql", "SELECT 2;", "SELECT 22;").sourceFileDirty,
      ).toBe(true);
    });
  });

  describe("isSqlFileDirty", () => {
    const tab = { sourceFilePath: "/tmp/q.sql", sourceFileContent: "SELECT 1;" };

    it("is dirty only while the editor text differs from the file", () => {
      expect(isSqlFileDirty(tab, "SELECT 1;x")).toBe(true);
      expect(isSqlFileDirty(tab, "SELECT 1;")).toBe(false);
    });

    it("never marks a console without a backing file", () => {
      expect(isSqlFileDirty({ sourceFilePath: undefined }, "SELECT 1;")).toBe(false);
    });
  });

  describe("hasUnsavedSqlFileTabs", () => {
    const tabs = [
      { id: "clean", sourceFilePath: "/tmp/clean.sql", sourceFileDirty: false },
      { id: "dirty", sourceFilePath: "/tmp/dirty.sql", sourceFileDirty: true },
      { id: "console", sourceFileDirty: true },
    ];

    it("detects a dirty SQL file among the tabs being closed", () => {
      expect(hasUnsavedSqlFileTabs(tabs, ["clean", "dirty"])).toBe(true);
    });

    it("ignores clean tabs and consoles not backed by a file", () => {
      expect(hasUnsavedSqlFileTabs(tabs, ["clean", "console"])).toBe(false);
    });
  });
});
