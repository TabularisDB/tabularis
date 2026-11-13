import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {useGridFind} from '@/hooks/useGridFind';
import type {GridCellPosition} from '@/utils/gridFind';

type Rows = (string | null)[][];

const at = (rowIndex: number, colIndex: number): GridCellPosition => ({rowIndex, colIndex});

const ORDERS: Rows = [
    ['1', 'REFUND requested'],
    ['2', 'paid'],
    ['3', 'refund'],
    ['4', 'Refunded'],
];

function renderGridFind(rows: Rows) {
    // An empty scroll container: no row is mounted, so every reveal goes
    // through the virtualizer.
    const scrollElementRef = {current: document.createElement('div')};
    const scrollToRow = vi.fn();
    const props = (next: Rows) => ({
        rowCount: next.length,
        getRowTexts: (rowIndex: number) => next[rowIndex],
    });
    const hook = renderHook(
        ({rowCount, getRowTexts}) =>
            useGridFind({rowCount, getRowTexts, scrollElementRef, scrollToRow}),
        {initialProps: props(rows)},
    );
    return {...hook, scrollToRow, refresh: (next: Rows) => hook.rerender(props(next))};
}

describe('useGridFind', () => {
    it('starts closed without matches', () => {
        const {result} = renderGridFind(ORDERS);
        expect(result.current.isOpen).toBe(false);
        expect(result.current.matchCount).toBe(0);
        expect(result.current.currentMatch).toBeNull();
    });

    it('finds matches while typing and reveals the first one', () => {
        const {result, scrollToRow} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('refund'));

        expect(result.current.matchCount).toBe(3);
        expect(result.current.currentIndex).toBe(0);
        expect(result.current.currentMatch).toEqual(at(0, 1));
        expect(scrollToRow).toHaveBeenLastCalledWith(0);
    });

    it('searches from the cell focused when the bar opened', () => {
        const {result, scrollToRow} = renderGridFind(ORDERS);
        act(() => result.current.open(at(1, 0)));
        act(() => result.current.setQuery('refund'));

        expect(result.current.currentMatch).toEqual(at(2, 1));
        expect(result.current.currentIndex).toBe(1);
        expect(scrollToRow).toHaveBeenLastCalledWith(2);
    });

    it('keeps refining from the same cell while typing', () => {
        const {result} = renderGridFind(ORDERS);
        act(() => result.current.open(at(1, 0)));
        act(() => result.current.setQuery('r'));
        expect(result.current.currentMatch).toEqual(at(2, 1));
        act(() => result.current.setQuery('refunded'));
        expect(result.current.currentMatch).toEqual(at(3, 1));
    });

    it('moves between matches and wraps around', () => {
        const {result, scrollToRow} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('refund'));

        act(() => result.current.goToNext());
        expect(result.current.currentMatch).toEqual(at(2, 1));
        act(() => result.current.goToNext());
        expect(result.current.currentMatch).toEqual(at(3, 1));
        act(() => result.current.goToNext());
        expect(result.current.currentMatch).toEqual(at(0, 1));
        act(() => result.current.goToPrevious());
        expect(result.current.currentMatch).toEqual(at(3, 1));
        expect(scrollToRow).toHaveBeenLastCalledWith(3);
    });

    it('matches case-sensitively when toggled', () => {
        const {result} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('Refund'));
        expect(result.current.matchCount).toBe(3);

        act(() => result.current.toggleCaseSensitive());
        expect(result.current.caseSensitive).toBe(true);
        expect(result.current.matchCount).toBe(1);
        expect(result.current.currentMatch).toEqual(at(3, 1));
    });

    it('reports no current match when nothing matches', () => {
        const {result, scrollToRow} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        scrollToRow.mockClear();
        act(() => result.current.setQuery('chargeback'));

        expect(result.current.matchCount).toBe(0);
        expect(result.current.currentIndex).toBe(-1);
        expect(result.current.currentMatch).toBeNull();
        expect(scrollToRow).not.toHaveBeenCalled();
        // Moving without matches is a no-op.
        act(() => result.current.goToNext());
        expect(result.current.currentMatch).toBeNull();
    });

    it('follows a refreshed result without scrolling the grid', () => {
        const {result, scrollToRow, refresh} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('refund'));
        act(() => result.current.goToNext());
        expect(result.current.currentMatch).toEqual(at(2, 1));
        scrollToRow.mockClear();

        // The current cell still matches: it stays current, counts update.
        refresh([...ORDERS, ['5', 'refund pending']]);
        expect(result.current.matchCount).toBe(4);
        expect(result.current.currentMatch).toEqual(at(2, 1));

        // The current cell no longer matches: the next match takes over.
        refresh([ORDERS[0], ORDERS[1], ['3', 'paid'], ORDERS[3]]);
        expect(result.current.matchCount).toBe(2);
        expect(result.current.currentMatch).toEqual(at(3, 1));
        expect(scrollToRow).not.toHaveBeenCalled();
    });

    it('clears the highlight on close and returns the current match', () => {
        const {result} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('refund'));
        act(() => result.current.goToNext());

        let closedOn: GridCellPosition | null = null;
        act(() => {
            closedOn = result.current.close();
        });
        expect(closedOn).toEqual(at(2, 1));
        expect(result.current.isOpen).toBe(false);
        expect(result.current.matchCount).toBe(0);
        expect(result.current.matchesByRow.size).toBe(0);
    });

    it('keeps the last query for the next search', () => {
        const {result} = renderGridFind(ORDERS);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('paid'));
        act(() => {
            result.current.close();
        });
        act(() => result.current.open(null));

        expect(result.current.query).toBe('paid');
        expect(result.current.currentMatch).toEqual(at(1, 1));
    });

    it('groups matches by row for the rendered rows', () => {
        const {result} = renderGridFind([
            ['refund', 'refund'],
            ['paid', 'x'],
        ]);
        act(() => result.current.open(null));
        act(() => result.current.setQuery('refund'));

        expect([...result.current.matchesByRow.get(0)!]).toEqual([0, 1]);
        expect(result.current.matchesByRow.has(1)).toBe(false);
    });

    it('focuses and selects the field when opened again', () => {
        const {result} = renderGridFind(ORDERS);
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.value = 'refund';
        result.current.inputRef.current = input;
        act(() => result.current.open(null));
        input.blur();

        act(() => result.current.open(at(3, 0)));
        expect(input).toHaveFocus();
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe('refund'.length);
        input.remove();
    });
});
