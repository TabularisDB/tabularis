import {describe, expect, it} from 'vitest';

import {slugify, titleCase, validateDbType, validateName, validateQuote} from '../src/validate';

describe('slugify', () => {
    it('lowercases and hyphenates', () => {
        expect(slugify('My Driver!')).toBe('my-driver');
        expect(slugify('FooBar')).toBe('foobar');
        expect(slugify('hello_world')).toBe('hello-world');
    });

    it('collapses repeats and trims edges', () => {
        expect(slugify('---foo---bar---')).toBe('foo-bar');
        expect(slugify('a b  c')).toBe('a-b-c');
    });
});

describe('titleCase', () => {
    it('converts slug to title case', () => {
        expect(titleCase('my-driver')).toBe('My Driver');
        expect(titleCase('one')).toBe('One');
        expect(titleCase('a-b-c')).toBe('A B C');
    });
});

describe('validateName', () => {
    it('accepts valid slugified names', () => {
        expect(validateName('My Driver')).toEqual({ok: true, slug: 'my-driver'});
        expect(validateName('duckdb')).toEqual({ok: true, slug: 'duckdb'});
    });

    it('rejects empty or too short', () => {
        expect(validateName('').ok).toBe(false);
        expect(validateName('a').ok).toBe(false);
    });

    it('rejects reserved names', () => {
        const r = validateName('tabularis');
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/reserved/);
    });

    it('rejects over-long names', () => {
        const r = validateName('x'.repeat(100));
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/64/);
    });
});

describe('validateDbType', () => {
    it('accepts the four known kinds', () => {
        expect(validateDbType('network')).toBe('network');
        expect(validateDbType('file')).toBe('file');
        expect(validateDbType('folder')).toBe('folder');
        expect(validateDbType('api')).toBe('api');
    });

    it('defaults to network when undefined', () => {
        expect(validateDbType(undefined)).toBe('network');
    });

    it('throws on invalid', () => {
        expect(() => validateDbType('mongo')).toThrow();
    });
});

describe('validateQuote', () => {
    it('accepts the two valid chars', () => {
        expect(validateQuote('"')).toBe('"');
        expect(validateQuote('`')).toBe('`');
    });

    it('defaults to double-quote', () => {
        expect(validateQuote(undefined)).toBe('"');
    });

    it('throws on invalid', () => {
        expect(() => validateQuote("'")).toThrow();
    });
});
