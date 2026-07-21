import { describe, it, expect } from 'vitest';
import {
  isMultiDatabaseCapable,
  isMultiDatabaseSelection,
  getDatabaseList,
  getEffectiveDatabase,
} from '../../src/utils/database';
import type { DriverCapabilities } from '../../src/types/plugins';

const baseCapabilities: DriverCapabilities = {
  schemas: false,
  views: true,
  routines: true,
  file_based: false,
  folder_based: false,
  identifier_quote: '`',
  alter_primary_key: false,
};

describe('isMultiDatabaseCapable', () => {
  it('returns true for MySQL-like driver (no schemas, not file_based, not folder_based)', () => {
    expect(isMultiDatabaseCapable(baseCapabilities)).toBe(true);
  });

  it('returns false when schemas is true (Postgres)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, schemas: true })).toBe(false);
  });

  it('returns false when file_based is true (SQLite)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, file_based: true })).toBe(false);
  });

  it('returns false when folder_based is true (DuckDB)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, folder_based: true })).toBe(false);
  });

  it('returns false for a single_database store (Meilisearch)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, single_database: true })).toBe(false);
  });

  it('returns false when both schemas and file_based are true', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, schemas: true, file_based: true })).toBe(false);
  });

  it('returns false for null capabilities', () => {
    expect(isMultiDatabaseCapable(null)).toBe(false);
  });

  it('returns false for undefined capabilities', () => {
    expect(isMultiDatabaseCapable(undefined)).toBe(false);
  });
});

describe('isMultiDatabaseSelection', () => {
  it('returns true for an array', () => {
    expect(isMultiDatabaseSelection(['db1', 'db2'])).toBe(true);
  });

  it('returns true for an empty array', () => {
    expect(isMultiDatabaseSelection([])).toBe(true);
  });

  it('returns true for a single-element array', () => {
    expect(isMultiDatabaseSelection(['db1'])).toBe(true);
  });

  it('returns false for a string', () => {
    expect(isMultiDatabaseSelection('mydb')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isMultiDatabaseSelection('')).toBe(false);
  });
});

describe('getDatabaseList', () => {
  it('returns the array unchanged when given an array', () => {
    expect(getDatabaseList(['db1', 'db2'])).toEqual(['db1', 'db2']);
  });

  it('returns empty array for empty array input', () => {
    expect(getDatabaseList([])).toEqual([]);
  });

  it('wraps a non-empty string in an array', () => {
    expect(getDatabaseList('mydb')).toEqual(['mydb']);
  });

  it('returns empty array for an empty string', () => {
    expect(getDatabaseList('')).toEqual([]);
  });

  it('returns single-element array for single-element array input', () => {
    expect(getDatabaseList(['only'])).toEqual(['only']);
  });
});

describe('getEffectiveDatabase', () => {
  it('returns the string as-is', () => {
    expect(getEffectiveDatabase('mydb')).toBe('mydb');
  });

  it('returns empty string for empty string input', () => {
    expect(getEffectiveDatabase('')).toBe('');
  });

  it('returns the first element of an array', () => {
    expect(getEffectiveDatabase(['db1', 'db2', 'db3'])).toBe('db1');
  });

  it('returns empty string for empty array', () => {
    expect(getEffectiveDatabase([])).toBe('');
  });

  it('returns the only element of a single-element array', () => {
    expect(getEffectiveDatabase(['only'])).toBe('only');
  });
});
