import { describe, expect, it } from "vitest";
import type { QueryResult } from "../../src/types/editor";
import {
  formatResultForExport,
  getLoadedRowsExportLimit,
} from "../../src/utils/resultExport";

const result: QueryResult = {
  columns: ["id", "name"],
  rows: [
    [1, "John"],
    [2, null],
  ],
  affected_rows: 0,
};

describe("resultExport", () => {
  it("formats loaded result rows as CSV with headers", () => {
    expect(formatResultForExport(result, "csv")).toBe(
      "id,name\n1,John\n2,NULL",
    );
  });

  it("uses the configured CSV delimiter", () => {
    expect(formatResultForExport(result, "csv", ";")).toBe(
      "id;name\n1;John\n2;NULL",
    );
  });

  it("formats fixture containing null, empty string, literal NULL, zero and false consistently", () => {
    const fixtureResult: QueryResult = {
      columns: ["c_null", "c_empty", "c_literal_null", "c_zero", "c_false"],
      rows: [[null, "", "NULL", 0, false]],
      affected_rows: 0,
    };

    expect(formatResultForExport(fixtureResult, "csv")).toBe(
      "c_null,c_empty,c_literal_null,c_zero,c_false\nNULL,,NULL,0,false",
    );
  });

  it("escapes CSV fields that contain delimiters, quotes, or newlines", () => {
    const specialResult: QueryResult = {
      columns: ["id", "note"],
      rows: [[1, 'hello, "world"\nagain']],
      affected_rows: 0,
    };

    expect(formatResultForExport(specialResult, "csv")).toBe(
      'id,note\n1,"hello, ""world""\nagain"',
    );
  });

  it("quotes a CSV field with a lone carriage return, as the clipboard does", () => {
    const carriageResult: QueryResult = {
      columns: ["id", "note"],
      rows: [[1, "hello\rworld"]],
      affected_rows: 0,
    };

    expect(formatResultForExport(carriageResult, "csv")).toBe('id,note\n1,"hello\rworld"');
  });

  it("formats loaded result rows as pretty JSON", () => {
    expect(formatResultForExport(result, "json")).toBe(
      JSON.stringify(
        [
          { id: 1, name: "John" },
          { id: 2, name: null },
        ],
        null,
        2,
      ),
    );
  });

  it("formats loaded result rows as Markdown", () => {
    expect(formatResultForExport(result, "markdown")).toBe(
      "| id | name |\n| --- | --- |\n| 1 | John |\n| 2 | null |",
    );
  });

  it("detects when only part of a paginated result is loaded for export", () => {
    expect(
      getLoadedRowsExportLimit({
        ...result,
        pagination: {
          total_rows: 25,
          page: 1,
          page_size: 2,
          has_more: true,
        },
      }),
    ).toEqual({ loadedRows: 2, totalRows: 25 });
  });

  it("does not warn when all paginated rows are loaded", () => {
    expect(
      getLoadedRowsExportLimit({
        ...result,
        pagination: {
          total_rows: 2,
          page: 1,
          page_size: 2,
          has_more: false,
        },
      }),
    ).toBeNull();
  });

  it("does not warn without a finite total row count", () => {
    expect(getLoadedRowsExportLimit(result)).toBeNull();
    expect(
      getLoadedRowsExportLimit({
        ...result,
        pagination: {
          total_rows: Number.POSITIVE_INFINITY,
          page: 1,
          page_size: 2,
          has_more: false,
        },
      }),
    ).toBeNull();
  });
});
