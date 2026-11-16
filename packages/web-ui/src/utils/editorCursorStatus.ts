/**
 * What the SQL editor's status indicator shows: where the primary cursor is
 * and how much text is selected.
 */
export interface EditorCursorStatus {
    /** One-based line of the primary cursor, as Monaco numbers lines. */
    line: number;
    /** One-based column of the primary cursor, as Monaco numbers columns. */
    column: number;
    /** Non-empty selections; 0 when nothing is selected. */
    selectionCount: number;
    /**
     * Total selected length in UTF-16 code units, summed over the non-empty
     * selections from Monaco model offsets. Not bytes and not grapheme
     * clusters: an emoji outside the BMP counts as two.
     */
    selectedLength: number;
}

/** The subset of a Monaco `IPosition` the status needs. */
export interface EditorPositionLike {
    lineNumber: number;
    column: number;
}

/** The subset of a Monaco `Selection` the status needs. */
export interface EditorSelectionLike {
    isEmpty(): boolean;
    getStartPosition(): EditorPositionLike;
    getEndPosition(): EditorPositionLike;
}

/** The subset of a Monaco `ITextModel` the status needs. */
export interface EditorModelLike {
    getOffsetAt(position: EditorPositionLike): number;
}

/**
 * Builds the status from the editor's current model, selections and primary
 * cursor position. Returns `null` when there is no cursor (no model attached).
 * Empty selections are plain cursors and do not count; a model is needed to
 * measure the others, so without one every selection measures as 0.
 */
export function getEditorCursorStatus(
    model: EditorModelLike | null | undefined,
    selections: readonly EditorSelectionLike[] | null | undefined,
    position: EditorPositionLike | null | undefined,
): EditorCursorStatus | null {
    if (!position) return null;
    let selectionCount = 0;
    let selectedLength = 0;
    for (const selection of selections ?? []) {
        if (selection.isEmpty()) continue;
        selectionCount += 1;
        if (!model) continue;
        const start = model.getOffsetAt(selection.getStartPosition());
        const end = model.getOffsetAt(selection.getEndPosition());
        selectedLength += Math.max(0, end - start);
    }
    return {line: position.lineNumber, column: position.column, selectionCount, selectedLength};
}

/** True when both statuses would render the same indicator. */
export function isSameEditorCursorStatus(
    a: EditorCursorStatus | null,
    b: EditorCursorStatus | null,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.line === b.line &&
        a.column === b.column &&
        a.selectionCount === b.selectionCount &&
        a.selectedLength === b.selectedLength
    );
}
