import {describe, expect, it, vi} from 'vitest';
import {renderHook} from '@testing-library/react';
import type {ReactNode} from 'react';
import {WebSessionProvider} from '@/contexts/WebSessionProvider';
import {useCanManageCredentialProfiles} from '@/hooks/useCanManageCredentialProfiles';
import type {SessionNegotiation} from '@/api/session';
import {DATABASE_WEB_SESSION} from '../pages/SettingsCredentialProfilesAccess.test';

const mockPlatformEnvironment = vi.fn<'tauri' | 'browser', []>(() => 'browser');

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        negotiation: {environment: mockPlatformEnvironment()},
    }),
}));

function wrapper(session: SessionNegotiation | null) {
    return ({children}: {children: ReactNode}) => (
        <WebSessionProvider session={session}>{children}</WebSessionProvider>
    );
}

describe('useCanManageCredentialProfiles', () => {
    it('returns true on desktop before any web session exists', () => {
        mockPlatformEnvironment.mockReturnValue('tauri');
        const {result} = renderHook(() => useCanManageCredentialProfiles(), {
            wrapper: wrapper(null),
        });
        expect(result.current).toBe(true);
    });

    it('returns false while a database-only browser session is active', () => {
        mockPlatformEnvironment.mockReturnValue('browser');
        const {result} = renderHook(() => useCanManageCredentialProfiles(), {
            wrapper: wrapper(DATABASE_WEB_SESSION),
        });
        expect(result.current).toBe(false);
    });

    it('returns false when the browser session is cleared after logout', () => {
        mockPlatformEnvironment.mockReturnValue('browser');
        const active = renderHook(() => useCanManageCredentialProfiles(), {
            wrapper: wrapper(DATABASE_WEB_SESSION),
        });
        expect(active.result.current).toBe(false);
        active.unmount();
        const loggedOut = renderHook(() => useCanManageCredentialProfiles(), {
            wrapper: wrapper(null),
        });
        expect(loggedOut.result.current).toBe(false);
    });
});
