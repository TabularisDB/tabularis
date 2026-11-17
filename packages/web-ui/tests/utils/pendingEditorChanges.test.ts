import {describe, expect, it, vi} from 'vitest';
import {flushPendingEditorChanges, registerPendingEditorFlush} from '@/utils/pendingEditorChanges';

describe('pendingEditorChanges', () => {
    describe('flushPendingEditorChanges', () => {
        it('runs every registered flush once', () => {
            const first = vi.fn();
            const second = vi.fn();
            const unregisterFirst = registerPendingEditorFlush(first);
            const unregisterSecond = registerPendingEditorFlush(second);

            flushPendingEditorChanges();

            expect(first).toHaveBeenCalledOnce();
            expect(second).toHaveBeenCalledOnce();
            unregisterFirst();
            unregisterSecond();
        });

        it('skips a flush once it is unregistered', () => {
            const flush = vi.fn();
            const unregister = registerPendingEditorFlush(flush);
            unregister();

            flushPendingEditorChanges();

            expect(flush).not.toHaveBeenCalled();
        });

        it('does nothing when no editor is registered', () => {
            expect(() => flushPendingEditorChanges()).not.toThrow();
        });

        it('lets a flush unregister itself or another one while flushing', () => {
            const later = vi.fn();
            let unregisterLater = () => {};
            const unregisterFirst = registerPendingEditorFlush(() => {
                unregisterFirst();
                unregisterLater();
            });
            unregisterLater = registerPendingEditorFlush(later);

            flushPendingEditorChanges();
            flushPendingEditorChanges();

            expect(later).toHaveBeenCalledTimes(1);
        });
    });
});
