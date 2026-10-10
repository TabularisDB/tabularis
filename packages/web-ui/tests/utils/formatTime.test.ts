import { describe, it, expect } from 'vitest';
import { formatDuration, parseDuration, formatElapsedTime } from '../../src/utils/formatTime';

describe('formatTime', () => {
  describe('formatDuration', () => {
    it('should format milliseconds when less than 1000ms', () => {
      expect(formatDuration(0)).toBe('0 ms');
      expect(formatDuration(45)).toBe('45 ms');
      expect(formatDuration(999)).toBe('999 ms');
    });

    it('should format seconds when between 1000ms and 60s', () => {
      expect(formatDuration(1000)).toBe('1.00 s');
      expect(formatDuration(1234)).toBe('1.23 s');
      expect(formatDuration(59000)).toBe('59.00 s');
      expect(formatDuration(59999)).toBe('60.00 s');
    });

    it('should format minutes when 60 seconds or more', () => {
      expect(formatDuration(60000)).toBe('1 min 0 s');
      expect(formatDuration(90000)).toBe('1 min 30 s');
      expect(formatDuration(150000)).toBe('2 min 30 s');
      expect(formatDuration(360000)).toBe('6 min 0 s');
    });

    it('should handle boundary values correctly', () => {
      // Exactly at 1000ms boundary
      expect(formatDuration(999)).toBe('999 ms');
      expect(formatDuration(1000)).toBe('1.00 s');
      
      // Exactly at 60s boundary  
      expect(formatDuration(59000)).toBe('59.00 s');
      expect(formatDuration(60000)).toBe('1 min 0 s');
    });

    it('should round milliseconds correctly', () => {
      expect(formatDuration(44.4)).toBe('44 ms');
      expect(formatDuration(44.5)).toBe('45 ms');
      expect(formatDuration(999.4)).toBe('999 ms');
    });

    it('should format large durations', () => {
      expect(formatDuration(3600000)).toBe('60 min 0 s'); // 1 hour
      expect(formatDuration(7200000)).toBe('120 min 0 s'); // 2 hours
    });
  });

  describe('parseDuration', () => {
    it('should parse milliseconds format', () => {
      expect(parseDuration('45 ms')).toBe(45);
      expect(parseDuration('999 ms')).toBe(999);
      expect(parseDuration('0 ms')).toBe(0);
    });

    it('should parse milliseconds without space', () => {
      expect(parseDuration('45ms')).toBe(45);
      expect(parseDuration('999ms')).toBe(999);
    });

    it('should parse seconds format', () => {
      expect(parseDuration('1.00 s')).toBe(1000);
      expect(parseDuration('1.23 s')).toBe(1230);
      expect(parseDuration('59.00 s')).toBe(59000);
    });

    it('should parse seconds without space', () => {
      expect(parseDuration('1.00s')).toBe(1000);
      expect(parseDuration('59s')).toBe(59000);
    });

    it('should parse minutes and seconds format', () => {
      expect(parseDuration('1 min 0 s')).toBe(60000);
      expect(parseDuration('1 min 30 s')).toBe(90000);
      expect(parseDuration('2 min 30 s')).toBe(150000);
    });

    it('should parse minutes without seconds', () => {
      expect(parseDuration('1 min')).toBe(60000);
      expect(parseDuration('5 min')).toBe(300000);
    });

    it('should handle whitespace', () => {
      expect(parseDuration('  45 ms  ')).toBe(45);
      expect(parseDuration('  1.23 s  ')).toBe(1230);
    });

    it('should return 0 for invalid formats', () => {
      expect(parseDuration('')).toBe(0);
      expect(parseDuration('invalid')).toBe(0);
      expect(parseDuration('abc ms')).toBe(0);
      expect(parseDuration('1 hour')).toBe(0);
    });

    it('should be reversible for valid formats', () => {
      // Test that format -> parse -> format produces consistent results
      const testCases = [0, 45, 999, 1000, 1234, 59000, 60000, 90000, 150000];
      
      testCases.forEach(ms => {
        const formatted = formatDuration(ms);
        const parsed = parseDuration(formatted);
        
        // Allow small rounding differences (within 10ms)
        expect(Math.abs(ms - parsed)).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('formatElapsedTime', () => {
    it('should format zero seconds', () => {
      expect(formatElapsedTime(0)).toBe('00:00');
    });

    it('should format seconds less than 1 minute', () => {
      expect(formatElapsedTime(1)).toBe('00:01');
      expect(formatElapsedTime(5)).toBe('00:05');
      expect(formatElapsedTime(30)).toBe('00:30');
      expect(formatElapsedTime(59)).toBe('00:59');
    });

    it('should format exactly 1 minute', () => {
      expect(formatElapsedTime(60)).toBe('01:00');
    });

    it('should format minutes and seconds', () => {
      expect(formatElapsedTime(90)).toBe('01:30');
      expect(formatElapsedTime(150)).toBe('02:30');
      expect(formatElapsedTime(599)).toBe('09:59');
    });

    it('should format large durations correctly', () => {
      expect(formatElapsedTime(600)).toBe('10:00');
      expect(formatElapsedTime(942)).toBe('15:42');
      expect(formatElapsedTime(3599)).toBe('59:59');
      expect(formatElapsedTime(3600)).toBe('60:00');
    });

    it('should handle very large durations', () => {
      expect(formatElapsedTime(7200)).toBe('120:00'); // 2 hours
      expect(formatElapsedTime(36000)).toBe('600:00'); // 10 hours
    });

    it('should pad single digits with zeros', () => {
      expect(formatElapsedTime(61)).toBe('01:01');
      expect(formatElapsedTime(125)).toBe('02:05');
      expect(formatElapsedTime(307)).toBe('05:07');
    });

    it('should handle boundary values', () => {
      expect(formatElapsedTime(59)).toBe('00:59'); // Just before 1 minute
      expect(formatElapsedTime(60)).toBe('01:00'); // Exactly 1 minute
      expect(formatElapsedTime(61)).toBe('01:01'); // Just after 1 minute
    });
  });
});
