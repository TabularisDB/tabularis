import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {useUpdate} from '@/hooks/useUpdate';
import {canManageCredentialProfiles} from '@/utils/sessionAccess';

export function useCanManageCredentialProfiles(): boolean {
    const platform = usePlatformCapabilities();
    const {session} = useUpdate();
    return canManageCredentialProfiles(platform.negotiation.environment, session);
}
