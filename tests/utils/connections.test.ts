import { describe, it, expect } from 'vitest';
import {
  formatConnectionString,
  getDefaultPort,
  getMysqlSocket,
  supportsUnixSocket,
  validateConnectionParams,
  getDriverLabel,
  generateConnectionName,
  connectionSubtitle,
  getCardClass,
  updateExtraField,
  withoutBlankSslMode,
  migrationDirectionForDriver,
  connectionOrderAfterMove,
  planGroupDrop,
  connectionDropZone,
  groupDropZone,
  type ConnectionParams,
  type DatabaseDriver,
} from '../../src/utils/connections';
import type { DriverCapabilities, PluginManifest } from '../../src/types/plugins';
import type { ConnectionGroup, SavedConnection } from '../../src/contexts/DatabaseContext';

const makeFileCaps = (): DriverCapabilities => ({
  schemas: false, views: false, routines: false,
  file_based: true, folder_based: false,
  identifier_quote: '"', alter_primary_key: false,
});

const makeFolderCaps = (): DriverCapabilities => ({
  schemas: false, views: false, routines: false,
  file_based: false, folder_based: true,
  identifier_quote: '"', alter_primary_key: false,
});

const makeRemoteCaps = (): DriverCapabilities => ({
  schemas: false, views: true, routines: true,
  file_based: false, folder_based: false,
  identifier_quote: '"', alter_primary_key: true,
});

