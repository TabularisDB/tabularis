import {describe, it, expect, vi} from 'vitest';

/** A fresh loader whose chart import runs `factory`; counts the imports. */
async function freshLoader(factory: () => {ResultChart: () => null}) {
    const imports = {count: 0};
    vi.resetModules();
    vi.doMock('@/components/ui/ResultChart', () => {
        imports.count++;
        return factory();
    });
    const loader = await import('@/components/ui/loadResultChart');
    return {...loader, imports};
}

const chart = () => ({ResultChart: () => null});
const offline = (): never => {
    throw new Error('offline');
};

describe('loadResultChart', () => {
    it('shares one request between callers', async () => {
        const {loadResultChart, imports} = await freshLoader(chart);
        const first = loadResultChart();
        expect(loadResultChart()).toBe(first);
        await expect(first).resolves.toHaveProperty('ResultChart');
        expect(imports.count).toBe(1);
    });

    it('retries after a failed load', async () => {
        let online = false;
        const {loadResultChart} = await freshLoader(() => (online ? chart() : offline()));
        await expect(loadResultChart()).rejects.toThrow();

        online = true;
        await expect(loadResultChart()).resolves.toHaveProperty('ResultChart');
    });

    it('preloads without surfacing a failure', async () => {
        const {preloadResultChart, imports} = await freshLoader(offline);
        expect(() => preloadResultChart()).not.toThrow();
        // Let the rejected import settle; an unhandled rejection would fail the run.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(imports.count).toBe(1);
    });
});
