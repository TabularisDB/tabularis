import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    persistWebWelcomeDismissal,
    readWebWelcomeDismissal,
    WEB_WELCOME_DISMISSED_KEY,
} from '@/utils/communityWelcome';

describe('communityWelcome', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.restoreAllMocks());

    it('persists only an explicit boolean dismissal', () => {
        expect(readWebWelcomeDismissal()).toBe(false);
        for (const value of ['false', '1', '{invalid', 'null']) {
            localStorage.setItem(WEB_WELCOME_DISMISSED_KEY, value);
            expect(readWebWelcomeDismissal()).toBe(false);
        }
        persistWebWelcomeDismissal();
        expect(readWebWelcomeDismissal()).toBe(true);
        expect(localStorage.length).toBe(1);
    });

    it('ignores unrelated settings and tolerates unavailable storage', () => {
        localStorage.setItem('tabularis:ui-state-cache', '{"showWelcome":false}');
        expect(readWebWelcomeDismissal()).toBe(false);
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(readWebWelcomeDismissal()).toBe(false);
        expect(() => persistWebWelcomeDismissal()).not.toThrow();
    });
});
