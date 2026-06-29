import { describe, it, expect } from 'vitest';
import { parseTablesFromQuery, getCurrentStatement } from '../../src/utils/sqlAnalysis';

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
});
