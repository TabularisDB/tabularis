import { describe, it, expect } from 'vitest';
import {
  splitQueries,
  splitStatements,
  scanNonCodeSpans,
} from '../../../src/utils/sqlSplitter';
import {
  createScriptBlockState,
  isInsideBlock,
  onScriptPunctuation,
  onStatementDelimiter,
  resetScriptBlockState,
  scanScriptWord,
} from '../../../src/utils/sqlSplitter/scriptBlocks';
import { GOOGLESQL } from '../../fixtures/sql-syntax/googlesql';

// GoogleSQL as a plugin declares it: the `sql_syntax` descriptor fixture.
const BQ = GOOGLESQL.options;
const split = (sql: string): string[] => splitQueries(sql, GOOGLESQL);

describe('scriptBlocks', () => {
  describe('scanScriptWord', () => {
    it('returns 0 when no word starts at the position', () => {
      const state = createScriptBlockState();
      expect(scanScriptWord('(x)', 0, BQ, state)).toBe(0);
      expect(scanScriptWord('abc', 1, BQ, state)).toBe(0);
    });

    it('opens a block for BEGIN at a statement start', () => {
      const state = createScriptBlockState();
      expect(scanScriptWord('BEGIN SELECT 1', 0, BQ, state)).toBe(5);
      expect(isInsideBlock(state)).toBe(true);
      expect(state.statementStart).toBe(true);
    });

    it('does not open a block for BEGIN TRANSACTION or a bare BEGIN;', () => {
      for (const sql of ['BEGIN TRANSACTION', 'begin transaction', 'BEGIN;', 'BEGIN', 'BEGIN -- c\n;']) {
        const state = createScriptBlockState();
        scanScriptWord(sql, 0, BQ, state);
        expect(isInsideBlock(state)).toBe(false);
      }
    });

    it('consumes the closer word of END IF', () => {
      const state = createScriptBlockState();
      scanScriptWord('IF', 0, BQ, state);
      expect(isInsideBlock(state)).toBe(true);
      expect(scanScriptWord('END  IF;', 0, BQ, state)).toBe(7);
      expect(isInsideBlock(state)).toBe(false);
    });

    it('consumes a label and keeps the statement position', () => {
      const state = createScriptBlockState();
      expect(scanScriptWord('outer: LOOP', 0, BQ, state)).toBe(6);
      expect(state.statementStart).toBe(true);
    });

    it('ignores keywords used as member or parameter names', () => {
      const state = createScriptBlockState();
      expect(scanScriptWord('t.begin', 2, BQ, state)).toBe(5);
      expect(scanScriptWord('@begin', 1, BQ, state)).toBe(5);
      expect(isInsideBlock(state)).toBe(false);
    });

    describe('look-ahead follows the tokenizer comment rules', () => {
      const endIf = (sql: string, options: typeof BQ): number => {
        const state = createScriptBlockState();
        scanScriptWord('IF', 0, options, state);
        return scanScriptWord(sql, 0, options, state);
      };

      it('skips nested block comments only when the dialect nests them', () => {
        const sql = 'END /* /* x */ */ IF';
        expect(endIf(sql, { ...BQ, blockComments: true, nestedBlockComments: true })).toBe(sql.length);
        // Flat comments end at the first `*/`, so ` */ IF` is code.
        expect(endIf(sql, { ...BQ, blockComments: true, nestedBlockComments: false })).toBe(3);
      });

      it('treats `--` without a space as code when the dialect requires one', () => {
        const sql = 'END --x\nIF';
        expect(endIf(sql, { ...BQ, lineComments: true, lineCommentRequiresSpace: false })).toBe(sql.length);
        expect(endIf(sql, { ...BQ, lineComments: true, lineCommentRequiresSpace: true })).toBe(3);
        const spaced = 'END -- x\nIF';
        expect(endIf(spaced, { ...BQ, lineComments: true, lineCommentRequiresSpace: true })).toBe(spaced.length);
      });

      it('skips `#` comments only when the dialect has them', () => {
        const sql = 'END # c\nIF';
        expect(endIf(sql, { ...BQ, hashComments: true })).toBe(sql.length);
        expect(endIf(sql, { ...BQ, hashComments: false })).toBe(3);
      });

      it('reads BEGIN TRANSACTION past a nested comment like the tokenizer', () => {
        const state = createScriptBlockState();
        scanScriptWord('BEGIN /* /* a */ b */ TRANSACTION', 0, { ...BQ, nestedBlockComments: true }, state);
        expect(isInsideBlock(state)).toBe(false);
      });
    });

    it('tracks parentheses and resets on delimiters', () => {
      const state = createScriptBlockState();
      onScriptPunctuation(state, '(');
      expect(state.parenDepth).toBe(1);
      expect(state.statementStart).toBe(false);
      onScriptPunctuation(state, ')');
      onScriptPunctuation(state, ')');
      expect(state.parenDepth).toBe(0);
      onStatementDelimiter(state);
      expect(state.statementStart).toBe(true);
      state.stack.push('BEGIN');
      resetScriptBlockState(state);
      expect(isInsideBlock(state)).toBe(false);
    });
  });

  describe('GoogleSQL descriptor splitting', () => {
    it('splits plain statements', () => {
      expect(split('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('shields semicolons in backtick identifiers and strings', () => {
      const sql =
        "SELECT `my-project.ds.t;x`.a FROM `p.d.t`; SELECT 'a\\';b', \"c\\\";d\"; SELECT 3";
      expect(split(sql)).toEqual([
        'SELECT `my-project.ds.t;x`.a FROM `p.d.t`',
        "SELECT 'a\\';b', \"c\\\";d\"",
        'SELECT 3',
      ]);
    });

    it('shields semicolons in triple-quoted and raw strings', () => {
      const sql = [
        "SELECT '''a;",
        "b''' AS x, r'\\d+;' AS re, b\"\"\"c;\"\"\" AS y;",
        'SELECT 2',
      ].join('\n');
      expect(split(sql)).toHaveLength(2);
    });

    it('shields semicolons in all comment forms', () => {
      const sql = 'SELECT 1 -- a;b\n# c;d\n/* e;f */; SELECT 2';
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps a BEGIN … END block as one statement', () => {
      const sql = [
        'DECLARE x INT64 DEFAULT 0;',
        'BEGIN',
        '  SET x = x + 1;',
        '  SELECT x;',
        'END;',
        'SELECT 2;',
      ].join('\n');
      expect(split(sql)).toEqual([
        'DECLARE x INT64 DEFAULT 0',
        'BEGIN\n  SET x = x + 1;\n  SELECT x;\nEND',
        'SELECT 2',
      ]);
    });

    it('does not treat BEGIN TRANSACTION or BEGIN; as a block', () => {
      const sql =
        'BEGIN TRANSACTION;\nINSERT INTO t VALUES (1);\nCOMMIT TRANSACTION;\nBEGIN;\nDELETE FROM t WHERE true;\nROLLBACK;';
      expect(split(sql)).toEqual([
        'BEGIN TRANSACTION',
        'INSERT INTO t VALUES (1)',
        'COMMIT TRANSACTION',
        'BEGIN',
        'DELETE FROM t WHERE true',
        'ROLLBACK',
      ]);
    });

    it('keeps BEGIN TRANSACTION inside a block', () => {
      const sql = 'BEGIN\n  BEGIN TRANSACTION;\n  COMMIT TRANSACTION;\nEND; SELECT 1';
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps BEGIN … EXCEPTION WHEN ERROR THEN … END together', () => {
      const sql = [
        'BEGIN',
        '  SELECT 1/0;',
        'EXCEPTION WHEN ERROR THEN',
        '  SELECT @@error.message;',
        'END;',
        'SELECT 2',
      ].join('\n');
      const result = split(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatch(/^BEGIN[\s\S]*@@error\.message;\nEND$/);
    });

    it('keeps IF … ELSEIF … ELSE … END IF together', () => {
      const sql = [
        'IF (SELECT COUNT(*) FROM t) > 0 THEN',
        '  SELECT 1;',
        'ELSEIF x IS NULL THEN',
        '  SELECT 2;',
        'ELSE',
        '  SELECT 3;',
        'END IF;',
        'SELECT 4',
      ].join('\n');
      expect(split(sql)).toHaveLength(2);
    });

    it('does not treat IF() or IF NOT EXISTS as a block', () => {
      const sql =
        'SELECT IF(a > 1, 1, 2) FROM t; CREATE TABLE IF NOT EXISTS d.t (x INT64); DROP TABLE IF EXISTS d.u; SELECT 1';
      expect(split(sql)).toHaveLength(4);
    });

    it('keeps LOOP, WHILE, REPEAT and FOR loops together', () => {
      const loops = [
        'LOOP\n  SET i = i + 1;\n  IF i > 3 THEN LEAVE; END IF;\nEND LOOP',
        'WHILE i < 3 DO\n  SET i = i + 1;\nEND WHILE',
        'REPEAT\n  SET i = i + 1;\nUNTIL i >= 3\nEND REPEAT',
        'FOR r IN (SELECT 1 AS n UNION ALL SELECT 2) DO\n  SELECT r.n;\nEND FOR',
      ];
      for (const loop of loops) {
        expect(split(`DECLARE i INT64 DEFAULT 0;\n${loop};\nSELECT i;`)).toEqual([
          'DECLARE i INT64 DEFAULT 0',
          loop,
          'SELECT i',
        ]);
      }
    });

    it('supports labelled loops and blocks', () => {
      const sql =
        'outer_loop: LOOP\n  inner_block: BEGIN\n    LEAVE outer_loop;\n  END inner_block;\nEND LOOP outer_loop;\nSELECT 1';
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps a CASE statement together and handles CASE expressions', () => {
      const sql = [
        'CASE',
        '  WHEN x = 1 THEN SELECT CASE WHEN y THEN 1 ELSE 2 END;',
        '  ELSE SELECT 3;',
        'END CASE;',
        'SELECT CASE WHEN a THEN IF(b, 1, 2) END FROM t;',
        'SELECT 4',
      ].join('\n');
      expect(split(sql)).toHaveLength(3);
    });

    it('handles nested blocks', () => {
      const sql = [
        'BEGIN',
        '  IF a THEN',
        '    WHILE b DO',
        '      BEGIN',
        '        SELECT 1;',
        '      END;',
        '    END WHILE;',
        '  END IF;',
        'END;',
        'SELECT 2',
      ].join('\n');
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps a CREATE PROCEDURE body together', () => {
      const sql = [
        'CREATE OR REPLACE PROCEDURE ds.p(x INT64, OUT y STRING)',
        'OPTIONS (strict_mode = false)',
        'BEGIN',
        '  DECLARE z INT64;',
        '  SET y = CAST(x AS STRING);',
        'END;',
        "CALL ds.p(1, y);",
      ].join('\n');
      const result = split(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatch(/^CREATE OR REPLACE PROCEDURE[\s\S]*END$/);
      expect(result[1]).toBe('CALL ds.p(1, y)');
    });

    it('keeps a CREATE TEMP PROCEDURE body together', () => {
      const sql = 'CREATE TEMP PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND;\nCALL p();';
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps CREATE FUNCTION bodies together', () => {
      const sql = [
        'CREATE TEMP FUNCTION f(x INT64) AS (CASE WHEN x > 0 THEN x ELSE -x END);',
        'CREATE TEMP FUNCTION g(s STRING) RETURNS STRING LANGUAGE js AS r"""',
        '  var a = s.split(";");',
        '  return a.join(\'\\n\');',
        '""";',
        'SELECT f(-1), g("a;b");',
      ].join('\n');
      const result = split(sql);
      expect(result).toHaveLength(3);
      expect(result[1]).toMatch(/^CREATE TEMP FUNCTION g[\s\S]*"""$/);
    });

    it('does not open a block for unreserved keywords used as names', () => {
      const sql =
        'SELECT begin, loop, repeat, while FROM t; SELECT REPEAT("a", 2); SELECT 3';
      expect(split(sql)).toHaveLength(3);
    });

    it('does not open a block for a struct field named end or begin', () => {
      const sql = 'SELECT s.begin, s.end FROM t; SELECT 2';
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps MERGE … WHEN … THEN as one statement', () => {
      const sql = [
        'MERGE d.t T USING d.s S ON T.id = S.id',
        'WHEN MATCHED THEN UPDATE SET v = S.v',
        'WHEN NOT MATCHED THEN INSERT (id, v) VALUES (S.id, S.v);',
        'SELECT 1',
      ].join('\n');
      expect(split(sql)).toHaveLength(2);
    });

    it('keeps an unterminated block until the end of the input', () => {
      expect(split('BEGIN\n  SELECT 1;\n  SELECT 2;')).toHaveLength(1);
    });

    it('reports ranges that cover the whole block', () => {
      const sql = 'BEGIN SELECT 1; END; SELECT 2';
      const [block, next] = splitStatements(sql, GOOGLESQL);
      expect(sql.slice(block.range.start, block.range.end)).toBe('BEGIN SELECT 1; END');
      expect(sql.slice(next.range.start, next.range.end)).toBe('SELECT 2');
    });

    it('splits a block only on its own terminator in other dialects', () => {
      // Generic keeps the old behavior, so existing plugins are unchanged.
      expect(splitQueries('BEGIN SELECT 1; END;', 'generic')).toHaveLength(2);
    });
  });

  describe('GoogleSQL descriptor non-code spans', () => {
    it('masks triple-quoted, raw and backtick literals and # comments', () => {
      const sql = "SELECT '''a:b''', r'c:d', `e:f` # g:h\nFROM t";
      const spans = scanNonCodeSpans(sql, GOOGLESQL).map(({ start, end }) =>
        sql.slice(start, end),
      );
      expect(spans).toEqual(["'''a:b'''", "r'c:d'", '`e:f`', '# g:h']);
    });
  });
});
