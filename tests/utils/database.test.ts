import { describe, it, expect } from 'vitest';
import {
  isMultiDatabaseCapable,
  isSchemaBasedMultiDb,
  isMultiDatabaseSelection,
  getDatabaseList,
  getEffectiveDatabase,
  buildTableRoutingParams,
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

  it('returns true when schemas is true (Postgres is multi-database capable)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, schemas: true })).toBe(true);
  });

  it('returns false when file_based is true (SQLite)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, file_based: true })).toBe(false);
  });

  it('returns false when folder_based is true (DuckDB)', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, folder_based: true })).toBe(false);
  });

  it('returns false when file_based is true even if schemas is true', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, schemas: true, file_based: true })).toBe(false);
  });

  it('returns false when no_connection_required is true', () => {
    expect(isMultiDatabaseCapable({ ...baseCapabilities, no_connection_required: true })).toBe(false);
  });

  it('returns false for null capabilities', () => {
    expect(isMultiDatabaseCapable(null)).toBe(false);
  });

  it('returns false for undefined capabilities', () => {
    expect(isMultiDatabaseCapable(undefined)).toBe(false);
  });
});

describe('isSchemaBasedMultiDb', () => {
  it('returns true for a schema-based server driver (Postgres)', () => {
    expect(isSchemaBasedMultiDb({ ...baseCapabilities, schemas: true })).toBe(true);
  });

  it('returns false for a flat server driver (MySQL)', () => {
    expect(isSchemaBasedMultiDb(baseCapabilities)).toBe(false);
  });

  it('returns false for a file-based driver even with schemas', () => {
    expect(isSchemaBasedMultiDb({ ...baseCapabilities, schemas: true, file_based: true })).toBe(false);
  });

  it('returns false when no_connection_required is true', () => {
    expect(isSchemaBasedMultiDb({ ...baseCapabilities, schemas: true, no_connection_required: true })).toBe(false);
  });

  it('returns false for null capabilities', () => {
    expect(isSchemaBasedMultiDb(null)).toBe(false);
  });

  it('returns false for undefined capabilities', () => {
    expect(isSchemaBasedMultiDb(undefined)).toBe(false);
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

describe('buildTableRoutingParams', () => {
  // Regression guard: on schema-based multi-database (PostgreSQL) connections
  // the metadata pool is keyed by database. Dropping `database` from
  // get_columns/get_foreign_keys made the call hit the connection's primary
  // database, return no columns/PK, and silently turn the grid read-only.

  it('routes a PostgreSQL multi-db tab to its schema AND database', () => {
    expect(buildTableRoutingParams('inventory', 'erp_demo', 'public')).toEqual({
      schema: 'inventory',
      database: 'erp_demo',
    });
  });

  it("prefers the tab's schema over the connection's active schema", () => {
    // The active schema is a single global; each tab may view a different one.
    expect(buildTableRoutingParams('inventory', 'erp_demo', 'sales')).toEqual({
      schema: 'inventory',
      database: 'erp_demo',
    });
  });

  it('falls back to the active schema when the tab has none', () => {
    expect(buildTableRoutingParams(undefined, 'erp_demo', 'public')).toEqual({
      schema: 'public',
      database: 'erp_demo',
    });
  });

  it('omits database for flat multi-db (MySQL) tabs that carry no database', () => {
    // MySQL connects server-wide; no per-database pool switch is needed, so the
    // database key must NOT be emitted (it would otherwise regress that path).
    expect(buildTableRoutingParams('myschema', undefined, null)).toEqual({
      schema: 'myschema',
    });
  });

  it('omits database when the tab database is null', () => {
    expect(buildTableRoutingParams('public', null, null)).toEqual({
      schema: 'public',
    });
  });

  it('omits schema when neither tab nor active schema is set', () => {
    expect(buildTableRoutingParams(null, 'erp_demo', null)).toEqual({
      database: 'erp_demo',
    });
  });

  it('returns an empty object when nothing is set (single-db connection)', () => {
    expect(buildTableRoutingParams(undefined, undefined, null)).toEqual({});
  });

  it('treats an empty-string schema as absent', () => {
    expect(buildTableRoutingParams('', undefined, '')).toEqual({});
  });
});
