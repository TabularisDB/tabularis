import { describe, it, expect } from 'vitest';
import { extractQueryParams, interpolateQueryParams, toBindParamName } from '../../src/utils/queryParameters';

describe('queryParameters', () => {
  describe('toBindParamName', () => {
    it('should keep valid identifiers unchanged', () => {
      expect(toBindParamName('user_id')).toBe('user_id');
      expect(toBindParamName('email')).toBe('email');
    });

    it('should replace spaces and special characters with underscores', () => {
      expect(toBindParamName('user name')).toBe('user_name');
      expect(toBindParamName('email-address')).toBe('email_address');
      expect(toBindParamName('order.total')).toBe('order_total');
    });

    it('should prefix identifiers starting with a digit', () => {
      expect(toBindParamName('123')).toBe('_123');
      expect(toBindParamName('2nd_column')).toBe('_2nd_column');
    });

    it('should handle empty input', () => {
      expect(toBindParamName('')).toBe('_');
    });

    it('should always produce an editor-recognised :param name', () => {
      const pattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      for (const name of ['user name', '123', '', 'a-b-c', 'données', '€']) {
        const param = toBindParamName(name);
        expect(param).toMatch(pattern);
        // The generated name must round-trip through the editor's extractor.
        expect(extractQueryParams(`SELECT * FROM t WHERE c = :${param}`)).toEqual([param]);
      }
    });
  });

  describe('extractQueryParams', () => {
    it('should extract simple parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = :id AND name = :name';
      const params = extractQueryParams(sql);
      expect(params).toEqual(expect.arrayContaining(['id', 'name']));
      expect(params).toHaveLength(2);
    });

    it('should deduplicate parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = :id OR parent_id = :id';
      const params = extractQueryParams(sql);
      expect(params).toEqual(['id']);
    });

    it('should ignore postgres casts (::)', () => {
      const sql = 'SELECT price::numeric FROM products WHERE id = :prod_id';
      const params = extractQueryParams(sql);
      expect(params).toEqual(['prod_id']);
    });

    it('should return empty array if no params', () => {
      const sql = 'SELECT * FROM users';
      expect(extractQueryParams(sql)).toEqual([]);
    });

    it('should handle underscores in param names', () => {
        const sql = 'SELECT * FROM t WHERE col = :my_custom_param_1';
        expect(extractQueryParams(sql)).toEqual(['my_custom_param_1']);
    });
  });

  describe('interpolateQueryParams', () => {
    it('should replace parameters with values', () => {
      const sql = 'SELECT * FROM users WHERE id = :id';
      const result = interpolateQueryParams(sql, { id: '123' });
      expect(result).toBe('SELECT * FROM users WHERE id = 123');
    });

    it('should handle multiple occurrences', () => {
      const sql = 'SELECT * FROM users WHERE id = :id OR parent_id = :id';
      const result = interpolateQueryParams(sql, { id: '5' });
      expect(result).toBe('SELECT * FROM users WHERE id = 5 OR parent_id = 5');
    });

    it('should leave unknown params untouched', () => {
      const sql = 'SELECT * FROM users WHERE id = :id';
      const result = interpolateQueryParams(sql, {});
      expect(result).toBe('SELECT * FROM users WHERE id = :id');
    });

    it('should ignore postgres casts during replacement', () => {
        const sql = 'SELECT val::text FROM t WHERE id = :id';
        const result = interpolateQueryParams(sql, { id: '10' });
        expect(result).toBe('SELECT val::text FROM t WHERE id = 10');
    });
  });

  describe('extractQueryParams with dialect (issue #458)', () => {
    it('ignores :name inside single-quoted literals', () => {
      const sql = "SELECT * FROM categories WHERE value = 'x:y'";
      expect(extractQueryParams(sql, 'postgres')).toEqual([]);
      expect(extractQueryParams(sql, 'mysql')).toEqual([]);
    });

    it('still detects a real param next to a literal', () => {
      const sql = "SELECT * FROM t WHERE a = 'x:y' AND b = :real";
      expect(extractQueryParams(sql, 'postgres')).toEqual(['real']);
    });

    it('ignores params inside comments', () => {
      expect(extractQueryParams('SELECT 1 -- :ghost', 'postgres')).toEqual([]);
      expect(
        extractQueryParams('SELECT 1 /* :ghost */, :real', 'postgres'),
      ).toEqual(['real']);
    });

    it('keeps the ::cast exclusion when a dialect is passed', () => {
      expect(extractQueryParams("SELECT 'x'::text, :id", 'postgres')).toEqual([
        'id',
      ]);
    });

    it('handles boundary cases around masked regions', () => {
      // Param immediately after a comment, and a comment splitting what
      // would otherwise read as one name.
      expect(extractQueryParams('/*c*/:id', 'postgres')).toEqual(['id']);
      expect(extractQueryParams(':na/*c*/me', 'postgres')).toEqual(['na']);
      expect(extractQueryParams("'x':y", 'postgres')).toEqual(['y']);
    });

    it('handles postgres dollar quotes, E-strings and nested comments', () => {
      expect(
        extractQueryParams('SELECT $tag$:hidden$tag$, :visible', 'postgres'),
      ).toEqual(['visible']);
      expect(
        extractQueryParams("SELECT E'it\\'s :hidden', :visible", 'postgres'),
      ).toEqual(['visible']);
      expect(
        extractQueryParams('SELECT /* a /* :inner */ :after */ :visible', 'postgres'),
      ).toEqual(['visible']);
    });

    it('handles mysql backslash escapes and backticks', () => {
      expect(
        extractQueryParams("SELECT 'it\\'s :hidden', :visible", 'mysql'),
      ).toEqual(['visible']);
      expect(
        extractQueryParams('SELECT `weird:col` FROM t WHERE id = :id', 'mysql'),
      ).toEqual(['id']);
    });

    it('treats mysql -- without a space as subtraction, keeping the param', () => {
      expect(
        extractQueryParams('SELECT qty--:threshold FROM stock', 'mysql'),
      ).toEqual(['threshold']);
    });

    it('detects params inside mysql executable comments but not their literals', () => {
      expect(
        extractQueryParams("SELECT /*!50700 CONCAT('x:y'), :exec */ :outer", 'mysql'),
      ).toEqual(['exec', 'outer']);
    });

    it('survives pathological chains of executable-comment markers', () => {
      // Regression: this used to overflow the call stack around 15KB.
      expect(() => extractQueryParams('/*!'.repeat(10000), 'mysql')).not.toThrow();
      // Past the rescan depth cap, detection degrades to plain text and
      // still sees the real parameter.
      expect(extractQueryParams('/*!'.repeat(10000) + ':id', 'mysql')).toEqual([
        'id',
      ]);
    });

    it('treats Object.prototype member names as unknown dialects', () => {
      const sql = "SELECT 'x:y', :real";
      expect(extractQueryParams(sql, '__proto__')).toEqual(['y', 'real']);
      expect(extractQueryParams(sql, 'toString')).toEqual(['y', 'real']);
    });

    it('handles oracle q-quotes and mssql bracket identifiers', () => {
      expect(
        extractQueryParams("SELECT q'{it's :hidden}' FROM dual WHERE id = :id", 'oracle'),
      ).toEqual(['id']);
      expect(
        extractQueryParams('SELECT [weird:col] FROM t WHERE id = :id', 'mssql'),
      ).toEqual(['id']);
    });

    it('suppresses params inside an unterminated string while typing', () => {
      expect(extractQueryParams("WHERE v = 'x:y", 'postgres')).toEqual([]);
    });

    it('falls back to maskless detection without a known dialect', () => {
      const sql = "SELECT 'x:y', :real";
      // Pre-#458 behavior is preserved verbatim when no dialect is known…
      expect(extractQueryParams(sql)).toEqual(['y', 'real']);
      expect(extractQueryParams(sql, 'does-not-exist')).toEqual(['y', 'real']);
      // …because guessing wrong is worse: generic quote rules would read
      // MySQL's escaped quote as a string end and swallow :x entirely.
      expect(extractQueryParams("SELECT 'a\\'b', :x", 'mysql')).toEqual(['x']);
      expect(extractQueryParams("SELECT 'a\\'b', :x")).toEqual(['x']);
    });

    it('ignores params inside mysql # comments', () => {
      expect(extractQueryParams('SELECT 1 # :ghost\n, :real', 'mysql')).toEqual([
        'real',
      ]);
    });

    it('detects params inside mariadb /*M! comments but not their literals', () => {
      expect(
        extractQueryParams("SELECT 1 /*M! + :inside */ + :real", 'mysql'),
      ).toEqual(['inside', 'real']);
      expect(
        extractQueryParams("SELECT /*M! CONCAT('x:y'), :m */ :real", 'mysql'),
      ).toEqual(['m', 'real']);
    });

    it('handles mssql double-quoted identifiers and nested comments', () => {
      expect(extractQueryParams('SELECT ":ghost", :real', 'mssql')).toEqual([
        'real',
      ]);
      expect(
        extractQueryParams('/* a /* b */ :ghost */ SELECT :real', 'mssql'),
      ).toEqual(['real']);
    });

    it('does not treat postgres identifiers containing $tag$ as strings', () => {
      expect(
        extractQueryParams('SELECT foo$tag$ + :real + bar$tag$', 'postgres'),
      ).toEqual(['real']);
    });
  });

  describe('interpolateQueryParams with dialect (issue #458)', () => {
    it('never rewrites inside string literals', () => {
      const sql = "SELECT ':id', :id";
      expect(interpolateQueryParams(sql, { id: '9' }, 'postgres')).toBe(
        "SELECT ':id', 9",
      );
    });

    it('never rewrites inside comments', () => {
      const sql = 'SELECT :id -- :id in comment';
      expect(interpolateQueryParams(sql, { id: '5' }, 'postgres')).toBe(
        'SELECT 5 -- :id in comment',
      );
    });

    it('replaces every occurrence by position', () => {
      expect(interpolateQueryParams(':id + :id', { id: '7' }, 'postgres')).toBe(
        '7 + 7',
      );
      expect(
        interpolateQueryParams(':first + :last', { first: '1', last: '2' }, 'postgres'),
      ).toBe('1 + 2');
    });

    it('keeps indices aligned after astral characters', () => {
      const sql = "SELECT '😀:id', :id";
      expect(interpolateQueryParams(sql, { id: '11' }, 'postgres')).toBe(
        "SELECT '😀:id', 11",
      );
    });

    it('leaves unknown params untouched around replaced ones', () => {
      expect(
        interpolateQueryParams('SELECT :known, :unknown', { known: '1' }, 'postgres'),
      ).toBe('SELECT 1, :unknown');
    });

    it('leaves params named after Object.prototype members untouched', () => {
      // A plain `params[name]` lookup would resolve :toString via the
      // prototype chain and splice function source into the SQL.
      expect(
        interpolateQueryParams('SELECT :toString, :id', { id: '1' }, 'postgres'),
      ).toBe('SELECT :toString, 1');
      expect(interpolateQueryParams('SELECT :__proto__', {})).toBe(
        'SELECT :__proto__',
      );
    });

    it('handles values shorter and longer than the placeholder', () => {
      expect(
        interpolateQueryParams(
          'a = :long_parameter_name',
          { long_parameter_name: '1' },
          'postgres',
        ),
      ).toBe('a = 1');
      expect(
        interpolateQueryParams('a = :x', { x: "'quite a long value'" }, 'postgres'),
      ).toBe("a = 'quite a long value'");
    });

    it('keeps ::cast adjacency intact', () => {
      expect(
        interpolateQueryParams('SELECT :id::text, val::text', { id: "'abc'" }, 'postgres'),
      ).toBe("SELECT 'abc'::text, val::text");
    });

    it('preserves pre-dialect behavior when dialect is omitted', () => {
      // Matches the old full-text replace — including its literal-corruption
      // flaw — so existing callers see zero change until they pass a dialect.
      expect(interpolateQueryParams("SELECT ':id', :id", { id: '9' })).toBe(
        "SELECT '9', 9",
      );
    });
  });
});
