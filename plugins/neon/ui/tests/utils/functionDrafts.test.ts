import {describe, expect, it} from 'vitest';
import {
    parseEnvironmentChanges,
    validFunctionSlug,
    readFunctionDraft,
    writeFunctionDraft,
    clearFunctionDraft,
} from '../../src/utils/functionDrafts';

describe('function editing', () => {
    it('validates Neon slugs without treating route names as reserved', () => {
        for (const slug of ['hello', 'new', 'create', 'a'.repeat(20)])
            expect(validFunctionSlug(slug)).toBe(true);
        for (const slug of ['', 'a-b', 'Hello', 'a_b', '../x', 'a'.repeat(21)])
            expect(validFunctionSlug(slug)).toBe(false);
    });
    it('accepts write-only environment patches with explicit removals', () => {
        expect(parseEnvironmentChanges('{"API_TOKEN":"private","OLD_TOKEN":null}')).toEqual({
            API_TOKEN: 'private',
            OLD_TOKEN: null,
        });
        expect(parseEnvironmentChanges('{}')).toEqual({});
    });
    it('rejects invalid environment drafts without echoing secret input', () => {
        for (const source of [
            'private-secret',
            '["private-secret"]',
            '{"API_TOKEN":12}',
            '{"API_TOKEN":""}',
            '{"BAD-NAME":"private-secret"}',
            '{"API_TOKEN":"\\u0000"}',
        ]) {
            expect(() => parseEnvironmentChanges(source)).toThrow('invalidEnvironment');
            try {
                parseEnvironmentChanges(source);
            } catch (error) {
                expect(String(error)).not.toContain('private-secret');
            }
        }
    });
    it('retains source drafts for the session and isolates connections and functions', () => {
        writeFunctionDraft('first', 'hello', {source: 'export default {};', slug: 'hello'});
        expect(readFunctionDraft('first', 'hello')?.source).toBe('export default {};');
        expect(readFunctionDraft('second', 'hello')).toBeUndefined();
        expect(readFunctionDraft('first', 'other')).toBeUndefined();
        clearFunctionDraft('first', 'hello');
        expect(readFunctionDraft('first', 'hello')).toBeUndefined();
    });
});
