import { describe, expect, it } from 'vitest';
import { stripSqlComments } from '../../src/utils/stripSqlComments';

describe('stripSqlComments', () => {
  it('removes a line comment and keeps the SQL', () => {
    expect(stripSqlComments('SELECT 1 -- trailing\n', 'postgres')).toBe(
      'SELECT 1 \n',
    );
  });

  it('removes a block comment', () => {
    expect(stripSqlComments('SELECT /* note */ 1', 'postgres')).toBe(
      'SELECT  1',
    );
  });

  it('inserts a space so stripping does not merge adjacent tokens', () => {
    expect(stripSqlComments('SELECT a/**/b', 'postgres')).toBe('SELECT a b');
  });

  it('does not add a space when a neighbour is already whitespace', () => {
    expect(stripSqlComments('SELECT a /**/ b', 'postgres')).toBe(
      'SELECT a  b',
    );
  });

  it('preserves string literals that look like comments', () => {
    expect(stripSqlComments("SELECT '-- not a comment'", 'postgres')).toBe(
      "SELECT '-- not a comment'",
    );
    expect(stripSqlComments("SELECT '/* not a comment */'", 'postgres')).toBe(
      "SELECT '/* not a comment */'",
    );
  });

  it('preserves quoted identifiers containing comment markers', () => {
    expect(stripSqlComments('SELECT "a -- b" FROM t', 'postgres')).toBe(
      'SELECT "a -- b" FROM t',
    );
  });

  it('preserves dollar-quoted bodies', () => {
    const sql = 'SELECT $tag$ -- keep /* this */ $tag$';
    expect(stripSqlComments(sql, 'postgres')).toBe(sql);
  });

  it('keeps MySQL executable comments but strips plain block comments', () => {
    expect(
      stripSqlComments('SELECT /*! STRAIGHT_JOIN */ /* drop */ 1', 'mysql'),
    ).toBe('SELECT /*! STRAIGHT_JOIN */  1');
  });

  it('keeps MariaDB /*M! ... */ conditional comments', () => {
    const sql = 'SELECT /*M!50000 1 */ 2';
    expect(stripSqlComments(sql, 'mysql')).toBe(sql);
  });

  it('treats MySQL `#` as a line comment', () => {
    expect(stripSqlComments('SELECT 1 # tail\nSELECT 2', 'mysql')).toBe(
      'SELECT 1 \nSELECT 2',
    );
  });

  it('keeps `--` as subtraction in MySQL when no space follows', () => {
    expect(stripSqlComments('SELECT 1--1', 'mysql')).toBe('SELECT 1--1');
  });

  it('strips `--1` as a comment in Postgres (no space required)', () => {
    expect(stripSqlComments('SELECT 1--1\n', 'postgres')).toBe('SELECT 1\n');
  });

  it('handles nested block comments in Postgres', () => {
    expect(stripSqlComments('SELECT /* a /* b */ c */ 1', 'postgres')).toBe(
      'SELECT  1',
    );
  });

  it('removes multiline block comments', () => {
    expect(stripSqlComments('SELECT\n/* a\nb\nc */\n1', 'postgres')).toBe(
      'SELECT\n\n1',
    );
  });

  it('preserves an unterminated block comment region as a string-like span', () => {
    expect(stripSqlComments('SELECT 1 /* unterminated', 'postgres')).toBe(
      'SELECT 1 ',
    );
  });

  it('returns the input unchanged for an unknown dialect', () => {
    const sql = 'SELECT /* note */ 1 -- x';
    expect(stripSqlComments(sql, 'nope')).toBe(sql);
  });

  it('returns the input unchanged when no dialect is given', () => {
    const sql = 'SELECT /* note */ 1';
    expect(stripSqlComments(sql)).toBe(sql);
  });

  it('strips comments spanning several statements', () => {
    const sql = 'SELECT 1; -- one\nSELECT 2; /* two */';
    expect(stripSqlComments(sql, 'postgres')).toBe(
      'SELECT 1; \nSELECT 2; ',
    );
  });

  it('leaves comment-free SQL untouched', () => {
    const sql = "SELECT a, b FROM t WHERE c = 'x'";
    expect(stripSqlComments(sql, 'postgres')).toBe(sql);
  });
});
