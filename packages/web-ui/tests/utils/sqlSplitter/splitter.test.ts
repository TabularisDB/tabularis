import { describe, it, expect } from 'vitest';
import { splitStatements, splitQueries } from '../../../src/utils/sqlSplitter';

describe('splitStatements', () => {
  describe('#223 — comment-only fragments fold', () => {
    it('folds trailing inline comment into the preceding statement (the bug)', () => {
      const sql = [
        '-- ============================================',
        '-- Any header comment block',
        '-- ============================================',
        'SELECT * FROM big_table ORDER BY id;  -- 500+ rows',
      ].join('\n');
      const result = splitStatements(sql);
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('SELECT * FROM big_table ORDER BY id');
      expect(result[0].text).toContain('-- 500+ rows');
      expect(result[0].text).toContain('Any header comment block');
    });

    it('folds a mid-input comment-only fragment into the NEXT statement', () => {
      const sql = 'SELECT 1; /* mid */ ; SELECT 2;';
      const result = splitStatements(sql);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('SELECT 1');
      expect(result[1].text).toContain('/* mid */');
      expect(result[1].text).toContain('SELECT 2');
    });

    it('returns an empty array when the input has only comments', () => {
      expect(splitStatements('-- only')).toEqual([]);
      expect(splitStatements('/* only */')).toEqual([]);
      expect(splitStatements('-- a\n/* b */\n-- c\n')).toEqual([]);
    });

    it('preserves the original behavior for leading comments', () => {
      const sql = '-- header\nSELECT 1;';
      const result = splitStatements(sql);
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('-- header');
      expect(result[0].text).toContain('SELECT 1');
    });
  });

  describe('basic splitting', () => {
    it('splits two statements by semicolon', () => {
      const result = splitQueries('SELECT 1; SELECT 2;');
      expect(result).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('handles a single statement with no terminator', () => {
      expect(splitQueries('SELECT 1')).toEqual(['SELECT 1']);
    });

    it('returns [] for empty input', () => {
      expect(splitQueries('')).toEqual([]);
      expect(splitQueries('   \n\t  ')).toEqual([]);
    });

    it('ignores semicolons inside single-quoted strings', () => {
      const result = splitQueries("SELECT * FROM t WHERE n = 'a;b'; SELECT 2");
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("SELECT * FROM t WHERE n = 'a;b'");
      expect(result[1]).toBe('SELECT 2');
    });

    it('ignores semicolons inside double-quoted identifiers', () => {
      const result = splitQueries('SELECT "a;b" FROM t; SELECT 2');
      expect(result).toHaveLength(2);
    });

    it('ignores semicolons inside block comments', () => {
      const result = splitQueries('SELECT 1 /* ; */; SELECT 2');
      expect(result).toEqual(['SELECT 1 /* ; */', 'SELECT 2']);
    });
  });

  describe('postgres dollar-quoting', () => {
    it('treats semicolons inside $$ ... $$ as data', () => {
      const sql = 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;';
      const result = splitStatements(sql);
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('PERFORM 1');
      expect(result[0].text).toContain('PERFORM 2');
    });

    it('respects $tag$ ... $tag$ delimiters', () => {
      const sql = 'DO $body$ SELECT 1; SELECT 2 $body$; SELECT 3;';
      const result = splitQueries(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('$body$');
      expect(result[1]).toBe('SELECT 3');
    });
  });

  describe('mysql custom delimiter round-trip', () => {
    it('handles DELIMITER // then back to ;', () => {
      const sql = [
        'DELIMITER //',
        'SELECT 1//',
        'SELECT 2//',
        'DELIMITER ;',
        'SELECT 3;',
      ].join('\n');
      const result = splitQueries(sql, 'mysql');
      expect(result).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
    });

    it('keeps an inline `-- comment` after DELIMITER out of the delimiter token', () => {
      // Old regex pulled `[^\n\r]+`, swallowing the comment as part of
      // the delimiter value. With the new `\S+` rule the delimiter is
      // the bare `//`, so subsequent `SELECT 1//` actually splits. The
      // line comment trails inside the following segment, which is the
      // expected fold behaviour (NEXT-meaningful wins).
      const sql = [
        'DELIMITER //  -- switch to slashes',
        'SELECT 1//',
        'SELECT 2//',
      ].join('\n');
      const result = splitQueries(sql, 'mysql');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('SELECT 1');
      expect(result[0]).toContain('-- switch to slashes');
      expect(result[1]).toBe('SELECT 2');
    });
  });

  describe('mysql executable conditional comments', () => {
    it('emits `/*! ... */` as a standalone statement', () => {
      const sql = '/*!40101 SET NAMES utf8 */;\nSELECT * FROM users;';
      const result = splitQueries(sql, 'mysql');
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('/*!40101 SET NAMES utf8 */');
      expect(result[1]).toBe('SELECT * FROM users');
    });

    it('treats a plain block comment normally on mysql', () => {
      const sql = '/* plain */\nSELECT 1;';
      const [stmt] = splitStatements(sql, 'mysql');
      expect(stmt.text).toContain('/* plain */');
      expect(stmt.text).toContain('SELECT 1');
    });
  });

  describe('postgres nested block comments', () => {
    it('does not split on `;` inside a nested block comment', () => {
      const sql = '/* outer /* inner ; */ outer */ SELECT 1;';
      const result = splitQueries(sql, 'postgres');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('SELECT 1');
    });

    it('mysql still terminates at the first `*/`', () => {
      // MySQL block comments do not nest; the first `*/` closes.
      const sql = '/* outer /* inner */ trailing */ SELECT 1';
      const result = splitQueries(sql, 'mysql');
      expect(result[0]).toContain('SELECT 1');
    });
  });

  describe('mssql GO separator', () => {
    it('splits on a line-leading GO', () => {
      const sql = 'SELECT 1\nGO\nSELECT 2';
      const result = splitQueries(sql, 'mssql');
      expect(result).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('does not split when GO is inside a string literal', () => {
      const sql = "SELECT 'GO' FROM t";
      const result = splitQueries(sql, 'mssql');
      expect(result).toEqual(["SELECT 'GO' FROM t"]);
    });

    it('does not split when GO is mid-line', () => {
      const sql = 'SELECT 1 GO SELECT 2';
      const result = splitQueries(sql, 'mssql');
      expect(result).toHaveLength(1);
    });

    it('accepts an optional repeat-count after GO (e.g. `GO 5`)', () => {
      // sqlcmd/SSMS treat `GO 5` as "run the preceding batch 5 times".
      // The splitter still emits a single batch boundary; the runner is
      // responsible for any repetition.
      const sql = 'SELECT 1\nGO 5\nSELECT 2';
      const result = splitQueries(sql, 'mssql');
      expect(result).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('still rejects GO followed by a non-numeric token', () => {
      const sql = 'SELECT 1\nGO foo\nSELECT 2';
      const result = splitQueries(sql, 'mssql');
      // Falls through to one big statement because `GO foo` does not
      // match the batch separator.
      expect(result).toHaveLength(1);
    });
  });

  describe('oracle slash terminator and PL/SQL blocks', () => {
    it('splits plain SQL on a line-leading slash', () => {
      const sql = ['SELECT 1 FROM dual', '/', 'SELECT 2 FROM dual', '/'].join(
        '\n',
      );
      expect(splitQueries(sql, 'oracle')).toEqual([
        'SELECT 1 FROM dual',
        'SELECT 2 FROM dual',
      ]);
    });

    it('treats a CRLF slash line as a separator', () => {
      expect(
        splitQueries('SELECT 1 FROM dual\r\n/\r\nSELECT 2 FROM dual', 'oracle'),
      ).toEqual(['SELECT 1 FROM dual', 'SELECT 2 FROM dual']);
    });

    it('keeps generic splitting unchanged for line-leading slash input', () => {
      const sql = ['SELECT 1', '/', 'SELECT 2'].join('\n');
      expect(splitQueries(sql, 'generic')).toEqual([sql]);
    });

    it('keeps a DM trigger body together until the slash terminator', () => {
      const sql = [
        'CREATE OR REPLACE TRIGGER TRG_SPLITTER_VFY',
        'AFTER UPDATE OF STATUS, TOTAL_AMOUNT ON ORDERS',
        'FOR EACH ROW',
        'BEGIN',
        '  INSERT INTO ORDER_AUDIT (',
        '    ID,',
        '    ORDER_ID,',
        '    OLD_STATUS,',
        '    NEW_STATUS',
        '  ) VALUES (',
        '    ORDER_AUDIT_SEQ.NEXTVAL,',
        '    :OLD.ID,',
        '    :OLD.STATUS,',
        '    :NEW.STATUS',
        '  );',
        'END;',
        '/',
        'SELECT 1 FROM dual;',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('CREATE OR REPLACE TRIGGER');
      expect(result[0]).toContain('ORDER_AUDIT_SEQ.NEXTVAL');
      expect(result[0]).toContain('END;');
      expect(result[0]).not.toContain('\n/');
      expect(result[1]).toBe('SELECT 1 FROM dual');
    });

    it('does not split nested BEGIN...END bodies on internal semicolons', () => {
      const sql = [
        'BEGIN',
        '  IF TRUE THEN',
        '    NULL;',
        '  END IF;',
        '  LOOP',
        '    EXIT;',
        '  END LOOP;',
        'END;',
        '/',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('END IF;');
      expect(result[0]).toContain('END LOOP;');
    });

    it('keeps package bodies with multiple procedures together', () => {
      const sql = [
        'CREATE OR REPLACE PACKAGE BODY pkg_demo AS',
        '  PROCEDURE p1 IS',
        '  BEGIN',
        '    NULL;',
        '  END;',
        '',
        '  PROCEDURE p2 IS',
        '  BEGIN',
        '    NULL;',
        '  END;',
        'END pkg_demo;',
        '/',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('PROCEDURE p1');
      expect(result[0]).toContain('PROCEDURE p2');
    });

    it('keeps DM CREATE CLASS and CLASS BODY blocks together', () => {
      const sql = [
        'CREATE OR REPLACE CLASS CLS_SPLITTER_VFY AS',
        '  STATIC FUNCTION NAME RETURN VARCHAR;',
        'END;',
        '/',
        'CREATE OR REPLACE CLASS BODY CLS_SPLITTER_VFY AS',
        '  STATIC FUNCTION NAME RETURN VARCHAR AS',
        '  BEGIN',
        "    RETURN 'ok';",
        '  END;',
        'END;',
        '/',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('CREATE OR REPLACE CLASS');
      expect(result[1]).toContain('CREATE OR REPLACE CLASS BODY');
    });

    it('keeps DM CREATE JAVA CLASS blocks together', () => {
      const sql = [
        'CREATE OR REPLACE JAVA CLASS JCLS_SPLITTER_VFY {',
        '  public static String name() {',
        '    return "a;b";',
        '  }',
        '}',
        '/',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('return "a;b";');
    });

    it('keeps CREATE AND RESOLVE NOFORCE JAVA SOURCE blocks together', () => {
      const sql = [
        'CREATE OR REPLACE AND RESOLVE NOFORCE JAVA SOURCE NAMED "Demo" AS',
        'public class Demo {',
        '  public static String name() {',
        '    return "a;b";',
        '  }',
        '}',
        '/',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('return "a;b";');
    });

    it('does not treat CREATE TYPE specs or CREATE LIBRARY as block openers', () => {
      expect(
        splitQueries(
          'CREATE TYPE t_demo AS OBJECT (id NUMBER); SELECT 1 FROM dual',
          'oracle',
        ),
      ).toEqual([
        'CREATE TYPE t_demo AS OBJECT (id NUMBER)',
        'SELECT 1 FROM dual',
      ]);

      expect(
        splitQueries(
          "CREATE LIBRARY lib_demo AS '/tmp/libdemo.so'; SELECT 1 FROM dual",
          'oracle',
        ),
      ).toEqual([
        "CREATE LIBRARY lib_demo AS '/tmp/libdemo.so'",
        'SELECT 1 FROM dual',
      ]);
    });

    it('keeps CREATE TYPE BODY blocks together', () => {
      const sql = [
        'CREATE TYPE BODY t_demo AS',
        '  MEMBER FUNCTION name RETURN VARCHAR IS',
        '  BEGIN',
        "    RETURN 'a;b';",
        '  END;',
        'END;',
        '/',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("RETURN 'a;b';");
    });

    it('shields semicolons and slash lines inside q-quoted strings', () => {
      const sql = [
        "SELECT q'[first;",
        '/',
        "second]' FROM dual",
        '/',
        'SELECT 2 FROM dual',
      ].join('\n');

      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("q'[first;");
      expect(result[0]).toContain("second]'");
    });

    it('shields semicolons inside nq-quoted strings', () => {
      const sql = "SELECT nq'{a;b}' FROM dual; SELECT 2 FROM dual";
      expect(splitQueries(sql, 'oracle')).toEqual([
        "SELECT nq'{a;b}' FROM dual",
        'SELECT 2 FROM dual',
      ]);
    });

    it('handles comment-tolerant CREATE openers', () => {
      const sql = [
        'CREATE /* comment */ OR REPLACE PROCEDURE p_demo AS',
        'BEGIN',
        '  NULL;',
        'END;',
        '/',
      ].join('\n');

      expect(splitQueries(sql, 'oracle')).toHaveLength(1);
    });

    it('handles labeled blocks', () => {
      const sql = ['<<outer_block>>', 'BEGIN', '  NULL;', 'END;', '/'].join(
        '\n',
      );
      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('<<outer_block>>');
    });

    it('treats WITH FUNCTION as a PL/SQL block but CTEs named function as normal SQL', () => {
      const inlineFunction = [
        'WITH FUNCTION f RETURN NUMBER IS',
        'BEGIN',
        '  RETURN 1;',
        'END;',
        'SELECT f FROM dual',
        '/',
      ].join('\n');
      expect(splitQueries(inlineFunction, 'oracle')).toHaveLength(1);

      expect(
        splitQueries('WITH function AS (SELECT 1 x FROM dual) SELECT x FROM function;', 'oracle'),
      ).toHaveLength(1);
      expect(
        splitQueries(
          'WITH function (x) AS (SELECT 1 FROM dual) SELECT x FROM function;',
          'oracle',
        ),
      ).toHaveLength(1);
    });

    it('treats WITH PROCEDURE as a PL/SQL block', () => {
      const inlineProcedure = [
        'WITH PROCEDURE p IS',
        'BEGIN',
        '  NULL;',
        'END;',
        'SELECT 1 FROM dual',
        '/',
      ].join('\n');

      const result = splitQueries(inlineProcedure, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('NULL;');
    });

    it('keeps a PL/SQL block together at EOF without a trailing slash', () => {
      const sql = ['CREATE OR REPLACE PROCEDURE p_demo AS', 'BEGIN', '  NULL;', 'END;'].join(
        '\n',
      );
      const result = splitQueries(sql, 'oracle');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('NULL;');
      expect(result[0]).toContain('END;');
    });

    it('keeps END semicolon ownership when the slash terminates the following whitespace segment', () => {
      const sql = ['CREATE OR REPLACE PROCEDURE p_demo AS', 'BEGIN', '  NULL;', 'END;', '/'].join(
        '\n',
      );
      const [stmt] = splitStatements(sql, 'oracle');
      expect(stmt.text).toContain('END;');
      expect(sql.slice(stmt.range.start, stmt.range.end)).toContain('END;');
    });

    it('documents the SQL*Plus-compatible division continuation tradeoff', () => {
      const sql = ['SELECT 10', '/', '2 FROM dual'].join('\n');
      expect(splitQueries(sql, 'oracle')).toEqual(['SELECT 10', '2 FROM dual']);
    });

    it('does not split on a slash followed by more tokens on the same line', () => {
      const sql = 'SELECT 10\n/2 FROM dual';
      expect(splitQueries(sql, 'oracle')).toEqual([sql]);
    });
  });

  describe('mysql `--` requires trailing whitespace', () => {
    it('treats `1--1` as the subtraction operator, not a comment', () => {
      // MySQL parses `--` as subtraction unless followed by whitespace,
      // so `SELECT 1--1` is `2`, a single statement, not `SELECT 1`
      // with a trailing comment.
      const result = splitQueries('SELECT 1--1', 'mysql');
      expect(result).toEqual(['SELECT 1--1']);
    });

    it('still treats `-- ` (with trailing space) as a comment', () => {
      // The MySQL line-comment rule requires whitespace after `--`,
      // not its absence. `-- header` followed by `\n` is a normal
      // comment and folds into the next meaningful statement.
      const [stmt] = splitStatements('-- header\nSELECT 1', 'mysql');
      expect(stmt.text).toContain('-- header');
      expect(stmt.text).toContain('SELECT 1');
    });

    it('does not apply the rule under postgres (`--` is always a comment)', () => {
      // Sanity check: the MySQL-only rule must not regress other dialects.
      // Postgres treats `--1` as a line comment, so the splitter keeps
      // the source intact as one statement with the trailing comment
      // folded in.
      const result = splitQueries('SELECT 1--1', 'postgres');
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('SELECT 1');
    });
  });

  describe('statement metadata', () => {
    it('annotates SELECT as isSelect / returnsResultSet / isExplainable', () => {
      const [stmt] = splitStatements('SELECT 1;');
      expect(stmt.isSelect).toBe(true);
      expect(stmt.returnsResultSet).toBe(true);
      expect(stmt.isExplainable).toBe(true);
    });

    it('annotates DDL as none of those', () => {
      const [stmt] = splitStatements('CREATE TABLE t (id INT);');
      expect(stmt.isSelect).toBe(false);
      expect(stmt.returnsResultSet).toBe(false);
      expect(stmt.isExplainable).toBe(false);
    });

    it('annotates UPDATE as explainable but not returning result set', () => {
      const [stmt] = splitStatements("UPDATE t SET x = 1 WHERE id = 2;");
      expect(stmt.isSelect).toBe(false);
      expect(stmt.returnsResultSet).toBe(false);
      expect(stmt.isExplainable).toBe(true);
    });
  });

  describe('range', () => {
    it('reports source string indices for the emitted statement', () => {
      const sql = 'SELECT 1; SELECT 2';
      const [a, b] = splitStatements(sql);
      expect(a.range.start).toBe(0);
      expect(a.range.end).toBe(8); // up to but excluding `;`
      // The space between `;` and `SELECT 2` is whitespace, not part of
      // the SQL body. range should point at the first non-space char so
      // sql.slice(range.start, range.end) returns clean SQL.
      expect(b.range.start).toBe(10);
      expect(b.range.end).toBe(sql.length);
      expect(sql.slice(b.range.start, b.range.end)).toBe('SELECT 2');
    });

    it('excludes a folded trailing comment from range while keeping it in text', () => {
      // Range should point at the SQL body only — `sql.slice(range)` must
      // remain valid SQL. Display text still includes the folded comment
      // so the run-button dropdown shows the user-visible label.
      const sql = 'SELECT 1; -- trail';
      const [stmt] = splitStatements(sql);
      expect(stmt.range.start).toBe(0);
      expect(stmt.range.end).toBe(8);
      expect(sql.slice(stmt.range.start, stmt.range.end)).toBe('SELECT 1');
      expect(stmt.text).toContain('-- trail');
    });

    it('range points at the meaningful body when a comment-only segment is folded into NEXT', () => {
      const sql = 'SELECT 1; /* mid */ ; SELECT 2;';
      const [, b] = splitStatements(sql);
      // Meaningful for the second emitted statement is ` SELECT 2` after
      // the second `;`. Range excludes the `/* mid */ ;` chunk that gets
      // prepended to text.
      expect(sql.slice(b.range.start, b.range.end).trim()).toBe('SELECT 2');
      expect(b.text).toContain('/* mid */');
      expect(b.text).toContain('SELECT 2');
    });
  });

  describe('CRLF input', () => {
    it('splits on `;` even when line endings are CRLF', () => {
      const result = splitQueries('SELECT 1;\r\nSELECT 2;\r\n');
      expect(result).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('treats a CRLF GO line as a separator under mssql', () => {
      const result = splitQueries('SELECT 1\r\nGO\r\nSELECT 2', 'mssql');
      expect(result).toEqual(['SELECT 1', 'SELECT 2']);
    });
  });

  describe('escape-shield end-to-end', () => {
    it('postgres E-string with an escaped semicolon does not split', () => {
      const sql = "SELECT E'a\\;b' FROM t; SELECT 2";
      const result = splitQueries(sql, 'postgres');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("E'a\\;b'");
      expect(result[1]).toBe('SELECT 2');
    });

    it('mysql backticked identifier shields a semicolon', () => {
      const result = splitQueries('SELECT `col;name` FROM t; SELECT 2', 'mysql');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('`col;name`');
    });

    it('mssql `]]` escape keeps a bracketed identifier intact across `]`', () => {
      // T-SQL: `[col]]name]` is the identifier literally named `col]name`.
      // Before doubleClose was wired up on the bracket rule, the first
      // `]` closed the quote and the trailing `;` after `name]` mid-token
      // would split incorrectly.
      const sql = 'SELECT [col]]name] FROM t; SELECT 2';
      const result = splitQueries(sql, 'mssql');
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('[col]]name]');
      expect(result[1]).toBe('SELECT 2');
    });
  });

  describe('unterminated lenience', () => {
    it('emits an unterminated string as part of its statement', () => {
      const result = splitQueries("SELECT 'never closes");
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('SELECT');
    });
  });
});
