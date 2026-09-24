import { describe, it, expect, vi } from "vitest";
import {
  buildSyncPayload,
  hasMultiResults,
  singleResultToEntry,
  applyAction,
  SINGLE_RESULT_ENTRY_ID,
  type ResultsDisplaySettings,
  type ResultsWindowActionHandlers,
  type ResultsSyncPayload,
} from "../../src/utils/resultsWindowSync";
import type { Tab, QueryResult, QueryResultEntry } from "../../src/types/editor";

const settings: ResultsDisplaySettings = {
  connectionId: "conn-1",
  copyFormat: "csv",
  csvDelimiter: ",",
  csvIncludeHeaders: true,
};

const baseResult: QueryResult = {
  columns: ["id", "name"],
  rows: [[1, "a"]],
  affected_rows: 0,
  pagination: { page: 2, page_size: 100, total_rows: 250, has_more: true },
};

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    title: "Console 1",
    type: "console",
    query: "SELECT * FROM t",
    result: null,
    error: "",
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumn: null,
    connectionId: "conn-1",
    ...overrides,
  };
}

describe("buildSyncPayload", () => {
  it("captures single-result tab state plus display settings", () => {
    const tab = makeTab({
      result: baseResult,
      executionTime: 12.5,
      isLoading: false,
      activeTable: "t",
    });
    const payload = buildSyncPayload(tab, settings);

    expect(payload.tabId).toBe("tab-1");
    expect(payload.tabTitle).toBe("Console 1");
    expect(payload.query).toBe("SELECT * FROM t");
    expect(payload.result).toEqual(baseResult);
    expect(payload.executionTime).toBe(12.5);
    expect(payload.activeTable).toBe("t");
    expect(payload.results).toBeUndefined();
    expect(payload.connectionId).toBe("conn-1");
    expect(payload.copyFormat).toBe("csv");
    expect(payload.csvDelimiter).toBe(",");
    expect(payload.csvIncludeHeaders).toBe(true);
  });

  it("defaults isLoading to false when tab.isLoading is undefined", () => {
    const payload = buildSyncPayload(makeTab(), settings);
    expect(payload.isLoading).toBe(false);
  });

  it("carries multi-result entries and the active id", () => {
    const entry: QueryResultEntry = {
      id: "e1",
      queryIndex: 0,
      query: "SELECT 1",
      result: baseResult,
      error: "",
      executionTime: 5,
      isLoading: false,
      page: 1,
      activeTable: null,
      pkColumn: null,
    };
    const tab = makeTab({ results: [entry], activeResultId: "e1" });
    const payload = buildSyncPayload(tab, settings);
    expect(payload.results).toHaveLength(1);
    expect(payload.activeResultId).toBe("e1");
  });
});

describe("hasMultiResults", () => {
  const base = buildSyncPayload(makeTab(), settings);

  it("is false when there are no entries", () => {
    expect(hasMultiResults(base)).toBe(false);
    expect(hasMultiResults({ ...base, results: [] })).toBe(false);
  });

  it("is true when entries are present", () => {
    const withEntries: ResultsSyncPayload = {
      ...base,
      results: [
        {
          id: "e1",
          queryIndex: 0,
          query: "",
          result: null,
          error: "",
          executionTime: null,
          isLoading: false,
          page: 1,
          activeTable: null,
          pkColumn: null,
        },
      ],
    };
    expect(hasMultiResults(withEntries)).toBe(true);
  });
});

describe("singleResultToEntry", () => {
  it("maps a single-result payload to a synthetic entry", () => {
    const payload = buildSyncPayload(
      makeTab({ result: baseResult, executionTime: 9, isLoading: false }),
      settings,
    );
    const entry = singleResultToEntry(payload);
    expect(entry.id).toBe(SINGLE_RESULT_ENTRY_ID);
    expect(entry.result).toEqual(baseResult);
    expect(entry.executionTime).toBe(9);
    expect(entry.page).toBe(2); // from pagination.page
    expect(entry.query).toBe("SELECT * FROM t");
  });

  it("falls back to page 1 when there is no pagination", () => {
    const payload = buildSyncPayload(
      makeTab({ result: { columns: [], rows: [], affected_rows: 0 } }),
      settings,
    );
    expect(singleResultToEntry(payload).page).toBe(1);
  });
});

describe("applyAction", () => {
  function makeHandlers(): ResultsWindowActionHandlers {
    return {
      onRunQueryPage: vi.fn(),
      onPageChange: vi.fn(),
      onSelectResult: vi.fn(),
      onRerunEntry: vi.fn(),
      onCloseEntry: vi.fn(),
      onCloseOtherEntries: vi.fn(),
      onCloseEntriesToRight: vi.fn(),
      onCloseEntriesToLeft: vi.fn(),
      onCloseAllEntries: vi.fn(),
      onRenameEntry: vi.fn(),
      onLoadCount: vi.fn(),
    };
  }

  it("dispatches run-query-page with query and page", () => {
    const h = makeHandlers();
    applyAction({ type: "run-query-page", query: "SELECT 1", page: 3 }, h);
    expect(h.onRunQueryPage).toHaveBeenCalledWith("SELECT 1", 3);
  });

  it("dispatches page-change with entry id and page", () => {
    const h = makeHandlers();
    applyAction({ type: "page-change", entryId: "e2", page: 4 }, h);
    expect(h.onPageChange).toHaveBeenCalledWith("e2", 4);
  });

  it("dispatches entry close/rename/select actions", () => {
    const h = makeHandlers();
    applyAction({ type: "select-result", entryId: "e1" }, h);
    applyAction({ type: "rerun-entry", entryId: "e1" }, h);
    applyAction({ type: "close-entry", entryId: "e1" }, h);
    applyAction({ type: "close-other-entries", entryId: "e1" }, h);
    applyAction({ type: "close-entries-to-right", entryId: "e1" }, h);
    applyAction({ type: "close-entries-to-left", entryId: "e1" }, h);
    applyAction({ type: "close-all-entries" }, h);
    applyAction({ type: "rename-entry", entryId: "e1", label: "X" }, h);
    applyAction({ type: "load-count" }, h);

    expect(h.onSelectResult).toHaveBeenCalledWith("e1");
    expect(h.onRerunEntry).toHaveBeenCalledWith("e1");
    expect(h.onCloseEntry).toHaveBeenCalledWith("e1");
    expect(h.onCloseOtherEntries).toHaveBeenCalledWith("e1");
    expect(h.onCloseEntriesToRight).toHaveBeenCalledWith("e1");
    expect(h.onCloseEntriesToLeft).toHaveBeenCalledWith("e1");
    expect(h.onCloseAllEntries).toHaveBeenCalledTimes(1);
    expect(h.onRenameEntry).toHaveBeenCalledWith("e1", "X");
    expect(h.onLoadCount).toHaveBeenCalledTimes(1);
  });

  it("only calls the handler matching the action type", () => {
    const h = makeHandlers();
    applyAction({ type: "load-count" }, h);
    expect(h.onRunQueryPage).not.toHaveBeenCalled();
    expect(h.onPageChange).not.toHaveBeenCalled();
  });
});
