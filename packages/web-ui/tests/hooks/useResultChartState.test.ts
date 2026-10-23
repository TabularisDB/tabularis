import {describe, it, expect, beforeEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {
    forgetResultChartStates,
    resetResultChartStates,
    useResultChartState,
} from '@/hooks/useResultChartState';
import type {CellChartConfig} from '@/types/notebook';

const config: CellChartConfig = {
    type: 'line',
    labelColumn: 'month',
    valueColumns: ['revenue'],
};

describe('useResultChartState', () => {
    beforeEach(() => {
        resetResultChartStates();
    });

    it('starts on the grid with no config', () => {
        const {result} = renderHook(() => useResultChartState('tab-1'));
        expect(result.current.view).toBe('grid');
        expect(result.current.config).toBeNull();
    });

    it('stores view and config per key', () => {
        const {result} = renderHook(() => ({
            a: useResultChartState('tab-a'),
            b: useResultChartState('tab-b'),
        }));
        act(() => {
            result.current.a.setView('chart');
            result.current.a.setConfig(config);
        });
        expect(result.current.a.view).toBe('chart');
        expect(result.current.a.config).toEqual(config);
        expect(result.current.b.view).toBe('grid');
        expect(result.current.b.config).toBeNull();
    });

    it('keeps the state when the consumer remounts', () => {
        const first = renderHook(() => useResultChartState('entry-1'));
        act(() => first.result.current.setView('chart'));
        first.unmount();

        const second = renderHook(() => useResultChartState('entry-1'));
        expect(second.result.current.view).toBe('chart');
    });

    it('reads as the grid and ignores writes for a null key', () => {
        const {result} = renderHook(() => useResultChartState(null));
        act(() => result.current.setView('chart'));
        expect(result.current.view).toBe('grid');
    });

    it('forgets the states of closed tabs and their result entries', () => {
        const {result} = renderHook(() => ({
            tab: useResultChartState('tab-1'),
            entry: useResultChartState('tab-1-result-0'),
            other: useResultChartState('tab-10'),
            otherEntry: useResultChartState('tab-10-result-0'),
        }));
        act(() => {
            result.current.tab.setView('chart');
            result.current.entry.setView('chart');
            result.current.other.setView('chart');
            result.current.otherEntry.setView('chart');
        });

        act(() => forgetResultChartStates(['tab-1']));
        expect(result.current.tab.view).toBe('grid');
        expect(result.current.entry.view).toBe('grid');
        expect(result.current.other.view).toBe('chart');
        expect(result.current.otherEntry.view).toBe('chart');
    });
});
