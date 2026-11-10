import {describe, it, expect} from 'vitest';
import {
    createGridHistory,
    recordGridEdit,
    undoGridEdit,
    redoGridEdit,
    canUndoGrid,
    canRedoGrid,
    clonePendingChanges,
    cloneGridSnapshot,
    pendingChangesSignature,
    GRID_HISTORY_LIMIT,
    type PendingChangesMap,
    type GridPendingSnapshot,
} from '@/utils/gridUndo';

describe('gridUndo', () => {
    const row1 = {id: 1};
    const pkKey1 = JSON.stringify(row1);

    const state0: PendingChangesMap | undefined = undefined;

    const state1: PendingChangesMap = {
        [pkKey1]: {
            pkOriginalValue: row1,
            changes: {name: 'Bob'},
        },
    };

    const state2: PendingChangesMap = {
        [pkKey1]: {
            pkOriginalValue: row1,
            changes: {name: 'Charlie'},
        },
    };

    const stateMulti: PendingChangesMap = {
        [pkKey1]: {
            pkOriginalValue: row1,
            changes: {name: 'David', age: 30},
        },
        '{"id":2}': {
            pkOriginalValue: {id: 2},
            changes: {role: 'admin'},
        },
    };

    it('initializes empty history', () => {
        const h = createGridHistory();
        expect(h.past).toEqual([]);
        expect(h.future).toEqual([]);
        expect(canUndoGrid(h)).toBe(false);
        expect(canRedoGrid(h)).toBe(false);
    });

    it('records edit transition and enables undo', () => {
        let h = createGridHistory();
        h = recordGridEdit(h, state0, state1, 1000);
        expect(canUndoGrid(h)).toBe(true);
        expect(canRedoGrid(h)).toBe(false);
        expect(h.past.length).toBe(1);
        expect(h.past[0]).toBeUndefined();
    });

    it('ignores identical states', () => {
        let h = createGridHistory();
        h = recordGridEdit(h, state0, state1, 1000);
        const before = h;
        h = recordGridEdit(h, state1, state1, 1200);
        expect(h).toBe(before);
    });

    it('coalesces rapid multi-cell paste / fill operations within COALESCE_MS window into a single step', () => {
        let h = createGridHistory();
        // Start of paste: cell 1
        h = recordGridEdit(h, state0, state1, 1000);
        expect(h.past.length).toBe(1);

        // Cell 2 of same paste within 10ms
        const intermediateState: PendingChangesMap = {
            [pkKey1]: {
                pkOriginalValue: row1,
                changes: {name: 'Bob', age: 25},
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

    it('keeps edits to distinct rows across human intervals (>150ms) as separate undo steps', () => {
        let h = createGridHistory();
        // Edit row 1 at t0
        h = recordGridEdit(h, state0, state1, 1000);
        expect(h.past.length).toBe(1);

        // Edit row 2 at t0 + 300ms (distinct row, human typing interval)
        const row2State: PendingChangesMap = {
            ...state1,
            '{"id":2}': {pkOriginalValue: {id: 2}, changes: {role: 'admin'}},
        };
        h = recordGridEdit(h, state1, row2State, 1300);
        // Must NOT coalesce because it's a different row and elapsed > 150ms
        expect(h.past.length).toBe(2);

        // First undo reverts only row 2 edit
        const step1 = undoGridEdit(h, row2State);
        expect(step1?.pendingChanges).toEqual(state1);

        // Second undo reverts row 1 edit
        const step2 = undoGridEdit(step1!.history, step1!.pendingChanges);
        expect(step2?.pendingChanges).toBeUndefined();
    });

    it('supports multi-step undo and redo', () => {
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

    it('invalidates redo branch when a new edit occurs', () => {
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
                changes: {name: 'Zack'},
            },
        };
        const nextHistory = recordGridEdit(step!.history, state1, brandNewState, 4000);

        // Redo branch must be cleared
        expect(canRedoGrid(nextHistory)).toBe(false);
        expect(nextHistory.future).toEqual([]);
    });

    it('restores state when reverting back to original value', () => {
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

    it('enforces history limit', () => {
        let h = createGridHistory();
        for (let i = 0; i < GRID_HISTORY_LIMIT + 10; i++) {
            const prev: PendingChangesMap = {
                [pkKey1]: {pkOriginalValue: row1, changes: {step: i}},
            };
            const next: PendingChangesMap = {
                [pkKey1]: {pkOriginalValue: row1, changes: {step: i + 1}},
            };
            h = recordGridEdit(h, prev, next, 1000 + i * 1000);
        }
        expect(h.past.length).toBe(GRID_HISTORY_LIMIT);
    });

    it('deep clones pending change snapshots to prevent reference mutation', () => {
        const original: PendingChangesMap = {
            [pkKey1]: {pkOriginalValue: row1, changes: {name: 'Original'}},
        };
        const cloned = clonePendingChanges(original);
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
        expect(cloned![pkKey1].changes).not.toBe(original[pkKey1].changes);
    });

    describe('Milestone 2: row insertions, deletions, and composite snapshots', () => {
        const del1 = {[pkKey1]: row1};
        const ins1 = {
            temp_1: {
                tempId: 'temp_1',
                displayIndex: 5,
                data: {name: 'New User', age: 22},
            },
        };

        it('records row deletion transition and restores it on undo', () => {
            let h = createGridHistory();
            h = recordGridEdit(
                h,
                {pendingChanges: undefined, pendingDeletions: undefined},
                {pendingChanges: undefined, pendingDeletions: del1},
                1000,
            );

            expect(canUndoGrid(h)).toBe(true);
            const step = undoGridEdit(h, {pendingDeletions: del1});
            expect(step).not.toBeNull();
            expect(step!.pendingDeletions).toBeUndefined();

            const redo = redoGridEdit(step!.history, {
                pendingDeletions: step!.pendingDeletions,
            });
            expect(redo).not.toBeNull();
            expect(redo!.pendingDeletions).toEqual(del1);
        });

        it('records row insertion transition and restores it on undo/redo', () => {
            let h = createGridHistory();
            h = recordGridEdit(h, {pendingInsertions: undefined}, {pendingInsertions: ins1}, 1000);

            expect(canUndoGrid(h)).toBe(true);
            const step = undoGridEdit(h, {pendingInsertions: ins1});
            expect(step).not.toBeNull();
            expect(step!.pendingInsertions).toBeUndefined();

            const redo = redoGridEdit(step!.history, {
                pendingInsertions: step!.pendingInsertions,
            });
            expect(redo).not.toBeNull();
            expect(redo!.pendingInsertions).toEqual(ins1);
        });

        it('records cell edit inside pending insertion and restores previous insertion data', () => {
            let h = createGridHistory();
            const ins2 = {
                temp_1: {
                    tempId: 'temp_1',
                    displayIndex: 5,
                    data: {name: 'Edited Name', age: 22},
                },
            };

            h = recordGridEdit(h, {pendingInsertions: ins1}, {pendingInsertions: ins2}, 1000);

            const step = undoGridEdit(h, {pendingInsertions: ins2});
            expect(step).not.toBeNull();
            expect(step!.pendingInsertions).toEqual(ins1);
        });

        it('supports composite interleaved operations: edit -> insert -> delete', () => {
            let h = createGridHistory();
            // Step 1: Cell edit
            const snap1 = {pendingChanges: state1};
            h = recordGridEdit(h, undefined, snap1, 1000);

            // Step 2: Add row
            const snap2 = {pendingChanges: state1, pendingInsertions: ins1};
            h = recordGridEdit(h, snap1, snap2, 2000);

            // Step 3: Mark row for deletion
            const snap3 = {
                pendingChanges: state1,
                pendingInsertions: ins1,
                pendingDeletions: del1,
            };
            h = recordGridEdit(h, snap2, snap3, 3000);

            expect(h.past.length).toBe(3);

            // Undo deletion -> snap2
            const u1 = undoGridEdit(h, snap3);
            expect(u1!.pendingDeletions).toBeUndefined();
            expect(u1!.pendingInsertions).toEqual(ins1);
            expect(u1!.pendingChanges).toEqual(state1);

            // Undo insertion -> snap1
            const u2 = undoGridEdit(u1!.history, snap2);
            expect(u2!.pendingInsertions).toBeUndefined();
            expect(u2!.pendingChanges).toEqual(state1);

            // Undo cell edit -> initial empty
            const u3 = undoGridEdit(u2!.history, snap1);
            expect(u3!.pendingChanges).toBeUndefined();
            expect(canUndoGrid(u3!.history)).toBe(false);

            // Redo all the way forward
            const r1 = redoGridEdit(u3!.history, undefined);
            expect(r1!.pendingChanges).toEqual(state1);
            const r2 = redoGridEdit(r1!.history, snap1);
            expect(r2!.pendingInsertions).toEqual(ins1);
            const r3 = redoGridEdit(r2!.history, snap2);
            expect(r3!.pendingDeletions).toEqual(del1);
            expect(canRedoGrid(r3!.history)).toBe(false);
        });

        it('coalesces multiple queued batch mutations into a single history entry without phantom steps', () => {
            const isBatchingRef = {current: false};
            let beforeSnapshot: GridPendingSnapshot | null = null;
            let history = createGridHistory();
            let state: GridPendingSnapshot = {
                pendingChanges: undefined,
                pendingDeletions: undefined,
                pendingInsertions: undefined,
            };

            // Simulating React deferred state updater queue
            type Updater = (prev: GridPendingSnapshot) => GridPendingSnapshot;
            const updaterQueue: Updater[] = [];

            const dispatchCellEdit = (colName: string, val: unknown) => {
                // Capture batch flag at call time before dispatching/queuing
                const isBatching = isBatchingRef.current;
                updaterQueue.push((prev) => {
                    const newChanges = {
                        ...(prev.pendingChanges || {}),
                        [pkKey1]: {
                            pkOriginalValue: row1,
                            changes: {
                                ...(prev.pendingChanges?.[pkKey1]?.changes || {}),
                                [colName]: val,
                            },
                        },
                    };
                    const nextSnap: GridPendingSnapshot = {
                        ...prev,
                        pendingChanges: newChanges,
                    };
                    if (!isBatching) {
                        history = recordGridEdit(history, prev, nextSnap, Date.now());
                    }
                    return nextSnap;
                });
            };

            // 1. Begin batch
            isBatchingRef.current = true;
            beforeSnapshot = cloneGridSnapshot(state) || {};

            // 2. Dispatch multiple edits in quick succession (e.g. multi-cell paste)
            dispatchCellEdit('name', 'Alice');
            dispatchCellEdit('age', 30);
            dispatchCellEdit('city', 'London');

            // 3. Batch ends synchronously before React renders/processes queued updaters
            isBatchingRef.current = false;

            // 4. React drains queued updaters
            while (updaterQueue.length > 0) {
                const updater = updaterQueue.shift()!;
                state = updater(state);
            }

            // 5. Batch completion records single diff from beforeSnapshot to final state
            history = recordGridEdit(history, beforeSnapshot, state, Date.now(), {coalesce: false});

            // Verify exactly 1 history entry was pushed; no intermediate phantom steps
            expect(history.past.length).toBe(1);
            expect(canUndoGrid(history)).toBe(true);

            // Undo restores the initial clean state
            const undone = undoGridEdit(history, state);
            expect(undone).not.toBeNull();
            expect(undone!.pendingChanges).toBeUndefined();
            expect(canUndoGrid(undone!.history)).toBe(false);
        });
    });
});
