import { describe, it, expect } from 'vitest';
import { scanNonCodeSpans } from '../../../src/utils/sqlSplitter';

/** Rebuilds the length-preserving mask a consumer would apply. */
const maskOf = (sql: string, dialect?: string): string => {
  const spans = scanNonCodeSpans(sql, dialect);
  let masked = '';
  let cursor = 0;
  for (const { start, end } of spans) {
    masked += sql.slice(cursor, start) + ' '.repeat(end - start);
    cursor = end;
  }
  return masked + sql.slice(cursor);
};

describe('scanNonCodeSpans', () => {
  describe('basic spans', () => {
    it('covers a single-quoted literal exactly', () => {
      expect(scanNonCodeSpans("SELECT 'x:y'", 'postgres')).toEqual([
        { start: 7, end: 12 },
      ]);
    });

    it('covers line and block comments', () => {
      expect(scanNonCodeSpans('SELECT 1 -- :ghost', 'postgres')).toEqual([
        { start: 9, end: 18 },
      ]);
      expect(scanNonCodeSpans('/* :ghost */ SELECT 1', 'postgres')).toEqual([
        { start: 0, end: 12 },
      ]);
    });

    it('returns sorted, non-overlapping, in-bounds spans', () => {
      const sql = "SELECT 'a', /* c */ 'b' -- tail";
      const spans = scanNonCodeSpans(sql, 'postgres');
      let previousEnd = 0;
      for (const { start, end } of spans) {
        expect(start).toBeGreaterThanOrEqual(previousEnd);
        expect(end).toBeGreaterThan(start);
        expect(end).toBeLessThanOrEqual(sql.length);
        previousEnd = end;
      }
      // Two literals, one block comment, one line comment.
      expect(spans).toHaveLength(4);
    });

    it('produces a length-preserving mask, including astral characters', () => {
      const sql = "SELECT '😀:id', :id";
      expect(maskOf(sql, 'postgres')).toHaveLength(sql.length);
      // The emoji sits inside the literal, so the whole literal is masked
      // (UTF-16 code-unit indices, same contract as StatementRange).
      expect(maskOf(sql, 'postgres')).toBe('SELECT        , :id');
    });

    it('runs unterminated strings and comments to end of input', () => {
      expect(scanNonCodeSpans("WHERE v = 'x:y", 'postgres')).toEqual([
        { start: 10, end: 14 },
      ]);
      expect(scanNonCodeSpans('/* open :ghost', 'postgres')).toEqual([
        { start: 0, end: 14 },
      ]);
    });
  });

  describe('dialect fallback', () => {
    it('returns no spans when the dialect is undefined or unknown', () => {
      expect(scanNonCodeSpans("SELECT 'x:y'")).toEqual([]);
      expect(scanNonCodeSpans("SELECT 'x:y'", 'does-not-exist')).toEqual([]);
    });

    it('scans with the ANSI-ish rules for an explicit generic', () => {
      expect(scanNonCodeSpans("SELECT 'x:y'", 'generic')).toEqual([
        { start: 7, end: 12 },
      ]);
    });

    it('returns no spans for Object.prototype member names', () => {
      // An `in` check would resolve these via the prototype chain and
      // crash the scanner on a non-DialectOptions value.
      expect(scanNonCodeSpans("SELECT 'x:y'", '__proto__')).toEqual([]);
      expect(scanNonCodeSpans("SELECT 'x:y'", 'toString')).toEqual([]);
      expect(scanNonCodeSpans("SELECT 'x:y'", 'constructor')).toEqual([]);
    });
  });

  describe('postgres', () => {
    it('covers dollar-quoted strings', () => {
      expect(maskOf('SELECT $tag$:hidden$tag$, :visible', 'postgres')).toBe(
        'SELECT                  , :visible',
      );
      expect(maskOf('SELECT $$key:value$$, :visible', 'postgres')).toBe(
        'SELECT              , :visible',
      );
    });

    it('honours E-string backslash escapes', () => {
      expect(maskOf("SELECT E'it\\'s :hidden', :visible", 'postgres')).toBe(
        'SELECT                 , :visible',
      );
    });

    it('tracks nested block comments to the outermost close', () => {
      expect(
        maskOf('SELECT /* a /* :inner */ :after */ :visible', 'postgres'),
      ).toBe('SELECT                             :visible');
    });
  });

  describe('mysql', () => {
    it('honours backslash escapes in strings', () => {
      expect(maskOf("SELECT 'it\\'s :hidden', :visible", 'mysql')).toBe(
        'SELECT                , :visible',
      );
    });

    it('covers backtick-quoted identifiers', () => {
      expect(maskOf('SELECT `weird:col` FROM t', 'mysql')).toBe(
        'SELECT             FROM t',
      );
    });

    it('treats -- without trailing space as data (subtraction)', () => {
      expect(scanNonCodeSpans('SELECT qty--:threshold FROM stock', 'mysql')).toEqual(
        [],
      );
    });

    it('covers # line comments from any position to end of line', () => {
      expect(scanNonCodeSpans('SELECT 1 # :ghost', 'mysql')).toEqual([
        { start: 9, end: 17 },
      ]);
      // No whitespace requirement, unlike `--`.
      expect(scanNonCodeSpans('SELECT qty#:ghost\n, :real', 'mysql')).toEqual([
        { start: 10, end: 17 },
      ]);
    });

    it('rescans MariaDB /*M! conditional comments instead of masking them', () => {
      // MariaDB executes the payload, so :m must stay visible while the
      // literal inside is still masked.
      const sql = "SELECT /*M!100500 CONCAT('x:y'), :m */ :real";
      const start = sql.indexOf("'x:y'");
      expect(scanNonCodeSpans(sql, 'mysql')).toEqual([
        { start, end: start + 5 },
      ]);
    });

    it('rescans executable comment payloads instead of masking them', () => {
      const sql = "SELECT /*!50700 CONCAT('x:y'), :exec */ :outer";
      // Only the inner literal is non-code; the payload (incl. :exec) stays.
      expect(scanNonCodeSpans(sql, 'mysql')).toEqual([{ start: 23, end: 28 }]);
      expect(maskOf(sql, 'mysql')).toBe(
        'SELECT /*!50700 CONCAT(     ), :exec */ :outer',
      );
    });

    it('keeps spans sorted when a payload literal precedes a later outer literal', () => {
      // The payload region is scanned after the rest of its parent, so
      // its span arrives out of document order and must be re-sorted.
      const sql = "SELECT /*!50700 'a' */ 'b'";
      expect(scanNonCodeSpans(sql, 'mysql')).toEqual([
        { start: 16, end: 19 },
        { start: 23, end: 26 },
      ]);
      expect(maskOf(sql, 'mysql')).toBe('SELECT /*!50700     */    ');
    });

    it('survives pathological chains of executable-comment markers', () => {
      // Regression: this used to recurse once per `/*!` header and
      // overflow the native call stack at roughly 15KB of input.
      expect(() => scanNonCodeSpans('/*!'.repeat(10000), 'mysql')).not.toThrow();
      expect(() =>
        scanNonCodeSpans('/*!'.repeat(10000) + 'x' + '*/', 'mysql'),
      ).not.toThrow();
    });

    it('stops rescanning executable-comment payloads past the depth cap', () => {
      // Eight nested headers: the innermost literal is still masked…
      expect(scanNonCodeSpans('/*!'.repeat(8) + "'x:y'", 'mysql')).toHaveLength(1);
      // …nine: the depth-9 payload is left unscanned (nothing masked),
      // degrading to plain-text behavior for the pathological tail.
      expect(scanNonCodeSpans('/*!'.repeat(9) + "'x:y'", 'mysql')).toEqual([]);
    });

    it('does not honour a DELIMITER directive in the middle of a line', () => {
      // Mid-line DELIMITER is plain data, so the quoted part is a string.
      expect(
        scanNonCodeSpans("SELECT DELIMITER ':ghost' AS d, :real", 'mysql'),
      ).toEqual([{ start: 17, end: 25 }]);
    });

    it('applies a custom delimiter that collides with a comment opener', () => {
      // After `DELIMITER /*`, the `/*` sequence is the statement delimiter,
      // not a block-comment opener — nothing here is non-code.
      expect(
        scanNonCodeSpans('DELIMITER /*\nSELECT :before/*\nSELECT :after;\n', 'mysql'),
      ).toEqual([]);
    });
  });

  describe('postgres identifier boundaries', () => {
    it('does not treat a dollar quote glued to an identifier as an opener', () => {
      // `foo$tag$` is a single PostgreSQL identifier, not a string start.
      expect(
        scanNonCodeSpans('SELECT foo$tag$ + :real + bar$tag$ FROM t', 'postgres'),
      ).toEqual([]);
    });
  });

  describe('oracle and mssql', () => {
    it('covers oracle q-quoted strings', () => {
      expect(maskOf("SELECT q'{it's :hidden}' FROM dual", 'oracle')).toBe(
        'SELECT                   FROM dual',
      );
    });

    it('covers mssql bracket identifiers', () => {
      expect(maskOf('SELECT [weird:col] FROM t', 'mssql')).toBe(
        'SELECT             FROM t',
      );
    });

    it('covers mssql double-quoted identifiers', () => {
      expect(maskOf('SELECT ":ghost" FROM t WHERE id = :id', 'mssql')).toBe(
        'SELECT          FROM t WHERE id = :id',
      );
    });

    it('tracks nested t-sql block comments to the outermost close', () => {
      expect(
        scanNonCodeSpans('/* outer /* inner */ :ghost */ SELECT :real', 'mssql'),
      ).toEqual([{ start: 0, end: 30 }]);
    });

    it('advances past GO and slash delimiter lines without stalling', () => {
      expect(scanNonCodeSpans('SELECT 1\nGO\nSELECT 2', 'mssql')).toEqual([]);
      expect(scanNonCodeSpans('SELECT 1\n/\nSELECT 2', 'oracle')).toEqual([]);
    });
  });
});
