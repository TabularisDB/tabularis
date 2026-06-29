import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NotebookState } from "../../src/types/notebook";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Import after mock setup
import { invoke } from "@tauri-apps/api/core";
import {
  getNotebookState,
  setNotebookState,
  loadNotebook,
  createNotebook,
  createNotebookFromState,
  renameNotebook,
  deleteNotebook,
  evictFromCache,
  flushAllPendingSaves,
  getNotebookTitle,
  setNotebookTitle,
  NOTEBOOKS_CHANGED_EVENT,
  _resetForTesting,
} from "../../src/utils/notebookStore";

const mockedInvoke = vi.mocked(invoke);

const CONN = "conn_1";

function makeState(content = "SELECT 1"): NotebookState {
  return {
    cells: [{ id: "c1", type: "sql", content }],
  };
}

/**
 * Notebooks persist per connection, so a save only happens once the store
 * knows the owning connection — established by loadNotebook/createNotebook in
 * the real lifecycle. Seed that association via a (mocked) load returning null.
 */
async function seedConnection(id: string) {
  mockedInvoke.mockResolvedValueOnce(null);
  await loadNotebook(id, CONN);
}

describe("notebookStore", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.useFakeTimers();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("cache operations", () => {
    it("getNotebookState returns undefined for unknown ID", () => {
      expect(getNotebookState("unknown-id")).toBeUndefined();
    });

    it("setNotebookState stores state in cache", () => {
      const state = makeState();
      setNotebookState("test-1", state);
      expect(getNotebookState("test-1")).toBe(state);
    });
  });

  describe("debounced save", () => {
    it("does not save immediately on setNotebookState", () => {
      setNotebookState("debounce-1", makeState());
      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "save_notebook",
        expect.anything(),
      );
    });

    it("saves after debounce period", async () => {
      await seedConnection("debounce-2");
      setNotebookTitle("debounce-2", "Test");
      setNotebookState("debounce-2", makeState());

      await vi.advanceTimersByTimeAsync(1500);

      expect(mockedInvoke).toHaveBeenCalledWith("save_notebook", {
        connectionId: CONN,
        notebookId: "debounce-2",
        content: expect.any(String),
      });
    });

    it("resets timer on subsequent calls", async () => {
      await seedConnection("debounce-3");
      setNotebookTitle("debounce-3", "Test");
      setNotebookState("debounce-3", makeState("SELECT 1"));

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "save_notebook",
        expect.anything(),
      );

      // Second call resets the timer
      setNotebookState("debounce-3", makeState("SELECT 2"));

      await vi.advanceTimersByTimeAsync(1000);
      // Still not saved (only 1000ms since last call)
      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "save_notebook",
        expect.anything(),
      );

      await vi.advanceTimersByTimeAsync(500);
      // Now 1500ms since last call — should save
      expect(mockedInvoke).toHaveBeenCalledWith("save_notebook", {
        connectionId: CONN,
        notebookId: "debounce-3",
        content: expect.any(String),
      });
    });

    it("does not save when the connection is unknown", async () => {
      // No seeded connection — the store cannot build a path, so it skips.
      setNotebookTitle("orphan-1", "Test");
      setNotebookState("orphan-1", makeState());

      await vi.advanceTimersByTimeAsync(1500);

      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "save_notebook",
        expect.anything(),
      );
    });
  });

  describe("loadNotebook", () => {
    it("loads from Tauri backend and caches", async () => {
      const fileContent = JSON.stringify({
        version: 2,
        title: "Loaded",
        createdAt: "2026-01-01",
        cells: [{ type: "sql", content: "SELECT 42" }],
      });
      mockedInvoke.mockResolvedValueOnce(fileContent);

      const state = await loadNotebook("load-1", CONN);

      expect(mockedInvoke).toHaveBeenCalledWith("load_notebook", {
        connectionId: CONN,
        notebookId: "load-1",
      });
      expect(state.cells).toHaveLength(1);
      expect(state.cells[0].content).toBe("SELECT 42");
      expect(getNotebookState("load-1")).toBe(state);
      expect(getNotebookTitle("load-1")).toBe("Loaded");
    });

    it("returns cached state on second call", async () => {
      const state = makeState();
      setNotebookState("load-2", state);

      const result = await loadNotebook("load-2", CONN);
      expect(result).toBe(state);
      // Should NOT call invoke since it's cached
      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "load_notebook",
        expect.anything(),
      );
    });

    it("creates default state when file not found", async () => {
      mockedInvoke.mockResolvedValueOnce(null);

      const state = await loadNotebook("load-3", CONN);
      expect(state.cells).toHaveLength(1);
      expect(state.cells[0].type).toBe("sql");
      expect(state.cells[0].content).toBe("");
    });
  });

  describe("createNotebook", () => {
    it("generates unique ID and saves to disk", async () => {
      const { notebookId, state } = await createNotebook("New Notebook", CONN);

      expect(notebookId).toMatch(/^nb_/);
      expect(state.cells).toHaveLength(1);
      expect(getNotebookState(notebookId)).toBe(state);
      expect(getNotebookTitle(notebookId)).toBe("New Notebook");
      expect(mockedInvoke).toHaveBeenCalledWith("create_notebook", {
        connectionId: CONN,
        notebookId,
        content: expect.any(String),
      });
    });
  });

  describe("createNotebookFromState", () => {
    it("saves existing state as new file", async () => {
      const state = makeState("SELECT * FROM orders");
      const { notebookId } = await createNotebookFromState(
        "Migrated",
        state,
        CONN,
      );

      expect(notebookId).toMatch(/^nb_/);
      expect(getNotebookState(notebookId)).toBe(state);
      expect(getNotebookTitle(notebookId)).toBe("Migrated");
      expect(mockedInvoke).toHaveBeenCalledWith("create_notebook", {
        connectionId: CONN,
        notebookId,
        content: expect.stringContaining("SELECT * FROM orders"),
      });
    });
  });

  describe("deleteNotebook", () => {
    it("evicts from cache and deletes file", async () => {
      setNotebookState("del-1", makeState());
      setNotebookTitle("del-1", "To Delete");

      await deleteNotebook("del-1", CONN);

      expect(getNotebookState("del-1")).toBeUndefined();
      expect(getNotebookTitle("del-1")).toBeUndefined();
      expect(mockedInvoke).toHaveBeenCalledWith("delete_notebook", {
        connectionId: CONN,
        notebookId: "del-1",
      });
    });
  });

  describe("renameNotebook", () => {
    it("rewrites the file via save when the notebook is open (cached)", async () => {
      await seedConnection("ren-1");
      setNotebookState("ren-1", makeState());

      await renameNotebook("ren-1", CONN, "Renamed Open");

      // Open notebooks flush the full file with the new title (no rename cmd).
      expect(mockedInvoke).toHaveBeenCalledWith("save_notebook", {
        connectionId: CONN,
        notebookId: "ren-1",
        content: expect.stringContaining("Renamed Open"),
      });
      expect(mockedInvoke).not.toHaveBeenCalledWith(
        "rename_notebook",
        expect.anything(),
      );
      expect(getNotebookTitle("ren-1")).toBe("Renamed Open");
    });

    it("patches the file via rename_notebook when not open", async () => {
      await renameNotebook("ren-2", CONN, "Renamed Closed");

      expect(mockedInvoke).toHaveBeenCalledWith("rename_notebook", {
        connectionId: CONN,
        notebookId: "ren-2",
        title: "Renamed Closed",
      });
    });
  });

  describe("evictFromCache", () => {
    it("flushes pending save before evicting", async () => {
      await seedConnection("evict-1");
      setNotebookTitle("evict-1", "Test");
      setNotebookState("evict-1", makeState());

      // There's a pending save timer
      await evictFromCache("evict-1");

      // Should have flushed the save
      expect(mockedInvoke).toHaveBeenCalledWith("save_notebook", {
        connectionId: CONN,
        notebookId: "evict-1",
        content: expect.any(String),
      });
      expect(getNotebookState("evict-1")).toBeUndefined();
    });
  });

  describe("flushAllPendingSaves", () => {
    it("flushes all pending timers", async () => {
      await seedConnection("flush-1");
      await seedConnection("flush-2");
      setNotebookTitle("flush-1", "A");
      setNotebookTitle("flush-2", "B");
      setNotebookState("flush-1", makeState("SELECT 1"));
      setNotebookState("flush-2", makeState("SELECT 2"));

      await flushAllPendingSaves();

      const saveCalls = mockedInvoke.mock.calls.filter(
        ([cmd]) => cmd === "save_notebook",
      );
      expect(saveCalls).toHaveLength(2);
    });
  });

  describe("change notifications", () => {
    it("emits NOTEBOOKS_CHANGED_EVENT on create", async () => {
      const handler = vi.fn();
      window.addEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
      await createNotebook("Notify Create", CONN);
      window.removeEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emits NOTEBOOKS_CHANGED_EVENT on delete", async () => {
      const handler = vi.fn();
      window.addEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
      await deleteNotebook("notify-del", CONN);
      window.removeEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emits NOTEBOOKS_CHANGED_EVENT on rename", async () => {
      const handler = vi.fn();
      window.addEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
      await renameNotebook("notify-ren", CONN, "X");
      window.removeEventListener(NOTEBOOKS_CHANGED_EVENT, handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("title management", () => {
    it("stores and retrieves titles", () => {
      setNotebookTitle("title-1", "My Title");
      expect(getNotebookTitle("title-1")).toBe("My Title");
    });

    it("schedules save on title change", async () => {
      await seedConnection("title-2");
      setNotebookState("title-2", makeState());
      setNotebookTitle("title-2", "Updated Title");

      await vi.advanceTimersByTimeAsync(1500);

      expect(mockedInvoke).toHaveBeenCalledWith("save_notebook", {
        connectionId: CONN,
        notebookId: "title-2",
        content: expect.stringContaining("Updated Title"),
      });
    });
  });
});
