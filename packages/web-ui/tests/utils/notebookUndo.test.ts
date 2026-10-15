import { describe, it, expect } from "vitest";
import type { NotebookState } from "../../src/types/notebook";
import {
  createHistory,
  documentSignature,
  recordEdit,
  undo,
  redo,
  timeline,
  jumpTo,
  describeChange,
  HISTORY_LIMIT,
  COALESCE_MS,
} from "../../src/utils/notebookUndo";
import type { NotebookCell } from "../../src/types/notebook";

function state(content: string, extra: Partial<NotebookState> = {}): NotebookState {
  return { cells: [{ id: "c1", type: "sql", content }], ...extra };
}

describe("notebookUndo", () => {
  describe("documentSignature", () => {
    it("ignores runtime fields (results, loading, errors)", () => {
      const a = state("SELECT 1");
      const b: NotebookState = {
        cells: [
          {
            id: "c1",
            type: "sql",
            content: "SELECT 1",
            result: { columns: ["x"], rows: [[1]] } as never,
            isLoading: true,
            error: "boom",
            executionTime: 42,
          },
        ],
      };
      expect(documentSignature(a)).toBe(documentSignature(b));
    });

    it("changes when content changes", () => {
      expect(documentSignature(state("SELECT 1"))).not.toBe(
        documentSignature(state("SELECT 2")),
      );
    });

    it("changes when params or stopOnError change", () => {
      expect(documentSignature(state("X"))).not.toBe(
        documentSignature(state("X", { stopOnError: true })),
      );
      expect(documentSignature(state("X"))).not.toBe(
        documentSignature(state("X", { params: [{ name: "p", value: "1" }] })),
      );
    });
  });

  describe("recordEdit", () => {
    it("does not record runtime-only changes", () => {
      const h = createHistory();
      const prev = state("SELECT 1");
      const next: NotebookState = {
        cells: [{ id: "c1", type: "sql", content: "SELECT 1", isLoading: true }],
      };
      const result = recordEdit(h, prev, next, 1000);
      expect(result.past).toHaveLength(0);
    });

    it("records a document change outside the coalesce window", () => {
      let h = createHistory();
      h = recordEdit(h, state("a"), state("ab"), 1000);
      expect(h.past).toHaveLength(1);
      expect(h.past[0].cells[0].content).toBe("a");
    });

    it("coalesces edits within the window into one step", () => {
      let h = createHistory();
      h = recordEdit(h, state("a"), state("ab"), 1000);
      h = recordEdit(h, state("ab"), state("abc"), 1000 + COALESCE_MS - 1);
      expect(h.past).toHaveLength(1); // still just the pre-burst state
      expect(h.past[0].cells[0].content).toBe("a");
    });

    it("starts a new step after the coalesce window elapses", () => {
      let h = createHistory();
      h = recordEdit(h, state("a"), state("ab"), 1000);
      h = recordEdit(h, state("ab"), state("abc"), 1000 + COALESCE_MS + 1);
      expect(h.past).toHaveLength(2);
    });

    it("clears the redo stack on a fresh edit", () => {
      let h = createHistory();
      h = recordEdit(h, state("a"), state("ab"), 1000);
      const undone = undo(h, state("ab"))!;
      expect(undone.history.future).toHaveLength(1);
      const after = recordEdit(undone.history, state("a"), state("ax"), 5000);
      expect(after.future).toHaveLength(0);
    });

    it("caps the history at HISTORY_LIMIT", () => {
      let h = createHistory();
      let t = 0;
      for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
        t += COALESCE_MS + 1;
        h = recordEdit(h, state(`v${i}`), state(`v${i}x`), t);
      }
      expect(h.past).toHaveLength(HISTORY_LIMIT);
    });
  });

  describe("undo / redo", () => {
    it("undo returns null when there is nothing to undo", () => {
      expect(undo(createHistory(), state("a"))).toBeNull();
    });

    it("redo returns null when there is nothing to redo", () => {
      expect(redo(createHistory(), state("a"))).toBeNull();
    });

    it("round-trips through undo then redo", () => {
      let h = createHistory();
      h = recordEdit(h, state("a"), state("ab"), 1000);

      const undone = undo(h, state("ab"))!;
      expect(undone.state.cells[0].content).toBe("a");
      expect(undone.history.past).toHaveLength(0);
      expect(undone.history.future).toHaveLength(1);

      const redone = redo(undone.history, undone.state)!;
      expect(redone.state.cells[0].content).toBe("ab");
      expect(redone.history.past).toHaveLength(1);
      expect(redone.history.future).toHaveLength(0);
    });

    it("walks back through multiple steps", () => {
      let h = createHistory();
      h = recordEdit(h, state("a"), state("b"), 1000);
      h = recordEdit(h, state("b"), state("c"), 1000 + COALESCE_MS + 1);

      const u1 = undo(h, state("c"))!;
      expect(u1.state.cells[0].content).toBe("b");
      const u2 = undo(u1.history, u1.state)!;
      expect(u2.state.cells[0].content).toBe("a");
      expect(undo(u2.history, u2.state)).toBeNull();
    });
  });

  describe("timeline / jumpTo", () => {
    function build() {
      // past: [a, b], current: c
      let h = createHistory();
      h = recordEdit(h, state("a"), state("b"), 1000);
      h = recordEdit(h, state("b"), state("c"), 1000 + COALESCE_MS + 1);
      return h;
    }

    it("timeline lists oldest-first with current at past.length", () => {
      const h = build();
      const { states, currentIndex } = timeline(h, state("c"));
      expect(states.map((s) => s.cells[0].content)).toEqual(["a", "b", "c"]);
      expect(currentIndex).toBe(2);
    });

    it("jumps back to an earlier point", () => {
      const h = build();
      const step = jumpTo(h, state("c"), 0)!;
      expect(step.state.cells[0].content).toBe("a");
      expect(step.history.past).toHaveLength(0);
      // current ("c") and everything after the target move to the future
      expect(step.history.future.map((s) => s.cells[0].content)).toEqual([
        "b",
        "c",
      ]);
    });

    it("jumps forward through the future", () => {
      const h = build();
      const back = jumpTo(h, state("c"), 0)!; // now at "a", future [b, c]
      const fwd = jumpTo(back.history, back.state, 2)!; // jump to "c"
      expect(fwd.state.cells[0].content).toBe("c");
      expect(fwd.history.past.map((s) => s.cells[0].content)).toEqual([
        "a",
        "b",
      ]);
      expect(fwd.history.future).toHaveLength(0);
    });

    it("returns null for the current index or out-of-range", () => {
      const h = build();
      expect(jumpTo(h, state("c"), 2)).toBeNull(); // current
      expect(jumpTo(h, state("c"), -1)).toBeNull();
      expect(jumpTo(h, state("c"), 99)).toBeNull();
    });
  });

  describe("describeChange", () => {
    const cell = (id: string, over: Partial<NotebookCell> = {}): NotebookCell => ({
      id,
      type: "sql",
      content: "",
      ...over,
    });
    const ns = (cells: NotebookCell[], over: Partial<typeof import("../../src/types/notebook")> = {}): NotebookState =>
      ({ cells, ...(over as object) }) as NotebookState;

    it("detects an edited cell with a preview of the new content", () => {
      const prev = ns([cell("a", { content: "SELECT 1" })]);
      const next = ns([cell("a", { content: "SELECT 2\n-- more" })]);
      expect(describeChange(prev, next)).toMatchObject({
        kind: "editCell",
        n: 1,
        detail: "SELECT 2",
      });
    });

    it("detects an added SQL cell at its position", () => {
      const prev = ns([cell("a")]);
      const next = ns([cell("a"), cell("b", { content: "NEW" })]);
      expect(describeChange(prev, next)).toMatchObject({ kind: "addSql", n: 2 });
    });

    it("detects an added markdown cell", () => {
      const prev = ns([cell("a")]);
      const next = ns([cell("a"), cell("b", { type: "markdown" })]);
      expect(describeChange(prev, next).kind).toBe("addMarkdown");
    });

    it("detects a deleted cell by its old position", () => {
      const prev = ns([cell("a"), cell("b"), cell("c")]);
      const next = ns([cell("a"), cell("c")]);
      expect(describeChange(prev, next)).toMatchObject({
        kind: "deleteCell",
        n: 2,
      });
    });

    it("detects reordering", () => {
      const prev = ns([cell("a"), cell("b")]);
      const next = ns([cell("b"), cell("a")]);
      expect(describeChange(prev, next).kind).toBe("reorder");
    });

    it("detects rename, schema, params and stop-on-error", () => {
      expect(
        describeChange(ns([cell("a")]), ns([cell("a", { name: "Q1" })])),
      ).toMatchObject({ kind: "renameCell", n: 1, detail: "Q1" });
      expect(
        describeChange(ns([cell("a")]), ns([cell("a", { schema: "public" })])),
      ).toMatchObject({ kind: "schemaCell", n: 1 });
      expect(
        describeChange(ns([cell("a")]), ns([cell("a")], { params: [{ name: "p", value: "1" }] } as never)),
      ).toMatchObject({ kind: "params" });
      expect(
        describeChange(ns([cell("a")]), ns([cell("a")], { stopOnError: true } as never)),
      ).toMatchObject({ kind: "stopOnError" });
    });
  });
});
