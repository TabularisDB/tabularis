import {describe, it, expect} from 'vitest';
import {computeTextStats} from '@/utils/textStats';

describe('computeTextStats', () => {
    it('reports zero for empty text', () => {
        expect(computeTextStats('')).toEqual({characters: 0, lines: 0, bytes: 0});
    });

    it('counts ASCII text as one line', () => {
        expect(computeTextStats('hello')).toEqual({characters: 5, lines: 1, bytes: 5});
    });

    it('counts LF separators and a trailing empty line', () => {
        expect(computeTextStats('a\nb').lines).toBe(2);
        expect(computeTextStats('a\nb\n').lines).toBe(3);
        expect(computeTextStats('\n')).toEqual({characters: 1, lines: 2, bytes: 1});
    });

    it('treats CRLF as a single line separator', () => {
        expect(computeTextStats('a\r\nb')).toEqual({characters: 4, lines: 2, bytes: 4});
        expect(computeTextStats('a\r\nb\r\n').lines).toBe(3);
    });

    it('treats a lone CR as a line separator', () => {
        expect(computeTextStats('a\rb').lines).toBe(2);
    });

    it('counts code points rather than UTF-16 code units for emoji', () => {
        expect(computeTextStats('A😀')).toEqual({characters: 2, lines: 1, bytes: 5});
    });

    it('counts combining sequences by code point', () => {
        // "e" + COMBINING ACUTE ACCENT renders as one grapheme but is two code points.
        expect(computeTextStats('é')).toEqual({characters: 2, lines: 1, bytes: 3});
    });

    it('measures multibyte UTF-8 widths', () => {
        // é = 2 bytes, 世 = 3 bytes
        expect(computeTextStats('é世')).toEqual({characters: 2, lines: 1, bytes: 5});
    });

    it('matches TextEncoder byte length, including lone surrogates', () => {
        for (const text of ['', 'abc', 'é世😀', 'a\ud800b', '\udc00', 'x\ud83d', 'a\r\nb\rc\n']) {
            expect(computeTextStats(text).bytes).toBe(new TextEncoder().encode(text).length);
        }
    });
});
