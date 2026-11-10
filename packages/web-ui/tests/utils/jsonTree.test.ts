import {describe, it, expect} from 'vitest';
import {createElement} from 'react';
import {render} from '@testing-library/react';
import {JsonEditor} from 'json-edit-react';
import {
    safeParse,
    isJsonColumn,
    buildCollapseTrigger,
    compareJsonKeys,
    hasCollapsibleNodes,
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
