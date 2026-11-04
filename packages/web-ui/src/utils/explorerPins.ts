/** Explorer objects that can be pinned. Materialized views count as views. */
export type PinnedObjectKind = 'table' | 'view';

export interface PinnedObject {
    kind: PinnedObjectKind;
    name: string;
}

/**
 * Every pin, keyed by connection id and then by scope (see {@link pinScope}). One UI
 * state key holds them all: the store loads only registered keys at startup, so a key
 * per connection would not survive a restart.
 */
export type ExplorerPins = Record<string, Record<string, PinnedObject[]>>;

/** Pins kept per scope. Pinning more drops the oldest, which keeps the stored value small. */
export const MAX_PINS_PER_SCOPE = 50;

/**
 * Where a pin lives: the database and schema of its object, either of which may be
 * absent. JSON keeps names that contain separators from colliding.
 */
export function pinScope(database?: string | null, schema?: string | null): string {
    return JSON.stringify([database ?? null, schema ?? null]);
}

export function pinsInScope(
    pins: ExplorerPins,
    connectionId: string,
    scope: string,
): PinnedObject[] {
    return pins[connectionId]?.[scope] ?? [];
}

export function isPinned(
    pins: ExplorerPins,
    connectionId: string,
    scope: string,
    object: PinnedObject,
): boolean {
    return pinsInScope(pins, connectionId, scope).some(
        (pin) => pin.kind === object.kind && pin.name === object.name,
    );
}

/**
 * Pins or unpins one object, returning new pins. A new pin goes last, so pinned objects
 * keep the order they were pinned in; empty scopes and connections are dropped.
 */
export function setPinned(
    pins: ExplorerPins,
    connectionId: string,
    scope: string,
    object: PinnedObject,
    pinned: boolean,
): ExplorerPins {
    const others = pinsInScope(pins, connectionId, scope).filter(
        (pin) => !(pin.kind === object.kind && pin.name === object.name),
    );
    const next = pinned
        ? [...others, {kind: object.kind, name: object.name}].slice(-MAX_PINS_PER_SCOPE)
        : others;
    const scopes = Object.fromEntries(
        Object.entries({...pins[connectionId], [scope]: next}).filter(
            ([, list]) => list.length > 0,
        ),
    );
    return Object.fromEntries(
        Object.entries({...pins, [connectionId]: scopes}).filter(
            ([, connectionScopes]) => Object.keys(connectionScopes).length > 0,
        ),
    );
}

/**
 * The pinned objects of one kind that still exist, in pin order. `available` is the
 * scope's current (and possibly filtered) list, so pins whose object was dropped,
 * renamed or filtered out are left out.
 */
export function resolvePins<T>(
    pinned: PinnedObject[],
    kind: PinnedObjectKind,
    available: T[],
    getName: (item: T) => string,
): T[] {
    const byName = new Map(available.map((item) => [getName(item), item]));
    return pinned
        .filter((pin) => pin.kind === kind)
        .map((pin) => byName.get(pin.name))
        .filter((item): item is T => item !== undefined);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isPinnedObject = (value: unknown): value is PinnedObject =>
    isRecord(value) &&
    (value.kind === 'table' || value.kind === 'view') &&
    typeof value.name === 'string';

/** Reads the stored value defensively: anything malformed is skipped instead of thrown on. */
export function sanitizeExplorerPins(value: unknown): ExplorerPins {
    if (!isRecord(value)) return {};
    const pins: ExplorerPins = {};
    for (const [connectionId, scopes] of Object.entries(value)) {
        if (!isRecord(scopes)) continue;
        for (const [scope, list] of Object.entries(scopes)) {
            if (!Array.isArray(list)) continue;
            const objects = list.filter(isPinnedObject);
            if (objects.length === 0) continue;
            pins[connectionId] = {...pins[connectionId], [scope]: objects};
        }
    }
    return pins;
}
