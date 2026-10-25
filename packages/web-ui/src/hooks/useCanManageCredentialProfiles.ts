import {useWebSession} from '@/hooks/useWebSession';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {canManageCredentialProfiles} from '@/utils/sessionAccess';

export function useCanManageCredentialProfiles(): boolean {
    const platform = usePlatformCapabilities();
    const session = useWebSession();
    return canManageCredentialProfiles(platform.negotiation.environment, session);
}
