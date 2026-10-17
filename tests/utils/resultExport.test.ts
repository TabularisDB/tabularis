import { describe, expect, it } from "vitest";
import type { QueryResult } from "../../src/types/editor";
import { rowsToHtmlTable } from "../../src/utils/clipboard";
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

  it("writes NULL the same way the streaming exporter does", () => {
    // Mirrors value_to_csv_string in src-tauri/src/export/format.rs: only NULL
    // gets the sentinel, an empty string stays an empty field.
    const fixture: QueryResult = {
      columns: ["null_col", "empty_col", "literal_null", "zero", "flag"],
      rows: [[null, "", "NULL", 0, false]],
      affected_rows: 0,
    };

    expect(formatResultForExport(fixture, "csv")).toBe(
      "null_col,empty_col,literal_null,zero,flag\nNULL,,NULL,0,false",
    );
  });

  it("keeps quoting around NULL-adjacent fields that need it", () => {
    const tricky: QueryResult = {
      columns: ["a", "b", "c"],
      rows: [[null, 'has,comma', 'say "hi"\nthere']],
      affected_rows: 0,
    };

    expect(formatResultForExport(tricky, "csv")).toBe(
      'a,b,c\nNULL,"has,comma","say ""hi""\nthere"',
    );
  });

  it("uses the configured CSV delimiter", () => {
    expect(formatResultForExport(result, "csv", ";")).toBe(
      "id;name\n1;John\n2;NULL",
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

  it("formats loaded result rows as NDJSON with one JSON object per line and escaped newlines", () => {
    const ndjsonResult: QueryResult = {
      columns: ["id", "active", "note", "meta", "missing"],
      rows: [
        [1, true, "first\nline\r\nsecond", { role: "admin", tags: ["a", "b"] }, undefined],
        [2, false, null, { role: "user", tags: [] }, "present"],
      ],
      affected_rows: 0,
    };

    const output = formatResultForExport(ndjsonResult, "ndjson");
    const lines = output.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        id: 1,
        active: true,
        note: "first\nline\r\nsecond",
        meta: { role: "admin", tags: ["a", "b"] },
        missing: null,
      },
      {
        id: 2,
        active: false,
        note: null,
        meta: { role: "user", tags: [] },
        missing: "present",
      },
    ]);
  });

  it("produces an empty file when exporting empty results as NDJSON", () => {
    const emptyResult: QueryResult = {
      columns: ["id", "name"],
      rows: [],
      affected_rows: 0,
    };

    expect(formatResultForExport(emptyResult, "ndjson")).toBe("");
  });

  it("formats loaded result rows as Markdown", () => {
    expect(formatResultForExport(result, "markdown")).toBe(
      "| id | name |\n| --- | --- |\n| 1 | John |\n| 2 | null |",
    );
  });

  it("wraps loaded rows in a UTF-8 HTML document using the clipboard table", () => {
    const html = formatResultForExport(result, "html");

    expect(html.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(rowsToHtmlTable(result.rows, result.columns));
    expect(html).toContain("<th>id</th><th>name</th>");
    expect(html).toContain("<td>1</td><td>John</td>");
    expect(html).toContain("<td>2</td><td>null</td>");
  });

  it("escapes HTML names and values, including script text, quotes and ampersands", () => {
    const specialResult: QueryResult = {
      columns: ["<tag>", "note"],
      rows: [
        ["<script>alert(1)</script>", `"quotes" & 'ok'`],
        ["café 你好", null],
      ],
      affected_rows: 0,
    };

    const html = formatResultForExport(specialResult, "html");

    expect(html).toContain("<th>&lt;tag&gt;</th>");
    expect(html).toContain(
      "<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>",
    );
    expect(html).toContain("<td>&quot;quotes&quot; &amp; &#39;ok&#39;</td>");
    expect(html).toContain("<td>café 你好</td>");
    expect(html).toContain("<td>null</td>");
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain(
      rowsToHtmlTable(specialResult.rows, specialResult.columns),
    );
  });

  it("keeps a header row when the loaded result has no data rows", () => {
    const emptyResult: QueryResult = {
      columns: ["id", "name"],
      rows: [],
      affected_rows: 0,
    };

    const html = formatResultForExport(emptyResult, "html");

    expect(html).toContain("<th>id</th><th>name</th>");
    expect(html).toContain("<tbody></tbody>");
    expect(html).not.toContain("<td>");
    expect(html).toContain(rowsToHtmlTable([], ["id", "name"]));
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
