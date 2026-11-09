import type {SlotContext} from '@/types/pluginSlots';

const CALLBACK_NAMES = [
    'onDatabaseChange',
    'setExtraField',
    'setCredentialFieldsHidden',
    'setSecretField',
] as const;

export type SlotHostCallback = (method: string, ...args: unknown[]) => void;

/** Make a structured-clone-safe context and record which host callbacks exist. */
export function serializePluginSlotContext(context: SlotContext): SlotContext {
    const callbacks = CALLBACK_NAMES.filter((name) => typeof context[name] === 'function');
    const data = Object.fromEntries(
        Object.entries(context).filter(([, value]) => typeof value !== 'function'),
    );
    return structuredClone({...data, __tabularisHostCallbacks: callbacks}) as SlotContext;
}

/** Recreate callback functions inside the guest; functions never cross postMessage. */
export function hydratePluginSlotContext(
    context: Record<string, unknown>,
    callHost: SlotHostCallback,
): Record<string, unknown> {
    const callbacks = Array.isArray(context.__tabularisHostCallbacks)
        ? context.__tabularisHostCallbacks
        : [];
    const hydrated = {...context};
    delete hydrated.__tabularisHostCallbacks;

    if (callbacks.includes('onDatabaseChange')) {
        hydrated.onDatabaseChange = (value: string) => callHost('slot.onDatabaseChange', value);
    }
    if (callbacks.includes('setExtraField')) {
        hydrated.setExtraField = (key: string, value: string) =>
            callHost('slot.setExtraField', key, value);
    }
    if (callbacks.includes('setCredentialFieldsHidden')) {
        hydrated.setCredentialFieldsHidden = (hidden: boolean) =>
            callHost('slot.setCredentialFieldsHidden', hidden);
    }
    if (callbacks.includes('setSecretField')) {
        hydrated.setSecretField = (key: string, value: string) =>
            callHost('slot.setSecretField', key, value);
    }
    return hydrated;
}
