import {describe, expect, it} from 'vitest';
import {
    limitState,
    formatLimitValue,
    formatConsumption,
    formatUsageTime,
} from '../../src/utils/usage';

describe('usage presentation', () => {
    it('warns at 80 percent, marks reached limits, and keeps unavailable values unknown', () => {
        expect(limitState({used: 80, limit: 100, limitStatus: 'finite'})).toEqual({
            severity: 'warning',
            percent: 80,
            remaining: 20,
        });
        expect(limitState({used: 110, limit: 100, limitStatus: 'finite'})).toEqual({
            severity: 'exceeded',
            percent: 100,
            remaining: 0,
        });
        expect(limitState({used: null, limit: 100, limitStatus: 'finite'}).percent).toBeNull();
        expect(
            limitState({used: 100, limit: null, limitStatus: 'unavailable'}).remaining,
        ).toBeNull();
    });
    it('keeps snapshot bytes, CPU hours and billing units distinct', () => {
        expect(formatLimitValue(1024 ** 3, 'bytes', 'en')).toBe('1 GiB');
        expect(formatLimitValue(0.5, 'bytes', 'en')).toBe('0.5 B');
        expect(formatLimitValue(3600, 'seconds', 'en')).toBe('1 h');
        expect(formatLimitValue(null, 'bytes', 'en')).toBeUndefined();
        expect(formatConsumption('compute_unit_seconds', 3600, 'en')).toBe('1');
        expect(formatConsumption('root_branch_bytes_month', 1000000000, 'en')).toBe('1');
        expect(formatConsumption('functions_active_capacity_microseconds', 1000000, 'en')).toBe(
            '1',
        );
        expect(formatConsumption('compute_unit_seconds', null, 'en')).toBeUndefined();
        expect(formatConsumption('compute_unit_seconds', 1800, 'de')).toBe('0,5');
        expect(formatConsumption('compute_unit_seconds', 0.001, 'en')).not.toBe('0');
        expect(formatUsageTime('invalid', 'en')).toBeUndefined();
    });
});
