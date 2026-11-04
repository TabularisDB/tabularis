import {renderHook, act} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';
import {useExplorerPins} from '@/hooks/useExplorerPins';
import {UI_STATE_KEYS, uiStateStore} from '@/utils/uiStateStore';

const table = {kind: 'table' as const, name: 'orders'};

describe('useExplorerPins', () => {
    beforeEach(() => {
        localStorage.clear();
        uiStateStore.reset();
    });

    it('pins and unpins through the shared UI state', () => {
        const {result} = renderHook(() => useExplorerPins('conn'));
        expect(result.current.isPinned(table, 'shop', 'public')).toBe(false);

        act(() => result.current.togglePin(table, 'shop', 'public'));
        expect(result.current.isPinned(table, 'shop', 'public')).toBe(true);
        expect(result.current.pinsFor('shop', 'public')).toEqual([table]);
        expect(uiStateStore.get(UI_STATE_KEYS.explorerPins.key, null)).toEqual({
            conn: {'["shop","public"]': [table]},
        });

        act(() => result.current.togglePin(table, 'shop', 'public'));
        expect(result.current.isPinned(table, 'shop', 'public')).toBe(false);
        expect(uiStateStore.get(UI_STATE_KEYS.explorerPins.key, null)).toEqual({});
    });

    it('keeps pins of other schemas and connections separate', () => {
        const conn = renderHook(() => useExplorerPins('conn'));
        const other = renderHook(() => useExplorerPins('other'));
        act(() => conn.result.current.togglePin(table, 'shop', 'public'));

        expect(conn.result.current.pinsFor('shop', 'sales')).toEqual([]);
        expect(conn.result.current.pinsFor(undefined, 'public')).toEqual([]);
        expect(other.result.current.pinsFor('shop', 'public')).toEqual([]);
    });

    it('does nothing without a connection', () => {
        const {result} = renderHook(() => useExplorerPins(null));
        act(() => result.current.togglePin(table));
        expect(result.current.pinsFor()).toEqual([]);
        expect(uiStateStore.get(UI_STATE_KEYS.explorerPins.key, null)).toBeNull();
    });

    it('ignores a malformed stored value instead of throwing', () => {
        uiStateStore.set(UI_STATE_KEYS.explorerPins.key, {conn: 'broken'});
        const {result} = renderHook(() => useExplorerPins('conn'));
        expect(result.current.pinsFor('shop', 'public')).toEqual([]);
    });
});
