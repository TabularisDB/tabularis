import {describe, it, expect, vi, afterEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {useMediaQuery, useViewportLayout} from '@/hooks/useMediaQuery';
import {BREAKPOINTS, MEDIA_QUERIES} from '@/utils/responsive';

const original = window.matchMedia;

/** Browser default font size; `rem` in a media query always resolves against it. */
const DEFAULT_FONT_PX = 16;

/** Fakes matchMedia for `min-width` queries against a mutable viewport width (CSS px). */
function stubViewport(initialWidth: number, fontPx = DEFAULT_FONT_PX) {
    let width = initialWidth;
    const listeners = new Map<string, Set<() => void>>();
    const matches = (query: string) => {
        const min = /min-width:\s*(\d+(?:\.\d+)?)rem/.exec(query);
        return min ? width >= Number(min[1]) * fontPx : false;
    };
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        get matches() {
            return matches(query);
        },
        addEventListener: (_: string, l: () => void) => {
            if (!listeners.has(query)) listeners.set(query, new Set());
            listeners.get(query)!.add(l);
        },
        removeEventListener: (_: string, l: () => void) => listeners.get(query)?.delete(l),
    })) as unknown as typeof window.matchMedia;
    return {
        resize(next: number) {
            width = next;
            listeners.forEach((set) => set.forEach((l) => l()));
        },
        listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
}

describe('useMediaQuery', () => {
    afterEach(() => {
        window.matchMedia = original;
    });

    it('is false when matchMedia is unavailable', () => {
        window.matchMedia = undefined as unknown as typeof window.matchMedia;
        const {result} = renderHook(() => useMediaQuery(MEDIA_QUERIES.coarsePointer));
        expect(result.current).toBe(false);
    });

    it('follows the media query live', () => {
        const viewport = stubViewport(390);
        const {result} = renderHook(() => useMediaQuery(MEDIA_QUERIES.wide));
        expect(result.current).toBe(false);
        act(() => viewport.resize(1280));
        expect(result.current).toBe(true);
    });

    it('removes its listener on unmount', () => {
        const viewport = stubViewport(390);
        const {unmount} = renderHook(() => useMediaQuery(MEDIA_QUERIES.wide));
        expect(viewport.listenerCount()).toBe(1);
        unmount();
        expect(viewport.listenerCount()).toBe(0);
    });

    it('moves its subscription when the query changes', () => {
        const viewport = stubViewport(900);
        const {result, rerender} = renderHook(({query}) => useMediaQuery(query), {
            initialProps: {query: MEDIA_QUERIES.intermediate},
        });
        expect(result.current).toBe(true);
        rerender({query: MEDIA_QUERIES.wide});
        expect(result.current).toBe(false);
        expect(viewport.listenerCount()).toBe(1);
    });
});

describe('useViewportLayout', () => {
    afterEach(() => {
        window.matchMedia = original;
    });

    it('defaults to the wide layout without matchMedia', () => {
        window.matchMedia = undefined as unknown as typeof window.matchMedia;
        const {result} = renderHook(() => useViewportLayout());
        expect(result.current).toBe('wide');
    });

    it.each([
        [320, 'compact'],
        [BREAKPOINTS.intermediate * DEFAULT_FONT_PX - 1, 'compact'],
        [BREAKPOINTS.intermediate * DEFAULT_FONT_PX, 'intermediate'],
        [BREAKPOINTS.wide * DEFAULT_FONT_PX - 1, 'intermediate'],
        [BREAKPOINTS.wide * DEFAULT_FONT_PX, 'wide'],
    ])('maps %ipx to %s', (width, layout) => {
        stubViewport(width);
        const {result} = renderHook(() => useViewportLayout());
        expect(result.current).toBe(layout);
    });

    it.each([
        [BREAKPOINTS.intermediate * 20 - 1, 'compact'],
        [BREAKPOINTS.intermediate * 20, 'intermediate'],
        [BREAKPOINTS.wide * 20 - 1, 'intermediate'],
        [BREAKPOINTS.wide * 20, 'wide'],
    ])('scales with a 20px default font size: %ipx is %s', (width, layout) => {
        stubViewport(width, 20);
        const {result} = renderHook(() => useViewportLayout());
        expect(result.current).toBe(layout);
    });

    it('uses rem units so the queries match the Tailwind tokens', () => {
        expect(MEDIA_QUERIES.intermediate).toBe('(min-width: 48rem)');
        expect(MEDIA_QUERIES.wide).toBe('(min-width: 64rem)');
    });

    it('updates across breakpoints and cleans up both subscriptions', () => {
        const viewport = stubViewport(390);
        const {result, unmount} = renderHook(() => useViewportLayout());
        expect(result.current).toBe('compact');
        act(() => viewport.resize(800));
        expect(result.current).toBe('intermediate');
        act(() => viewport.resize(1440));
        expect(result.current).toBe('wide');
        unmount();
        expect(viewport.listenerCount()).toBe(0);
    });
});
