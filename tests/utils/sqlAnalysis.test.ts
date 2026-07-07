import { describe, it, expect } from 'vitest';
import { parseTablesFromQuery, getCurrentStatement, isDestructiveWithoutWhere, classifyDangerousQuery, isDangerousQuery } from '../../src/utils/sqlAnalysis';

describe('sqlAnalysis utils', () => {
  describe('parseTablesFromQuery', () => {
    it('should return null for empty or non-FROM queries', () => {
      expect(parseTablesFromQuery('')).toBeNull();
      expect(parseTablesFromQuery('SELECT 1')).toBeNull();
      expect(parseTablesFromQuery('UPDATE t SET c=1')).toBeNull(); // Currently only looks for FROM/JOIN
    });

    it('should extract simple table name', () => {
      const result = parseTablesFromQuery('SELECT * FROM users');
      expect(result).not.toBeNull();
      expect(result?.get('users')?.name).toBe('users');
    });

    it('should extract table with alias', () => {
      const result = parseTablesFromQuery('SELECT * FROM users u');
      expect(result?.get('u')?.name).toBe('users');
    });

    it('should extract table with AS alias', () => {
      const result = parseTablesFromQuery('SELECT * FROM users AS u');
      expect(result?.get('u')?.name).toBe('users');
    });

    it('should extract multiple tables (JOIN)', () => {
      const sql = 'SELECT * FROM users u JOIN posts p ON u.id = p.user_id';
      const result = parseTablesFromQuery(sql);
      expect(result?.get('u')?.name).toBe('users');
      expect(result?.get('p')?.name).toBe('posts');
    });

    it('should handle backticks', () => {
      const result = parseTablesFromQuery('SELECT * FROM `my_table` `mt`');
      expect(result?.get('mt')?.name).toBe('my_table');
    });

    it('should handle complex joins', () => {
        const sql = `
            SELECT * FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            INNER JOIN products p ON o.prod_id = p.id
        `;
        const result = parseTablesFromQuery(sql);
        expect(result?.get('o')?.name).toBe('orders');
        expect(result?.get('u')?.name).toBe('users');
        expect(result?.get('p')?.name).toBe('products');
    });

    it('does not register a keyword as an alias when it follows a table name', () => {
      // Unaliased JOIN: both tables keyed by their own name, JOIN not an alias.
      const r = parseTablesFromQuery('SELECT * FROM users JOIN orders');
      expect(r?.get('users')?.name).toBe('users');
      expect(r?.get('orders')?.name).toBe('orders');
      expect(r?.has('join')).toBe(false);

      // JOIN-type keywords must not become aliases of the preceding table.
      const left = parseTablesFromQuery('SELECT * FROM a LEFT JOIN b ON a.id = b.a_id');
      expect(left?.get('a')?.name).toBe('a');
      expect(left?.get('b')?.name).toBe('b');
      expect(left?.has('left')).toBe(false);

      const natural = parseTablesFromQuery('SELECT * FROM t NATURAL JOIN u');
      expect(natural?.get('t')?.name).toBe('t');
      expect(natural?.get('u')?.name).toBe('u');
      expect(natural?.has('natural')).toBe(false);

      // Trailing clause keywords that can legally follow a table name.
      const forUpdate = parseTablesFromQuery('SELECT * FROM orders FOR UPDATE');
      expect(forUpdate?.get('orders')?.name).toBe('orders');
      expect(forUpdate?.has('for')).toBe(false);
    });

    it('keeps schema on qualified refs across a JOIN', () => {
      const r = parseTablesFromQuery('SELECT * FROM db1.users JOIN db2.orders ON 1 = 1');
      expect(r?.get('users')).toEqual({ name: 'users', schema: 'db1' });
      expect(r?.get('orders')).toEqual({ name: 'orders', schema: 'db2' });
    });

    it('should extract PostgreSQL double-quoted table with alias', () => {
      const result = parseTablesFromQuery('SELECT ael. FROM "AccountEventLog" ael');
      expect(result?.get('ael')?.name).toBe('AccountEventLog');
    });

    it('should extract schema-qualified table with alias', () => {
      const result = parseTablesFromQuery('SELECT u. FROM public.users u');
      expect(result?.get('u')?.name).toBe('users');
      expect(result?.get('u')?.schema).toBe('public');
    });

    it('should extract comma-separated FROM tables', () => {
      const result = parseTablesFromQuery('SELECT * FROM users u, orders o');
      expect(result?.get('u')?.name).toBe('users');
      expect(result?.get('o')?.name).toBe('orders');
    });
  });

  describe('getCurrentStatement', () => {
    // Mock monaco model
    const createMockModel = (text: string) => ({
      getValue: () => text,
      getOffsetAt: (pos: { lineNumber: number, column: number }) => {
        // Simple mock: assumes text is single line or simple multiline logic
        // For accurate testing we'd need a real text buffer, but for this logic 
        // we can approximate if we only use single line tests or controlled inputs.
        // Let's implement a simple line/col to offset mapper.
        const lines = text.split('\n');
        let offset = 0;
        for (let i = 0; i < pos.lineNumber - 1; i++) {
            offset += lines[i].length + 1; // +1 for \n
        }
        offset += pos.column - 1;
        return offset;
      }
    });

    it('should return full text for short single queries', () => {
      const text = 'SELECT * FROM users';
      const model = createMockModel(text);
      const stmt = getCurrentStatement(model, { lineNumber: 1, column: 5 });
      expect(stmt).toBe(text);
    });

    it('should extract current statement between semicolons', () => {
      // We need text > 500 chars to trigger logic
      const padding = ' '.repeat(500);
      const text = `SELECT 1; SELECT * FROM users; SELECT 2 -- ${padding}`;
      const model = createMockModel(text);
      // Cursor in the middle query
      // SELECT 1; [cursor here] SELECT * FROM users; SELECT 2
      // Length of 'SELECT 1; ' is 10. 
      // Cursor at char 12 roughly.
      const stmt = getCurrentStatement(model, { lineNumber: 1, column: 15 });
      expect(stmt).toBe('SELECT * FROM users');
    });

    it('should handle cursor at the end of statement', () => {
        const padding = ' '.repeat(500);
        const text = `SELECT * FROM users; -- ${padding}`;
        const model = createMockModel(text);
        const stmt = getCurrentStatement(model, { lineNumber: 1, column: 20 });
        expect(stmt).toBe('SELECT * FROM users');
    });

    it('should handle multiline strings', () => {
        const padding = ' '.repeat(500);
        const text = `SELECT 1;
SELECT * FROM users
WHERE id = 1;
SELECT 2; -- ${padding}`;
        const model = createMockModel(text);
        // Cursor in middle of WHERE clause (Line 3)
        const stmt = getCurrentStatement(model, { lineNumber: 3, column: 5 });
        const expected = `SELECT * FROM users
WHERE id = 1`;
        expect(stmt).toBe(expected);
    });
  });

  describe('isDestructiveWithoutWhere', () => {
    it('flags DELETE with no WHERE clause', () => {
      expect(isDestructiveWithoutWhere('DELETE FROM users')).toBe(true);
      expect(isDestructiveWithoutWhere('delete from users;')).toBe(true);
    });

    it('flags UPDATE with no WHERE clause', () => {
      expect(isDestructiveWithoutWhere('UPDATE users SET active = 0')).toBe(true);
    });

    it('does not flag DELETE/UPDATE with a top-level WHERE clause', () => {
      expect(isDestructiveWithoutWhere('DELETE FROM users WHERE id = 1')).toBe(false);
      expect(isDestructiveWithoutWhere('UPDATE users SET active = 0 WHERE id = 1')).toBe(false);
    });

    it('does not flag SELECT/INSERT/other statement types', () => {
      expect(isDestructiveWithoutWhere('SELECT * FROM users')).toBe(false);
      expect(isDestructiveWithoutWhere('INSERT INTO users (id) VALUES (1)')).toBe(false);
      expect(isDestructiveWithoutWhere('TRUNCATE TABLE users')).toBe(false);
    });

    it('ignores WHERE that only appears inside a subquery', () => {
      const sql = "UPDATE users SET status = (SELECT status FROM defaults WHERE key = 'default')";
      expect(isDestructiveWithoutWhere(sql)).toBe(true);
    });

    it('ignores WHERE-like text inside comments and string literals', () => {
      expect(isDestructiveWithoutWhere("DELETE FROM users -- WHERE id = 1")).toBe(true);
      expect(isDestructiveWithoutWhere("DELETE FROM users /* WHERE id = 1 */")).toBe(true);
      expect(isDestructiveWithoutWhere("UPDATE users SET note = 'no WHERE here'")).toBe(true);
    });

    it('handles leading whitespace and multi-line statements', () => {
      const sql = `\n  UPDATE users\n  SET active = 0\n`;
      expect(isDestructiveWithoutWhere(sql)).toBe(true);
    });

    it('does not let a backslash-escaped quote hide a real WHERE, or fake one out of string content', () => {
      // No real WHERE: the escaped quote must not prematurely close the string
      // and expose the literal "WHERE clause" text inside it as a top-level WHERE.
      expect(
        isDestructiveWithoutWhere("UPDATE logs SET msg = 'don\\'t forget to add a WHERE clause'"),
      ).toBe(true);
      // A real WHERE after a backslash-escaped string is still detected.
      expect(
        isDestructiveWithoutWhere("UPDATE logs SET msg = 'it\\'s fine' WHERE id = 1"),
      ).toBe(false);
    });

    it('flags a data-modifying CTE with no WHERE on its final statement', () => {
      expect(
        isDestructiveWithoutWhere('WITH ids AS (SELECT id FROM stale_users) DELETE FROM users'),
      ).toBe(true);
      expect(
        isDestructiveWithoutWhere(
          'WITH ids AS (SELECT id FROM stale_users) DELETE FROM users WHERE id IN (SELECT id FROM ids)',
        ),
      ).toBe(false);
      // A CTE feeding a plain SELECT is not destructive at all.
      expect(
        isDestructiveWithoutWhere('WITH ids AS (SELECT id FROM stale_users) SELECT * FROM ids'),
      ).toBe(false);
    });

    it('flags a statement wrapped in parentheses instead of silently allowing it', () => {
      // The wrapping parens make the WHERE-depth scan treat any WHERE as
      // nested, so a wrapped statement is conservatively flagged either way
      // (a false positive, not a silent bypass) — that's the safe direction
      // to err in for a "forgot the WHERE" guard.
      expect(isDestructiveWithoutWhere('(DELETE FROM users)')).toBe(true);
      expect(isDestructiveWithoutWhere('(DELETE FROM users WHERE id = 1)')).toBe(true);
    });

    it('returns false for empty or whitespace-only input', () => {
      expect(isDestructiveWithoutWhere('')).toBe(false);
      expect(isDestructiveWithoutWhere('   \n\t  ')).toBe(false);
    });
  });

  describe('classifyDangerousQuery', () => {
    it('classifies DELETE/UPDATE without a WHERE as no-where', () => {
      expect(classifyDangerousQuery('DELETE FROM users')).toBe('no-where');
      expect(classifyDangerousQuery('UPDATE users SET active = 0')).toBe('no-where');
    });

    it('classifies DROP statements', () => {
      expect(classifyDangerousQuery('DROP TABLE users')).toBe('drop');
      expect(classifyDangerousQuery('drop database analytics;')).toBe('drop');
      expect(classifyDangerousQuery('DROP INDEX idx_users_email')).toBe('drop');
    });

    it('classifies TRUNCATE statements', () => {
      expect(classifyDangerousQuery('TRUNCATE TABLE users')).toBe('truncate');
      expect(classifyDangerousQuery('truncate logs;')).toBe('truncate');
    });

    it('returns null for safe statements', () => {
      expect(classifyDangerousQuery('SELECT * FROM users')).toBe(null);
      expect(classifyDangerousQuery('DELETE FROM users WHERE id = 1')).toBe(null);
      expect(classifyDangerousQuery('INSERT INTO users (id) VALUES (1)')).toBe(null);
      expect(classifyDangerousQuery('')).toBe(null);
    });

    it('is not fooled by DROP/TRUNCATE inside comments or literals', () => {
      expect(classifyDangerousQuery("SELECT 'DROP TABLE users'")).toBe(null);
      expect(classifyDangerousQuery('SELECT 1 -- DROP TABLE users')).toBe(null);
    });

    it('exposes isDangerousQuery as a boolean shortcut', () => {
      expect(isDangerousQuery('DROP TABLE users')).toBe(true);
      expect(isDangerousQuery('DELETE FROM users')).toBe(true);
      expect(isDangerousQuery('SELECT * FROM users')).toBe(false);
    });
  });
});
