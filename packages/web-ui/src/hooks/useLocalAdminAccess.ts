import {useWebSession} from '@/hooks/useWebSession';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {hasLocalAdminAccess} from '@/utils/sessionAccess';

export function useLocalAdminAccess(): boolean {
    const platform = usePlatformCapabilities();
    const session = useWebSession();
    return hasLocalAdminAccess(platform.negotiation.environment, session);
}
