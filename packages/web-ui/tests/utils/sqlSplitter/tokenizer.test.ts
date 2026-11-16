import {describe, it, expect} from 'vitest';
import {scanToken, type TokenizerState} from '@/utils/sqlSplitter/tokenizer';
import {dialectOptions} from '@/utils/sqlSplitter';
import {GOOGLESQL} from '../../../../../tests/fixtures/sql-syntax/googlesql';

const PG = dialectOptions('postgres');
const MY = dialectOptions('mysql');
const MS = dialectOptions('mssql');
const OR = dialectOptions('oracle');
// GoogleSQL as a plugin declares it: the `sql_syntax` descriptor fixture.
const BQ = GOOGLESQL.options;

const freshState = (): TokenizerState => ({delimiter: ';', lineLeading: true});

describe('scanToken', () => {
    describe('basic kinds', () => {
        it('emits whitespace for spaces', () => {
            const t = scanToken('   ', 0, PG, freshState());
            expect(t).toEqual({kind: 'whitespace', length: 1});
        });

        it('emits eoln for newline', () => {
            const t = scanToken('\n', 0, PG, freshState());
            expect(t).toEqual({kind: 'eoln', length: 1});
        });

        it('emits data for letters', () => {
            const t = scanToken('SELECT', 0, PG, freshState());
            expect(t).toEqual({kind: 'data', length: 1});
        });

        it('emits delimiter when current delimiter matches', () => {
            const t = scanToken(';', 0, PG, freshState());
            expect(t).toEqual({kind: 'delimiter', length: 1});
        });
    });

    describe('comments', () => {
        it('consumes line comments until newline', () => {
            const t = scanToken('-- hello\nrest', 0, PG, freshState());
            expect(t).toEqual({kind: 'lineComment', length: 8});
        });

        it('consumes line comments to EOF when no newline', () => {
            const src = '-- trailing';
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'lineComment', length: src.length});
        });

        it('consumes block comments', () => {
            const t = scanToken('/* foo */ rest', 0, PG, freshState());
            expect(t).toEqual({kind: 'blockComment', length: 9});
        });

        it('consumes unterminated block comments to EOF', () => {
            const src = '/* never closes';
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'blockComment', length: src.length});
        });
    });

    describe('strings (postgres)', () => {
        it('consumes single-quoted string with doubled-quote escape', () => {
            const src = "'It''s fine'";
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('consumes double-quoted identifier', () => {
            const src = '"my ident"';
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('consumes dollar-quoted string with empty tag', () => {
            const src = '$$body with ; inside$$';
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('consumes dollar-quoted string with named tag', () => {
            const src = '$tag$body$tag$';
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('consumes E-string with backslash escape', () => {
            const src = "E'a\\'b'";
            const t = scanToken(src, 0, PG, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('does not start an E-string after an identifier character', () => {
            // `valE'foo'` — E follows a letter, so not an E-string. Just `data`.
            const src = "valE'foo'";
            const t = scanToken(src, 3, PG, freshState()); // position at 'E'
            expect(t).toEqual({kind: 'data', length: 1});
        });
    });

    describe('mysql identifiers and escape', () => {
        it('consumes backtick identifier', () => {
            const src = '`my col`';
            const t = scanToken(src, 0, MY, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it("treats `\\'` as escaped quote inside string (mysql)", () => {
            const src = "'It\\'s ok'";
            const t = scanToken(src, 0, MY, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });
    });

    describe('mssql brackets', () => {
        it('consumes [bracketed identifier]', () => {
            const src = '[col;name]';
            const t = scanToken(src, 0, MS, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });
    });

    describe('line-leading directives', () => {
        it('recognises GO when line-leading (mssql)', () => {
            const src = 'GO\nSELECT 1';
            const t = scanToken(src, 0, MS, freshState());
            expect(t?.kind).toBe('goDelimiter');
            // length excludes the trailing newline
            expect(t?.length).toBe(2);
        });

        it('does not recognise GO when not line-leading', () => {
            const src = 'GO';
            const state: TokenizerState = {delimiter: ';', lineLeading: false};
            const t = scanToken(src, 0, MS, state);
            expect(t?.kind).toBe('data');
        });

        it('recognises DELIMITER directive (mysql)', () => {
            const src = 'DELIMITER //\nSELECT';
            const t = scanToken(src, 0, MY, freshState());
            expect(t?.kind).toBe('setDelimiter');
            expect(t?.value).toBe('//');
        });

        it('does not recognise DELIMITER mid-line', () => {
            const state: TokenizerState = {delimiter: ';', lineLeading: false};
            const t = scanToken('DELIMITER //', 0, MY, state);
            expect(t?.kind).toBe('data');
        });

        it('recognises a line-leading slash terminator (oracle)', () => {
            const src = '/\nSELECT 1';
            const t = scanToken(src, 0, OR, freshState());
            expect(t).toEqual({kind: 'slashDelimiter', length: 1});
        });

        it('does not recognise a slash terminator mid-line', () => {
            const state: TokenizerState = {delimiter: ';', lineLeading: false};
            const t = scanToken('/', 0, OR, state);
            expect(t).toEqual({kind: 'data', length: 1});
        });

        it('does not confuse a line-leading block comment with a slash terminator', () => {
            const t = scanToken('/* comment */', 0, OR, freshState());
            expect(t?.kind).toBe('blockComment');
        });
    });

    describe('oracle q-quoting', () => {
        it('consumes q-quoted strings with paired delimiters', () => {
            const src = "q'[it; has / inside]'";
            const t = scanToken(src, 0, OR, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('consumes nq-quoted strings', () => {
            const src = "nq'{it; has / inside}'";
            const t = scanToken(src, 0, OR, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('does not consume q-quoted strings with whitespace delimiters', () => {
            const t = scanToken("q' bad; delimiter '", 0, OR, freshState());
            expect(t).toEqual({kind: 'data', length: 1});
        });

        it('allows a single quote q-quote delimiter', () => {
            const src = "q'''it; works''";
            const t = scanToken(src, 0, OR, freshState());
            expect(t).toEqual({kind: 'string', length: src.length});
        });

        it('does not start q-quoting after an identifier character', () => {
            const src = "colq'[x]'";
            const t = scanToken(src, 3, OR, freshState());
            expect(t).toEqual({kind: 'data', length: 1});
        });
    });

    describe('GoogleSQL descriptor strings and identifiers', () => {
        it('scans a single-quoted string with a backslash-escaped quote', () => {
            const src = "'it\\'s;' x";
            expect(scanToken(src, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 8,
            });
        });

        it('does not treat a doubled quote as an escape', () => {
            expect(scanToken("'a'' x", 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 3,
            });
        });

        it('scans a backtick identifier with a backslash escape', () => {
            const src = '`a\\`;b` x';
            expect(scanToken(src, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 7,
            });
        });

        it('scans triple-quoted strings across lines', () => {
            const single = "'''a;\n'b'\n''' x";
            expect(scanToken(single, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 13,
            });
            const double = '"""a;\n"b"\n""" x';
            expect(scanToken(double, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 13,
            });
        });

        it('scans an empty triple-quoted string', () => {
            expect(scanToken("'''''' x", 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 6,
            });
        });

        it('lets a backslash escape a quote inside a triple-quoted string', () => {
            const src = '"""a\\""""; x';
            expect(scanToken(src, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 9,
            });
        });

        it('includes raw and bytes prefixes in the string token', () => {
            for (const prefix of ['r', 'R', 'b', 'B', 'rb', 'RB', 'br', 'bR']) {
                const src = `${prefix}'a;b' x`;
                expect(scanToken(src, 0, BQ, freshState())).toEqual({
                    kind: 'string',
                    length: prefix.length + 5,
                });
            }
        });

        it('scans a raw triple-quoted string', () => {
            const src = 'r"""\\d+;\n""" x';
            expect(scanToken(src, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 12,
            });
        });

        it('keeps a backslash-quote pair inside a raw literal', () => {
            // `r'\''` is the two characters `\'`: the backslash is kept but
            // still prevents the quote from ending the literal.
            const src = "r'\\''; x";
            expect(scanToken(src, 0, BQ, freshState())).toEqual({
                kind: 'string',
                length: 5,
            });
        });

        it('does not read a prefix inside an identifier', () => {
            expect(scanToken("xr'a'", 1, BQ, freshState())).toEqual({
                kind: 'data',
                length: 1,
            });
            expect(scanToken('rb_col', 0, BQ, freshState())).toEqual({
                kind: 'data',
                length: 1,
            });
        });

        it('treats # as a line comment', () => {
            expect(scanToken('# note; x\nSELECT', 0, BQ, freshState())).toEqual({
                kind: 'lineComment',
                length: 9,
            });
        });

        it('leaves triple quotes and prefixes alone in other dialects', () => {
            expect(scanToken("r'a'", 0, PG, freshState())).toEqual({
                kind: 'data',
                length: 1,
            });
        });
    });
});
