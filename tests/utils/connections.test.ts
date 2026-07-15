import { describe, it, expect } from 'vitest';
import {
  formatConnectionString,
  getDefaultPort,
  validateConnectionParams,
  getDriverLabel,
  generateConnectionName,
  connectionSubtitle,
  getCardClass,
  type ConnectionParams,
  type DatabaseDriver,
} from '../../src/utils/connections';
import type { DriverCapabilities } from '../../src/types/plugins';
import type { SavedConnection } from '../../src/contexts/DatabaseContext';

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
  });

  describe('getCardClass', () => {
    const isOpen = (id: string) => id === 'open-conn';

    it('should return active class when connId matches activeConnectionId', () => {
      const cls = getCardClass('conn-1', 'conn-1', isOpen);
      expect(cls).toContain('border-blue-500/40');
    });

    it('should return open class when connection is open but not active', () => {
      const cls = getCardClass('open-conn', 'other', isOpen);
      expect(cls).toContain('border-green-500/35');
    });

    it('should return default class when connection is neither active nor open', () => {
      const cls = getCardClass('closed-conn', 'other', isOpen);
      expect(cls).toContain('border-strong');
    });

    it('should prioritize active over open when both could apply', () => {
      const isOpenAndActive = (id: string) => id === 'conn-1';
      const cls = getCardClass('conn-1', 'conn-1', isOpenAndActive);
      expect(cls).toContain('border-blue-500/40');
      expect(cls).not.toContain('border-green-500/35');
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
});
