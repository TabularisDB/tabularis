import {useEffect} from 'react';
import {subscribePluginEvent} from '@/utils/pluginEvents';

/** Subscribe to another view of the same plugin; cleanup follows the component lifecycle. */
export function usePluginEvent(
    pluginId: string,
    name: string,
    listener: (detail: unknown) => void,
): void {
    useEffect(() => subscribePluginEvent(pluginId, name, listener), [pluginId, name, listener]);
}
