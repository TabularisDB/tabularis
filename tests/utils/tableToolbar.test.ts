import { describe, it, expect } from 'vitest';
import {
  haveToolbarValuesChanged,
  parseLimitInput,
  generateToolbarStateKey,
  isValidLimit,
  formatLimitInput,
  generateWherePlaceholder,
  generateOrderByPlaceholder,
  formatSortClause,
} from '../../src/utils/tableToolbar';

describe('tableToolbar utils', () => {
  describe('haveToolbarValuesChanged', () => {
    it('should detect filter change', () => {
      const state = { filterInput: 'id > 5', sortInput: '', limitInput: '' };
      const props = { initialFilter: '', initialSort: '', initialLimit: undefined };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.filterChanged).toBe(true);
      expect(result.sortChanged).toBe(false);
      expect(result.limitChanged).toBe(false);
      expect(result.hasChanges).toBe(true);
    });

    it('should detect sort change', () => {
      const state = { filterInput: '', sortInput: 'name ASC', limitInput: '' };
      const props = { initialFilter: '', initialSort: '', initialLimit: null };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.filterChanged).toBe(false);
      expect(result.sortChanged).toBe(true);
      expect(result.hasChanges).toBe(true);
    });

    it('should detect limit change', () => {
      const state = { filterInput: '', sortInput: '', limitInput: '100' };
      const props = { initialFilter: '', initialSort: '', initialLimit: null };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.limitChanged).toBe(true);
      expect(result.hasChanges).toBe(true);
    });

    it('should handle empty strings as equivalent to undefined', () => {
      const state = { filterInput: '', sortInput: '', limitInput: '' };
      const props = { initialFilter: undefined, initialSort: undefined, initialLimit: undefined };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.filterChanged).toBe(false);
      expect(result.sortChanged).toBe(false);
      expect(result.limitChanged).toBe(false); // Both undefined, so no change
    });

    it('should return hasChanges false when nothing changed', () => {
      const state = { filterInput: 'id = 1', sortInput: 'name', limitInput: '50' };
      const props = { initialFilter: 'id = 1', initialSort: 'name', initialLimit: 50 };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.hasChanges).toBe(false);
    });

    it('should detect multiple changes', () => {
      const state = { filterInput: 'active', sortInput: 'date', limitInput: '10' };
      const props = { initialFilter: '', initialSort: '', initialLimit: null };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.filterChanged).toBe(true);
      expect(result.sortChanged).toBe(true);
      expect(result.limitChanged).toBe(true);
      expect(result.hasChanges).toBe(true);
    });

    it('should handle whitespace in filter input', () => {
      const state = { filterInput: '  ', sortInput: '', limitInput: '' };
      const props = { initialFilter: '', initialSort: '', initialLimit: null };

      const result = haveToolbarValuesChanged(state, props);

      expect(result.filterChanged).toBe(true);
    });
  });

  describe('parseLimitInput', () => {
    it('should parse valid number', () => {
      expect(parseLimitInput('100')).toBe(100);
      expect(parseLimitInput('0')).toBe(0);
      expect(parseLimitInput('999999')).toBe(999999);
    });

    it('should return undefined for empty string', () => {
      expect(parseLimitInput('')).toBeUndefined();
    });

    it('should return undefined for whitespace', () => {
      expect(parseLimitInput('   ')).toBeUndefined();
    });

    it('should return undefined for invalid number', () => {
      expect(parseLimitInput('abc')).toBeUndefined();
      expect(parseLimitInput('12.34')).toBe(12); // parseInt truncates
      expect(parseLimitInput('-5')).toBe(-5); // negative numbers are valid for parseInt
    });
  });

  describe('generateToolbarStateKey', () => {
    it('should generate key from values', () => {
      const props = { initialFilter: 'id=1', initialSort: 'name', initialLimit: 100 };

      const key = generateToolbarStateKey(props);

      expect(key).toBe('id=1-name-100');
    });

    it('should handle undefined values', () => {
      const props = { initialFilter: undefined, initialSort: undefined, initialLimit: undefined };

      const key = generateToolbarStateKey(props);

      expect(key).toBe('undefined-undefined-undefined');
    });

    it('should handle null values', () => {
      const props = { initialFilter: '', initialSort: '', initialLimit: null };

      const key = generateToolbarStateKey(props);

      expect(key).toBe('--null');
    });

    it('should generate different keys for different values', () => {
      const key1 = generateToolbarStateKey({ initialFilter: 'a', initialSort: 'b', initialLimit: 1 });
      const key2 = generateToolbarStateKey({ initialFilter: 'a', initialSort: 'b', initialLimit: 2 });

      expect(key1).not.toBe(key2);
    });
  });

  describe('isValidLimit', () => {
    it('should validate positive integers', () => {
      expect(isValidLimit('1')).toBe(true);
      expect(isValidLimit('100')).toBe(true);
      expect(isValidLimit('999999')).toBe(true);
    });

    it('should validate empty string', () => {
      expect(isValidLimit('')).toBe(true);
    });

    it('should validate whitespace-only string', () => {
      expect(isValidLimit('   ')).toBe(true);
    });

    it('should reject zero', () => {
      expect(isValidLimit('0')).toBe(false);
    });

    it('should reject negative numbers', () => {
      expect(isValidLimit('-1')).toBe(false);
      expect(isValidLimit('-100')).toBe(false);
    });

    it('should reject non-numeric strings', () => {
      expect(isValidLimit('abc')).toBe(false);
      expect(isValidLimit('12.34')).toBe(false);
      expect(isValidLimit('10px')).toBe(false);
    });
  });

  describe('formatLimitInput', () => {
    it('should remove non-numeric characters', () => {
      expect(formatLimitInput('abc')).toBe('');
      expect(formatLimitInput('100px')).toBe('100');
      expect(formatLimitInput('1,000')).toBe('1000');
    });

    it('should preserve numeric characters', () => {
      expect(formatLimitInput('123')).toBe('123');
      expect(formatLimitInput('0')).toBe('0');
    });

    it('should handle empty string', () => {
      expect(formatLimitInput('')).toBe('');
    });

    it('should handle mixed alphanumeric', () => {
      expect(formatLimitInput('a1b2c3')).toBe('123');
    });
  });

  describe('generateWherePlaceholder', () => {
    it('should generate placeholder with column name', () => {
      expect(generateWherePlaceholder('id')).toBe("id > 5 AND status = 'active'");
      expect(generateWherePlaceholder('user_id')).toBe("user_id > 5 AND status = 'active'");
    });
  });

  describe('generateOrderByPlaceholder', () => {
    it('should generate placeholder with column name', () => {
      expect(generateOrderByPlaceholder('id')).toBe('id DESC');
      expect(generateOrderByPlaceholder('created_at')).toBe('created_at DESC');
    });
  });

  describe('formatSortClause', () => {
    it('should quote column names for postgres', () => {
      expect(formatSortClause('Status DESC', 'postgres')).toBe('"Status" DESC');
    });

    it('should quote multiple comma-separated terms for postgres', () => {
      expect(formatSortClause('Status ASC, UserName DESC', 'postgres')).toBe(
        '"Status" ASC, "UserName" DESC',
      );
    });

    it('should leave already-quoted terms unchanged for postgres', () => {
      expect(formatSortClause('"Status" DESC', 'postgres')).toBe('"Status" DESC');
    });

    it('should leave clause unchanged for non-postgres drivers', () => {
      expect(formatSortClause('Status DESC', 'mysql')).toBe('Status DESC');
      expect(formatSortClause('Status DESC', null)).toBe('Status DESC');
    });

    it('should return empty clause unchanged', () => {
      expect(formatSortClause('', 'postgres')).toBe('');
      expect(formatSortClause('   ', 'postgres')).toBe('   ');
    });
  });

});
