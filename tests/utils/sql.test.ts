import { describe, it, expect } from 'vitest';
import { splitQueries, extractTableName, isExplainableQuery, stripLeadingSqlComments, getExplainableQueries } from '../../src/utils/sql';

describe('sql utils', () => {
  describe('splitQueries', () => {
    it('should split multiple queries by semicolon', () => {
      const sql = 'SELECT * FROM users; SELECT * FROM posts;';
      const result = splitQueries(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('SELECT * FROM users');
      expect(result[1]).toBe('SELECT * FROM posts');
    });

    it('should handle single query without semicolon', () => {
      const sql = 'SELECT * FROM users';
      const result = splitQueries(sql);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('SELECT * FROM users');
    });

    it('should ignore semicolons inside quotes', () => {
      const sql = "SELECT * FROM users WHERE name = 'John; Doe'; SELECT 2";
      const result = splitQueries(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("SELECT * FROM users WHERE name = 'John; Doe'");
      expect(result[1]).toBe('SELECT 2');
    });

    it('should ignore semicolons inside comments', () => {
      const sql = 'SELECT 1; -- comment with ; \n SELECT 2';
      const result = splitQueries(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('SELECT 1');
      expect(result[1]).toContain('SELECT 2');
    });
  });

  describe('stripLeadingSqlComments', () => {
    it('should strip line comments', () => {
      expect(stripLeadingSqlComments('-- comment\nSELECT 1')).toBe('SELECT 1');
      expect(stripLeadingSqlComments('-- line1\n-- line2\nSELECT 1')).toBe('SELECT 1');
    });

    it('should strip block comments', () => {
      expect(stripLeadingSqlComments('/* block */ SELECT 1')).toBe('SELECT 1');
      expect(stripLeadingSqlComments('/* a */ /* b */ SELECT 1')).toBe('SELECT 1');
    });

    it('should strip mixed comments', () => {
      expect(stripLeadingSqlComments('-- line\n/* block */\nSELECT 1')).toBe('SELECT 1');
    });

    it('should handle no comments', () => {
      expect(stripLeadingSqlComments('SELECT 1')).toBe('SELECT 1');
      expect(stripLeadingSqlComments('  SELECT 1')).toBe('SELECT 1');
    });

    it('should handle unterminated comments', () => {
      expect(stripLeadingSqlComments('-- only comment')).toBe('');
      expect(stripLeadingSqlComments('/* never closed')).toBe('');
    });
  });

  describe('isExplainableQuery', () => {
    it('should return true for DML statements', () => {
      expect(isExplainableQuery('SELECT * FROM users')).toBe(true);
      expect(isExplainableQuery('INSERT INTO users VALUES (1)')).toBe(true);
      expect(isExplainableQuery('UPDATE users SET name = "test"')).toBe(true);
      expect(isExplainableQuery('DELETE FROM users WHERE id = 1')).toBe(true);
      expect(isExplainableQuery('REPLACE INTO users VALUES (1, "a")')).toBe(true);
    });

    it('should return true for CTE and TABLE statements', () => {
      expect(isExplainableQuery('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
      expect(isExplainableQuery('TABLE users')).toBe(true);
    });

    it('should return false for DDL statements', () => {
      expect(isExplainableQuery('CREATE INDEX idx ON t(col)')).toBe(false);
      expect(isExplainableQuery('CREATE TABLE users (id INT)')).toBe(false);
      expect(isExplainableQuery('DROP TABLE users')).toBe(false);
      expect(isExplainableQuery('ALTER TABLE users ADD COLUMN name TEXT')).toBe(false);
      expect(isExplainableQuery('TRUNCATE TABLE users')).toBe(false);
    });

    it('should return false for DCL statements', () => {
      expect(isExplainableQuery("GRANT SELECT ON users TO 'user'")).toBe(false);
      expect(isExplainableQuery("REVOKE SELECT ON users FROM 'user'")).toBe(false);
    });

    it('should handle leading whitespace', () => {
      expect(isExplainableQuery('  SELECT 1')).toBe(true);
      expect(isExplainableQuery('\n\t  CREATE INDEX idx ON t(col)')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isExplainableQuery('select * from users')).toBe(true);
      expect(isExplainableQuery('create index idx on t(col)')).toBe(false);
    });

    it('should handle queries with leading SQL comments', () => {
      expect(isExplainableQuery('-- BEFORE index: full scan\nSELECT * FROM audit_log')).toBe(true);
      expect(isExplainableQuery('/* explain this */ SELECT * FROM users')).toBe(true);
      expect(isExplainableQuery('-- comment\n-- another\nDELETE FROM users WHERE id = 1')).toBe(true);
      expect(isExplainableQuery('-- setup\nCREATE INDEX idx ON t(col)')).toBe(false);
    });
  });

  describe('getExplainableQueries', () => {
    it('should return all queries when all are explainable', () => {
      const sql = 'SELECT * FROM users; SELECT * FROM posts;';
      const result = getExplainableQueries(sql);
      expect(result).toEqual([
        { query: 'SELECT * FROM users', index: 1 },
        { query: 'SELECT * FROM posts', index: 2 },
      ]);
    });

    it('should filter out DDL statements', () => {
      const sql = 'SELECT * FROM users; CREATE TABLE t (id INT); DELETE FROM logs;';
      const result = getExplainableQueries(sql);
      expect(result).toEqual([
        { query: 'SELECT * FROM users', index: 1 },
        { query: 'DELETE FROM logs', index: 3 },
      ]);
    });

    it('should return empty array when no queries are explainable', () => {
      const sql = 'CREATE TABLE t (id INT); DROP TABLE t;';
      const result = getExplainableQueries(sql);
      expect(result).toEqual([]);
    });

    it('should handle single explainable query', () => {
      const sql = 'UPDATE users SET name = "test" WHERE id = 1';
      const result = getExplainableQueries(sql);
      expect(result).toEqual([{ query: 'UPDATE users SET name = "test" WHERE id = 1', index: 1 }]);
    });

    it('should handle empty input', () => {
      expect(getExplainableQueries('')).toEqual([]);
    });

    it('should preserve original index across mixed statements', () => {
      const sql = 'DROP TABLE t; SELECT 1; ALTER TABLE t ADD col INT; INSERT INTO t VALUES (1); TRUNCATE TABLE t;';
      const result = getExplainableQueries(sql);
      expect(result).toEqual([
        { query: 'SELECT 1', index: 2 },
        { query: 'INSERT INTO t VALUES (1)', index: 4 },
      ]);
    });
  });

  describe('extractTableName', () => {
    it('should extract table name from simple SELECT', () => {
      expect(extractTableName('SELECT * FROM users')).toBe('users');
      expect(extractTableName('select * from "users"')).toBe('users');
      expect(extractTableName("SELECT * FROM `my_table` WHERE id = 1")).toBe('my_table');
    });

    it('should return null for non-SELECT queries', () => {
      expect(extractTableName('UPDATE users SET name="test"')).toBeNull();
      expect(extractTableName('DELETE FROM users')).toBeNull();
    });

    it('should return null for aggregate queries', () => {
        expect(extractTableName('SELECT COUNT(*) FROM users')).toBeNull();
        expect(extractTableName('SELECT SUM(price) FROM orders')).toBeNull();
        expect(extractTableName('SELECT * FROM users GROUP BY type')).toBeNull();
    });

    it('should return null for DISTINCT queries', () => {
        expect(extractTableName('SELECT DISTINCT name FROM users')).toBeNull();
        expect(extractTableName('SELECT DISTINCT * FROM orders')).toBeNull();
    });

    it('should return null for HAVING queries', () => {
        expect(extractTableName('SELECT type, COUNT(*) FROM users GROUP BY type HAVING COUNT(*) > 1')).toBeNull();
    });

    it('should return null for JOIN queries', () => {
        expect(extractTableName('SELECT u.* FROM users u JOIN orders o ON u.id = o.user_id')).toBeNull();
        expect(extractTableName('SELECT * FROM users LEFT JOIN posts ON users.id = posts.user_id')).toBeNull();
        expect(extractTableName('SELECT * FROM users INNER JOIN orders ON users.id = orders.uid')).toBeNull();
        expect(extractTableName('SELECT * FROM a RIGHT JOIN b ON a.id = b.a_id')).toBeNull();
    });

    it('should return null for UNION/INTERSECT/EXCEPT queries', () => {
        expect(extractTableName('SELECT * FROM users UNION SELECT * FROM admins')).toBeNull();
        expect(extractTableName('SELECT * FROM users UNION ALL SELECT * FROM admins')).toBeNull();
        expect(extractTableName('SELECT id FROM users INTERSECT SELECT id FROM admins')).toBeNull();
        expect(extractTableName('SELECT id FROM users EXCEPT SELECT id FROM admins')).toBeNull();
    });

    it('should return null for subquery in FROM clause', () => {
        expect(extractTableName('SELECT * FROM (SELECT * FROM users WHERE active = 1) sub')).toBeNull();
    });
  });
});
