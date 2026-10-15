import { describe, it, expect } from 'vitest';
import {
  formatObjectCount,
  filterValidSchemas,
  getDefaultSchema,
} from '../../src/utils/schema';

describe('formatObjectCount', () => {
  it('should format counts with proper labels', () => {
    expect(formatObjectCount(3, 2, 1)).toBe('3T / 2V / 1R');
  });

  it('should handle zero counts', () => {
    expect(formatObjectCount(0, 0, 0)).toBe('0T / 0V / 0R');
  });

  it('should handle large numbers', () => {
    expect(formatObjectCount(100, 50, 25)).toBe('100T / 50V / 25R');
  });

  it('should handle mixed zero and non-zero', () => {
    expect(formatObjectCount(5, 0, 3)).toBe('5T / 0V / 3R');
  });
});

describe('filterValidSchemas', () => {
  it('should keep only schemas that exist in available list', () => {
    const saved = ['public', 'analytics', 'stale_schema'];
    const available = ['public', 'analytics', 'audit'];
    expect(filterValidSchemas(saved, available)).toEqual(['public', 'analytics']);
  });

  it('should return empty array when no saved schemas are available', () => {
    expect(filterValidSchemas(['old1', 'old2'], ['new1', 'new2'])).toEqual([]);
  });

  it('should return empty array when saved list is empty', () => {
    expect(filterValidSchemas([], ['public', 'analytics'])).toEqual([]);
  });

  it('should return empty array when available list is empty', () => {
    expect(filterValidSchemas(['public'], [])).toEqual([]);
  });

  it('should preserve order of saved schemas', () => {
    const saved = ['z_schema', 'a_schema', 'm_schema'];
    const available = ['a_schema', 'm_schema', 'z_schema'];
    expect(filterValidSchemas(saved, available)).toEqual(['z_schema', 'a_schema', 'm_schema']);
  });
});

describe('getDefaultSchema', () => {
  it('should return "public" when available', () => {
    expect(getDefaultSchema(['analytics', 'public', 'audit'])).toBe('public');
  });

  it('should return first schema when "public" is not available', () => {
    expect(getDefaultSchema(['analytics', 'audit'])).toBe('analytics');
  });

  it('should return undefined for empty list', () => {
    expect(getDefaultSchema([])).toBeUndefined();
  });

  it('should return "public" even when it is the only schema', () => {
    expect(getDefaultSchema(['public'])).toBe('public');
  });

  it('should return first schema for single non-public schema', () => {
    expect(getDefaultSchema(['custom'])).toBe('custom');
  });
});
