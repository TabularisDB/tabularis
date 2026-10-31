import {useEffect} from 'react';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import {normalizeInterfaceScale} from '@/utils/interfaceScale';

/** Engine zoom scales pixels, editors and floating UI in the same coordinate space. */
export function useInterfaceScale(value: unknown, loading: boolean): void {
    const platform = usePlatformCapabilities();
    const scale = normalizeInterfaceScale(value) / 100;
    useEffect(() => {
        if (loading || !platform.setInterfaceScale) return;
        void platform.setInterfaceScale(scale).catch((error: unknown) => {
            console.error('Failed to apply interface scale:', error);
        });
    }, [loading, platform, scale]);
}
