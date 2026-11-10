import {useSyncExternalStore} from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function getMediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }
    return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void) {
    const mediaQuery = getMediaQuery();
    if (!mediaQuery) return () => {};
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
}

/** True when the OS asks for reduced motion; follows changes live. */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => getMediaQuery()?.matches ?? false,
        () => false,
    );
}
