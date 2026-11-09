import {describe, expect, it, vi} from 'vitest';

import {createTableTransferCommandStore} from '@/utils/tableTransferCommands';

describe('createTableTransferCommandStore', () => {
    it('should keep the commands of each connection apart', () => {
        const store = createTableTransferCommandStore();
        const first = {exportTable: {run: vi.fn()}};
        const second = {importTable: {run: vi.fn()}};
        store.register('a', first);
        store.register('b', second);

        expect(store.get('a')).toBe(first);
        expect(store.get('b')).toBe(second);
        expect(store.get(null)).toBeUndefined();
        expect(store.get('c')).toBeUndefined();
    });

    it('should let only the current owner clear its entry', () => {
        const store = createTableTransferCommandStore();
        const listener = vi.fn();
        store.subscribe(listener);
        const cleanupOld = store.register('a', {exportTable: {run: vi.fn()}});
        const current = {importTable: {run: vi.fn()}};
        const cleanupCurrent = store.register('a', current);

        cleanupOld();
        expect(store.get('a')).toBe(current);
        cleanupCurrent();
        expect(store.get('a')).toBeUndefined();
        expect(listener).toHaveBeenCalledTimes(3);
    });
});
