import {useCallback, useState} from 'react';
import {persistWebWelcomeDismissal, readWebWelcomeDismissal} from '@/utils/communityWelcome';
import {usePlatformCapabilities} from './usePlatformCapabilities';
import {useSettings} from './useSettings';

/** Web dismissal must not require permission to edit the server's configuration. */
export function useWelcomeDismissal() {
    const {negotiation} = usePlatformCapabilities();
    const {settings, updateSetting} = useSettings();
    const browser = negotiation.environment === 'browser';
    const [locallyDismissed, setLocallyDismissed] = useState(
        () => browser && readWebWelcomeDismissal(),
    );
    const dismiss = useCallback(() => {
        if (browser) persistWebWelcomeDismissal();
        else void updateSetting('showWelcome', false);
        setLocallyDismissed(true);
    }, [browser, updateSetting]);

    return {dismissed: locallyDismissed || settings.showWelcome === false, dismiss};
}
