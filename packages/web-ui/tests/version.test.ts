import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '@/version';

describe('version', () => {
  it('should export a version string', () => {
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION).toBeTruthy();
  });

  it('should follow semantic versioning format', () => {
    // Semantic versioning: MAJOR.MINOR.PATCH
    const semverRegex = /^\d+\.\d+\.\d+$/;
    expect(APP_VERSION).toMatch(semverRegex);
  });

  it('should have numeric version components', () => {
    const parts = APP_VERSION.split('.');
    expect(parts).toHaveLength(3);
    
    parts.forEach(part => {
      expect(Number.isInteger(Number(part))).toBe(true);
      expect(Number(part)).toBeGreaterThanOrEqual(0);
    });
  });

  it('should not contain whitespace', () => {
    expect(APP_VERSION.trim()).toBe(APP_VERSION);
    expect(APP_VERSION).not.toContain(' ');
    expect(APP_VERSION).not.toContain('\t');
    expect(APP_VERSION).not.toContain('\n');
  });
});
