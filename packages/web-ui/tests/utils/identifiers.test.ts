import { describe, it, expect } from 'vitest';
import {
  getQuoteChar,
  quoteIdentifier,
  quoteTableRef,
  formatSqlIdentifier,
  shouldQuoteIdentifiers,
} from '../../src/utils/identifiers';
import type { PluginManifest } from '../../src/types/plugins';

/** Minimal PluginManifest fixture for a postgres-dialect plugin registered
 * under a non-"postgres" id (issue #614's exact scenario). */
function pluginManifest(
  overrides: Partial<PluginManifest['capabilities']> = {},
): PluginManifest {
  return {
    id: 'postgresql',
    name: 'PostgreSQL',
    version: '1.0.0',
    description: '',
    default_port: 5432,
    capabilities: {
      schemas: true,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      identifier_quote: '"',
      alter_primary_key: true,
      sql_dialect: 'postgres',
      ...overrides,
    },
  };
}

describe('shouldQuoteIdentifiers', () => {
  it('returns true for the bare "postgres" string (legacy path)', () => {
    expect(shouldQuoteIdentifiers('postgres')).toBe(true);
  });

  it('returns true for the bare "postgresql" string — no capabilities object, so the literal fallback covers the shipped plugin id too (PR #588)', () => {
    expect(shouldQuoteIdentifiers('postgresql')).toBe(true);
  });

  it('returns true for a manifest/capabilities object declaring sql_dialect: "postgres"', () => {
    expect(shouldQuoteIdentifiers(pluginManifest())).toBe(true);
    expect(shouldQuoteIdentifiers(pluginManifest().capabilities)).toBe(true);
  });

  it('returns true when sql_dialect is omitted entirely (defaults to postgres per the manifest schema)', () => {
    const { sql_dialect, ...withoutDialect } = pluginManifest().capabilities;
    expect(shouldQuoteIdentifiers(withoutDialect)).toBe(true);
  });

  it('returns false for sql_dialect: "sqlite" — must not flip on identifier_quote alone, which sqlite shares with postgres', () => {
    expect(
      shouldQuoteIdentifiers(pluginManifest({ sql_dialect: 'sqlite' })),
    ).toBe(false);
  });

  it('returns false for sql_dialect: "mysql"', () => {
    expect(
      shouldQuoteIdentifiers(pluginManifest({ sql_dialect: 'mysql' })),
    ).toBe(false);
  });
});

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

  it('should read identifier_quote off a PluginManifest for a non-"postgres" plugin id', () => {
    expect(getQuoteChar(pluginManifest())).toBe('"');
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

  it('quotes identically for a "postgresql" plugin manifest and the bare "postgres" string', () => {
    expect(quoteIdentifier('my_table', pluginManifest())).toBe(
      quoteIdentifier('my_table', 'postgres'),
    );
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

  it('produces the same schema-qualified reference for a "postgresql" plugin manifest as for the bare "postgres" string', () => {
    expect(quoteTableRef('users', pluginManifest(), 'public')).toBe(
      quoteTableRef('users', 'postgres', 'public'),
    );
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

  it('should quote identifiers for postgresql driver ids', () => {
    expect(formatSqlIdentifier('AccountId', 'postgresql')).toBe('"AccountId"');
    expect(formatSqlIdentifier('user', 'postgresql')).toBe('"user"');
  });

  it('should quote identifiers for PostgreSQL plugin manifests', () => {
    const manifest = { id: 'postgresql' } as PluginManifest;

    expect(formatSqlIdentifier('AccountId', manifest)).toBe('"AccountId"');
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
  it('quotes mixed-case identifiers identically for a "postgresql" plugin manifest and the bare "postgres" string', () => {
    expect(formatSqlIdentifier('AccountEventLog', pluginManifest())).toBe(
      formatSqlIdentifier('AccountEventLog', 'postgres'),
    );
  });

  it('leaves identifiers unchanged for a plugin manifest declaring a non-postgres dialect', () => {
    expect(
      formatSqlIdentifier('Status', pluginManifest({ sql_dialect: 'mysql' })),
    ).toBe('Status');
  });
});
