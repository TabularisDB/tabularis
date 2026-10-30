import {describe, expect, it} from 'vitest';
import {getBulkClosedTabIds, keepPinnedTabsFirst, setTabPinned} from '@/utils/tabPins';
import type {Tab} from '@/types/editor';

function makeTab(id: string, connectionId = 'c1', pinned = false): Tab {
    return {
        id,
        title: id,
        type: 'console',
        query: '',
        result: null,
        error: '',
        executionTime: null,
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId,
        ...(pinned ? {pinned} : {}),
    };
}

const ids = (tabs: Tab[]) => tabs.map((tab) => tab.id);

describe('tabPins', () => {
    describe('getBulkClosedTabIds', () => {
        // p1 and p2 are pinned, so they come first like in the tab bar.
        const tabs = [
            makeTab('p1', 'c1', true),
            makeTab('p2', 'c1', true),
            makeTab('a'),
            makeTab('b'),
            makeTab('c'),
        ];

        it('never closes pinned tabs', () => {
            expect(getBulkClosedTabIds(tabs, 'all')).toEqual(['a', 'b', 'c']);
            expect(getBulkClosedTabIds(tabs, 'others', 'b')).toEqual(['a', 'c']);
            expect(getBulkClosedTabIds(tabs, 'left', 'b')).toEqual(['a']);
            expect(getBulkClosedTabIds(tabs, 'right', 'p1')).toEqual(['a', 'b', 'c']);
        });

        it('closes the unpinned tabs around a pinned target of Close other tabs', () => {
            expect(getBulkClosedTabIds(tabs, 'others', 'p2')).toEqual(['a', 'b', 'c']);
        });

        it('closes nothing to the left of the first unpinned tab', () => {
            expect(getBulkClosedTabIds(tabs, 'left', 'a')).toEqual([]);
        });

        it('closes nothing for an unknown target, except with Close other tabs', () => {
            expect(getBulkClosedTabIds(tabs, 'left', 'missing')).toEqual([]);
            expect(getBulkClosedTabIds(tabs, 'right', 'missing')).toEqual([]);
            expect(getBulkClosedTabIds(tabs, 'others', 'missing')).toEqual(['a', 'b', 'c']);
        });
    });

    describe('keepPinnedTabsFirst', () => {
        it("moves a connection's pinned tabs first, keeping the order inside each group", () => {
            const tabs = [
                makeTab('a'),
                makeTab('x', 'c2'),
                makeTab('p1', 'c1', true),
                makeTab('b'),
                makeTab('p2', 'c1', true),
            ];
            expect(ids(keepPinnedTabsFirst(tabs, 'c1'))).toEqual(['p1', 'x', 'p2', 'a', 'b']);
        });

        it("leaves other connections' tabs alone", () => {
            const tabs = [makeTab('a', 'c2'), makeTab('p', 'c2', true), makeTab('b')];
            expect(ids(keepPinnedTabsFirst(tabs, 'c1'))).toEqual(['a', 'p', 'b']);
        });

        it('returns the same array when the order already holds', () => {
            const tabs = [makeTab('p', 'c1', true), makeTab('a'), makeTab('b')];
            expect(keepPinnedTabsFirst(tabs, 'c1')).toBe(tabs);
        });
    });

    describe('setTabPinned', () => {
        const tabs = [makeTab('p1', 'c1', true), makeTab('a'), makeTab('x', 'c2'), makeTab('b')];

        it('moves a newly pinned tab after the other pinned tabs', () => {
            const next = setTabPinned(tabs, 'b', true);
            expect(ids(next)).toEqual(['p1', 'b', 'x', 'a']);
            expect(next[1].pinned).toBe(true);
            expect(tabs[3].pinned).toBeUndefined();
        });

        it('moves an unpinned tab before the other unpinned tabs', () => {
            const next = setTabPinned(setTabPinned(tabs, 'b', true), 'p1', false);
            expect(ids(next)).toEqual(['b', 'p1', 'x', 'a']);
            expect(next[1].pinned).toBe(false);
        });

        it('returns the same array for an unknown tab or an unchanged state', () => {
            expect(setTabPinned(tabs, 'missing', true)).toBe(tabs);
            expect(setTabPinned(tabs, 'p1', true)).toBe(tabs);
            expect(setTabPinned(tabs, 'a', false)).toBe(tabs);
        });
    });
});
