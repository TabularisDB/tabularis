import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deserializeNotebook } from "../../src/utils/notebookFile";
import { resolveParams } from "../../src/utils/notebookParams";
import { resolveQueryVariables } from "../../src/utils/notebookVariables";

const fixture = readFileSync(
  resolve(__dirname, "../fixtures/notebook-query-plan.tabularis-notebook"),
  "utf8",
);

describe("query-plan manual fixture", () => {
  it("requires source results before preparing the dependent query", () => {
    const notebook = deserializeNotebook(fixture);
    const query = resolveParams(notebook.cells[1].content, notebook.params ?? []).sql;
    expect(resolveQueryVariables(query, notebook.cells).unresolvedRefs).toHaveLength(2);
    expect(notebook.cells.every((cell) => !cell.result && !cell.isLoading)).toBe(true);
  });

  it("resolves params and repeated references using one CTE", () => {
    const notebook = deserializeNotebook(fixture);
    notebook.cells[0].result = {
      columns: ["id", "name"], rows: [[1, "Alpha"], [2, "O'Brien"]], affected_rows: 0,
    };
    const query = resolveParams(notebook.cells[1].content, notebook.params ?? []).sql;
    const prepared = resolveQueryVariables(query, notebook.cells);
    expect(prepared.unresolvedRefs).toEqual([]);
    expect(prepared.sql.match(/cell_1 AS \(/g)).toHaveLength(1);
    expect(prepared.sql).toContain("WHERE a.id >= 1");
    expect(prepared.sql).toContain("'O''Brien'");
    expect(prepared.sql).not.toContain("{{cell_");
    expect(resolveQueryVariables(notebook.cells[2].content, notebook.cells).unresolvedRefs)
      .toEqual([{ match: "{{cell_99}}", cellIndex: 98 }]);
  });
});