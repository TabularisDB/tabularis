import { describe, it, expect } from 'vitest';
import {
  buildConnectionStatus,
  partitionConnections,
  getConnectionItemClass,
  getStatusDotClass,
  findConnectionsForDrivers,
  type ConnectionStatus,
} from '../../src/utils/connectionManager';
import type { SavedConnection, ConnectionData } from '../../src/contexts/DatabaseContext';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeConn = (overrides?: Partial<SavedConnection['params']>): SavedConnection => ({
  id: 'conn-1',
  name: 'Test DB',
  params: {
    driver: 'postgres',
    host: 'localhost',
    database: 'mydb',
    port: 5432,
    ...overrides,
  },
});

const makeData = (overrides?: Partial<ConnectionData>): ConnectionData => ({
  driver: 'postgres',
  connectionName: 'Test DB',
  databaseName: 'mydb',
  tables: [],
  views: [],
  routines: [],
  isLoadingTables: false,
  isLoadingViews: false,
  isLoadingRoutines: false,
  schemas: [],
  isLoadingSchemas: false,
  schemaDataMap: {},
  activeSchema: null,
  selectedSchemas: [],
  needsSchemaSelection: false,
  isConnecting: false,
  isConnected: true,
  ...overrides,
});

const makeStatus = (overrides?: Partial<ConnectionStatus>): ConnectionStatus => ({
  id: 'conn-1',
  name: 'Test DB',
  driver: 'postgres',
  database: 'mydb',
  host: 'localhost',
  sshEnabled: false,
  isOpen: false,
  isActive: false,
  isConnecting: false,
  isConnected: false,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('connectionManager', () => {
  describe('buildConnectionStatus', () => {
    it('should build status from a connected active connection', () => {
      const conn = makeConn();
      const data = makeData({ isConnected: true, isConnecting: false });
      const result = buildConnectionStatus(conn, true, true, data);

      expect(result).toEqual({
        id: 'conn-1',
        name: 'Test DB',
        driver: 'postgres',
        database: 'mydb',
        host: 'localhost',
        sshEnabled: false,
        k8sEnabled: false,
        isOpen: true,
        isActive: true,
        isConnecting: false,
        isConnected: true,
        error: undefined,
      });
    });

    it('should reflect isConnecting state', () => {
      const conn = makeConn();
      const data = makeData({ isConnecting: true, isConnected: false });
      const result = buildConnectionStatus(conn, true, true, data);

      expect(result.isConnecting).toBe(true);
      expect(result.isConnected).toBe(false);
    });

    it('should reflect error from connection data', () => {
      const conn = makeConn();
      const data = makeData({ error: 'Connection refused' });
      const result = buildConnectionStatus(conn, false, false, data);

      expect(result.error).toBe('Connection refused');
    });

    it('should handle undefined connection data gracefully', () => {
      const conn = makeConn();
      const result = buildConnectionStatus(conn, false, false, undefined);

      expect(result.isConnecting).toBe(false);
      expect(result.isConnected).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should read ssh_enabled from connection params', () => {
      const conn = makeConn({ ssh_enabled: true });
      const result = buildConnectionStatus(conn, false, false, undefined);

      expect(result.sshEnabled).toBe(true);
    });

    it('should default sshEnabled to false when ssh_enabled is undefined', () => {
      const conn = makeConn();
      const result = buildConnectionStatus(conn, false, false, undefined);

      expect(result.sshEnabled).toBe(false);
    });

    it('should preserve host field', () => {
      const conn = makeConn({ host: '192.168.1.1' });
      const result = buildConnectionStatus(conn, false, false, undefined);

      expect(result.host).toBe('192.168.1.1');
    });

    it('should handle sqlite connection without host', () => {
      const conn = makeConn({ driver: 'sqlite', database: '/path/to/db.sqlite', host: undefined });
      const result = buildConnectionStatus(conn, false, false, undefined);

      expect(result.host).toBeUndefined();
      expect(result.driver).toBe('sqlite');
    });
  });

  describe('partitionConnections', () => {
    it('should separate open and closed connections', () => {
      const statuses: ConnectionStatus[] = [
        makeStatus({ id: 'a', isOpen: true }),
        makeStatus({ id: 'b', isOpen: false }),
        makeStatus({ id: 'c', isOpen: true }),
      ];

      const { openConnections, closedConnections } = partitionConnections(statuses);

      expect(openConnections).toHaveLength(2);
      expect(closedConnections).toHaveLength(1);
      expect(openConnections.map((c) => c.id)).toEqual(['a', 'c']);
      expect(closedConnections.map((c) => c.id)).toEqual(['b']);
    });

    it('should return all open when all are open', () => {
      const statuses = [
        makeStatus({ id: 'a', isOpen: true }),
        makeStatus({ id: 'b', isOpen: true }),
      ];
      const { openConnections, closedConnections } = partitionConnections(statuses);

      expect(openConnections).toHaveLength(2);
      expect(closedConnections).toHaveLength(0);
    });

    it('should return all closed when none are open', () => {
      const statuses = [
        makeStatus({ id: 'a', isOpen: false }),
        makeStatus({ id: 'b', isOpen: false }),
      ];
      const { openConnections, closedConnections } = partitionConnections(statuses);

      expect(openConnections).toHaveLength(0);
      expect(closedConnections).toHaveLength(2);
    });

    it('should return empty arrays for empty input', () => {
      const { openConnections, closedConnections } = partitionConnections([]);

      expect(openConnections).toHaveLength(0);
      expect(closedConnections).toHaveLength(0);
    });
  });

  describe('getConnectionItemClass', () => {
    it('should return active classes when isActive is true', () => {
      const result = getConnectionItemClass(true);
      expect(result).toContain('bg-blue-500/20');
      expect(result).toContain('text-blue-400');
      expect(result).toContain('ring-1');
    });

    it('should return inactive classes when isActive is false', () => {
      const result = getConnectionItemClass(false);
      expect(result).toContain('text-secondary');
      expect(result).toContain('hover:bg-surface-secondary');
    });

    it('should not return active classes when isActive is false', () => {
      const result = getConnectionItemClass(false);
      expect(result).not.toContain('bg-blue-500/20');
    });
  });

  describe('getStatusDotClass', () => {
    it('should return red when there is an error', () => {
      expect(getStatusDotClass(true, true)).toBe('bg-red-400');
      expect(getStatusDotClass(false, true)).toBe('bg-red-400');
    });

    it('should return bright green for active connection without error', () => {
      expect(getStatusDotClass(true, false)).toBe('bg-green-400');
    });

    it('should return dimmed green for inactive connection without error', () => {
      expect(getStatusDotClass(false, false)).toBe('bg-green-400/70');
    });

    it('should prioritize error over active state', () => {
      const result = getStatusDotClass(true, true);
      expect(result).toBe('bg-red-400');
    });
  });

  describe('findConnectionsForDrivers', () => {
    const makeDataMap = (entries: Record<string, string>) =>
      Object.fromEntries(Object.entries(entries).map(([id, driver]) => [id, { driver }]));

    it('should return IDs of open connections matching any given driver', () => {
      const openIds = ['a', 'b', 'c'];
      const dataMap = makeDataMap({ a: 'my-plugin', b: 'postgres', c: 'my-plugin' });

      expect(findConnectionsForDrivers(openIds, dataMap, ['my-plugin'])).toEqual(['a', 'c']);
    });

    it('should match across multiple driver IDs', () => {
      const openIds = ['a', 'b', 'c', 'd'];
      const dataMap = makeDataMap({ a: 'plugin-a', b: 'plugin-b', c: 'postgres', d: 'plugin-a' });

      expect(findConnectionsForDrivers(openIds, dataMap, ['plugin-a', 'plugin-b'])).toEqual(['a', 'b', 'd']);
    });

    it('should return empty array when no connections match', () => {
      const openIds = ['a', 'b'];
      const dataMap = makeDataMap({ a: 'postgres', b: 'mysql' });

      expect(findConnectionsForDrivers(openIds, dataMap, ['my-plugin'])).toEqual([]);
    });

    it('should return empty array when openConnectionIds is empty', () => {
      const dataMap = makeDataMap({ a: 'my-plugin' });

      expect(findConnectionsForDrivers([], dataMap, ['my-plugin'])).toEqual([]);
    });

    it('should return empty array when driverIds is empty', () => {
      const openIds = ['a', 'b'];
      const dataMap = makeDataMap({ a: 'my-plugin', b: 'postgres' });

      expect(findConnectionsForDrivers(openIds, dataMap, [])).toEqual([]);
    });

    it('should ignore open connection IDs not present in dataMap', () => {
      const openIds = ['a', 'orphan'];
      const dataMap = makeDataMap({ a: 'my-plugin' });

      expect(findConnectionsForDrivers(openIds, dataMap, ['my-plugin'])).toEqual(['a']);
    });

    it('should handle undefined entries in dataMap gracefully', () => {
      const openIds = ['a', 'b'];
      const dataMap: Record<string, { driver: string } | undefined> = {
        a: { driver: 'my-plugin' },
        b: undefined,
      };

      expect(findConnectionsForDrivers(openIds, dataMap, ['my-plugin'])).toEqual(['a']);
    });

    it('should not return connections whose driver is not in the list', () => {
      const openIds = ['a'];
      const dataMap = makeDataMap({ a: 'postgres' });

      expect(findConnectionsForDrivers(openIds, dataMap, ['mysql', 'sqlite'])).toEqual([]);
    });
  });
});
