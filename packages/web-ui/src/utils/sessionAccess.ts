import type {SessionNegotiation} from '@/api/session';
import type {PlatformEnvironment} from '@/platform/capabilities';

/** Desktop is trusted; Web authority comes from the negotiated session. */
export function hasLocalAdminAccess(
    environment: PlatformEnvironment,
    session: SessionNegotiation | null | undefined,
): boolean {
    if (environment === 'tauri') {
        return true;
    }
    return session?.access.authorizationLevel === 'local-admin';
}
