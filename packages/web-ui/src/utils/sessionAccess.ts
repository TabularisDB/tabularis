import type {SessionNegotiation} from '@/api/session';
import type {PlatformEnvironment} from '@/platform/capabilities';

/** Shared credential profile CRUD requires local administrator authority on Web. */
export function canManageCredentialProfiles(
    environment: PlatformEnvironment,
    session: SessionNegotiation | null | undefined,
): boolean {
    if (environment === 'tauri') {
        return true;
    }
    return session?.access.authorizationLevel === 'local-admin';
}
