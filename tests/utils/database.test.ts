import { describe, it, expect } from 'vitest';
import {
  isMultiDatabaseCapable,
  isSchemaBasedMultiDbCapable,
  isSchemaBasedMultiDb,
  hasOptedIntoDatabaseSelection,
  usesMultiDatabaseLayout,
  isMultiDatabaseSelection,
  getTableDataChangeScope,
  getDatabaseList,
  getEffectiveDatabase,
  reconcileDatabaseSelection,
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

const postgresCapabilities: DriverCapabilities = {
  ...baseCapabilities,
  schemas: true,
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
});

describe('usesMultiDatabaseLayout', () => {
  it('is on for a multi-db driver with any populated selection', () => {
    expect(usesMultiDatabaseLayout(baseCapabilities, ['a', 'b'])).toBe(true);
    // A single database still needs the multi-db presentation: all-databases
    // connections have no default schema, so queries must stay db-qualified.
    expect(usesMultiDatabaseLayout(baseCapabilities, ['a'])).toBe(true);
  });

  it('is off with an empty selection or a non multi-db driver', () => {
    expect(usesMultiDatabaseLayout(baseCapabilities, [])).toBe(false);
    expect(usesMultiDatabaseLayout({ ...baseCapabilities, schemas: true }, ['a'])).toBe(false);
    expect(usesMultiDatabaseLayout(null, ['a'])).toBe(false);
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

describe('getTableDataChangeScope', () => {
  it('prefers the table tab schema for schema-capable drivers', () => {
    expect(
      getTableDataChangeScope(
        { ...baseCapabilities, schemas: true },
        'schema_a',
        'schema_b',
      ),
    ).toEqual({ schema: 'schema_a' });
  });

  it('falls back to the active schema when a schema-capable tab has no schema', () => {
    expect(
      getTableDataChangeScope(
        { ...baseCapabilities, schemas: true },
        undefined,
        'public',
      ),
    ).toEqual({ schema: 'public' });
  });

  it('uses the table tab value as database for multi-database drivers', () => {
    expect(getTableDataChangeScope(baseCapabilities, 'app_db', 'ignored')).toEqual({
      database: 'app_db',
    });
  });

  it('omits scope for flat drivers', () => {
    expect(
      getTableDataChangeScope(
        { ...baseCapabilities, file_based: true },
        'main',
        'public',
      ),
    ).toEqual({});
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

describe('reconcileDatabaseSelection', () => {
  it('keeps the selection unchanged when every database exists', () => {
    expect(reconcileDatabaseSelection(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      selection: ['a', 'b'],
      removed: [],
    });
  });

  it('removes databases that no longer exist on the server', () => {
    expect(reconcileDatabaseSelection(['a', 'vins', 'b'], ['a', 'b', 'c'])).toEqual({
      selection: ['a', 'b'],
      removed: ['vins'],
    });
  });

  it('preserves the saved order of the surviving selection', () => {
    expect(reconcileDatabaseSelection(['z', 'a', 'm'], ['a', 'm', 'z']).selection).toEqual([
      'z',
      'a',
      'm',
    ]);
  });

  it('reports everything as removed when the server list is empty', () => {
    expect(reconcileDatabaseSelection(['a', 'b'], [])).toEqual({
      selection: [],
      removed: ['a', 'b'],
    });
  });

  it('returns empty results for an empty saved selection', () => {
    expect(reconcileDatabaseSelection([], ['a', 'b'])).toEqual({
      selection: [],
      removed: [],
    });
  });

  it('matches database names case-sensitively', () => {
    expect(reconcileDatabaseSelection(['Vins'], ['vins'])).toEqual({
      selection: [],
      removed: ['Vins'],
    });
  });

  it('keeps duplicate saved entries that exist on the server', () => {
    expect(reconcileDatabaseSelection(['a', 'a'], ['a'])).toEqual({
      selection: ['a', 'a'],
      removed: [],
    });
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

describe('isSchemaBasedMultiDbCapable', () => {
  it('returns true for a Postgres-like driver (schemas, not file/folder-based)', () => {
    expect(isSchemaBasedMultiDbCapable(postgresCapabilities)).toBe(true);
  });

  it('returns false when schemas is false (MySQL)', () => {
    expect(isSchemaBasedMultiDbCapable(baseCapabilities)).toBe(false);
  });

  it('returns false when file_based is true', () => {
    expect(isSchemaBasedMultiDbCapable({ ...postgresCapabilities, file_based: true })).toBe(false);
  });

  it('returns false when folder_based is true', () => {
    expect(isSchemaBasedMultiDbCapable({ ...postgresCapabilities, folder_based: true })).toBe(false);
  });

  it('returns false for a single_database store', () => {
    expect(isSchemaBasedMultiDbCapable({ ...postgresCapabilities, single_database: true })).toBe(false);
  });

  it('returns false for null/undefined capabilities', () => {
    expect(isSchemaBasedMultiDbCapable(null)).toBe(false);
    expect(isSchemaBasedMultiDbCapable(undefined)).toBe(false);
  });
});

describe('isSchemaBasedMultiDb', () => {
  it('is on for a schema-based driver with a non-empty selection', () => {
    expect(isSchemaBasedMultiDb(postgresCapabilities, ['analytics'])).toBe(true);
    expect(isSchemaBasedMultiDb(postgresCapabilities, ['a', 'b'])).toBe(true);
  });

  it('is off with an empty selection, even for a capable driver', () => {
    // A plain single-database Postgres connection must keep using the
    // schema-only layout — this is the guard against the exact regression
    // #402's review caught (flat-driver fallback firing on plain Postgres).
    expect(isSchemaBasedMultiDb(postgresCapabilities, [])).toBe(false);
  });

  it('is off for a flat multi-db driver (MySQL)', () => {
    expect(isSchemaBasedMultiDb(baseCapabilities, ['a'])).toBe(false);
  });

  it('is off for null capabilities', () => {
    expect(isSchemaBasedMultiDb(null, ['a'])).toBe(false);
  });
});

describe('hasOptedIntoDatabaseSelection', () => {
  it('is always true for a flat multi-db driver, regardless of dbParam shape', () => {
    expect(hasOptedIntoDatabaseSelection(baseCapabilities, 'mydb')).toBe(true);
    expect(hasOptedIntoDatabaseSelection(baseCapabilities, '')).toBe(true);
    expect(hasOptedIntoDatabaseSelection(baseCapabilities, ['a', 'b'])).toBe(true);
  });

  it('is false for a schema-based driver with a plain non-empty string', () => {
    // The critical case: every existing Postgres connection already has a
    // required, non-empty database name stored as a plain string from the
    // traditional single-database mode. That must NOT be misread as an
    // explicit one-element multi-db selection.
    expect(hasOptedIntoDatabaseSelection(postgresCapabilities, 'mydb')).toBe(false);
  });

  it('is true for a schema-based driver with an array selection (any length)', () => {
    expect(hasOptedIntoDatabaseSelection(postgresCapabilities, ['db1'])).toBe(true);
    expect(hasOptedIntoDatabaseSelection(postgresCapabilities, ['db1', 'db2'])).toBe(true);
  });

  it('is true for a schema-based driver with an empty string ("all databases")', () => {
    expect(hasOptedIntoDatabaseSelection(postgresCapabilities, '')).toBe(true);
  });

  it('is false for a driver that is neither flat nor schema-based multi-db capable', () => {
    expect(hasOptedIntoDatabaseSelection({ ...baseCapabilities, file_based: true }, 'main')).toBe(false);
  });

  it('is false for null capabilities', () => {
    expect(hasOptedIntoDatabaseSelection(null, ['a'])).toBe(false);
  });
});
