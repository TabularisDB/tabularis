import { describe, it, expect } from 'vitest';
import {
  getDateInputMode,
  getMonthNames,
  parseDateTime,
  formatDateTime,
  daysInMonth,
  clamp,
  type DateInputMode,
  type ParsedDateTime,
} from '../../src/utils/dateInput';

describe('dateInput utils', () => {
  // ---------------------------------------------------------------------------
  describe('getDateInputMode', () => {
    it('should return "date" for DATE type', () => {
      expect(getDateInputMode('date')).toBe('date');
      expect(getDateInputMode('DATE')).toBe('date');
      expect(getDateInputMode('  Date  ')).toBe('date');
    });

    it('should return "datetime" for DATETIME type', () => {
      expect(getDateInputMode('datetime')).toBe('datetime');
      expect(getDateInputMode('DATETIME')).toBe('datetime');
    });

    it('should return "datetime" for TIMESTAMP variants', () => {
      expect(getDateInputMode('timestamp')).toBe('datetime');
      expect(getDateInputMode('TIMESTAMP')).toBe('datetime');
      expect(getDateInputMode('timestamptz')).toBe('datetime');
      expect(getDateInputMode('timestamp with time zone')).toBe('datetime');
      expect(getDateInputMode('timestamp without time zone')).toBe('datetime');
      expect(getDateInputMode('timestamp with local time zone')).toBe('datetime');
    });

    it('should return "time" for TIME types', () => {
      expect(getDateInputMode('time')).toBe('time');
      expect(getDateInputMode('TIME')).toBe('time');
      expect(getDateInputMode('timetz')).toBe('time');
      expect(getDateInputMode('time with time zone')).toBe('time');
    });

    it('should return null for non-date types', () => {
      expect(getDateInputMode('varchar')).toBeNull();
      expect(getDateInputMode('int')).toBeNull();
      expect(getDateInputMode('boolean')).toBeNull();
      expect(getDateInputMode('text')).toBeNull();
      expect(getDateInputMode('')).toBeNull();
      expect(getDateInputMode('json')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getMonthNames', () => {
    it('should return 12 month names', () => {
      const names = getMonthNames();
      expect(names).toHaveLength(12);
    });

    it('should start with January and end with December', () => {
      const names = getMonthNames();
      expect(names[0]).toBe('January');
      expect(names[11]).toBe('December');
    });

    it('should return a new array each call (not mutate internal state)', () => {
      const a = getMonthNames();
      const b = getMonthNames();
      expect(a).toEqual(b);
    });
  });

  // ---------------------------------------------------------------------------
  describe('parseDateTime', () => {
    it('should parse full ISO 8601 with T separator', () => {
      const dt = parseDateTime('2024-03-15T10:30:45');
      expect(dt).toMatchObject<ParsedDateTime>({
        year: 2024, month: 3, day: 15,
        hours: 10, minutes: 30, seconds: 45,
      });
    });

    it('should parse full datetime with space separator', () => {
      const dt = parseDateTime('2024-03-15 10:30:45');
      expect(dt).toMatchObject<ParsedDateTime>({
        year: 2024, month: 3, day: 15,
        hours: 10, minutes: 30, seconds: 45,
      });
    });

    it('should parse datetime with timezone suffix', () => {
      const dt = parseDateTime('2024-03-15T10:30:45+02:00');
      expect(dt).toMatchObject({ year: 2024, month: 3, day: 15, hours: 10, minutes: 30, seconds: 45 });
    });

    it('should parse datetime with milliseconds', () => {
      const dt = parseDateTime('2024-03-15T10:30:45.123');
      expect(dt).toMatchObject({ year: 2024, month: 3, day: 15, hours: 10, minutes: 30, seconds: 45 });
    });

    it('should parse datetime without seconds (HH:MM)', () => {
      const dt = parseDateTime('2024-03-15 10:30');
      expect(dt).toMatchObject({ year: 2024, month: 3, day: 15, hours: 10, minutes: 30, seconds: 0 });
    });

    it('should parse date-only string', () => {
      const dt = parseDateTime('2024-03-15');
      expect(dt).toMatchObject({ year: 2024, month: 3, day: 15, hours: 0, minutes: 0, seconds: 0 });
    });

    it('should parse time-only string HH:MM:SS', () => {
      const dt = parseDateTime('10:30:45');
      expect(dt).toMatchObject({ hours: 10, minutes: 30, seconds: 45 });
    });

    it('should return today with zeroed time for empty string', () => {
      const dt = parseDateTime('');
      expect(dt.hours).toBe(0);
      expect(dt.minutes).toBe(0);
      expect(dt.seconds).toBe(0);
      expect(dt.year).toBeGreaterThan(2020);
    });

    it('should return fallback for whitespace-only string', () => {
      const dt = parseDateTime('   ');
      expect(dt.hours).toBe(0);
    });

    it('should return fallback for unparseable string', () => {
      const dt = parseDateTime('not-a-date');
      expect(dt.hours).toBe(0);
      expect(dt.year).toBeGreaterThan(2020);
    });

    it('should handle year boundary values', () => {
      const dt = parseDateTime('0001-01-01 00:00:00');
      expect(dt).toMatchObject({ year: 1, month: 1, day: 1, hours: 0, minutes: 0, seconds: 0 });
    });

    it('should handle far future dates', () => {
      const dt = parseDateTime('9999-12-31 23:59:59');
      expect(dt).toMatchObject({ year: 9999, month: 12, day: 31, hours: 23, minutes: 59, seconds: 59 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('formatDateTime', () => {
    const dt: ParsedDateTime = { year: 2024, month: 3, day: 5, hours: 8, minutes: 6, seconds: 4 };

    it('should format mode "date" as YYYY-MM-DD', () => {
      expect(formatDateTime(dt, 'date')).toBe('2024-03-05');
    });

    it('should format mode "time" as HH:MM:SS', () => {
      expect(formatDateTime(dt, 'time')).toBe('08:06:04');
    });

    it('should format mode "datetime" as YYYY-MM-DD HH:MM:SS', () => {
      expect(formatDateTime(dt, 'datetime')).toBe('2024-03-05 08:06:04');
    });

    it('should zero-pad single-digit values', () => {
      const padDt: ParsedDateTime = { year: 2024, month: 1, day: 1, hours: 0, minutes: 0, seconds: 0 };
      expect(formatDateTime(padDt, 'date')).toBe('2024-01-01');
      expect(formatDateTime(padDt, 'time')).toBe('00:00:00');
    });

    it('should handle boundary max values', () => {
      const maxDt: ParsedDateTime = { year: 9999, month: 12, day: 31, hours: 23, minutes: 59, seconds: 59 };
      expect(formatDateTime(maxDt, 'datetime')).toBe('9999-12-31 23:59:59');
    });

    it('should be inverse of parseDateTime for full datetime', () => {
      const original = '2026-02-24 15:30:00';
      const parsed = parseDateTime(original);
      expect(formatDateTime(parsed, 'datetime')).toBe(original);
    });
  });

  // ---------------------------------------------------------------------------
  describe('daysInMonth', () => {
    it('should return 31 for January', () => {
      expect(daysInMonth(1, 2024)).toBe(31);
    });

    it('should return 28 for February in a non-leap year', () => {
      expect(daysInMonth(2, 2023)).toBe(28);
    });

    it('should return 29 for February in a leap year', () => {
      expect(daysInMonth(2, 2024)).toBe(29);
      expect(daysInMonth(2, 2000)).toBe(29);
    });

    it('should return 28 for February in century non-leap years', () => {
      expect(daysInMonth(2, 1900)).toBe(28);
      expect(daysInMonth(2, 2100)).toBe(28);
    });

    it('should return 30 for April, June, September, November', () => {
      expect(daysInMonth(4, 2024)).toBe(30);
      expect(daysInMonth(6, 2024)).toBe(30);
      expect(daysInMonth(9, 2024)).toBe(30);
      expect(daysInMonth(11, 2024)).toBe(30);
    });

    it('should return 31 for July, August, October, December', () => {
      expect(daysInMonth(7, 2024)).toBe(31);
      expect(daysInMonth(8, 2024)).toBe(31);
      expect(daysInMonth(10, 2024)).toBe(31);
      expect(daysInMonth(12, 2024)).toBe(31);
    });
  });

  // ---------------------------------------------------------------------------
  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });

    it('should clamp to min when value is below', () => {
      expect(clamp(-1, 0, 10)).toBe(0);
      expect(clamp(-100, 0, 59)).toBe(0);
    });

    it('should clamp to max when value is above', () => {
      expect(clamp(11, 0, 10)).toBe(10);
      expect(clamp(999, 0, 23)).toBe(23);
    });

    it('should work with negative ranges', () => {
      expect(clamp(-5, -10, -1)).toBe(-5);
      expect(clamp(0, -10, -1)).toBe(-1);
      expect(clamp(-20, -10, -1)).toBe(-10);
    });

    it('should return value when min equals max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
      expect(clamp(3, 3, 3)).toBe(3);
    });
  });
});
