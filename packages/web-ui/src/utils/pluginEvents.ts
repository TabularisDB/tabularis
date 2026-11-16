type PluginEventListener = (detail: unknown) => void;
const listeners = new Map<string, Set<PluginEventListener>>();
const MAX_EVENT_BYTES = 64 * 1024;

function eventKey(pluginId: string, name: string): string {
    if (typeof pluginId !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(pluginId))
        throw new Error('Invalid plugin event owner');
    if (typeof name !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(name))
        throw new Error('Invalid plugin event name');
    return `${pluginId}:${name}`;
}

function serializedDetail(detail: unknown): string {
    let entries = 0;
    let bytes = 0;
    const charge = (serialized: string): void => {
        bytes += new TextEncoder().encode(serialized).byteLength;
        if (bytes > MAX_EVENT_BYTES) throw new Error('Plugin event detail exceeds 64 KiB');
    };
    const ancestors = new Set<object>();
    const validate = (value: unknown, depth: number): unknown => {
        if (++entries > MAX_EVENT_BYTES || depth > 64)
            throw new Error('Plugin event detail is too large');
        if (
            value === null ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))
        ) {
            charge(JSON.stringify(value));
            return value;
        }
        if (typeof value === 'string') {
            if (value.length > MAX_EVENT_BYTES)
                throw new Error('Plugin event detail exceeds 64 KiB');
            charge(JSON.stringify(value));
            return value;
        }
        if (typeof value !== 'object')
            throw new Error('Plugin event detail must contain JSON values');
        if (
            !Array.isArray(value) &&
            ![Object.prototype, null].includes(Object.getPrototypeOf(value))
        )
            throw new Error('Plugin event detail must contain plain JSON objects');
        if (ancestors.has(value)) throw new Error('Plugin event detail must not contain cycles');
        ancestors.add(value);
        if (Array.isArray(value) && value.length > MAX_EVENT_BYTES)
            throw new Error('Plugin event detail must contain bounded JSON arrays');
        const keys = Object.keys(value);
        if (keys.length > MAX_EVENT_BYTES) throw new Error('Plugin event detail is too large');
        if (
            Array.isArray(value) &&
            (value.length > MAX_EVENT_BYTES || keys.length !== value.length)
        )
            throw new Error('Plugin event detail must contain bounded JSON arrays');
        charge('{}');
        charge(','.repeat(Math.max(0, keys.length - 1)));
        const copy: unknown[] | Record<string, unknown> = Array.isArray(value)
            ? []
            : (Object.create(null) as Record<string, unknown>);
        for (const key of keys) {
            if (key.length > MAX_EVENT_BYTES) throw new Error('Plugin event detail exceeds 64 KiB');
            if (!Array.isArray(value)) charge(`${JSON.stringify(key)}:`);
            const property = Object.getOwnPropertyDescriptor(value, key);
            if (!property || !('value' in property))
                throw new Error('Plugin event detail must not contain accessors');
            const item = validate(property.value, depth + 1);
            if (Array.isArray(copy)) {
                if (key !== String(copy.length))
                    throw new Error('Plugin event arrays must not contain holes or custom keys');
                copy.push(item);
            } else copy[key] = item;
        }
        ancestors.delete(value);
        return copy;
    };
    return JSON.stringify(validate(detail, 0));
}

/** Events stay inside the owning plugin; each subscriber receives its own JSON copy. */
export async function publishPluginEvent(
    pluginId: string,
    name: string,
    detail: unknown,
): Promise<void> {
    const key = eventKey(pluginId, name);
    const serialized = serializedDetail(detail);
    for (const listener of [...(listeners.get(key) ?? [])]) {
        try {
            listener(JSON.parse(serialized));
        } catch {
            console.warn('[Plugin events] A subscriber could not handle an event');
        }
    }
}

export function subscribePluginEvent(
    pluginId: string,
    name: string,
    listener: PluginEventListener,
): () => void {
    const key = eventKey(pluginId, name);
    const owned = listeners.get(key) ?? new Set<PluginEventListener>();
    const subscription: PluginEventListener = (detail) => listener(detail);
    owned.add(subscription);
    listeners.set(key, owned);
    return () => {
        if (owned.delete(subscription) && !owned.size) listeners.delete(key);
    };
}
