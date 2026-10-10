import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseConnectionParams,
  formatDiagramTitle,
  isFullscreenActive,
  shouldShowMinimap,
  shouldAnimateEdges,
  resolveDiagramSchema,
  type ConnectionParams,
} from '../../src/utils/schemaDiagram';

describe('schemaDiagram', () => {
  describe('resolveDiagramSchema', () => {
    it('should prefer an explicit schema (PostgreSQL)', () => {
      expect(resolveDiagramSchema('public', 'my_db')).toBe('public');
    });

    it('should fall back to the selected database when no schema is given (MySQL multi-db)', () => {
      expect(resolveDiagramSchema(undefined, 'web_opd_backend')).toBe(
        'web_opd_backend',
      );
    });

    it('should return undefined when the database is the "Unknown" sentinel', () => {
      expect(resolveDiagramSchema(undefined, 'Unknown')).toBeUndefined();
    });

    it('should return undefined when neither schema nor database is given', () => {
      expect(resolveDiagramSchema(undefined, undefined)).toBeUndefined();
    });

    it('should prefer the schema even when a database is also present', () => {
      expect(resolveDiagramSchema('analytics', 'web_opd_backend')).toBe(
        'analytics',
      );
    });
  });

  describe('parseConnectionParams', () => {
    it('should parse all connection parameters', () => {
      const params = new URLSearchParams({
        connectionId: 'conn-123',
        connectionName: 'Production DB',
        databaseName: 'main_db',
      });

      const result = parseConnectionParams(params);

      expect(result).toEqual({
        connectionId: 'conn-123',
        connectionName: 'Production DB',
        databaseName: 'main_db',
      });
    });

    it('should use "Unknown" as default for missing connectionName', () => {
      const params = new URLSearchParams({
        connectionId: 'conn-123',
        databaseName: 'main_db',
      });

      const result = parseConnectionParams(params);

      expect(result.connectionName).toBe('Unknown');
    });

    it('should use "Unknown" as default for missing databaseName', () => {
      const params = new URLSearchParams({
        connectionId: 'conn-123',
        connectionName: 'Production DB',
      });

      const result = parseConnectionParams(params);

      expect(result.databaseName).toBe('Unknown');
    });

    it('should return null for missing connectionId', () => {
      const params = new URLSearchParams({
        connectionName: 'Production DB',
        databaseName: 'main_db',
      });

      const result = parseConnectionParams(params);

      expect(result.connectionId).toBeNull();
    });

    it('should handle empty search params', () => {
      const params = new URLSearchParams();

      const result = parseConnectionParams(params);

      expect(result).toEqual({
        connectionId: null,
        connectionName: 'Unknown',
        databaseName: 'Unknown',
      });
    });

    it('should handle special characters in names', () => {
      // URLSearchParams constructor doesn't decode values - they come pre-decoded from the browser
      const params = new URLSearchParams();
      params.set('connectionId', 'conn-123');
      params.set('connectionName', 'Production DB'); // Space is already decoded
      params.set('databaseName', 'main_db');

      const result = parseConnectionParams(params);

      expect(result.connectionName).toBe('Production DB');
    });
  });

  describe('formatDiagramTitle', () => {
    it('should format title with database and connection names', () => {
      const result = formatDiagramTitle('main_db', 'Production DB');

      expect(result).toBe('main_db (Production DB)');
    });

    it('should handle single-word names', () => {
      const result = formatDiagramTitle('users', 'local');

      expect(result).toBe('users (local)');
    });

    it('should handle empty strings', () => {
      const result = formatDiagramTitle('', '');

      expect(result).toBe(' ()');
    });

    it('should preserve special characters', () => {
      const result = formatDiagramTitle('db-name_v2', 'conn:123');

      expect(result).toBe('db-name_v2 (conn:123)');
    });

    it('should handle long names', () => {
      const longDb = 'very_long_database_name_that_might_be_truncated';
      const longConn = 'super_long_connection_name_for_testing';
      const result = formatDiagramTitle(longDb, longConn);

      expect(result).toBe(`${longDb} (${longConn})`);
    });
  });

  describe('isFullscreenActive', () => {
    beforeEach(() => {
      // Reset fullscreen state
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
    });

    it('should return false when not in fullscreen', () => {
      const result = isFullscreenActive();

      expect(result).toBe(false);
    });

    it('should handle server-side rendering', () => {
      const originalDocument = global.document;
      Object.defineProperty(global, 'document', {
        value: undefined,
        writable: true,
      });

      const result = isFullscreenActive();

      expect(result).toBe(false);

      Object.defineProperty(global, 'document', {
        value: originalDocument,
        writable: true,
      });
    });
  });

  describe('shouldShowMinimap', () => {
    it('should show minimap for 10-100 tables', () => {
      expect(shouldShowMinimap(10)).toBe(true);
      expect(shouldShowMinimap(50)).toBe(true);
      expect(shouldShowMinimap(100)).toBe(true);
    });

    it('should not show minimap for less than 10 tables', () => {
      expect(shouldShowMinimap(0)).toBe(false);
      expect(shouldShowMinimap(5)).toBe(false);
      expect(shouldShowMinimap(9)).toBe(false);
    });

    it('should not show minimap for more than 100 tables', () => {
      expect(shouldShowMinimap(101)).toBe(false);
      expect(shouldShowMinimap(500)).toBe(false);
      expect(shouldShowMinimap(1000)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(shouldShowMinimap(10)).toBe(true); // Exact minimum
      expect(shouldShowMinimap(100)).toBe(true); // Exact maximum
    });

    it('should handle negative values', () => {
      expect(shouldShowMinimap(-1)).toBe(false);
      expect(shouldShowMinimap(-100)).toBe(false);
    });
  });

  describe('shouldAnimateEdges', () => {
    it('should animate edges for 50 or fewer edges', () => {
      expect(shouldAnimateEdges(0)).toBe(true);
      expect(shouldAnimateEdges(25)).toBe(true);
      expect(shouldAnimateEdges(50)).toBe(true);
    });

    it('should not animate edges for more than 50 edges', () => {
      expect(shouldAnimateEdges(51)).toBe(false);
      expect(shouldAnimateEdges(100)).toBe(false);
      expect(shouldAnimateEdges(1000)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(shouldAnimateEdges(50)).toBe(true); // Exact threshold
      expect(shouldAnimateEdges(51)).toBe(false); // Just over threshold
    });

    it('should handle negative values', () => {
      // Negative edges don't make sense, but function should still work
      expect(shouldAnimateEdges(-1)).toBe(true);
      expect(shouldAnimateEdges(-100)).toBe(true);
    });
  });
});
