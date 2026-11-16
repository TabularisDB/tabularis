import {describe, expect, it} from 'vitest';

import {jsonEscape, substitute} from '../src/substitute';

describe('substitute', () => {
    it('replaces known variables', () => {
        expect(substitute('id=${NAME}', {NAME: 'my-driver'})).toBe('id=my-driver');
    });

    it('leaves unknown variables untouched', () => {
        expect(substitute('x=${UNKNOWN} y=${NAME}', {NAME: 'n'})).toBe('x=${UNKNOWN} y=n');
    });

    it('does not match lowercase patterns (so TS/Rust template literals survive)', () => {
        // ${context.tableName} in generated TSX must not be touched.
        const source = 'const x = `${context.tableName}`';
        expect(substitute(source, {context: 'BAD'})).toBe(source);
    });

    it('does not match double-brace GitHub Actions syntax', () => {
        const source = 'runs-on: ${{ matrix.runner }}';
        expect(substitute(source, {MATRIX: 'BAD'})).toBe(source);
    });

    it('replaces multiple occurrences', () => {
        expect(substitute('${X}-${X}-${X}', {X: 'a'})).toBe('a-a-a');
    });
});

describe('jsonEscape', () => {
    it('escapes backslashes and quotes', () => {
        expect(jsonEscape('a\\b"c')).toBe('a\\\\b\\"c');
    });

    it('escapes control chars', () => {
        expect(jsonEscape('a\nb\tc')).toBe('a\\nb\\tc');
    });

    it('leaves plain strings alone', () => {
        expect(jsonEscape('hello world')).toBe('hello world');
    });
});
