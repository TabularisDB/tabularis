/** Browser-wide marketing opt-out only; never store workspace data in this entry. */
export const WEB_WELCOME_DISMISSED_KEY = 'tabularis:web:community-welcome-dismissed';

export function readWebWelcomeDismissal(): boolean {
    try {
        return window.localStorage.getItem(WEB_WELCOME_DISMISSED_KEY) === 'true';
    } catch {
        return false;
    }
}

export function persistWebWelcomeDismissal(): void {
    try {
        window.localStorage.setItem(WEB_WELCOME_DISMISSED_KEY, 'true');
    } catch {
        // Storage can be blocked or full. The current page still dismisses it.
    }
}
