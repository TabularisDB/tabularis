import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useWelcomeDismissal} from '@/hooks/useWelcomeDismissal';
import {WEB_WELCOME_DISMISSED_KEY} from '@/utils/communityWelcome';

const state = vi.hoisted(() => ({
    environment: 'browser',
    settings: {showWelcome: undefined as boolean | undefined},
    updateSetting: vi.fn(),
}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({negotiation: {environment: state.environment}}),
}));
vi.mock('@/hooks/useSettings', () => ({useSettings: () => state}));

describe('useWelcomeDismissal', () => {
    beforeEach(() => {
        localStorage.clear();
        state.environment = 'browser';
        state.settings.showWelcome = undefined;
        state.updateSetting.mockReset();
    });
    afterEach(() => vi.restoreAllMocks());

    it('shows the welcome on a fresh browser even when remote settings are unavailable', () => {
        expect(renderHook(useWelcomeDismissal).result.current.dismissed).toBe(false);
    });

    it('survives reload and an empty replacement workspace without admin settings writes', () => {
        localStorage.setItem('other-workspace-preference', 'untouched');
        const first = renderHook(useWelcomeDismissal);
        act(() => first.result.current.dismiss());
        expect(first.result.current.dismissed).toBe(true);
        first.unmount();

        // A new hook instance models page reload; settings remain absent as on
        // a new ephemeral instance or a database-only session denied get_config.
        const next = renderHook(useWelcomeDismissal);
        expect(next.result.current.dismissed).toBe(true);
        expect(state.updateSetting).not.toHaveBeenCalled();
        expect(localStorage.getItem(WEB_WELCOME_DISMISSED_KEY)).toBe('true');
        expect(localStorage.getItem('other-workspace-preference')).toBe('untouched');
        expect(localStorage.length).toBe(2);
    });

    it('honors an existing server preference in Web', () => {
        state.settings.showWelcome = false;
        expect(renderHook(useWelcomeDismissal).result.current.dismissed).toBe(true);
        expect(localStorage.length).toBe(0);
    });

    it('keeps desktop configuration persistence and ignores the browser opt-out', () => {
        state.environment = 'tauri';
        state.settings.showWelcome = true;
        localStorage.setItem(WEB_WELCOME_DISMISSED_KEY, 'true');
        const {result} = renderHook(useWelcomeDismissal);
        expect(result.current.dismissed).toBe(false);
        act(() => result.current.dismiss());
        expect(result.current.dismissed).toBe(true);
        expect(state.updateSetting).toHaveBeenCalledExactlyOnceWith('showWelcome', false);
    });

    it('uses the persisted desktop preference after remount', () => {
        state.environment = 'tauri';
        state.settings.showWelcome = false;
        expect(renderHook(useWelcomeDismissal).result.current.dismissed).toBe(true);
        expect(localStorage.length).toBe(0);
    });

    it('still dismisses the current page when browser storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const {result} = renderHook(useWelcomeDismissal);
        expect(result.current.dismissed).toBe(false);
        act(() => result.current.dismiss());
        expect(result.current.dismissed).toBe(true);
        expect(state.updateSetting).not.toHaveBeenCalled();
    });
});