describe('connections', () => {
  describe('withoutBlankSslMode', () => {
    it('omits blank ssl_mode', () => {
      expect(withoutBlankSslMode({ driver: 'mysql', ssl_mode: '' })).toEqual({
        driver: 'mysql',
      });
      expect(withoutBlankSslMode({ driver: 'mysql', ssl_mode: '   ' })).toEqual({
        driver: 'mysql',
      });
    });

    it('omits a null ssl_mode loaded from disk', () => {
      // Saving with a blank mode persists it as `null`; saving that
      // connection again must not throw on `.trim()`.
      expect(withoutBlankSslMode({ driver: 'mysql', ssl_mode: null })).toEqual({
        driver: 'mysql',
      });
    });

    it('keeps a non-blank ssl_mode', () => {
      expect(
        withoutBlankSslMode({ driver: 'postgres', ssl_mode: 'require' }),
      ).toEqual({ driver: 'postgres', ssl_mode: 'require' });
    });
  });

  describe('formatConnectionString', () => {
    it('should format SQLite connection string', () => {
      const params: ConnectionParams = {
        driver: 'sqlite',
        database: '/path/to/database.db',
      };

      expect(formatConnectionString(params)).toBe('/path/to/database.db');
    });

    it('should format PostgreSQL connection string with defaults', () => {
      const params: ConnectionParams = {
        driver: 'postgres',
        database: 'mydb',
        host: 'localhost',
      };

      expect(formatConnectionString(params)).toBe('localhost:5432/mydb');
    });

    it('should format MySQL connection string with custom port', () => {
      const params: ConnectionParams = {
        driver: 'mysql',
        database: 'mydb',
        host: 'db.example.com',
        port: 3307,
      };

      expect(formatConnectionString(params)).toBe('db.example.com:3307/mydb');
    });

    it('should use localhost when host is not provided', () => {
      const params: ConnectionParams = {
        driver: 'postgres',
        database: 'mydb',
      };

      expect(formatConnectionString(params)).toBe('localhost:5432/mydb');
    });

    it('should format connection with IPv4 address', () => {
      const params: ConnectionParams = {
        driver: 'mysql',
        database: 'production',
        host: '192.168.1.100',
        port: 3306,
      };

      expect(formatConnectionString(params)).toBe('192.168.1.100:3306/production');
    });
  });

  describe('getDefaultPort', () => {
    it('should return correct default port for PostgreSQL', () => {
      expect(getDefaultPort('postgres')).toBe(5432);
    });

    it('should return correct default port for MySQL', () => {
      expect(getDefaultPort('mysql')).toBe(3306);
    });

    it('should return 0 for SQLite', () => {
      expect(getDefaultPort('sqlite')).toBe(0);
    });

    it('should return 0 for an unrecognized bare driver id (e.g. a plugin id with no manifest resolved)', () => {
      expect(getDefaultPort('postgresql')).toBe(0);
    });

    it('should read default_port off a PluginManifest for a non-"postgres" plugin id (issue #614)', () => {
      const manifest: PluginManifest = {
        id: 'postgresql',
        name: 'PostgreSQL',
        version: '1.0.0',
        description: '',
        default_port: 5432,
        capabilities: {
          schemas: true, views: true, routines: true,
          file_based: false, folder_based: false,
          identifier_quote: '"', alter_primary_key: true,
        },
      };
      expect(getDefaultPort(manifest)).toBe(5432);
    });

    it('should fall back to 0 when a PluginManifest declares no default_port', () => {
      const manifest: PluginManifest = {
        id: 'some-plugin',
        name: 'Some Plugin',
        version: '1.0.0',
        description: '',
        default_port: null,
        capabilities: {
          schemas: false, views: false, routines: false,
          file_based: false, folder_based: false,
          identifier_quote: '"', alter_primary_key: false,
        },
      };
      expect(getDefaultPort(manifest)).toBe(0);
    });
  });

  describe('validateConnectionParams', () => {
    it('should validate a complete PostgreSQL connection', () => {
      const params: ConnectionParams = {
        driver: 'postgres',
        database: 'mydb',
        host: 'localhost',
        port: 5432,
        username: 'user',
        password: 'pass',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate a complete SQLite connection', () => {
      const params: ConnectionParams = {
        driver: 'sqlite',
        database: '/path/to/db.sqlite',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should fail when driver is missing', () => {
      const params = {
        database: 'mydb',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Driver is required');
    });

    it('should fail when database is missing', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Database name is required');
    });

    it('should fail when host is missing for remote databases', () => {
      const params = {
        driver: 'mysql' as DatabaseDriver,
        database: 'mydb',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Host is required for remote databases');
    });

    it('should fail for invalid port numbers', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
        database: 'mydb',
        host: 'localhost',
        port: 70000,
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Port must be between 1 and 65535');
    });

    it('should fail for negative port numbers', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
        database: 'mydb',
        host: 'localhost',
        port: -1,
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
    });

    it('should fail when SSH is enabled without host', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
        database: 'mydb',
        host: 'localhost',
        ssh_enabled: true,
        ssh_user: 'user',
        ssh_password: 'pass',
      };

      // Missing ssh_host
      delete (params as { ssh_host?: string }).ssh_host;

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('SSH host is required when SSH is enabled');
    });

    it('should fail when SSH is enabled without user', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
        database: 'mydb',
        host: 'localhost',
        ssh_enabled: true,
        ssh_host: 'ssh.example.com',
        ssh_password: 'pass',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('SSH user is required when SSH is enabled');
    });

    it('should fail when SSH is enabled without password or key', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
        database: 'mydb',
        host: 'localhost',
        ssh_enabled: true,
        ssh_host: 'ssh.example.com',
        ssh_user: 'user',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('SSH password or key file is required');
    });

    it('should validate SSH connection with password', () => {
      const params: ConnectionParams = {
        driver: 'postgres',
        database: 'mydb',
        host: 'localhost',
        ssh_enabled: true,
        ssh_host: 'ssh.example.com',
        ssh_user: 'user',
        ssh_password: 'pass',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should validate SSH connection with key file', () => {
      const params: ConnectionParams = {
        driver: 'postgres',
        database: 'mydb',
        host: 'localhost',
        ssh_enabled: true,
        ssh_host: 'ssh.example.com',
        ssh_user: 'user',
        ssh_key_file: '/path/to/key',
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should fail for invalid SSH port', () => {
      const params = {
        driver: 'postgres' as DatabaseDriver,
        database: 'mydb',
        host: 'localhost',
        ssh_enabled: true,
        ssh_host: 'ssh.example.com',
        ssh_user: 'user',
        ssh_password: 'pass',
        ssh_port: 100000,
      };

      const result = validateConnectionParams(params);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('SSH port must be between 1 and 65535');
    });
  });

  describe('getDriverLabel', () => {
    it('should return human-readable label for PostgreSQL', () => {
      expect(getDriverLabel('postgres')).toBe('PostgreSQL');
    });

    it('should return human-readable label for MySQL', () => {
      expect(getDriverLabel('mysql')).toBe('MySQL');
    });

    it('should return human-readable label for SQLite', () => {
      expect(getDriverLabel('sqlite')).toBe('SQLite');
    });

    it('should return an all-caps fallback for an unrecognized bare driver id', () => {
      expect(getDriverLabel('postgresql')).toBe('POSTGRESQL');
    });

    it('should read name off a PluginManifest for a non-"postgres" plugin id (issue #614), not the all-caps fallback', () => {
      const manifest: PluginManifest = {
        id: 'postgresql',
        name: 'PostgreSQL',
        version: '1.0.0',
        description: '',
        default_port: 5432,
        capabilities: {
          schemas: true, views: true, routines: true,
          file_based: false, folder_based: false,
          identifier_quote: '"', alter_primary_key: true,
        },
      };
      expect(getDriverLabel(manifest)).toBe('PostgreSQL');
    });
  });

  describe('generateConnectionName', () => {
    it('should generate name from SQLite path', () => {
      const params: ConnectionParams = {
        driver: 'sqlite',
        database: '/path/to/database.db',
      };

      expect(generateConnectionName(params)).toBe('database.db');
    });

    it('should generate name from remote database', () => {
      const params: ConnectionParams = {
        driver: 'postgres',
        database: 'production',
        host: 'db.example.com',
      };

      expect(generateConnectionName(params)).toBe('production@db.example.com');
    });

    it('should use localhost when host is not provided', () => {
      const params: ConnectionParams = {
        driver: 'mysql',
        database: 'development',
      };

      expect(generateConnectionName(params)).toBe('development@localhost');
    });

    it('should handle SQLite path with no slashes', () => {
      const params: ConnectionParams = {
        driver: 'sqlite',
        database: 'local.db',
      };

      expect(generateConnectionName(params)).toBe('local.db');
    });

    it('should extract filename from complex SQLite path', () => {
      const params: ConnectionParams = {
        driver: 'sqlite',
        database: '/home/user/projects/app/data/main.sqlite',
      };

      expect(generateConnectionName(params)).toBe('main.sqlite');
    });
  });

  // Capability-based tests
  describe('formatConnectionString with capabilities', () => {
    it('should format local path for file_based driver', () => {
      const params: ConnectionParams = { driver: 'custom-db', database: '/data/app.db' };
      expect(formatConnectionString(params, makeFileCaps())).toBe('/data/app.db');
    });

    it('should format local path for folder_based driver', () => {
      const params: ConnectionParams = { driver: 'csv', database: '/data/csvdir' };
      expect(formatConnectionString(params, makeFolderCaps())).toBe('/data/csvdir');
    });

    it('should format remote connection string for remote driver', () => {
      const params: ConnectionParams = { driver: 'duckdb', database: 'mydb', host: 'db.host', port: 5432 };
      expect(formatConnectionString(params, makeRemoteCaps())).toBe('db.host:5432/mydb');
    });

    it('should use getDefaultPort when capabilities indicate remote and no port given', () => {
      const params: ConnectionParams = { driver: 'postgres', database: 'mydb', host: 'localhost' };
      expect(formatConnectionString(params, makeRemoteCaps())).toBe('localhost:5432/mydb');
    });

    it('should treat unknown driver as remote when capabilities show remote', () => {
      const params: ConnectionParams = { driver: 'oracle', database: 'orcl', host: 'db.host', port: 1521 };
      expect(formatConnectionString(params, makeRemoteCaps())).toBe('db.host:1521/orcl');
    });
  });

  describe('validateConnectionParams with capabilities', () => {
    it('should pass for file_based driver without host', () => {
      const params: ConnectionParams = { driver: 'custom-db', database: '/path/to/db' };
      const result = validateConnectionParams(params, makeFileCaps());
      expect(result.isValid).toBe(true);
    });

    it('should pass for folder_based driver without host', () => {
      const params: ConnectionParams = { driver: 'csv', database: '/data/dir' };
      const result = validateConnectionParams(params, makeFolderCaps());
      expect(result.isValid).toBe(true);
    });

    it('should fail for remote driver without host', () => {
      const params: ConnectionParams = { driver: 'duckdb-remote', database: 'mydb' };
      const result = validateConnectionParams(params, makeRemoteCaps());
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Host is required for remote databases');
    });

    it('should pass for remote driver with host', () => {
      const params: ConnectionParams = { driver: 'duckdb-remote', database: 'mydb', host: 'db.host' };
      const result = validateConnectionParams(params, makeRemoteCaps());
      expect(result.isValid).toBe(true);
    });

    it('should still require driver field even with capabilities', () => {
      const params = { database: '/path/to/db' };
      const result = validateConnectionParams(params, makeFileCaps());
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Driver is required');
    });
  });

  describe('connectionSubtitle', () => {
    const makeConn = (overrides: Partial<SavedConnection['params']> = {}): SavedConnection => ({
      id: '1',
      name: 'test',
      params: { driver: 'postgres', host: 'db.host', port: 5432, database: 'mydb', ...overrides },
    });

    it('should return file path for local driver', () => {
      const conn = makeConn({ database: '/path/to/db.sqlite' });
      expect(connectionSubtitle(conn, makeFileCaps())).toBe('/path/to/db.sqlite');
    });

    it('should return first element when database is array and driver is local', () => {
      const conn = makeConn({ database: ['/path/to/db.sqlite', '/path/other.sqlite'] });
      expect(connectionSubtitle(conn, makeFileCaps())).toBe('/path/to/db.sqlite');
    });

    it('should return empty string when database array is empty and driver is local', () => {
      const conn = makeConn({ database: [] });
      expect(connectionSubtitle(conn, makeFileCaps())).toBe('');
    });

    it('should return host:port · db for remote driver', () => {
      const conn = makeConn({ host: 'db.host', port: 5432, database: 'mydb' });
      expect(connectionSubtitle(conn, makeRemoteCaps())).toBe('db.host:5432  ·  mydb');
    });

    it('should use localhost when host is undefined for remote driver', () => {
      const conn = makeConn({ host: undefined, port: 3306, database: 'mydb' });
      expect(connectionSubtitle(conn, makeRemoteCaps())).toBe('localhost:3306  ·  mydb');
    });

    it('should show count when database is an array for remote driver', () => {
      const conn = makeConn({ host: 'db.host', port: 5432, database: ['db1', 'db2', 'db3'] });
      expect(connectionSubtitle(conn, makeRemoteCaps())).toBe('db.host:5432  ·  3 databases');
    });

    it('should treat null capabilities as remote driver', () => {
      const conn = makeConn({ host: 'db.host', port: 5432, database: 'mydb' });
      expect(connectionSubtitle(conn, null)).toBe('db.host:5432  ·  mydb');
    });

    it('should label empty database as all databases on multi-db drivers', () => {
      const conn = makeConn({ host: 'db.host', port: 3306, database: '' });
      expect(connectionSubtitle(conn, makeRemoteCaps())).toBe('db.host:3306  ·  All databases');
      expect(
        connectionSubtitle(conn, makeRemoteCaps(), { allDatabases: 'Tutti i database' }),
      ).toBe('db.host:3306  ·  Tutti i database');
    });

    it('should keep empty database verbatim when capabilities are unknown', () => {
      const conn = makeConn({ host: 'db.host', port: 3306, database: '' });
      expect(connectionSubtitle(conn, null)).toBe('db.host:3306  ·  ');
    });

    it('should use the translated database counter when provided', () => {
      const conn = makeConn({ host: 'db.host', port: 5432, database: ['db1', 'db2'] });
      expect(
        connectionSubtitle(conn, makeRemoteCaps(), { databaseCount: (c) => `${c} DB` }),
      ).toBe('db.host:5432  ·  2 DB');
    });
  });

  describe('getCardClass', () => {
    const isOpen = (id: string) => id === 'open-conn';

    it('should return active class when connId matches activeConnectionId', () => {
      const cls = getCardClass('conn-1', 'conn-1', isOpen);
      expect(cls).toContain('border-accent-primary/40');
    });

    it('should return open class when connection is open but not active', () => {
      const cls = getCardClass('open-conn', 'other', isOpen);
      expect(cls).toContain('border-accent-success/35');
    });

    it('should return default class when connection is neither active nor open', () => {
      const cls = getCardClass('closed-conn', 'other', isOpen);
      expect(cls).toContain('border-strong');
    });

    it('should prioritize active over open when both could apply', () => {
      const isOpenAndActive = (id: string) => id === 'conn-1';
      const cls = getCardClass('conn-1', 'conn-1', isOpenAndActive);
      expect(cls).toContain('border-accent-primary/40');
      expect(cls).not.toContain('border-accent-success/35');
    });

    it('should return default class when activeConnectionId is null', () => {
      const cls = getCardClass('conn-1', null, isOpen);
      expect(cls).toContain('border-strong');
    });
  });

  describe('generateConnectionName with capabilities', () => {
    it('should extract filename for file_based driver', () => {
      const params: ConnectionParams = { driver: 'custom-db', database: '/home/user/data.db' };
      expect(generateConnectionName(params, makeFileCaps())).toBe('data.db');
    });

    it('should extract folder name for folder_based driver', () => {
      const params: ConnectionParams = { driver: 'csv', database: '/data/csvfiles' };
      expect(generateConnectionName(params, makeFolderCaps())).toBe('csvfiles');
    });

    it('should format database@host for remote driver', () => {
      const params: ConnectionParams = { driver: 'duckdb-remote', database: 'analytics', host: 'db.host' };
      expect(generateConnectionName(params, makeRemoteCaps())).toBe('analytics@db.host');
    });

    it('should use localhost when host is missing for remote driver', () => {
      const params: ConnectionParams = { driver: 'duckdb-remote', database: 'analytics' };
      expect(generateConnectionName(params, makeRemoteCaps())).toBe('analytics@localhost');
    });
  });

  describe('updateExtraField', () => {
    it('should set a field on an undefined map', () => {
      expect(updateExtraField(undefined, 'region', 'us-east-1')).toEqual({
        region: 'us-east-1',
      });
    });

    it('should set a field alongside existing entries', () => {
      const result = updateExtraField({ profile: 'dev' }, 'region', 'eu-west-1');
      expect(result).toEqual({ profile: 'dev', region: 'eu-west-1' });
    });

    it('should not mutate the input map', () => {
      const input = { region: 'us-east-1' };
      updateExtraField(input, 'region', 'eu-west-1');
      expect(input).toEqual({ region: 'us-east-1' });
    });

    it('should remove the key when the value is empty', () => {
      const result = updateExtraField(
        { region: 'us-east-1', profile: 'dev' },
        'region',
        '',
      );
      expect(result).toEqual({ profile: 'dev' });
    });

    it('should return undefined when the last entry is removed', () => {
      expect(updateExtraField({ region: 'us-east-1' }, 'region', '')).toBeUndefined();
    });

    it('should return undefined when removing from an undefined map', () => {
      expect(updateExtraField(undefined, 'region', '')).toBeUndefined();
    });

    it('should ignore blank keys', () => {
      const input = { region: 'us-east-1' };
      expect(updateExtraField(input, '  ', 'value')).toBe(input);
      expect(updateExtraField(undefined, '', 'value')).toBeUndefined();
    });

    it('should trim the key', () => {
      expect(updateExtraField(undefined, ' region ', 'us-east-1')).toEqual({
        region: 'us-east-1',
      });
    });
  });

  describe('migrationDirectionForDriver', () => {
    const baseManifest = (
      id: string,
      overrides: Partial<PluginManifest> = {},
    ): PluginManifest => ({
      id,
      name: id,
      version: '1.0.0',
      description: '',
      default_port: null,
      capabilities: {
        schemas: true, views: true, routines: true,
        file_based: false, folder_based: false,
        identifier_quote: '"', alter_primary_key: true,
      },
      ...overrides,
    });

    it('returns "to-plugin" when the current driver is deprecated', () => {
      const drivers = [
        baseManifest('postgres', {
          deprecated: { replacement_id: 'postgresql', removal_date: '2026-10-05' },
        }),
        baseManifest('postgresql'),
      ];
      expect(migrationDirectionForDriver('postgres', drivers)).toBe('to-plugin');
    });

    it('returns "to-builtin" when the current driver is the replacement of a deprecated built-in', () => {
      const drivers = [
        baseManifest('postgres', {
          deprecated: { replacement_id: 'postgresql', removal_date: '2026-10-05' },
        }),
        baseManifest('postgresql'),
      ];
      expect(migrationDirectionForDriver('postgresql', drivers)).toBe('to-builtin');
    });

    it('returns null for a driver unrelated to any deprecation', () => {
      const drivers = [
        baseManifest('postgres', {
          deprecated: { replacement_id: 'postgresql', removal_date: '2026-10-05' },
        }),
        baseManifest('postgresql'),
        baseManifest('mysql'),
        baseManifest('sqlite'),
      ];
      expect(migrationDirectionForDriver('mysql', drivers)).toBeNull();
      expect(migrationDirectionForDriver('sqlite', drivers)).toBeNull();
    });

    it('returns null when no driver is deprecated at all', () => {
      const drivers = [baseManifest('postgres'), baseManifest('mysql')];
      expect(migrationDirectionForDriver('postgres', drivers)).toBeNull();
    });

    it('returns null for an unknown driver id', () => {
      const drivers = [
        baseManifest('postgres', {
          deprecated: { replacement_id: 'postgresql', removal_date: '2026-10-05' },
        }),
      ];
      expect(migrationDirectionForDriver('sqlite', drivers)).toBeNull();
    });

    it('returns null for a deprecated driver with no wired migration hook yet', () => {
      // A manifest can carry `deprecated` before its migration hook exists
      // (e.g. a future mysql deprecation, wired incrementally). The action
      // must stay hidden until the UI actually supports that pair — otherwise
      // clicking it would fall through to whatever hook happens to be
      // instantiated (postgres today), flipping the driver to the wrong plugin.
      const drivers = [
        baseManifest('mysql', {
          deprecated: { replacement_id: 'mysql-plugin', removal_date: '2027-01-01' },
        }),
        baseManifest('mysql-plugin'),
      ];
      expect(migrationDirectionForDriver('mysql', drivers)).toBeNull();
      expect(migrationDirectionForDriver('mysql-plugin', drivers)).toBeNull();
    });
  });

  describe('connectionOrderAfterMove', () => {
    const ids = ['a', 'b', 'c', 'd'];

    it('places a connection after the target', () => {
      expect(connectionOrderAfterMove(ids, 'a', 'c', 'after')).toEqual([
        ['b', 0], ['c', 1], ['a', 2], ['d', 3],
      ]);
    });

    it('places a connection before the target', () => {
      expect(connectionOrderAfterMove(ids, 'd', 'b', 'before')).toEqual([
        ['a', 0], ['d', 1], ['b', 2], ['c', 3],
      ]);
    });

    it('inserts a connection coming from another folder', () => {
      expect(connectionOrderAfterMove(ids, 'x', 'b', 'after')).toEqual([
        ['a', 0], ['b', 1], ['x', 2], ['c', 3], ['d', 4],
      ]);
    });

    it('returns null when the order would not change', () => {
      expect(connectionOrderAfterMove(ids, 'b', 'b', 'before')).toBeNull();
      expect(connectionOrderAfterMove(ids, 'b', 'c', 'before')).toBeNull();
      expect(connectionOrderAfterMove(ids, 'b', 'a', 'after')).toBeNull();
    });

    it('returns null when the target is not in the list', () => {
      expect(connectionOrderAfterMove(ids, 'a', 'x', 'after')).toBeNull();
    });
  });

  describe('connectionDropZone', () => {
    const rect = { top: 0, left: 0, width: 100, height: 40 };

    it('splits side-by-side cards left and right', () => {
      expect(connectionDropZone(rect, 10, 35, 'x')).toBe('before');
      expect(connectionDropZone(rect, 90, 5, 'x')).toBe('after');
    });

    it('splits stacked cards top and bottom', () => {
      expect(connectionDropZone(rect, 90, 5, 'y')).toBe('before');
      expect(connectionDropZone(rect, 10, 35, 'y')).toBe('after');
    });
  });

  describe('groupDropZone', () => {
    const rect = { top: 100, height: 30 };

    it('maps the top, middle and bottom of a header', () => {
      expect(groupDropZone(rect, 102, true)).toBe('before');
      expect(groupDropZone(rect, 115, true)).toBe('inside');
      expect(groupDropZone(rect, 128, true)).toBe('after');
    });

    it('nests instead of placing after an expanded folder with content', () => {
      expect(groupDropZone(rect, 128, false)).toBe('inside');
    });
  });

  describe('planGroupDrop', () => {
    const group = (id: string, sort_order: number, parent_id?: string): ConnectionGroup => ({
      id,
      name: id,
      collapsed: false,
      sort_order,
      parent_id,
    });
    // pg (0) > [pg-prod (0), pg-dev (1)], ch (1)
    const groups = [
      group('pg', 0),
      group('ch', 1),
      group('pg-prod', 0, 'pg'),
      group('pg-dev', 1, 'pg'),
    ];

    it('nests a folder at the end of the target', () => {
      expect(planGroupDrop(groups, 'ch', 'pg', 'inside')).toEqual({
        parentId: 'pg',
        order: [['pg-prod', 0], ['pg-dev', 1], ['ch', 2]],
      });
    });

    it('moves a nested folder back to the top level when dropped before a root folder', () => {
      expect(planGroupDrop(groups, 'pg-dev', 'pg', 'before')).toEqual({
        parentId: null,
        order: [['pg-dev', 0], ['pg', 1], ['ch', 2]],
      });
    });

    it('places a folder after its target among the same siblings', () => {
      expect(planGroupDrop(groups, 'pg', 'ch', 'after')).toEqual({
        parentId: null,
        order: [['ch', 0], ['pg', 1]],
      });
    });

    it('refuses to move a folder into its own subfolder', () => {
      expect(planGroupDrop(groups, 'pg', 'pg-prod', 'inside')).toBe('cycle');
      expect(planGroupDrop(groups, 'pg', 'pg-prod', 'after')).toBe('cycle');
    });

    it('does nothing when the folder order would not change', () => {
      expect(planGroupDrop(groups, 'pg', 'ch', 'before')).toBeNull();
      expect(planGroupDrop(groups, 'pg-dev', 'pg', 'inside')).toBeNull();
    });

    it('does nothing when dropped on itself', () => {
      expect(planGroupDrop(groups, 'pg', 'pg', 'before')).toBeNull();
    });
  });

  describe('MySQL Unix socket', () => {
    it('getMysqlSocket returns the trimmed path for MySQL only', () => {
      expect(getMysqlSocket({ driver: 'mysql', socket: ' /tmp/mysql.sock ' })).toBe('/tmp/mysql.sock');
      expect(getMysqlSocket({ driver: 'mysql', socket: '   ' })).toBeUndefined();
      expect(getMysqlSocket({ driver: 'mysql' })).toBeUndefined();
      expect(getMysqlSocket({ driver: 'postgres', socket: '/tmp/mysql.sock' })).toBeUndefined();
    });

    it('formatConnectionString shows the socket instead of host:port', () => {
      expect(
        formatConnectionString({
          driver: 'mysql',
          host: 'db.example.com',
          port: 3307,
          socket: '/tmp/mysql.sock',
          database: 'app',
        }),
      ).toBe('/tmp/mysql.sock/app');
    });

    it('connectionSubtitle shows the socket instead of host:port', () => {
      const conn: SavedConnection = {
        id: '1',
        name: 'local',
        params: { driver: 'mysql', host: 'localhost', port: 3306, socket: '/tmp/mysql.sock', database: 'app' },
      };
      expect(connectionSubtitle(conn, null)).toBe('/tmp/mysql.sock  ·  app');
    });

    it('supportsUnixSocket is false only on Windows', () => {
      expect(supportsUnixSocket('Win32')).toBe(false);
      expect(supportsUnixSocket('MacIntel')).toBe(true);
      expect(supportsUnixSocket('Linux x86_64')).toBe(true);
    });
  });
});
