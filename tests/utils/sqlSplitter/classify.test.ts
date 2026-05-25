import { describe, it, expect } from 'vitest';
import {
  isSelect,
  returnsResultSet,
  isExplainable,
  stripLeadingComments,
} from '../../../src/utils/sqlSplitter';

describe('stripLeadingComments', () => {
  it('strips line comments', () => {
    expect(stripLeadingComments('-- comment\nSELECT 1')).toBe('SELECT 1');
    expect(stripLeadingComments('-- a\n-- b\nSELECT 1')).toBe('SELECT 1');
  });

  it('strips block comments', () => {
    expect(stripLeadingComments('/* x */ SELECT 1')).toBe('SELECT 1');
    expect(stripLeadingComments('/* a */ /* b */ SELECT 1')).toBe('SELECT 1');
  });

  it('handles mixed comments and whitespace', () => {
    expect(stripLeadingComments('  -- a\n /* b */\n\tSELECT 1')).toBe('SELECT 1');
  });

  it('returns empty string for a comment-only input', () => {
    expect(stripLeadingComments('-- only comment')).toBe('');
    expect(stripLeadingComments('/* never closes')).toBe('');
  });
});

describe('isSelect', () => {
  it('detects bare SELECT', () => {
    expect(isSelect('SELECT 1')).toBe(true);
    expect(isSelect('  select * from t')).toBe(true);
  });

  it('detects SELECT after leading comments', () => {
    expect(isSelect('-- header\nSELECT 1')).toBe(true);
    expect(isSelect('/* x */ select 1')).toBe(true);
  });

  it('rejects words that merely start with SELECT', () => {
    expect(isSelect('SELECTIVE 1')).toBe(false);
  });

  it('peels leading parentheses so parenthesised SELECTs still classify', () => {
    expect(isSelect('(SELECT 1)')).toBe(true);
    expect(isSelect('((SELECT 1))')).toBe(true);
    expect(isSelect('-- header\n ( SELECT 1 )')).toBe(true);
  });

  it('peels interleaved parens and comments', () => {
    // `(` then a comment inside the parens: previously stripLeadingComments
    // saw `(` first and stopped, so the inner comment leaked into the
    // keyword match. The fixed-point loop now keeps stripping until both
    // sides give up.
    expect(isSelect('( /* note */ SELECT 1 )')).toBe(true);
    expect(isSelect('(\n-- comment\nSELECT 1\n)')).toBe(true);
    expect(isSelect('(\n-- comment\n(SELECT 1)\n)')).toBe(true);
    expect(isSelect('/* a */ ( /* b */ ( SELECT 1 ) )')).toBe(true);
  });

  it('rejects non-SELECT statements', () => {
    expect(isSelect('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isSelect('CREATE TABLE t (id INT)')).toBe(false);
  });
});

describe('returnsResultSet', () => {
  it('returns true for result-set producing keywords', () => {
    expect(returnsResultSet('SELECT 1')).toBe(true);
    expect(returnsResultSet('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
    expect(returnsResultSet('SHOW TABLES')).toBe(true);
    expect(returnsResultSet('EXPLAIN SELECT 1')).toBe(true);
    expect(returnsResultSet('DESCRIBE users')).toBe(true);
    expect(returnsResultSet('DESC users')).toBe(true);
    expect(returnsResultSet('VALUES (1)')).toBe(true);
    expect(returnsResultSet('TABLE users')).toBe(true);
    expect(returnsResultSet('PRAGMA foreign_keys')).toBe(true);
    expect(returnsResultSet('CALL proc()')).toBe(true);
  });

  it('returns false for DML that does not produce a result set', () => {
    expect(returnsResultSet('INSERT INTO t VALUES (1)')).toBe(false);
    expect(returnsResultSet('UPDATE t SET x = 1')).toBe(false);
    expect(returnsResultSet('DELETE FROM t')).toBe(false);
  });
});

describe('isExplainable', () => {
  it('returns true for DML and CTE', () => {
    expect(isExplainable('SELECT 1')).toBe(true);
    expect(isExplainable('INSERT INTO t VALUES (1)')).toBe(true);
    expect(isExplainable('UPDATE t SET x = 1')).toBe(true);
    expect(isExplainable('DELETE FROM t')).toBe(true);
    expect(isExplainable('REPLACE INTO t VALUES (1)')).toBe(true);
    expect(isExplainable('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
    expect(isExplainable('TABLE users')).toBe(true);
    expect(isExplainable('MERGE INTO target USING src ON x = y WHEN MATCHED THEN UPDATE SET a = 1')).toBe(true);
  });

  it('returns false for DDL', () => {
    expect(isExplainable('CREATE TABLE t (id INT)')).toBe(false);
    expect(isExplainable('DROP TABLE t')).toBe(false);
    expect(isExplainable('ALTER TABLE t ADD COLUMN c INT')).toBe(false);
    expect(isExplainable('TRUNCATE TABLE t')).toBe(false);
  });

  it('handles leading comments and whitespace', () => {
    expect(isExplainable('-- BEFORE index: full scan\nSELECT 1')).toBe(true);
    expect(isExplainable('/* x */ SELECT 1')).toBe(true);
    expect(isExplainable('-- setup\nCREATE INDEX i ON t(c)')).toBe(false);
  });
});
