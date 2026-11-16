import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {useExplorerExpanded} from '@/hooks/useExplorerExpanded';
import {expansionKey} from '@/utils/explorerExpansion';
import {UI_STATE_KEYS, uiStateStore} from '@/utils/uiStateStore';

const STORE_KEY = UI_STATE_KEYS.explorerExpanded.key;
const ordersKey = expansionKey('conn', ['table', 'shop', 'public', 'orders']);

const saved = () => uiStateStore.get<unknown>(STORE_KEY, undefined);

describe('useExplorerExpanded', () => {
    it('starts with the default when nothing is saved', () => {
        const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));
        expect(result.current.isExpanded).toBe(false);
    });

    it('saves a user toggle and removes the entry when collapsed again', () => {
        const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));

        act(() => result.current.setExpanded(true));
        expect(result.current.isExpanded).toBe(true);
        expect(saved()).toEqual({[ordersKey]: true});

        act(() => result.current.setExpanded(false));
        expect(result.current.isExpanded).toBe(false);
        expect(saved()).toEqual({});
    });

    it('restores the saved state on the next mount', () => {
        const first = renderHook(() => useExplorerExpanded(ordersKey, false));
        act(() => first.result.current.setExpanded(true));
        first.unmount();

        const second = renderHook(() => useExplorerExpanded(ordersKey, false));
        expect(second.result.current.isExpanded).toBe(true);
    });

    it('applies a saved state that arrives after mount', () => {
        const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));
        expect(result.current.isExpanded).toBe(false);

        act(() => uiStateStore.set(STORE_KEY, {[ordersKey]: true}));
        expect(result.current.isExpanded).toBe(true);
    });

    it('does not apply the state of another connection or node', () => {
        uiStateStore.set(STORE_KEY, {
            [expansionKey('other', ['table', 'shop', 'public', 'orders'])]: true,
            [expansionKey('conn', ['table', 'shop', 'sales', 'orders'])]: true,
            [expansionKey('conn', ['view', 'shop', 'public', 'orders'])]: true,
        });

        const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));
        expect(result.current.isExpanded).toBe(false);
    });

    it('keeps other entries when toggling one node', () => {
        const otherKey = expansionKey('other', ['db', 'shop']);
        uiStateStore.set(STORE_KEY, {[otherKey]: true});

        const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));
        act(() => result.current.setExpanded(true));

        expect(saved()).toEqual({[otherKey]: true, [ordersKey]: true});
    });

    it('ignores a broken saved value', () => {
        uiStateStore.set(STORE_KEY, {[ordersKey]: 'yes'});
        const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));
        expect(result.current.isExpanded).toBe(false);

        act(() => result.current.setExpanded(true));
        expect(saved()).toEqual({[ordersKey]: true});
    });

    describe('session-only expansion', () => {
        it('opens a node with reveal without saving it', () => {
            const {result} = renderHook(() => useExplorerExpanded(ordersKey, false));

            act(() => result.current.reveal());
            expect(result.current.isExpanded).toBe(true);
            expect(saved()).toBeUndefined();
        });

        it('opens an initially revealed node without saving it', () => {
            const {result} = renderHook(() =>
                useExplorerExpanded(ordersKey, false, {revealed: true}),
            );
            expect(result.current.isExpanded).toBe(true);
            expect(saved()).toBeUndefined();
        });

        it('lets a revealed node win over a saved collapsed state', () => {
            uiStateStore.set(STORE_KEY, {[ordersKey]: false});
            const {result} = renderHook(() =>
                useExplorerExpanded(ordersKey, false, {revealed: true}),
            );
            expect(result.current.isExpanded).toBe(true);
        });

        it('saves the user toggle that follows a reveal', () => {
            const {result} = renderHook(() =>
                useExplorerExpanded(ordersKey, false, {revealed: true}),
            );

            // Collapsing matches the default, so nothing is saved for the node.
            act(() => result.current.setExpanded(false));
            expect(result.current.isExpanded).toBe(false);
            expect(saved() ?? {}).toEqual({});

            act(() => result.current.setExpanded(true));
            expect(saved()).toEqual({[ordersKey]: true});
        });
    });

    it('keeps the state in memory only without a key', () => {
        const {result} = renderHook(() => useExplorerExpanded(null, false));

        act(() => result.current.setExpanded(true));
        expect(result.current.isExpanded).toBe(true);
        expect(saved()).toBeUndefined();
    });
});
