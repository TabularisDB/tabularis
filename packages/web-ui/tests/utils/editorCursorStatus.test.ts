import {describe, it, expect} from 'vitest';
import {
    getEditorCursorStatus,
    isSameEditorCursorStatus,
    type EditorPositionLike,
    type EditorSelectionLike,
} from '@/utils/editorCursorStatus';

/** A model over `text` that converts positions to UTF-16 offsets like Monaco. */
function modelOf(text: string) {
    const lines = text.split('\n');
    return {
        getOffsetAt: ({lineNumber, column}: EditorPositionLike) => {
            let offset = 0;
            for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1;
            return offset + column - 1;
        },
    };
}

function selection(start: EditorPositionLike, end: EditorPositionLike): EditorSelectionLike {
    return {
        isEmpty: () => start.lineNumber === end.lineNumber && start.column === end.column,
        getStartPosition: () => start,
        getEndPosition: () => end,
    };
}

const at = (lineNumber: number, column: number): EditorPositionLike => ({lineNumber, column});

describe('editorCursorStatus', () => {
    describe('getEditorCursorStatus', () => {
        it('is null without a cursor position', () => {
            expect(getEditorCursorStatus(modelOf('SELECT 1'), [], null)).toBeNull();
            expect(getEditorCursorStatus(null, null, undefined)).toBeNull();
        });

        it('reports the one-based primary cursor position with nothing selected', () => {
            expect(getEditorCursorStatus(modelOf('SELECT 1'), [], at(1, 1))).toEqual({
                line: 1,
                column: 1,
                selectionCount: 0,
                selectedLength: 0,
            });
            const cursor = selection(at(2, 4), at(2, 4));
            expect(getEditorCursorStatus(modelOf('a\nbcd'), [cursor], at(2, 4))).toEqual({
                line: 2,
                column: 4,
                selectionCount: 0,
                selectedLength: 0,
            });
        });

        it('measures a multiline selection in UTF-16 code units from model offsets', () => {
            const text = "SELECT 1;\nSELECT '😀';";
            // Through the newline and the emoji, which is two code units, not four bytes.
            const status = getEditorCursorStatus(
                modelOf(text),
                [selection(at(1, 8), at(2, 11))],
                at(2, 11),
            );
            expect(status).toEqual({line: 2, column: 11, selectionCount: 1, selectedLength: 13});
        });

        it('sums several selections and ignores empty ones', () => {
            const text = 'SELECT a, b FROM t';
            const status = getEditorCursorStatus(
                modelOf(text),
                [
                    selection(at(1, 8), at(1, 9)),
                    selection(at(1, 11), at(1, 12)),
                    selection(at(1, 14), at(1, 14)),
                    selection(at(1, 18), at(1, 19)),
                ],
                at(1, 19),
            );
            expect(status).toEqual({line: 1, column: 19, selectionCount: 3, selectedLength: 3});
        });

        it('counts selections but measures nothing without a model', () => {
            expect(getEditorCursorStatus(null, [selection(at(1, 1), at(1, 5))], at(1, 5))).toEqual({
                line: 1,
                column: 5,
                selectionCount: 1,
                selectedLength: 0,
            });
        });
    });

    describe('isSameEditorCursorStatus', () => {
        it('compares every field and treats null as its own value', () => {
            const a = {line: 1, column: 2, selectionCount: 0, selectedLength: 0};
            expect(isSameEditorCursorStatus(a, {...a})).toBe(true);
            expect(isSameEditorCursorStatus(a, {...a, column: 3})).toBe(false);
            expect(isSameEditorCursorStatus(a, {...a, selectionCount: 1})).toBe(false);
            expect(isSameEditorCursorStatus(a, {...a, selectedLength: 4})).toBe(false);
            expect(isSameEditorCursorStatus(null, null)).toBe(true);
            expect(isSameEditorCursorStatus(a, null)).toBe(false);
            expect(isSameEditorCursorStatus(null, a)).toBe(false);
        });
    });
});
