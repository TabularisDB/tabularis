import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useInterfaceScale} from '@/hooks/useInterfaceScale';
const {setInterfaceScale, current} = vi.hoisted(() => {
    const setInterfaceScale = vi.fn().mockResolvedValue(undefined);
    return {
        setInterfaceScale,
        current: {platform: {setInterfaceScale} as {setInterfaceScale?: typeof setInterfaceScale}},
    };
});
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => current.platform,
}));
beforeEach(() => {
    vi.clearAllMocks();
    current.platform = {setInterfaceScale};
});
describe('useInterfaceScale', () => {
    it('waits for preferences, applies native zoom, and handles resets', () => {
        const {rerender} = renderHook(({value, loading}) => useInterfaceScale(value, loading), {
            initialProps: {value: 125, loading: true},
        });
        expect(setInterfaceScale).not.toHaveBeenCalled();
        rerender({value: 125, loading: false});
        expect(setInterfaceScale).toHaveBeenLastCalledWith(1.25);
        rerender({value: 100, loading: false});
        expect(setInterfaceScale).toHaveBeenLastCalledWith(1);
    });
    it('leaves browser zoom and DOM coordinates untouched', () => {
        current.platform = {};
        renderHook(() => useInterfaceScale(150, false));
        expect(setInterfaceScale).not.toHaveBeenCalled();
        expect(document.documentElement.style.zoom).toBe('');
    });
});
