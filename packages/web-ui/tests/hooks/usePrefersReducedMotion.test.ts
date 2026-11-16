import {describe, it, expect, vi, afterEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {usePrefersReducedMotion} from '@/hooks/usePrefersReducedMotion';

const original = window.matchMedia;

function stubMatchMedia(initial: boolean) {
    let matches = initial;
    const listeners = new Set<() => void>();
    window.matchMedia = vi.fn().mockImplementation(() => ({
        get matches() {
            return matches;
        },
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    })) as unknown as typeof window.matchMedia;
    return (next: boolean) => {
        matches = next;
        listeners.forEach((l) => l());
    };
}

describe('usePrefersReducedMotion', () => {
    afterEach(() => {
        window.matchMedia = original;
    });

    it('is false when matchMedia is unavailable', () => {
        // jsdom has no matchMedia by default
        window.matchMedia = undefined as unknown as typeof window.matchMedia;
        const {result} = renderHook(() => usePrefersReducedMotion());
        expect(result.current).toBe(false);
    });

    it('follows the media query live', () => {
        const set = stubMatchMedia(false);
        const {result} = renderHook(() => usePrefersReducedMotion());
        expect(result.current).toBe(false);
        act(() => set(true));
        expect(result.current).toBe(true);
    });
});
