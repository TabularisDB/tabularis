import { describe, it, expect } from 'vitest';
import { scanToken, type TokenizerState } from '../../../src/utils/sqlSplitter/tokenizer';
import { dialectOptions } from '../../../src/utils/sqlSplitter';

const PG = dialectOptions('postgres');
const MY = dialectOptions('mysql');
const MS = dialectOptions('mssql');
const OR = dialectOptions('oracle');

const freshState = (): TokenizerState => ({ delimiter: ';', lineLeading: true });

describe('scanToken', () => {
  describe('basic kinds', () => {
    it('emits whitespace for spaces', () => {
      const t = scanToken('   ', 0, PG, freshState());
      expect(t).toEqual({ kind: 'whitespace', length: 1 });
    });

    it('emits eoln for newline', () => {
      const t = scanToken('\n', 0, PG, freshState());
      expect(t).toEqual({ kind: 'eoln', length: 1 });
    });

    it('emits data for letters', () => {
      const t = scanToken('SELECT', 0, PG, freshState());
      expect(t).toEqual({ kind: 'data', length: 1 });
    });

    it('emits delimiter when current delimiter matches', () => {
      const t = scanToken(';', 0, PG, freshState());
      expect(t).toEqual({ kind: 'delimiter', length: 1 });
    });
  });

  describe('comments', () => {
    it('consumes line comments until newline', () => {
      const t = scanToken('-- hello\nrest', 0, PG, freshState());
      expect(t).toEqual({ kind: 'lineComment', length: 8 });
    });

    it('consumes line comments to EOF when no newline', () => {
      const src = '-- trailing';
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'lineComment', length: src.length });
    });

    it('consumes block comments', () => {
      const t = scanToken('/* foo */ rest', 0, PG, freshState());
      expect(t).toEqual({ kind: 'blockComment', length: 9 });
    });

    it('consumes unterminated block comments to EOF', () => {
      const src = '/* never closes';
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'blockComment', length: src.length });
    });
  });

  describe('strings (postgres)', () => {
    it('consumes single-quoted string with doubled-quote escape', () => {
      const src = "'It''s fine'";
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('consumes double-quoted identifier', () => {
      const src = '"my ident"';
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('consumes dollar-quoted string with empty tag', () => {
      const src = '$$body with ; inside$$';
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('consumes dollar-quoted string with named tag', () => {
      const src = '$tag$body$tag$';
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('consumes E-string with backslash escape', () => {
      const src = "E'a\\'b'";
      const t = scanToken(src, 0, PG, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('does not start an E-string after an identifier character', () => {
      // `valE'foo'` — E follows a letter, so not an E-string. Just `data`.
      const src = "valE'foo'";
      const t = scanToken(src, 3, PG, freshState()); // position at 'E'
      expect(t).toEqual({ kind: 'data', length: 1 });
    });
  });

  describe('mysql identifiers and escape', () => {
    it('consumes backtick identifier', () => {
      const src = '`my col`';
      const t = scanToken(src, 0, MY, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it("treats `\\'` as escaped quote inside string (mysql)", () => {
      const src = "'It\\'s ok'";
      const t = scanToken(src, 0, MY, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });
  });

  describe('mssql brackets', () => {
    it('consumes [bracketed identifier]', () => {
      const src = '[col;name]';
      const t = scanToken(src, 0, MS, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
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
      const state: TokenizerState = { delimiter: ';', lineLeading: false };
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
      const state: TokenizerState = { delimiter: ';', lineLeading: false };
      const t = scanToken('DELIMITER //', 0, MY, state);
      expect(t?.kind).toBe('data');
    });

    it('recognises a line-leading slash terminator (oracle)', () => {
      const src = '/\nSELECT 1';
      const t = scanToken(src, 0, OR, freshState());
      expect(t).toEqual({ kind: 'slashDelimiter', length: 1 });
    });

    it('does not recognise a slash terminator mid-line', () => {
      const state: TokenizerState = { delimiter: ';', lineLeading: false };
      const t = scanToken('/', 0, OR, state);
      expect(t).toEqual({ kind: 'data', length: 1 });
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
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('consumes nq-quoted strings', () => {
      const src = "nq'{it; has / inside}'";
      const t = scanToken(src, 0, OR, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('does not consume q-quoted strings with whitespace delimiters', () => {
      const t = scanToken("q' bad; delimiter '", 0, OR, freshState());
      expect(t).toEqual({ kind: 'data', length: 1 });
    });

    it('allows a single quote q-quote delimiter', () => {
      const src = "q'''it; works''";
      const t = scanToken(src, 0, OR, freshState());
      expect(t).toEqual({ kind: 'string', length: src.length });
    });

    it('does not start q-quoting after an identifier character', () => {
      const src = "colq'[x]'";
      const t = scanToken(src, 3, OR, freshState());
      expect(t).toEqual({ kind: 'data', length: 1 });
    });
  });
});
