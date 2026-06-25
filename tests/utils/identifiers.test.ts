import { describe, it, expect } from 'vitest';
import {
  getQuoteChar,
  quoteIdentifier,
  quoteTableRef,
  formatSqlIdentifier,
} from '../../src/utils/identifiers';

describe('getQuoteChar', () => {
  it('should return backtick for mysql', () => {
    expect(getQuoteChar('mysql')).toBe('`');
  });

  it('should return backtick for mariadb', () => {
    expect(getQuoteChar('mariadb')).toBe('`');
  });

  it('should return double quote for postgres', () => {
    expect(getQuoteChar('postgres')).toBe('"');
  });

  it('should return double quote for sqlite', () => {
    expect(getQuoteChar('sqlite')).toBe('"');
  });

  it('should return double quote for null driver', () => {
    expect(getQuoteChar(null)).toBe('"');
  });

  it('should return double quote for undefined driver', () => {
    expect(getQuoteChar(undefined)).toBe('"');
  });

  it('should return double quote for unknown driver', () => {
    expect(getQuoteChar('oracle')).toBe('"');
  });
});

describe('quoteIdentifier', () => {
  it('should quote with backticks for mysql', () => {
    expect(quoteIdentifier('my_table', 'mysql')).toBe('`my_table`');
  });

  it('should quote with double quotes for postgres', () => {
    expect(quoteIdentifier('my_table', 'postgres')).toBe('"my_table"');
  });

  it('should quote with double quotes for sqlite', () => {
    expect(quoteIdentifier('my_table', 'sqlite')).toBe('"my_table"');
  });

  it('should escape backticks inside mysql identifiers', () => {
    expect(quoteIdentifier('my`table', 'mysql')).toBe('`my``table`');
  });

  it('should escape double quotes inside postgres identifiers', () => {
    expect(quoteIdentifier('my"table', 'postgres')).toBe('"my""table"');
  });

  it('should handle empty string', () => {
    expect(quoteIdentifier('', 'mysql')).toBe('``');
    expect(quoteIdentifier('', 'postgres')).toBe('""');
  });

  it('should handle identifiers with spaces', () => {
    expect(quoteIdentifier('my table', 'mysql')).toBe('`my table`');
    expect(quoteIdentifier('my table', 'postgres')).toBe('"my table"');
  });

  it('should handle identifiers with special characters', () => {
    expect(quoteIdentifier('table-name.v2', 'postgres')).toBe('"table-name.v2"');
  });
});

describe('quoteTableRef', () => {
  it('should return just quoted table when no schema', () => {
    expect(quoteTableRef('users', 'postgres')).toBe('"users"');
  });

  it('should return schema-qualified reference when schema is provided', () => {
    expect(quoteTableRef('users', 'postgres', 'public')).toBe('"public"."users"');
  });

  it('should use backticks for mysql schema-qualified reference', () => {
    expect(quoteTableRef('users', 'mysql', 'mydb')).toBe('`mydb`.`users`');
  });

  it('should return just quoted table when schema is null', () => {
    expect(quoteTableRef('users', 'postgres', null)).toBe('"users"');
  });

  it('should return just quoted table when schema is undefined', () => {
    expect(quoteTableRef('users', 'postgres', undefined)).toBe('"users"');
  });

  it('should return just quoted table when schema is empty string', () => {
    expect(quoteTableRef('users', 'postgres', '')).toBe('"users"');
  });

  it('should escape special chars in both schema and table', () => {
    expect(quoteTableRef('my"table', 'postgres', 'my"schema')).toBe('"my""schema"."my""table"');
  });
});

describe('formatSqlIdentifier', () => {
  it('should not quote plain lowercase identifiers for postgres', () => {
    expect(formatSqlIdentifier('users', 'postgres')).toBe('users');
    expect(formatSqlIdentifier('user_status', 'postgres')).toBe('user_status');
  });

  it('should quote mixed case identifiers for postgres', () => {
    expect(formatSqlIdentifier('Status', 'postgres')).toBe('"Status"');
    expect(formatSqlIdentifier('AccountEventLog', 'postgres')).toBe('"AccountEventLog"');
    expect(formatSqlIdentifier('AccountId', 'postgres')).toBe('"AccountId"');
  });

  it('should quote reserved words for postgres', () => {
    expect(formatSqlIdentifier('select', 'postgres')).toBe('"select"');
    expect(formatSqlIdentifier('user', 'postgres')).toBe('"user"');
    expect(formatSqlIdentifier('table', 'postgres')).toBe('"table"');
  });

  it('should quote identifiers with special characters or spaces for postgres', () => {
    expect(formatSqlIdentifier('my table', 'postgres')).toBe('"my table"');
    expect(formatSqlIdentifier('table-name', 'postgres')).toBe('"table-name"');
  });

  it('should leave identifiers unchanged for mysql', () => {
    expect(formatSqlIdentifier('Status', 'mysql')).toBe('Status');
    expect(formatSqlIdentifier('user_status', 'mariadb')).toBe('user_status');
    expect(formatSqlIdentifier('AccountEventLog', 'mysql')).toBe('AccountEventLog');
    expect(formatSqlIdentifier('select', 'mysql')).toBe('select');
  });

  it('should leave identifiers unchanged for sqlite and unknown drivers', () => {
    expect(formatSqlIdentifier('Status', 'sqlite')).toBe('Status');
    expect(formatSqlIdentifier('Status', null)).toBe('Status');
    expect(formatSqlIdentifier('users', 'sqlite')).toBe('users');
    expect(formatSqlIdentifier('AccountEventLog', 'sqlite')).toBe('AccountEventLog');
  });
});