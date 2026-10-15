import { describe, it, expect } from "vitest";
import { exportNotebookToHtml } from "../../src/utils/notebookHtmlExport";
import type { NotebookCell } from "../../src/types/notebook";

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: "c1",
    type: "sql",
    content: "",
    result: null,
    error: undefined,
    executionTime: null,
    isLoading: false,
    ...overrides,
  };
}

describe("notebookHtmlExport", () => {
  it("should produce valid HTML document", () => {
    const html = exportNotebookToHtml("Test", []);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Test</title>");
    expect(html).toContain("</html>");
  });

  it("should render markdown cells", () => {
    const cells = [
      makeCell({ type: "markdown", content: "# Hello World" }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("<h1>Hello World</h1>");
    expect(html).toContain('class="markdown-cell"');
  });

  it("should render SQL cells with code", () => {
    const cells = [
      makeCell({ type: "sql", content: "SELECT * FROM users" }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("SELECT * FROM users");
    expect(html).toContain('class="sql-code"');
  });

  it("should render SQL cell results as table", () => {
    const cells = [
      makeCell({
        type: "sql",
        content: "SELECT 1",
        result: {
          columns: ["id", "name"],
          rows: [[1, "Alice"], [2, "Bob"]],
          affected_rows: 0,
        },
        executionTime: 42,
      }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("<th>id</th>");
    expect(html).toContain("<th>name</th>");
    expect(html).toContain("<td>Alice</td>");
    expect(html).toContain("2 rows");
    expect(html).toContain("42ms");
  });

  it("should render SQL cell errors", () => {
    const cells = [
      makeCell({
        type: "sql",
        content: "BAD SQL",
        error: "syntax error near BAD",
      }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("syntax error near BAD");
    expect(html).toContain('class="cell-error"');
  });

  it("should escape HTML in content", () => {
    const cells = [
      makeCell({ type: "markdown", content: "Use <script>alert(1)</script>" }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should handle null values in result table", () => {
    const cells = [
      makeCell({
        type: "sql",
        content: "SELECT 1",
        result: {
          columns: ["val"],
          rows: [[null]],
          affected_rows: 0,
        },
      }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("<em>NULL</em>");
  });

  it("should render cell schema/database in SQL cell header", () => {
    const cells = [
      makeCell({
        type: "sql",
        content: "SELECT 1",
        schema: "production_db",
      }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("production_db");
    expect(html).toContain("SQL Cell #1");
  });

  it("should not render schema when not set", () => {
    const cells = [
      makeCell({ type: "sql", content: "SELECT 1" }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).not.toContain("· <span");
  });

  it("should render bold and italic in markdown", () => {
    const cells = [
      makeCell({
        type: "markdown",
        content: "**bold** and *italic*",
      }),
    ];
    const html = exportNotebookToHtml("Test", cells);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });
});
