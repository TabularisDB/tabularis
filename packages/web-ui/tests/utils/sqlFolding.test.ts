import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  getSqlFoldingRanges,
  getSqlQueryAtFoldLine,
  registerSqlFoldingProvider,
  setSqlFoldingDialect,
} from "../../src/utils/sqlFolding";

describe("sqlFolding", () => {
  it("does not fold a single-line query", () => {
    expect(getSqlFoldingRanges("SELECT 1;")).toEqual([]);
  });

  it("creates one fold for each multiline query", () => {
    expect(
      getSqlFoldingRanges("SELECT\n  1;\n\nSELECT\n  2;"),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 5 },
    ]);
  });

  it("returns the complete query behind a fold", () => {
    const sql = "SELECT\n  1;\n\nSELECT\n  2;";
    expect(getSqlQueryAtFoldLine(sql, 1)).toBe("SELECT\n  1");
    expect(getSqlQueryAtFoldLine(sql, 4)).toBe("SELECT\n  2");
    expect(getSqlQueryAtFoldLine(sql, 2)).toBeNull();
  });

  it("does not create separate folds for nested SQL structures", () => {
    expect(
      getSqlFoldingRanges(
        "SELECT *\nFROM (\n  SELECT id\n  FROM users\n) nested;",
      ),
    ).toEqual([{ start: 1, end: 5 }]);
  });

  it("uses the selected dialect when splitting queries", () => {
    const mysql = "SELECT\n  'a;\\'b';\nSELECT\n  2;";
    expect(getSqlFoldingRanges(mysql, "mysql")).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it("registers one dialect-aware Monaco provider per instance", () => {
    let provider: Monaco.languages.FoldingRangeProvider | undefined;
    const registerFoldingRangeProvider = vi.fn(
      (_language: string, nextProvider: Monaco.languages.FoldingRangeProvider) => {
        provider = nextProvider;
        return { dispose: vi.fn() };
      },
    );
    const monaco = {
      languages: {
        registerFoldingRangeProvider,
        FoldingRangeKind: { Region: { value: "region" } },
      },
    } as unknown as typeof Monaco;
    const model = {
      getValue: () => "SELECT\n  1;",
      getValueLength: () => 11,
    } as unknown as Monaco.editor.ITextModel;

    registerSqlFoldingProvider(monaco);
    registerSqlFoldingProvider(monaco);
    setSqlFoldingDialect(model, "postgres");

    expect(registerFoldingRangeProvider).toHaveBeenCalledTimes(1);
    expect(provider).toBeDefined();
    expect(
      provider?.provideFoldingRanges(
        model,
        {},
        { isCancellationRequested: false, onCancellationRequested: vi.fn() },
      ),
    ).toEqual([{ start: 1, end: 2, kind: { value: "region" } }]);
  });
});
