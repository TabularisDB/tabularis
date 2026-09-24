import { describe, it, expect } from 'vitest';
import { splitQueries } from '../../../src/utils/sqlSplitter';

describe('dialect canaries', () => {
  it('postgres treats $$ as a string boundary', () => {
    const sql = 'DO $$BEGIN PERFORM 1; END$$;';
    expect(splitQueries(sql, 'postgres')).toHaveLength(1);
  });

  it('mysql shields semicolons inside backticked identifiers', () => {
    const sql = 'SELECT `col;name` FROM t; SELECT 2';
    const result = splitQueries(sql, 'mysql');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('`col;name`');
  });

  it('mysql shields semicolons inside # line comments', () => {
    const sql = 'SELECT 1; # note; with semicolon\nSELECT 2';
    expect(splitQueries(sql, 'mysql')).toHaveLength(2);
  });

  it('mssql shields semicolons inside double-quoted identifiers', () => {
    const sql = 'SELECT "a;b" FROM t; SELECT 2';
    const result = splitQueries(sql, 'mssql');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('"a;b"');
  });

  it('mssql shields semicolons inside nested block comments', () => {
    expect(
      splitQueries('/* o /* i */ ; */ SELECT 1', 'mssql'),
    ).toHaveLength(1);
  });

  it('mssql shields semicolons inside [bracketed identifiers]', () => {
    const sql = 'SELECT [col;name] FROM t; SELECT 2';
    const result = splitQueries(sql, 'mssql');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('[col;name]');
  });

  it('sqlite accepts both backticks and brackets as identifier quotes', () => {
    expect(splitQueries('SELECT `a;b` FROM t', 'sqlite')).toHaveLength(1);
    expect(splitQueries('SELECT [a;b] FROM t', 'sqlite')).toHaveLength(1);
  });

  it('generic dialect splits a basic two-statement input', () => {
    expect(splitQueries('SELECT 1; SELECT 2', 'generic')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('falls back to generic when given an unknown dialect string', () => {
    // Plugin manifests pass through serde without TS-side validation, so
    // an unknown value may arrive at runtime. The splitter must not crash.
    const result = splitQueries(
      'SELECT 1; SELECT 2',
      'unknown-driver-from-plugin',
    );
    expect(result).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('treats Object.prototype member names as unknown dialects', () => {
    // `in`-style lookups would resolve these via the prototype chain and
    // hand a non-DialectOptions value to the tokenizer.
    for (const dialect of ['__proto__', 'toString', 'constructor']) {
      expect(splitQueries('SELECT 1; SELECT 2', dialect)).toEqual([
        'SELECT 1',
        'SELECT 2',
      ]);
    }
  });
});
