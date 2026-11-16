import {describe, expect, it, vi} from 'vitest';
import {createAsyncResource} from '@/utils/asyncResource';

describe('createAsyncResource', () => {
    it('shares concurrent loads and retains a stable snapshot until data changes', async () => {
        const fetchData = vi.fn().mockResolvedValue([1]);
        const resource = createAsyncResource<number[]>([], fetchData);
        expect(resource.getSnapshot()).toBe(resource.getSnapshot());
        await Promise.all([resource.load(), resource.load(), resource.load()]);
        await resource.load();
        expect(fetchData).toHaveBeenCalledTimes(1);
        expect(resource.getSnapshot()).toEqual({data: [1], loading: false, error: null});
    });

    it('refreshes again when a plugin changes while a read is pending', async () => {
        let resolve!: (value: number) => void;
        const fetchData = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<number>((done) => {
                        resolve = done;
                    }),
            )
            .mockResolvedValue(2);
        const resource = createAsyncResource(0, fetchData);
        const pending = resource.load();
        await Promise.resolve();
        const refresh = resource.refresh();
        resolve(1);
        await Promise.all([pending, refresh]);
        expect(fetchData).toHaveBeenCalledTimes(2);
        expect(resource.getSnapshot().data).toBe(2);
    });

    it('preserves usable data on errors, supports retry, and unsubscribes', async () => {
        const fetchData = vi
            .fn()
            .mockResolvedValueOnce(1)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(2);
        const resource = createAsyncResource(0, fetchData);
        const listener = vi.fn();
        const unsubscribe = resource.subscribe(listener);
        await resource.load();
        await resource.refresh();
        expect(resource.getSnapshot()).toEqual({data: 1, loading: false, error: 'Error: offline'});
        unsubscribe();
        listener.mockClear();
        await resource.refresh();
        expect(resource.getSnapshot().data).toBe(2);
        expect(listener).not.toHaveBeenCalled();
    });

    it('retries a failed initial load when concurrent readers load again', async () => {
        const fetchData = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(1);
        const resource = createAsyncResource(0, fetchData);

        await resource.load();
        expect(resource.getSnapshot()).toEqual({data: 0, loading: false, error: 'Error: offline'});
        expect(fetchData).toHaveBeenCalledTimes(1);

        await Promise.all([resource.load(), resource.load()]);
        expect(fetchData).toHaveBeenCalledTimes(2);
        expect(resource.getSnapshot()).toEqual({data: 1, loading: false, error: null});
    });

    it('retries a failed refresh on load while retaining the previous data', async () => {
        const fetchData = vi
            .fn()
            .mockResolvedValueOnce(1)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(2);
        const resource = createAsyncResource(0, fetchData);

        await resource.load();
        await resource.refresh();
        expect(resource.getSnapshot()).toEqual({data: 1, loading: false, error: 'Error: offline'});

        await resource.load();
        expect(fetchData).toHaveBeenCalledTimes(3);
        expect(resource.getSnapshot()).toEqual({data: 2, loading: false, error: null});
    });

    it.each(['success', 'failure'])(
        'honors a refresh queued by the final %s notification',
        async (outcome) => {
            const fetchData = vi.fn<() => Promise<number>>();
            if (outcome === 'success') fetchData.mockResolvedValueOnce(1);
            else fetchData.mockRejectedValueOnce(new Error('offline'));
            fetchData.mockResolvedValueOnce(2);
            const resource = createAsyncResource(0, fetchData);
            let refresh: Promise<void> | undefined;
            resource.subscribe(() => {
                if (!resource.getSnapshot().loading && !refresh) {
                    // Run after the fetch loop exits, before chained promise cleanup.
                    queueMicrotask(() => {
                        refresh = resource.refresh();
                    });
                }
            });

            await resource.load();
            expect(refresh).toBeDefined();
            await refresh;
            expect(fetchData).toHaveBeenCalledTimes(2);
            expect(resource.getSnapshot()).toEqual({data: 2, loading: false, error: null});
        },
    );

    it('adopts externally fetched data without another request', async () => {
        const fetchData = vi.fn().mockResolvedValue(1);
        const resource = createAsyncResource(0, fetchData);
        resource.set(5);
        await resource.load();
        expect(fetchData).not.toHaveBeenCalled();
        expect(resource.getSnapshot()).toEqual({data: 5, loading: false, error: null});
    });

    it('keeps adopted data when an older in-flight fetch resolves afterwards', async () => {
        let resolveOld!: (value: number) => void;
        const fetchData = vi.fn().mockImplementationOnce(
            () =>
                new Promise<number>((resolve) => {
                    resolveOld = resolve;
                }),
        );
        const resource = createAsyncResource(0, fetchData);
        const load = resource.load();
        await Promise.resolve();
        resource.set(5);
        resolveOld(1);
        await load;
        expect(fetchData).toHaveBeenCalledTimes(1);
        expect(resource.getSnapshot()).toEqual({data: 5, loading: false, error: null});
    });

    it('ignores an older in-flight failure after adopting data', async () => {
        let rejectOld!: (reason: Error) => void;
        const fetchData = vi.fn().mockImplementationOnce(
            () =>
                new Promise<number>((_, reject) => {
                    rejectOld = reject;
                }),
        );
        const resource = createAsyncResource(0, fetchData);
        const load = resource.load();
        await Promise.resolve();
        resource.set(5);
        rejectOld(new Error('offline'));
        await load;
        expect(resource.getSnapshot()).toEqual({data: 5, loading: false, error: null});
    });
});
