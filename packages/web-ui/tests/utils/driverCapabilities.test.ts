import { describe, it, expect } from 'vitest';
import {
  isLocalDriver,
  supportsAlterColumn,
  supportsCreateForeignKeys,
  supportsExplain,
  findDriverManifest,
  getCapabilitiesForDriver,
} from '../../src/utils/driverCapabilities';
import type { DriverCapabilities, PluginManifest } from '../../src/types/plugins';

const makeCapabilities = (overrides: Partial<DriverCapabilities> = {}): DriverCapabilities => ({
  schemas: false,
  views: false,
  routines: false,
  file_based: false,
  folder_based: false,
  identifier_quote: '"',
  alter_primary_key: false,
  ...overrides,
});

const makeManifest = (id: string, caps: Partial<DriverCapabilities> = {}): PluginManifest => ({
  id,
  name: id,
  version: '1.0.0',
  description: '',
  default_port: null,
  capabilities: makeCapabilities(caps),
});

describe('driverCapabilities', () => {
  describe('isLocalDriver', () => {
    it('should return true when file_based is true', () => {
      expect(isLocalDriver(makeCapabilities({ file_based: true }))).toBe(true);
    });

    it('should return true when folder_based is true', () => {
      expect(isLocalDriver(makeCapabilities({ folder_based: true }))).toBe(true);
    });

    it('should return true when both file_based and folder_based are true', () => {
      expect(isLocalDriver(makeCapabilities({ file_based: true, folder_based: true }))).toBe(true);
    });

    it('should return false when neither file_based nor folder_based is true', () => {
      expect(isLocalDriver(makeCapabilities({ file_based: false, folder_based: false }))).toBe(false);
    });

    it('should return false when capabilities are null', () => {
      expect(isLocalDriver(null)).toBe(false);
    });

    it('should return false when capabilities are undefined', () => {
      expect(isLocalDriver(undefined)).toBe(false);
    });

    it('should return false for a typical remote driver (postgres-like)', () => {
      const caps = makeCapabilities({ schemas: true, views: true, routines: true });
      expect(isLocalDriver(caps)).toBe(false);
    });
  });

  describe('supportsAlterColumn', () => {
    it('should return true when alter_column is true', () => {
      expect(supportsAlterColumn(makeCapabilities({ alter_column: true }))).toBe(true);
    });

    it('should return false when alter_column is false', () => {
      expect(supportsAlterColumn(makeCapabilities({ alter_column: false }))).toBe(false);
    });

    it('should return false when alter_column is not set (default false)', () => {
      expect(supportsAlterColumn(makeCapabilities())).toBe(false);
    });

    it('should return false when capabilities are null', () => {
      expect(supportsAlterColumn(null)).toBe(false);
    });

    it('should return false when capabilities are undefined', () => {
      expect(supportsAlterColumn(undefined)).toBe(false);
    });
  });

  describe('supportsCreateForeignKeys', () => {
    it('should return true when create_foreign_keys is true', () => {
      expect(supportsCreateForeignKeys(makeCapabilities({ create_foreign_keys: true }))).toBe(true);
    });

    it('should return false when create_foreign_keys is false', () => {
      expect(supportsCreateForeignKeys(makeCapabilities({ create_foreign_keys: false }))).toBe(false);
    });

    it('should return false when create_foreign_keys is not set (default false)', () => {
      expect(supportsCreateForeignKeys(makeCapabilities())).toBe(false);
    });

    it('should return false when capabilities are null', () => {
      expect(supportsCreateForeignKeys(null)).toBe(false);
    });

    it('should return false when capabilities are undefined', () => {
      expect(supportsCreateForeignKeys(undefined)).toBe(false);
    });
  });

  describe('supportsExplain', () => {
    it('should return true when explain is true', () => {
      expect(supportsExplain(makeCapabilities({ explain: true }))).toBe(true);
    });

    it('should return false when explain is false', () => {
      expect(supportsExplain(makeCapabilities({ explain: false }))).toBe(false);
    });

    it('should return false when explain is not set (default false)', () => {
      expect(supportsExplain(makeCapabilities())).toBe(false);
    });

    it('should return false when capabilities are null', () => {
      expect(supportsExplain(null)).toBe(false);
    });

    it('should return false when capabilities are undefined', () => {
      expect(supportsExplain(undefined)).toBe(false);
    });
  });

  describe('findDriverManifest', () => {
    const drivers: PluginManifest[] = [
      makeManifest('postgres', { schemas: true }),
      makeManifest('mysql'),
      makeManifest('sqlite', { file_based: true }),
    ];

    it('should find driver by ID', () => {
      const result = findDriverManifest('postgres', drivers);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('postgres');
    });

    it('should return null for unknown driver ID', () => {
      expect(findDriverManifest('oracle', drivers)).toBeNull();
    });

    it('should return null for empty drivers list', () => {
      expect(findDriverManifest('postgres', [])).toBeNull();
    });

    it('should find correct manifest among multiple drivers', () => {
      const sqlite = findDriverManifest('sqlite', drivers);
      expect(sqlite?.capabilities.file_based).toBe(true);
    });
  });

  describe('getCapabilitiesForDriver', () => {
    const drivers: PluginManifest[] = [
      makeManifest('postgres', { schemas: true, alter_column: true, create_foreign_keys: true }),
      makeManifest('sqlite', { file_based: true }),
    ];

    it('should return capabilities for known driver', () => {
      const caps = getCapabilitiesForDriver('postgres', drivers);
      expect(caps).not.toBeNull();
      expect(caps?.schemas).toBe(true);
      expect(caps?.alter_column).toBe(true);
    });

    it('should return null for unknown driver', () => {
      expect(getCapabilitiesForDriver('oracle', drivers)).toBeNull();
    });

    it('should return file_based capability for SQLite-like driver', () => {
      const caps = getCapabilitiesForDriver('sqlite', drivers);
      expect(caps?.file_based).toBe(true);
    });

    it('should return null for empty drivers list', () => {
      expect(getCapabilitiesForDriver('postgres', [])).toBeNull();
    });
  });

  describe('driver-agnostic behavior with postgres-like capabilities', () => {
    const postgresCaps = makeCapabilities({
      schemas: true,
      views: true,
      routines: true,
      alter_column: true,
      create_foreign_keys: true,
      serial_type: 'SERIAL',
    });

    it('is not local', () => expect(isLocalDriver(postgresCaps)).toBe(false));
    it('supports alter column', () => expect(supportsAlterColumn(postgresCaps)).toBe(true));
    it('supports foreign keys', () => expect(supportsCreateForeignKeys(postgresCaps)).toBe(true));
  });

  describe('driver-agnostic behavior with sqlite-like capabilities', () => {
    const sqliteCaps = makeCapabilities({
      file_based: true,
      views: true,
      inline_pk: true,
      auto_increment_keyword: 'AUTOINCREMENT',
    });

    it('is local', () => expect(isLocalDriver(sqliteCaps)).toBe(true));
    it('does not support alter column (default false)', () => expect(supportsAlterColumn(sqliteCaps)).toBe(false));
    it('does not support foreign keys (default false)', () => expect(supportsCreateForeignKeys(sqliteCaps)).toBe(false));
  });

  describe('unknown external plugin (all new capabilities missing)', () => {
    const unknownCaps = makeCapabilities();

    it('is not local by default', () => expect(isLocalDriver(unknownCaps)).toBe(false));
    it('does not support alter column by default', () => expect(supportsAlterColumn(unknownCaps)).toBe(false));
    it('does not support foreign keys by default', () => expect(supportsCreateForeignKeys(unknownCaps)).toBe(false));
  });
});
