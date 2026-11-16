import {describe, expect, it, vi} from 'vitest';
import {publishPluginEvent, subscribePluginEvent} from '@/utils/pluginEvents';

describe('plugin events', () => {
    it('delivers only to the matching plugin and event name, with independent payload copies', async () => {
        const received: unknown[] = [];
        const foreign = vi.fn();
        const otherName = vi.fn();
        const unsubscribe = [
            subscribePluginEvent('neon', 'branch-changed', (detail) => {
                (detail as {branchId: string}).branchId = 'changed by listener';
            }),
            subscribePluginEvent('neon', 'branch-changed', (detail) => received.push(detail)),
            subscribePluginEvent('other', 'branch-changed', foreign),
            subscribePluginEvent('neon', 'other-event', otherName),
        ];
        const original = {projectId: 'project', branchId: 'branch'};
        try {
            await publishPluginEvent('neon', 'branch-changed', original);
            expect(received).toEqual([{projectId: 'project', branchId: 'branch'}]);
            expect(original.branchId).toBe('branch');
            expect(foreign).not.toHaveBeenCalled();
            expect(otherName).not.toHaveBeenCalled();
        } finally {
            unsubscribe.forEach((remove) => remove());
        }
    });

    it('unsubscribes independently even when two views share a callback and cleanup repeats', async () => {
        const listener = vi.fn();
        const first = subscribePluginEvent('neon', 'branch-changed', listener);
        const second = subscribePluginEvent('neon', 'branch-changed', listener);
        first();
        await publishPluginEvent('neon', 'branch-changed', null);
        expect(listener).toHaveBeenCalledOnce();
        second();
        const next = subscribePluginEvent('neon', 'branch-changed', listener);
        first();
        second();
        try {
            await publishPluginEvent('neon', 'branch-changed', null);
            expect(listener).toHaveBeenCalledTimes(2);
        } finally {
            next();
        }
        await publishPluginEvent('neon', 'branch-changed', null);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('enforces JSON payload and UTF-8 size bounds before delivery', async () => {
        const listener = vi.fn();
        const remove = subscribePluginEvent('neon', 'branch-changed', listener);
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const getter = vi.fn();
        const accessor = Object.defineProperty({}, 'secret', {enumerable: true, get: getter});
        const hiddenSerializer = Object.defineProperty({safe: true}, 'toJSON', {value: getter});
        try {
            await publishPluginEvent('neon', 'branch-changed', 'ä'.repeat(32767));
            expect(listener).toHaveBeenCalledOnce();
            for (const detail of [
                'ä'.repeat(32768),
                undefined,
                () => null,
                BigInt(1),
                NaN,
                cyclic,
                accessor,
                new Date(),
                new Array(1000000),
                Array.from({length: 1000}, () => 'x'.repeat(1000)),
            ])
                await expect(
                    publishPluginEvent('neon', 'branch-changed', detail),
                ).rejects.toThrow();
            expect(listener).toHaveBeenCalledOnce();
            expect(getter).not.toHaveBeenCalled();
            await publishPluginEvent('neon', 'branch-changed', hiddenSerializer);
            expect(listener).toHaveBeenLastCalledWith({safe: true});
            expect(getter).not.toHaveBeenCalled();
        } finally {
            remove();
        }
    });

    it('rejects invalid names and owners and isolates a failing subscriber', async () => {
        for (const name of ['', 'window:message', 'a'.repeat(65), '__proto__']) {
            expect(() => subscribePluginEvent('neon', name, () => undefined)).toThrow('event name');
            await expect(publishPluginEvent('neon', name, {})).rejects.toThrow('event name');
        }
        await expect(publishPluginEvent('../neon', 'branch-changed', {})).rejects.toThrow('owner');
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const listener = vi.fn();
        const broken = subscribePluginEvent('neon', 'branch-changed', () => {
            throw new Error('private detail');
        });
        const active = subscribePluginEvent('neon', 'branch-changed', listener);
        try {
            await publishPluginEvent('neon', 'branch-changed', {});
            expect(listener).toHaveBeenCalledOnce();
            expect(warning).toHaveBeenCalledWith(
                '[Plugin events] A subscriber could not handle an event',
            );
        } finally {
            broken();
            active();
            warning.mockRestore();
        }
    });
});
