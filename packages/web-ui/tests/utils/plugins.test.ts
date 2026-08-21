import { describe, it, expect } from 'vitest';
import { canUpdateToLatest, parseAuthor, versionGte } from '../../src/utils/plugins';

describe('plugins', () => {
  describe('parseAuthor', () => {
    it('should parse name only', () => {
      expect(parseAuthor('debba')).toEqual({ name: 'debba' });
    });

    it('should parse name and url from "Name <url>" format', () => {
      expect(parseAuthor('debba <https://example.com>')).toEqual({
        name: 'debba',
        url: 'https://example.com',
      });
    });

    it('should trim whitespace around name and url', () => {
      expect(parseAuthor('  John Doe  <  https://example.com  >')).toEqual({
        name: 'John Doe',
        url: 'https://example.com',
      });
    });

    it('should handle name with spaces', () => {
      expect(parseAuthor('John Doe')).toEqual({ name: 'John Doe' });
    });

    it('should return undefined url when no angle brackets present', () => {
      const result = parseAuthor('nodash');
      expect(result.url).toBeUndefined();
    });

    it('should handle empty string', () => {
      expect(parseAuthor('')).toEqual({ name: '' });
    });
  });

  describe('versionGte', () => {
    it('should return true for equal versions', () => {
      expect(versionGte('1.0.0', '1.0.0')).toBe(true);
      expect(versionGte('0.9.1', '0.9.1')).toBe(true);
    });

    it('should return true when versionA is greater (patch)', () => {
      expect(versionGte('1.0.1', '1.0.0')).toBe(true);
    });

    it('should return true when versionA is greater (minor)', () => {
      expect(versionGte('1.1.0', '1.0.9')).toBe(true);
    });

    it('should return true when versionA is greater (major)', () => {
      expect(versionGte('2.0.0', '1.9.9')).toBe(true);
    });

    it('should return false when versionA is less (patch)', () => {
      expect(versionGte('1.0.0', '1.0.1')).toBe(false);
    });

    it('should return false when versionA is less (minor)', () => {
      expect(versionGte('1.0.9', '1.1.0')).toBe(false);
    });

    it('should return false when versionA is less (major)', () => {
      expect(versionGte('1.9.9', '2.0.0')).toBe(false);
    });

    it('should handle versions with different number of parts', () => {
      expect(versionGte('1.0', '1.0.0')).toBe(true);
      expect(versionGte('1.0.0', '1.0')).toBe(true);
      expect(versionGte('1', '1.0.0')).toBe(true);
    });

    it('should handle real-world Tabularis version scenarios', () => {
      // Current app 0.9.1, plugin requires >= 0.8.15 → compatible
      expect(versionGte('0.9.1', '0.8.15')).toBe(true);
      // Current app 0.9.1, plugin requires >= 0.9.2 → incompatible
      expect(versionGte('0.9.1', '0.9.2')).toBe(false);
      // Current app 0.9.1, plugin requires >= 0.9.1 → compatible
      expect(versionGte('0.9.1', '0.9.1')).toBe(true);
    });
  });

  describe('canUpdateToLatest', () => {
    const plugin = (over = {}) => ({
      latest_version: '0.5.0',
      update_available: true,
      releases: [
        { version: '0.3.9', platform_supported: true },
        { version: '0.5.0', platform_supported: true },
      ],
      ...over,
    });

    it('offers the update when the latest release is installable', () => {
      expect(canUpdateToLatest(plugin(), '0.15.0')).toBe(true);
    });

    it('stays silent when no newer version exists', () => {
      expect(canUpdateToLatest(plugin({ update_available: false }), '0.15.0')).toBe(false);
      expect(canUpdateToLatest(undefined, '0.15.0')).toBe(false);
    });

    // The catalogue degrades to the list item when the detail fetch fails, and
    // that item carries latest_version but no releases — update_available stays
    // true, so without this guard we'd offer an update we can't perform.
    it('stays silent when releases are unknown', () => {
      expect(canUpdateToLatest(plugin({ releases: [] }), '0.15.0')).toBe(false);
    });

    it('stays silent when the latest release has no build for this platform', () => {
      const p = plugin({
        releases: [{ version: '0.5.0', platform_supported: false }],
      });
      expect(canUpdateToLatest(p, '0.15.0')).toBe(false);
    });

    it('respects min_tabularis_version', () => {
      const needs = (v: string) =>
        plugin({
          releases: [
            { version: '0.5.0', platform_supported: true, min_tabularis_version: v },
          ],
        });
      expect(canUpdateToLatest(needs('0.16.0'), '0.15.0')).toBe(false);
      expect(canUpdateToLatest(needs('0.15.0'), '0.15.0')).toBe(true);
    });
  });
});
