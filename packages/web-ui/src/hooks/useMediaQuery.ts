import {useCallback, useSyncExternalStore} from 'react';

import {MEDIA_QUERIES, type ViewportLayout} from '@/utils/responsive';

function getMediaQuery(query: string): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }
    return window.matchMedia(query);
}

/**
 * True while `query` matches; follows changes live and unsubscribes on unmount.
 * Use it for behavior only: presentation belongs in CSS (see docs/DESIGN.md).
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const mediaQuery = getMediaQuery(query);
            if (!mediaQuery) return () => {};
            mediaQuery.addEventListener('change', onChange);
            return () => mediaQuery.removeEventListener('change', onChange);
        },
        [query],
    );
    return useSyncExternalStore(
        subscribe,
        () => getMediaQuery(query)?.matches ?? false,
        () => false,
    );
}

/**
 * The shared compact / intermediate / wide layout for the current viewport width.
 * Falls back to `wide` without matchMedia so desktop behavior is the default.
 */
export function useViewportLayout(): ViewportLayout {
    const hasMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
    const intermediate = useMediaQuery(MEDIA_QUERIES.intermediate);
    const wide = useMediaQuery(MEDIA_QUERIES.wide);
    if (!hasMatchMedia || wide) return 'wide';
    return intermediate ? 'intermediate' : 'compact';
}
