import {describe, it, expect} from 'vitest';
import {
    MAX_PINS_PER_SCOPE,
    isPinned,
    pinScope,
    pinsInScope,
    resolvePins,
    sanitizeExplorerPins,
    setPinned,
    type ExplorerPins,
    type PinnedObject,
} from '../../src/utils/explorerPins';

const orders: PinnedObject = {kind: 'table', name: 'orders'};
const customers: PinnedObject = {kind: 'table', name: 'customers'};
const scope = pinScope('shop', 'public');

describe('explorerPins', () => {
    describe('pinScope', () => {
        it('tells databases and schemas apart, including missing ones', () => {
            const scopes = [
                pinScope('shop', 'public'),
                pinScope('shop', 'sales'),
                pinScope('crm', 'public'),
                pinScope(undefined, 'public'),
                pinScope('public', undefined),
                pinScope(undefined, undefined),
            ];
            expect(new Set(scopes).size).toBe(scopes.length);
            expect(pinScope(null, null)).toBe(pinScope(undefined, undefined));
        });

        it('keeps names that contain separators from colliding', () => {
            expect(pinScope('a/b', 'c')).not.toBe(pinScope('a', 'b/c'));
            expect(pinScope('a","b', 'c')).not.toBe(pinScope('a', 'b","c'));
        });
    });

    describe('setPinned', () => {
        it('pins in order and unpins, without touching the input', () => {
            const empty: ExplorerPins = {};
            const one = setPinned(empty, 'conn', scope, orders, true);
            const two = setPinned(one, 'conn', scope, customers, true);
            expect(empty).toEqual({});
            expect(pinsInScope(two, 'conn', scope)).toEqual([orders, customers]);
            expect(isPinned(two, 'conn', scope, orders)).toBe(true);

            const back = setPinned(two, 'conn', scope, orders, false);
            expect(pinsInScope(back, 'conn', scope)).toEqual([customers]);
            expect(isPinned(back, 'conn', scope, orders)).toBe(false);
        });

        it('does not duplicate a pin', () => {
            const pins = setPinned(
                setPinned({}, 'conn', scope, orders, true),
                'conn',
                scope,
                orders,
                true,
            );
            expect(pinsInScope(pins, 'conn', scope)).toEqual([orders]);
        });

        it('keeps a table and a view of the same name apart', () => {
            const view: PinnedObject = {kind: 'view', name: 'orders'};
            const pins = setPinned(
                setPinned({}, 'conn', scope, orders, true),
                'conn',
                scope,
                view,
                true,
            );
            expect(
                isPinned(setPinned(pins, 'conn', scope, view, false), 'conn', scope, orders),
            ).toBe(true);
        });

        it('scopes pins to the connection, database and schema', () => {
            const pins = setPinned({}, 'conn', scope, orders, true);
            expect(isPinned(pins, 'conn', pinScope('shop', 'sales'), orders)).toBe(false);
            expect(isPinned(pins, 'conn', pinScope('crm', 'public'), orders)).toBe(false);
            expect(isPinned(pins, 'other', scope, orders)).toBe(false);
        });

        it('drops empty scopes and connections', () => {
            const pins = setPinned(
                setPinned({}, 'conn', scope, orders, true),
                'conn',
                scope,
                orders,
                false,
            );
            expect(pins).toEqual({});
        });

        it(`keeps at most ${MAX_PINS_PER_SCOPE} pins per scope, dropping the oldest`, () => {
            let pins: ExplorerPins = {};
            for (let i = 0; i <= MAX_PINS_PER_SCOPE; i++) {
                pins = setPinned(pins, 'conn', scope, {kind: 'table', name: `t${i}`}, true);
            }
            const kept = pinsInScope(pins, 'conn', scope);
            expect(kept).toHaveLength(MAX_PINS_PER_SCOPE);
            expect(kept[0].name).toBe('t1');
            expect(kept.at(-1)?.name).toBe(`t${MAX_PINS_PER_SCOPE}`);
        });
    });

    describe('resolvePins', () => {
        const tables = [{name: 'users'}, {name: 'orders'}, {name: 'customers'}];

        it('returns the existing pinned objects of one kind, in pin order', () => {
            const pinned: PinnedObject[] = [
                customers,
                {kind: 'view', name: 'users'},
                {kind: 'table', name: 'dropped'},
                orders,
            ];
            expect(resolvePins(pinned, 'table', tables, (t) => t.name)).toEqual([
                {name: 'customers'},
                {name: 'orders'},
            ]);
        });

        it('leaves out objects the list no longer has, e.g. after filtering', () => {
            expect(resolvePins([orders], 'table', [{name: 'users'}], (t) => t.name)).toEqual([]);
        });
    });

    describe('sanitizeExplorerPins', () => {
        it('keeps valid pins and skips anything malformed', () => {
            expect(
                sanitizeExplorerPins({
                    conn: {
                        [scope]: [orders, {kind: 'index', name: 'x'}, {kind: 'view'}, 'orders'],
                        broken: 'not a list',
                        empty: [{kind: 'bad'}],
                    },
                    other: null,
                    list: [orders],
                }),
            ).toEqual({conn: {[scope]: [orders]}});
        });

        it('turns a value that is not an object into no pins', () => {
            for (const value of [undefined, null, 'x', 1, []]) {
                expect(sanitizeExplorerPins(value)).toEqual({});
            }
        });
    });
});
