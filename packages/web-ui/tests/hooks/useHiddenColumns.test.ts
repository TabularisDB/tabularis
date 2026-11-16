import {describe, it, expect, beforeEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {forgetHiddenColumns, resetHiddenColumns, useHiddenColumns} from '@/hooks/useHiddenColumns';
import {NO_HIDDEN_COLUMNS} from '@/utils/hiddenColumns';

const columns = ['id', 'name', 'created_at'];

describe('useHiddenColumns', () => {
    beforeEach(() => {
        resetHiddenColumns();
    });

    it('starts with nothing hidden', () => {
        const {result} = renderHook(() => useHiddenColumns('tab-1', columns));
        expect(result.current.hidden).toBe(NO_HIDDEN_COLUMNS);
    });

    it('stores the hidden columns per key', () => {
        const {result} = renderHook(() => ({
            a: useHiddenColumns('tab-a', columns),
            b: useHiddenColumns('tab-b', columns),
        }));
        act(() => result.current.a.setHidden(new Set([2])));
        expect([...result.current.a.hidden]).toEqual([2]);
        expect(result.current.b.hidden.size).toBe(0);
    });

    it('keeps them when the grid remounts with the same columns', () => {
        const first = renderHook(() => useHiddenColumns('tab-1', columns));
        act(() => first.result.current.setHidden(new Set([1])));
        first.unmount();

        // A refresh or re-run hands over a new array with the same names.
        const second = renderHook(() => useHiddenColumns('tab-1', [...columns]));
        expect([...second.result.current.hidden]).toEqual([1]);
    });

    it('shows every column of a result with other columns', () => {
        const {result, rerender} = renderHook(({cols}) => useHiddenColumns('tab-1', cols), {
            initialProps: {cols: columns},
        });
        act(() => result.current.setHidden(new Set([1])));

        rerender({cols: ['id', 'email']});
        expect(result.current.hidden.size).toBe(0);
    });

    it('shares the state between consumers of the same key', () => {
        const {result} = renderHook(() => ({
            grid: useHiddenColumns('tab-1-result-0', columns),
            header: useHiddenColumns('tab-1-result-0', columns),
        }));
        act(() => result.current.grid.setHidden(new Set([0])));
        expect([...result.current.header.hidden]).toEqual([0]);
    });

    it('clears the state with an empty set', () => {
        const {result} = renderHook(() => useHiddenColumns('tab-1', columns));
        act(() => result.current.setHidden(new Set([1])));
        act(() => result.current.setHidden(NO_HIDDEN_COLUMNS));
        expect(result.current.hidden.size).toBe(0);
    });

    it('ignores writes without a key', () => {
        const {result} = renderHook(() => useHiddenColumns(null, columns));
        act(() => result.current.setHidden(new Set([1])));
        expect(result.current.hidden).toBe(NO_HIDDEN_COLUMNS);
    });

    it('forgets the columns of closed tabs and their result entries', () => {
        const {result} = renderHook(() => ({
            tab: useHiddenColumns('tab-1', columns),
            entry: useHiddenColumns('tab-1-result-0', columns),
            other: useHiddenColumns('tab-2', columns),
        }));
        act(() => {
            result.current.tab.setHidden(new Set([0]));
            result.current.entry.setHidden(new Set([1]));
            result.current.other.setHidden(new Set([2]));
        });

        act(() => forgetHiddenColumns(['tab-1']));
        expect(result.current.tab.hidden.size).toBe(0);
        expect(result.current.entry.hidden.size).toBe(0);
        expect([...result.current.other.hidden]).toEqual([2]);
    });
});
