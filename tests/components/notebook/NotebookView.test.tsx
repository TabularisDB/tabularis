import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookView } from "../../../src/components/notebook/NotebookView";
import type { NotebookCellWrapper } from "../../../src/components/notebook/NotebookCellWrapper";
import type { NotebookToolbar } from "../../../src/components/notebook/NotebookToolbar";
import type { QueryResult, Tab } from "../../../src/types/editor";
import type { NotebookCell, NotebookState } from "../../../src/types/notebook";
import { resolveParams } from "../../../src/utils/notebookParams";
import { resolveQueryVariables, type ResolvedQuery } from "../../../src/utils/notebookVariables";
import { loadNotebook, setNotebookState } from "../../../src/utils/notebookStore";

const fixtures = vi.hoisted(() => ({
  notebooks: new Map<string, NotebookState>(),
  database: {
    activeDriver: "postgres",
    activeSchema: "active_schema" as string | null,
    activeCapabilities: null,
    selectedDatabases: [] as string[],
  },
  settings: { resultPageSize: 37, safetyConfirmationDelayEnabled: false },
  guardQuery: vi.fn(),
  resolveGuard: vi.fn(),
  matchesShortcut: vi.fn(),
  showAlert: vi.fn(),
}));

vi.mock("../../../src/hooks/useDatabase", () => ({
  useDatabase: () => fixtures.database,
}));
vi.mock("../../../src/hooks/useSettings", () => ({
  useSettings: () => ({ settings: fixtures.settings }),
}));
vi.mock("../../../src/hooks/useAlert", () => ({
  useAlert: () => ({ showAlert: fixtures.showAlert }),
}));
vi.mock("../../../src/hooks/useKeybindings", () => ({
  useKeybindings: () => ({ matchesShortcut: fixtures.matchesShortcut }),
}));
vi.mock("../../../src/hooks/useQueryGuards", () => ({
  useQueryGuards: () => ({
    pending: null,
    guardQuery: fixtures.guardQuery,
    resolve: fixtures.resolveGuard,
  }),
}));
vi.mock("../../../src/hooks/useSqlAutocompleteRegistration", () => ({
  useSqlAutocompleteRegistration: vi.fn(),
}));
vi.mock("../../../src/utils/notebookStore", () => ({
  getNotebookState: vi.fn((id: string) => fixtures.notebooks.get(id)),
  setNotebookState: vi.fn((id: string, state: NotebookState) => {
    fixtures.notebooks.set(id, state);
  }),
  loadNotebook: vi.fn(),
  setNotebookTitle: vi.fn(),
  createNotebookFromState: vi.fn(),
}));
// Observe preparation without replacing the real parameter/reference algorithms.
vi.mock("../../../src/utils/notebookParams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/utils/notebookParams")>();
  return { ...actual, resolveParams: vi.fn(actual.resolveParams) };
});
vi.mock("../../../src/utils/notebookVariables", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/utils/notebookVariables")>();
  return { ...actual, resolveQueryVariables: vi.fn(actual.resolveQueryVariables) };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(), readTextFile: vi.fn(),
}));
vi.mock("../../../src/components/modals/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("../../../src/components/notebook/NotebookHistoryPanel", () => ({ NotebookHistoryPanel: () => null }));
vi.mock("../../../src/components/notebook/AddCellButton", () => ({ AddCellButton: () => null }));
vi.mock("../../../src/components/notebook/RunAllSummary", () => ({ RunAllSummary: () => null }));
vi.mock("../../../src/components/notebook/ParamsPanel", () => ({ ParamsPanel: () => null }));
vi.mock("../../../src/components/notebook/NotebookOutline", () => ({ NotebookOutline: () => null }));
vi.mock("../../../src/components/notebook/NotebookToolbar", () => ({
  NotebookToolbar: ({ onRunAll, isRunning }: ComponentProps<typeof NotebookToolbar>) => (
    <button onClick={onRunAll} disabled={isRunning}>Run All</button>
  ),
}));
// Only the child boundary is replaced: NotebookView owns state and execution.
// Do not read cell.result here, so the hidden-plan test can detect materialization.
vi.mock("../../../src/components/notebook/NotebookCellWrapper", () => ({
  NotebookCellWrapper: ({ cell, explainQuery, activeSchema, connectionId, onRun, onUpdate }: ComponentProps<typeof NotebookCellWrapper>) => (
    <section data-testid={`cell-${cell.id}`} data-schema={activeSchema} data-connection={connectionId} data-loading={!!cell.isLoading}>
      <output data-testid={`explain-${cell.id}`}>{JSON.stringify(explainQuery ?? null)}</output>
      <textarea aria-label={`SQL ${cell.id}`} value={cell.content} onChange={(event) => onUpdate({ content: event.target.value })} />
      <button onClick={() => onUpdate({ isQueryPlanVisible: !cell.isQueryPlanVisible })}>Toggle plan {cell.id}</button>
      <button onClick={onRun}>Run {cell.id}</button>
    </section>
  ),
}));

const mockInvoke = vi.mocked(invoke);
const mockResolveParams = vi.mocked(resolveParams);
const mockResolveVariables = vi.mocked(resolveQueryVariables);
const notebookId = "notebook-1";
const connectionId = "notebook-connection";
const rawQuery = "  SELECT * FROM @source WHERE id >= ${minimum}  \n";
const parameterSql = "SELECT * FROM {{cell_1}} WHERE id >= 7";
const params = [{ name: "source", value: "{{cell_1}}" }, { name: "minimum", value: "7" }];
const sourceResult: QueryResult = {
  columns: ["id", "label"],
  rows: [[7, String.raw`C:\team\O'Reilly`]],
  affected_rows: 0,
};
const queryResult: QueryResult = { columns: ["id"], rows: [[7], [8]], affected_rows: 0 };
const standardSql = `WITH cell_1 AS (\n  SELECT 7 AS "id", '${String.raw`C:\team\O''Reilly`}' AS "label"\n)\nSELECT * FROM cell_1 WHERE id >= 7`;
const mysqlSql = `WITH cell_1 AS (\n  SELECT 7 AS "id", '${String.raw`C:\\team\\O''Reilly`}' AS "label"\n)\nSELECT * FROM cell_1 WHERE id >= 7`;

function sqlCell(id: string, content: string, partial: Partial<NotebookCell> = {}): NotebookCell {
  return { id, type: "sql", content, ...partial };
}

function renderNotebook(state: NotebookState, tabOverrides: Partial<Tab> = {}) {
  fixtures.notebooks.set(notebookId, state);
  const tab: Tab = {
    id: "tab-1", title: "Notebook", type: "notebook", notebookId, connectionId,
    query: "", result: null, error: "", executionTime: null, page: 1,
    activeTable: null, pkColumns: null, schema: "tab_schema", ...tabOverrides,
  };
  return render(<NotebookView tab={tab} updateTab={vi.fn()} connectionId={connectionId} isActive />);
}

function explainFor(id: string): ResolvedQuery | null {
  return JSON.parse(screen.getByTestId(`explain-${id}`).textContent ?? "null") as ResolvedQuery | null;
}

function savedCell(id: string): NotebookCell {
  const cell = fixtures.notebooks.get(notebookId)?.cells.find((entry) => entry.id === id);
  if (!cell) throw new Error(`Missing test cell ${id}`);
  return cell;
}

async function settle() {
  await act(async () => { await Promise.resolve(); });
}

describe("NotebookView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.notebooks.clear();
    fixtures.database.activeDriver = "postgres";
    fixtures.database.activeSchema = "active_schema";
    fixtures.settings.resultPageSize = 37;
    fixtures.guardQuery.mockReset().mockResolvedValue(true);
    fixtures.matchesShortcut.mockReset().mockReturnValue(false);
    mockInvoke.mockReset().mockResolvedValue(queryResult);
  });

  describe("explainQuery preparation", () => {
    it("resolves notebook parameters before references and passes cached data to the visible plan", async () => {
      const state: NotebookState = {
        params,
        cells: [
          sqlCell("source", "SELECT id, label FROM people", { result: sourceResult }),
          sqlCell("target", rawQuery, { isQueryPlanVisible: true }),
        ],
      };
      renderNotebook(state);
      await settle();

      expect(mockResolveParams).toHaveBeenCalledWith(rawQuery.trim(), params);
      expect(mockResolveVariables).toHaveBeenCalledWith(parameterSql, state.cells, { escapeBackslashes: false });
      expect(explainFor("target")).toEqual({ sql: standardSql, unresolvedRefs: [] });
      expect(screen.getByRole("textbox", { name: "SQL target" })).toHaveValue(rawQuery);
      expect(screen.getByTestId("cell-target")).toHaveAttribute("data-connection", connectionId);
      expect(loadNotebook).not.toHaveBeenCalled();
      expect(setNotebookState).not.toHaveBeenCalled();
      expect(fixtures.guardQuery).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it.each([undefined, false])("does not resolve or materialize a hidden plan (visibility %s), including after edits", async (isQueryPlanVisible) => {
      const readRows = vi.fn(() => sourceResult.rows);
      const cachedResult: QueryResult = {
        columns: sourceResult.columns, affected_rows: 0,
        get rows() { return readRows(); },
      };
      renderNotebook({
        params,
        cells: [
          sqlCell("source", "SELECT id, label FROM people", { result: cachedResult }),
          sqlCell("target", rawQuery, { isQueryPlanVisible }),
          { id: "notes", type: "markdown", content: "{{cell_1}}", isQueryPlanVisible: true },
        ],
      });
      await settle();
      expect(explainFor("target")).toBeNull();
      expect(explainFor("notes")).toBeNull();
      expect(mockResolveParams).not.toHaveBeenCalled();
      expect(mockResolveVariables).not.toHaveBeenCalled();
      expect(readRows).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Toggle plan target" }));
      expect(savedCell("target").isQueryPlanVisible).toBe(true);
      expect(explainFor("target")).toEqual({ sql: standardSql, unresolvedRefs: [] });
      expect(readRows).toHaveBeenCalled();

      mockResolveParams.mockClear();
      mockResolveVariables.mockClear();
      readRows.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Toggle plan target" }));
      fireEvent.change(screen.getByRole("textbox", { name: "SQL target" }), {
        target: { value: rawQuery.replace("*", "label") },
      });
      await settle();
      expect(savedCell("target").isQueryPlanVisible).toBe(false);
      expect(explainFor("target")).toBeNull();
      expect(mockResolveParams).not.toHaveBeenCalled();
      expect(mockResolveVariables).not.toHaveBeenCalled();
      expect(readRows).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Toggle plan target" }));
      expect(explainFor("target")).toEqual({ sql: standardSql.replace("SELECT *", "SELECT label"), unresolvedRefs: [] });
      expect(readRows).toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it.each([
      { name: "missing result", partial: { result: null }, reference: "{{cell_1}}", cellIndex: 0 },
      { name: "errored result", partial: { result: sourceResult, error: "Previous execution failed" }, reference: "{{cell_1}}", cellIndex: 0 },
      { name: "missing cell", partial: { result: sourceResult }, reference: "{{cell_9}}", cellIndex: 8 },
    ])("keeps a $name unresolved without lazy-executing dependencies", async ({ partial, reference, cellIndex }) => {
      renderNotebook({
        params: [{ name: "source", value: reference }],
        cells: [
          sqlCell("source", "SELECT id, label FROM people", partial),
          sqlCell("target", " SELECT * FROM @source ", { isQueryPlanVisible: true }),
        ],
      });
      await settle();
      expect(explainFor("target")).toEqual({
        sql: `SELECT * FROM ${reference}`,
        unresolvedRefs: [{ match: reference, cellIndex }],
      });
      fireEvent.change(screen.getByRole("textbox", { name: "SQL target" }), {
        target: { value: "SELECT id FROM @source" },
      });
      await settle();
      expect(explainFor("target")).toEqual({
        sql: `SELECT id FROM ${reference}`,
        unresolvedRefs: [{ match: reference, cellIndex }],
      });
      expect(savedCell("source")).toMatchObject(partial);
      expect(savedCell("source").history).toBeUndefined();
      expect(fixtures.guardQuery).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("legacy runCell", () => {
    it.each([
      { driver: "mysql", escapeBackslashes: true, expectedSql: mysqlSql },
      { driver: "postgres", escapeBackslashes: false, expectedSql: standardSql },
      { driver: "sqlite", escapeBackslashes: false, expectedSql: standardSql },
      { driver: "test-driver", escapeBackslashes: false, expectedSql: standardSql },
    ])("uses the same prepared SQL for the plan and execute_query with $driver escaping, preserving result history", async ({ driver, escapeBackslashes, expectedSql }) => {
      fixtures.database.activeDriver = driver;
      const previousEntry = { query: "SELECT 1", result: null, executionTime: 1, timestamp: 1 };
      renderNotebook({
        params,
        cells: [
          sqlCell("source", "SELECT id, label FROM people", { result: sourceResult }),
          sqlCell("target", rawQuery, { schema: "cell_schema", isQueryPlanVisible: true, history: [previousEntry] }),
        ],
      });
      const prepared = explainFor("target");
      expect(prepared).toEqual({ sql: expectedSql, unresolvedRefs: [] });
      expect(mockResolveVariables).toHaveBeenCalledWith(parameterSql, expect.any(Array), { escapeBackslashes });
      expect(mockInvoke).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Run target" }));
      });

      expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("execute_query", {
        connectionId, query: prepared?.sql, schema: "cell_schema", limit: 37, page: 1,
      });
      expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(expectedSql);
      const target = savedCell("target");
      expect(target).toMatchObject({ result: queryResult, isLoading: false, executionTime: expect.any(Number) });
      expect(target.error).toBeUndefined();
      expect(target.executionTime).toBeGreaterThanOrEqual(0);
      expect(target.history).toEqual([
        { query: rawQuery.trim(), result: queryResult, error: undefined, executionTime: target.executionTime, timestamp: expect.any(Number) },
        previousEntry,
      ]);
      expect(savedCell("source").history).toBeUndefined();
      expect(screen.getByTestId("cell-target")).toHaveAttribute("data-loading", "false");
      expect(explainFor("target")).toEqual(prepared);
      // The exact single invocation above also excludes EXPLAIN and batch execution.
    });

    it.each([
      { tabSchema: "tab_schema", activeSchema: "active_schema", expectedSchema: "tab_schema" },
      { tabSchema: undefined, activeSchema: "active_schema", expectedSchema: "active_schema" },
      { tabSchema: undefined, activeSchema: null, expectedSchema: undefined },
    ])("forwards per-cell schema and notebook fallback $expectedSchema to both the child and execution", async ({ tabSchema, activeSchema, expectedSchema }) => {
      fixtures.database.activeSchema = activeSchema;
      renderNotebook({ cells: [
        sqlCell("override", "SELECT 1", { schema: "cell_schema", isQueryPlanVisible: true }),
        sqlCell("fallback", "SELECT 2", { isQueryPlanVisible: true }),
      ] }, { schema: tabSchema });
      expect(screen.getByTestId("cell-override")).toHaveAttribute("data-schema", "cell_schema");
      if (expectedSchema) expect(screen.getByTestId("cell-fallback")).toHaveAttribute("data-schema", expectedSchema);
      else expect(screen.getByTestId("cell-fallback")).not.toHaveAttribute("data-schema");

      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run override" })); });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run fallback" })); });
      expect(mockInvoke.mock.calls).toEqual([
        ["execute_query", { connectionId, query: "SELECT 1", schema: "cell_schema", limit: 37, page: 1 }],
        ["execute_query", { connectionId, query: "SELECT 2", limit: 37, page: 1, ...(expectedSchema ? { schema: expectedSchema } : {}) }],
      ]);
    });
  });

  describe("Run All", () => {
    it.each([false, true])("runs ordinary queries only and uses fresh dependency results (plan visible: %s)", async (isQueryPlanVisible) => {
      mockInvoke.mockResolvedValueOnce(sourceResult).mockResolvedValueOnce(queryResult);
      renderNotebook({
        params,
        cells: [
          sqlCell("source", "SELECT id, label FROM people"),
          sqlCell("target", rawQuery, { schema: "cell_schema", isQueryPlanVisible }),
        ],
      });
      await settle();
      expect(mockInvoke).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run All" })); });

      expect(mockInvoke.mock.calls).toEqual([
        ["execute_query", { connectionId, query: "SELECT id, label FROM people", schema: "tab_schema", limit: 37, page: 1 }],
        ["execute_query", { connectionId, query: standardSql, schema: "cell_schema", limit: 37, page: 1 }],
      ]);
      expect(savedCell("source").result).toEqual(sourceResult);
      expect(savedCell("target").result).toEqual(queryResult);
      expect(savedCell("source").history).toHaveLength(1);
      expect(savedCell("target").history).toHaveLength(1);
      expect(savedCell("target").history?.[0]).toMatchObject({ query: rawQuery.trim(), result: queryResult });
      expect(explainFor("target")).toEqual(isQueryPlanVisible ? { sql: standardSql, unresolvedRefs: [] } : null);
      expect(screen.getByRole("button", { name: "Run All" })).toBeEnabled();
    });
  });
});