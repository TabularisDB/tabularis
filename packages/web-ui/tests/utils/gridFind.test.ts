import {describe, expect, it} from 'vitest';
import {USE_DEFAULT_SENTINEL} from '@/utils/dataGrid';
import {
    buildGridFindIndex,
    compareCellPositions,
    findMatchIndexFrom,
    getFindCellText,
    getFindMatchState,
    getFindRowTexts,
    getRevealScrollDelta,
    groupMatchesByRow,
    searchGridFindIndex,
    stepMatchIndex,
    type GridCellPosition,
} from '@/utils/gridFind';

const at = (rowIndex: number, colIndex: number): GridCellPosition => ({rowIndex, colIndex});

const search = (rows: (string | null)[][], query: string, caseSensitive = false) =>
    searchGridFindIndex(
        buildGridFindIndex(rows.length, (rowIndex) => rows[rowIndex], caseSensitive),
        query,
    );

describe('gridFind', () => {
    describe('getFindCellText', () => {
        it('never matches NULL or the DEFAULT placeholder', () => {
            expect(getFindCellText(null)).toBeNull();
            expect(getFindCellText(undefined)).toBeNull();
            expect(getFindCellText(USE_DEFAULT_SENTINEL)).toBeNull();
        });

        it('uses the text the grid shows', () => {
            expect(getFindCellText(42)).toBe('42');
            expect(getFindCellText(false)).toBe('false');
            expect(getFindCellText('')).toBe('');
            expect(getFindCellText({status: 'REFUND'})).toBe('{"status":"REFUND"}');
            expect(getFindCellText({a: 1}, 'jsonb')).toBe('{"a":1}');
        });
    });

    describe('getFindRowTexts', () => {
        const columns = ['id', 'status', 'note'];

        it('returns one text per column', () => {
            expect(getFindRowTexts([1, 'paid', null], columns)).toEqual(['1', 'paid', null]);
        });

        it('prefers pending edits over the loaded values', () => {
            expect(
                getFindRowTexts([1, 'paid', 'x'], columns, {pending: {status: 'refunded'}}),
            ).toEqual(['1', 'refunded', 'x']);
        });

        it('keeps the loaded value when a pending edit is undefined', () => {
            expect(
                getFindRowTexts([1, 'paid', 'x'], columns, {pending: {status: undefined}}),
            ).toEqual(['1', 'paid', 'x']);
        });

        it('skips excluded cells such as masked ones', () => {
            expect(
                getFindRowTexts([1, 'secret', 'x'], columns, {
                    isExcluded: (colIndex) => colIndex === 1,
                }),
            ).toEqual(['1', null, 'x']);
        });

        it('formats by column type', () => {
            const columnTypes = new Map([['note', 'json']]);
            expect(getFindRowTexts([1, 'a', {k: 'v'}], columns, {columnTypes})).toEqual([
                '1',
                'a',
                '{"k":"v"}',
            ]);
        });
    });

    describe('searchGridFindIndex', () => {
        const rows = [
            ['1', 'REFUND requested', null],
            ['2', 'paid', 'refund'],
            ['3', 'Refunded', 'ok'],
        ];

        it('matches case-insensitively by default, in reading order', () => {
            expect(search(rows, 'refund')).toEqual([at(0, 1), at(1, 2), at(2, 1)]);
        });

        it('matches case-sensitively on request', () => {
            expect(search(rows, 'Refund', true)).toEqual([at(2, 1)]);
            expect(search(rows, 'REFUND', true)).toEqual([at(0, 1)]);
        });

        it('matches nothing for an empty query', () => {
            expect(search(rows, '')).toEqual([]);
        });

        it('never matches cells without text', () => {
            expect(search([[null, null]], 'null')).toEqual([]);
        });

        it('keeps whitespace in the query significant', () => {
            expect(search(rows, ' requested')).toEqual([at(0, 1)]);
            expect(search(rows, 'paid ')).toEqual([]);
        });

        it('returns no matches when nothing contains the query', () => {
            expect(search(rows, 'chargeback')).toEqual([]);
        });

        it('builds the index from the row callback once per row', () => {
            const calls: number[] = [];
            buildGridFindIndex(
                3,
                (rowIndex) => {
                    calls.push(rowIndex);
                    return [];
                },
                false,
            );
            expect(calls).toEqual([0, 1, 2]);
        });
    });

    describe('compareCellPositions', () => {
        it('orders by row, then by column', () => {
            expect(compareCellPositions(at(0, 5), at(1, 0))).toBeLessThan(0);
            expect(compareCellPositions(at(2, 1), at(2, 3))).toBeLessThan(0);
            expect(compareCellPositions(at(2, 3), at(2, 3))).toBe(0);
            expect(compareCellPositions(at(3, 0), at(2, 9))).toBeGreaterThan(0);
        });
    });

    describe('findMatchIndexFrom', () => {
        const matches = [at(0, 1), at(2, 0), at(2, 3), at(5, 2)];

        it('returns -1 without matches', () => {
            expect(findMatchIndexFrom([], at(0, 0))).toBe(-1);
            expect(findMatchIndexFrom([], null)).toBe(-1);
        });

        it('starts at the first match without a position', () => {
            expect(findMatchIndexFrom(matches, null)).toBe(0);
        });

        it('stays on a position that matches', () => {
            expect(findMatchIndexFrom(matches, at(2, 3))).toBe(2);
        });

        it('moves to the next match after a position that does not match', () => {
            expect(findMatchIndexFrom(matches, at(2, 1))).toBe(2);
            expect(findMatchIndexFrom(matches, at(1, 9))).toBe(1);
        });

        it('wraps to the first match after the last one', () => {
            expect(findMatchIndexFrom(matches, at(5, 3))).toBe(0);
            expect(findMatchIndexFrom(matches, at(9, 0))).toBe(0);
        });
    });

    describe('stepMatchIndex', () => {
        it('moves forward and backward', () => {
            expect(stepMatchIndex(1, 4, 1)).toBe(2);
            expect(stepMatchIndex(1, 4, -1)).toBe(0);
        });

        it('wraps around at both ends', () => {
            expect(stepMatchIndex(3, 4, 1)).toBe(0);
            expect(stepMatchIndex(0, 4, -1)).toBe(3);
        });

        it('stays on a single match', () => {
            expect(stepMatchIndex(0, 1, 1)).toBe(0);
            expect(stepMatchIndex(0, 1, -1)).toBe(0);
        });

        it('enters at the first or the last match without a current one', () => {
            expect(stepMatchIndex(-1, 4, 1)).toBe(0);
            expect(stepMatchIndex(-1, 4, -1)).toBe(3);
        });

        it('returns -1 without matches', () => {
            expect(stepMatchIndex(-1, 0, 1)).toBe(-1);
        });
    });

    describe('groupMatchesByRow', () => {
        it('groups matched columns by row', () => {
            const byRow = groupMatchesByRow([at(0, 1), at(0, 3), at(4, 0)]);
            expect([...byRow.keys()]).toEqual([0, 4]);
            expect([...byRow.get(0)!]).toEqual([1, 3]);
            expect([...byRow.get(4)!]).toEqual([0]);
            expect(byRow.has(1)).toBe(false);
        });

        it('is empty without matches', () => {
            expect(groupMatchesByRow([]).size).toBe(0);
        });
    });

    describe('getFindMatchState', () => {
        const matched = new Set([1, 3]);

        it('marks the current match', () => {
            expect(getFindMatchState(3, matched, 3)).toBe('current');
        });

        it('marks the other matches', () => {
            expect(getFindMatchState(1, matched, 3)).toBe('match');
            expect(getFindMatchState(1, matched, null)).toBe('match');
        });

        it('leaves other cells alone', () => {
            expect(getFindMatchState(2, matched, 3)).toBeUndefined();
            expect(getFindMatchState(0, null, null)).toBeUndefined();
        });
    });

    describe('getRevealScrollDelta', () => {
        it('does not scroll when the span is fully visible', () => {
            expect(getRevealScrollDelta(100, 135, 50, 400)).toBe(0);
            expect(getRevealScrollDelta(50, 400, 50, 400)).toBe(0);
        });

        it('centres a span above or before the view', () => {
            // Span centre 25, view centre 225.
            expect(getRevealScrollDelta(10, 40, 50, 400)).toBe(-200);
        });

        it('centres a span below or after the view', () => {
            // Span centre 917.5, view centre 225.
            expect(getRevealScrollDelta(900, 935, 50, 400)).toBe(693);
        });

        it('centres a partly visible span', () => {
            expect(getRevealScrollDelta(380, 420, 50, 400)).toBe(175);
        });

        it('aligns the start of a span larger than the view', () => {
            expect(getRevealScrollDelta(600, 1200, 50, 400)).toBe(550);
        });
    });
});
