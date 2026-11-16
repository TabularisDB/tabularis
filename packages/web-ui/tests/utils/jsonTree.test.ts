import {describe, it, expect} from 'vitest';
import {createElement} from 'react';
import {act, fireEvent, render} from '@testing-library/react';
import {JsonEditor, type ExternalTriggers} from 'json-edit-react';
import {
    safeParse,
    isJsonColumn,
    buildCollapseTrigger,
    buildExpandToLevelTrigger,
    compareJsonKeys,
    hasCollapsibleNodes,
    JSON_TREE_EXPAND_LEVELS,
} from '@/utils/jsonTree';

describe('jsonTree', () => {
    describe('safeParse', () => {
        it('parses a valid JSON object', () => {
            const result = safeParse('{"a":1,"b":[2,3]}');
            expect(result.error).toBeUndefined();
            expect(result.value).toEqual({a: 1, b: [2, 3]});
        });

        it('parses a valid JSON array', () => {
            const result = safeParse('[1,2,3]');
            expect(result.error).toBeUndefined();
            expect(result.value).toEqual([1, 2, 3]);
        });

        it('parses a valid JSON primitive', () => {
            const result = safeParse('42');
            expect(result.error).toBeUndefined();
            expect(result.value).toBe(42);
        });

        it('parses null literal', () => {
            const result = safeParse('null');
            expect(result.error).toBeUndefined();
            expect(result.value).toBeNull();
        });

        it('returns null value with no error for empty input', () => {
            const result = safeParse('');
            expect(result.error).toBeUndefined();
            expect(result.value).toBeNull();
        });

        it('returns null value with no error for whitespace-only input', () => {
            const result = safeParse('   \n\t  ');
            expect(result.error).toBeUndefined();
            expect(result.value).toBeNull();
        });

        it('returns an error message for invalid JSON', () => {
            const result = safeParse('{not valid json');
            expect(result.error).toBeDefined();
            expect(typeof result.error).toBe('string');
            expect(result.value).toBeNull();
        });

        it('returns an error message for trailing garbage', () => {
            const result = safeParse('{"a":1} extra');
            expect(result.error).toBeDefined();
            expect(result.value).toBeNull();
        });
    });

    describe('isJsonColumn', () => {
        it('matches lowercase json', () => {
            expect(isJsonColumn('json')).toBe(true);
        });

        it('matches lowercase jsonb', () => {
            expect(isJsonColumn('jsonb')).toBe(true);
        });

        it('matches uppercase JSON', () => {
            expect(isJsonColumn('JSON')).toBe(true);
        });

        it('matches uppercase JSONB', () => {
            expect(isJsonColumn('JSONB')).toBe(true);
        });

        it('matches mixed case', () => {
            expect(isJsonColumn('JsonB')).toBe(true);
        });

        it('returns false for unrelated types', () => {
            expect(isJsonColumn('text')).toBe(false);
            expect(isJsonColumn('varchar')).toBe(false);
            expect(isJsonColumn('integer')).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isJsonColumn('')).toBe(false);
        });
    });

    describe('hasCollapsibleNodes', () => {
        it('is true for objects and arrays', () => {
            expect(hasCollapsibleNodes({a: 1})).toBe(true);
            expect(hasCollapsibleNodes([1, 2])).toBe(true);
            expect(hasCollapsibleNodes({})).toBe(true);
        });

        it('is false for scalar roots', () => {
            for (const v of ['x', 1, true, null, undefined]) {
                expect(hasCollapsibleNodes(v)).toBe(false);
            }
        });
    });

    describe('buildCollapseTrigger', () => {
        it('targets the root and all descendants', () => {
            expect(buildCollapseTrigger(true)).toEqual({
                collapse: {path: [], collapsed: true, includeChildren: true},
            });
            expect(buildCollapseTrigger(false).collapse).toMatchObject({
                collapsed: false,
            });
        });

        it('returns a new object each call so repeated clicks re-trigger', () => {
            expect(buildCollapseTrigger(true)).not.toBe(buildCollapseTrigger(true));
        });
    });

    describe('buildExpandToLevelTrigger', () => {
        const issueExample = {customer: {address: {city: 'Rome'}}};
        const catchAll = {path: [], collapsed: true, includeChildren: true};
        const open = (...path: (string | number)[]) => ({
            path,
            collapsed: false,
            includeChildren: false,
        });

        it('offers levels 1, 2 and 3', () => {
            expect(JSON_TREE_EXPAND_LEVELS).toEqual([1, 2, 3]);
        });

        it('opens the root at level 1 and collapses everything else', () => {
            expect(buildExpandToLevelTrigger(issueExample, 1)).toEqual({
                collapse: [open(), catchAll],
            });
        });

        it('opens one more level of collections per level', () => {
            expect(buildExpandToLevelTrigger(issueExample, 2).collapse).toEqual([
                open(),
                open('customer'),
                catchAll,
            ]);
            expect(buildExpandToLevelTrigger(issueExample, 3).collapse).toEqual([
                open(),
                open('customer'),
                open('customer', 'address'),
                catchAll,
            ]);
        });

        it('uses numeric indexes for arrays in mixed arrays and objects', () => {
            const value = [{a: [1, {b: {}}]}, [['deep']], 'x', null];
            expect(buildExpandToLevelTrigger(value, 3).collapse).toEqual([
                open(),
                open(0),
                open(0, 'a'),
                open(1),
                open(1, 0),
                catchAll,
            ]);
        });

        it('keeps empty collections safe', () => {
            expect(buildExpandToLevelTrigger({}, 3).collapse).toEqual([open(), catchAll]);
            expect(buildExpandToLevelTrigger([], 2).collapse).toEqual([open(), catchAll]);
            expect(buildExpandToLevelTrigger({a: {}, b: []}, 2).collapse).toEqual([
                open(),
                open('a'),
                open('b'),
                catchAll,
            ]);
        });

        it('opens nothing for scalar roots', () => {
            for (const v of ['x', 1, true, null, undefined]) {
                expect(buildExpandToLevelTrigger(v, 3).collapse).toEqual([catchAll]);
            }
        });

        it('does not modify the value', () => {
            const value = {b: [3, 1, 2], a: {z: 1, y: 2}};
            const snapshot = JSON.stringify(value);
            buildExpandToLevelTrigger(Object.freeze(value), 3);
            expect(JSON.stringify(value)).toBe(snapshot);
        });

        it('returns a new object each call so repeated selections re-trigger', () => {
            expect(buildExpandToLevelTrigger(issueExample, 2)).not.toBe(
                buildExpandToLevelTrigger(issueExample, 2),
            );
        });

        describe('with the editor', () => {
            const data = {
                customer: {address: {city: 'Rome', tags: [['vip']]}},
                orders: [{items: [{sku: 'A1'}]}],
            };

            const findNode = (container: HTMLElement, key: string) => {
                const node = [
                    ...container.querySelectorAll<HTMLElement>('.jer-collection-component'),
                ].find(
                    (el) =>
                        el
                            .querySelector(':scope > .jer-collection-header-row .jer-key-text')
                            ?.textContent?.replace(/:$/, '') === key,
                );
                if (!node) throw new Error(`no collection node "${key}"`);
                return node;
            };
            const isOpen = (container: HTMLElement, key: string) =>
                findNode(container, key).querySelector<HTMLElement>(
                    ':scope > .jer-collection-inner',
                )?.style.maxHeight !== '0px';
            const openState = (container: HTMLElement) =>
                Object.fromEntries(
                    ['root', 'customer', 'address', 'tags', 'orders', 'items'].map((key) => [
                        key,
                        isOpen(container, key),
                    ]),
                );

            const renderWith = async (
                rerender: (ui: React.ReactElement) => void,
                trigger: ExternalTriggers,
            ) => {
                rerender(
                    createElement(JsonEditor, {data, viewOnly: true, externalTriggers: trigger}),
                );
                await act(async () => {
                    await new Promise((resolve) => setTimeout(resolve, 600));
                });
            };

            const expected = {
                1: {
                    root: true,
                    customer: false,
                    address: false,
                    tags: false,
                    orders: false,
                    items: false,
                },
                2: {
                    root: true,
                    customer: true,
                    address: false,
                    tags: false,
                    orders: true,
                    items: false,
                },
                3: {
                    root: true,
                    customer: true,
                    address: true,
                    tags: false,
                    orders: true,
                    items: false,
                },
            };

            it('opens collections down to the chosen level and collapses deeper ones', async () => {
                const {container, rerender} = render(
                    createElement(JsonEditor, {data, viewOnly: true}),
                );
                for (const level of [1, 2, 3] as const) {
                    await renderWith(rerender, buildExpandToLevelTrigger(data, level));
                    expect(openState(container)).toEqual(expected[level]);
                }
                // Going back to a shallower level collapses again.
                await renderWith(rerender, buildExpandToLevelTrigger(data, 1));
                expect(openState(container)).toEqual(expected[1]);
            });

            it('applies a repeated selection after manual toggles and works with expand/collapse all', async () => {
                const {container, rerender} = render(
                    createElement(JsonEditor, {data, viewOnly: true}),
                );
                await renderWith(rerender, buildExpandToLevelTrigger(data, 2));
                expect(openState(container)).toEqual(expected[2]);

                // Manually collapse "customer" and expand "address".
                const header = (key: string) =>
                    findNode(container, key).querySelector(':scope > .jer-collection-header-row')!;
                await act(async () => {
                    fireEvent.click(header('customer'));
                    fireEvent.click(header('items'));
                    await new Promise((resolve) => setTimeout(resolve, 600));
                });
                expect(isOpen(container, 'customer')).toBe(false);

                await renderWith(rerender, buildExpandToLevelTrigger(data, 2));
                expect(openState(container)).toEqual(expected[2]);

                await renderWith(rerender, buildCollapseTrigger(false));
                expect(Object.values(openState(container)).every(Boolean)).toBe(true);

                await renderWith(rerender, buildCollapseTrigger(true));
                expect(Object.values(openState(container)).some(Boolean)).toBe(false);

                await renderWith(rerender, buildExpandToLevelTrigger(data, 3));
                expect(openState(container)).toEqual(expected[3]);
            });
        });
    });

    describe('compareJsonKeys', () => {
        const sortKeys = (keys: string[]) =>
            keys
                .map((key): [string, unknown] => [key, null])
                .sort(compareJsonKeys)
                .map(([key]) => key);

        it('orders numeric-looking keys by their number', () => {
            expect(sortKeys(['10', '2', '1'])).toEqual(['1', '2', '10']);
        });

        it('orders words alphabetically regardless of case', () => {
            expect(sortKeys(['cherry', 'Banana', 'apple'])).toEqual(['apple', 'Banana', 'cherry']);
        });

        it('puts numeric-looking keys before words', () => {
            expect(sortKeys(['b', '10', 'a', '2'])).toEqual(['2', '10', 'a', 'b']);
        });

        it('sorts nested objects and keeps array order when the editor uses it', () => {
            const {container} = render(
                createElement(JsonEditor, {
                    data: {
                        z: 1,
                        '10': 'ten',
                        '2': 'two',
                        nested: {y: 2, Beta: 3, alpha: 4},
                        list: [{d: 1, c: 2}, 'x'],
                    },
                    keySort: compareJsonKeys,
                    viewOnly: true,
                }),
            );
            const keys = [...container.querySelectorAll('.jer-key-text')].map((el) =>
                el.textContent?.replace(/:$/, ''),
            );
            expect(keys).toEqual([
                'root',
                '2',
                '10',
                'list',
                '0',
                'c',
                'd',
                '1',
                'nested',
                'alpha',
                'Beta',
                'y',
                'z',
            ]);
        });
    });
});
