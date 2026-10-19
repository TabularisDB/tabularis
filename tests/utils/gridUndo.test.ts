import { describe, it, expect } from "vitest";
import {
  createGridHistory,
  recordGridEdit,
  undoGridEdit,
  redoGridEdit,
  canUndoGrid,
  canRedoGrid,
  clonePendingChanges,
  pendingChangesSignature,
  GRID_HISTORY_LIMIT,
  type PendingChangesMap,
} from "../../src/utils/gridUndo";

describe("gridUndo", () => {
  const row1 = { id: 1 };
  const pkKey1 = JSON.stringify(row1);

  const state0: PendingChangesMap | undefined = undefined;

  const state1: PendingChangesMap = {
    [pkKey1]: {
      pkOriginalValue: row1,
      changes: { name: "Bob" },
    },
  };

  const state2: PendingChangesMap = {
    [pkKey1]: {
      pkOriginalValue: row1,
      changes: { name: "Charlie" },
    },
  };

  const stateMulti: PendingChangesMap = {
    [pkKey1]: {
      pkOriginalValue: row1,
      changes: { name: "David", age: 30 },
    },
    '{"id":2}': {
      pkOriginalValue: { id: 2 },
      changes: { role: "admin" },
    },
  };

  it("initializes empty history", () => {
    const h = createGridHistory();
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(canUndoGrid(h)).toBe(false);
    expect(canRedoGrid(h)).toBe(false);
  });

  it("records edit transition and enables undo", () => {
    let h = createGridHistory();
    h = recordGridEdit(h, state0, state1, 1000);
    expect(canUndoGrid(h)).toBe(true);
    expect(canRedoGrid(h)).toBe(false);
    expect(h.past.length).toBe(1);
    expect(h.past[0]).toBeUndefined();
  });

  it("ignores identical states", () => {
    let h = createGridHistory();
    h = recordGridEdit(h, state0, state1, 1000);
    const before = h;
    h = recordGridEdit(h, state1, state1, 1200);
    expect(h).toBe(before);
  });

  it("coalesces rapid multi-cell paste / fill operations within COALESCE_MS window into a single step", () => {
    let h = createGridHistory();
    // Start of paste: cell 1
    h = recordGridEdit(h, state0, state1, 1000);
    expect(h.past.length).toBe(1);

    // Cell 2 of same paste within 10ms
    const intermediateState: PendingChangesMap = {
      [pkKey1]: {
        pkOriginalValue: row1,
        changes: { name: "Bob", age: 25 },
      },
    };
    h = recordGridEdit(h, state1, intermediateState, 1010);
    expect(h.past.length).toBe(1);

    // Cell 3 of same paste within 20ms
    h = recordGridEdit(h, intermediateState, stateMulti, 1020);
    expect(h.past.length).toBe(1);

    // Undoing must revert all the way back to state0 before the paste
    const step = undoGridEdit(h, stateMulti);
    expect(step).not.toBeNull();
    expect(step!.pendingChanges).toBeUndefined();
    expect(canUndoGrid(step!.history)).toBe(false);
    expect(canRedoGrid(step!.history)).toBe(true);
  });

  it("supports multi-step undo and redo", () => {
    let h = createGridHistory();
    h = recordGridEdit(h, state0, state1, 1000);
    h = recordGridEdit(h, state1, state2, 2000);

    expect(h.past.length).toBe(2);

    // First undo: charlie -> bob
    const step1 = undoGridEdit(h, state2);
    expect(step1).not.toBeNull();
    expect(step1!.pendingChanges).toEqual(state1);
    expect(canUndoGrid(step1!.history)).toBe(true);
    expect(canRedoGrid(step1!.history)).toBe(true);

    // Second undo: bob -> initial (undefined)
    const step2 = undoGridEdit(step1!.history, step1!.pendingChanges);
    expect(step2).not.toBeNull();
    expect(step2!.pendingChanges).toBeUndefined();
    expect(canUndoGrid(step2!.history)).toBe(false);
    expect(canRedoGrid(step2!.history)).toBe(true);

    // Redo step 1: initial -> bob
    const redo1 = redoGridEdit(step2!.history, step2!.pendingChanges);
    expect(redo1).not.toBeNull();
    expect(redo1!.pendingChanges).toEqual(state1);
    expect(canUndoGrid(redo1!.history)).toBe(true);

    // Redo step 2: bob -> charlie
    const redo2 = redoGridEdit(redo1!.history, redo1!.pendingChanges);
    expect(redo2).not.toBeNull();
    expect(redo2!.pendingChanges).toEqual(state2);
    expect(canRedoGrid(redo2!.history)).toBe(false);
  });

  it("invalidates redo branch when a new edit occurs", () => {
    let h = createGridHistory();
    h = recordGridEdit(h, state0, state1, 1000);
    h = recordGridEdit(h, state1, state2, 2000);

    // Undo back to state1
    const step = undoGridEdit(h, state2);
    expect(canRedoGrid(step!.history)).toBe(true);

    // New edit while in past state
    const brandNewState: PendingChangesMap = {
      [pkKey1]: {
        pkOriginalValue: row1,
        changes: { name: "Zack" },
      },
    };
    const nextHistory = recordGridEdit(step!.history, state1, brandNewState, 4000);

    // Redo branch must be cleared
    expect(canRedoGrid(nextHistory)).toBe(false);
    expect(nextHistory.future).toEqual([]);
  });

  it("restores state when reverting back to original value", () => {
    let h = createGridHistory();
    // Edit original to Bob
    h = recordGridEdit(h, state0, state1, 1000);
    // User types original back -> pending changes becomes empty/undefined
    h = recordGridEdit(h, state1, undefined, 2000);

    expect(canUndoGrid(h)).toBe(true);
    const step = undoGridEdit(h, undefined);
    expect(step).not.toBeNull();
    expect(step!.pendingChanges).toEqual(state1);
  });

  it("enforces history limit", () => {
    let h = createGridHistory();
    for (let i = 0; i < GRID_HISTORY_LIMIT + 10; i++) {
      const prev: PendingChangesMap = {
        [pkKey1]: { pkOriginalValue: row1, changes: { step: i } },
      };
      const next: PendingChangesMap = {
        [pkKey1]: { pkOriginalValue: row1, changes: { step: i + 1 } },
      };
      h = recordGridEdit(h, prev, next, 1000 + i * 1000);
    }
    expect(h.past.length).toBe(GRID_HISTORY_LIMIT);
  });

  it("deep clones pending change snapshots to prevent reference mutation", () => {
    const original: PendingChangesMap = {
      [pkKey1]: { pkOriginalValue: row1, changes: { name: "Original" } },
    };
    const cloned = clonePendingChanges(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned![pkKey1].changes).not.toBe(original[pkKey1].changes);
  });
});
