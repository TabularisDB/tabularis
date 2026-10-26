import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
    calendarDayNumber,
    formatHistoryTime,
    groupByDate,
    parseCalendarDay,
} from '@/utils/dateGroups';

describe('dateGroups', () => {
    describe('groupByDate', () => {
        // Fix "now" to a UTC instant and classify in UTC so the tests are
        // deterministic regardless of the machine's timezone.
        const NOW = new Date('2026-04-15T14:00:00.000Z');
        const TZ = 'UTC';

        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(NOW);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        const makeItem = (dateStr: string) => ({date: dateStr, value: dateStr});
        const getDate = (item: {date: string}) => item.date;

        it('should return empty array for empty input', () => {
            const result = groupByDate([], getDate, TZ);
            expect(result).toEqual([]);
        });

        it('should group items from today', () => {
            const items = [
                makeItem('2026-04-15T10:00:00.000Z'),
                makeItem('2026-04-15T08:30:00.000Z'),
            ];
            const result = groupByDate(items, getDate, TZ);
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('dateGroupToday');
            expect(result[0][1]).toHaveLength(2);
        });

        it('should group items from yesterday', () => {
            const items = [makeItem('2026-04-14T12:00:00.000Z')];
            const result = groupByDate(items, getDate, TZ);
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('dateGroupYesterday');
            expect(result[0][1]).toHaveLength(1);
        });

        it('should group items from this week', () => {
            // 5 days ago (April 10)
            const items = [makeItem('2026-04-10T12:00:00.000Z')];
            const result = groupByDate(items, getDate, TZ);
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('dateGroupThisWeek');
        });

        it('should group items from this month', () => {
            // 20 days ago (March 26)
            const items = [makeItem('2026-03-26T12:00:00.000Z')];
            const result = groupByDate(items, getDate, TZ);
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('dateGroupThisMonth');
        });

        it('should group old items', () => {
            // 2 months ago
            const items = [makeItem('2026-02-10T12:00:00.000Z')];
            const result = groupByDate(items, getDate, TZ);
            expect(result).toHaveLength(1);
            expect(result[0][0]).toBe('dateGroupOlder');
        });

        it('should group items into multiple categories', () => {
            const items = [
                makeItem('2026-04-15T09:00:00.000Z'), // today
                makeItem('2026-04-14T18:00:00.000Z'), // yesterday
                makeItem('2026-04-12T10:00:00.000Z'), // this week
                makeItem('2026-03-20T10:00:00.000Z'), // this month
                makeItem('2026-01-05T10:00:00.000Z'), // older
            ];
            const result = groupByDate(items, getDate, TZ);

            expect(result).toHaveLength(5);
            expect(result[0][0]).toBe('dateGroupToday');
            expect(result[1][0]).toBe('dateGroupYesterday');
            expect(result[2][0]).toBe('dateGroupThisWeek');
            expect(result[3][0]).toBe('dateGroupThisMonth');
            expect(result[4][0]).toBe('dateGroupOlder');
        });

        it('should skip empty groups', () => {
            const items = [
                makeItem('2026-04-15T09:00:00.000Z'), // today
                makeItem('2026-01-05T10:00:00.000Z'), // older
            ];
            const result = groupByDate(items, getDate, TZ);
            expect(result).toHaveLength(2);
            expect(result[0][0]).toBe('dateGroupToday');
            expect(result[1][0]).toBe('dateGroupOlder');
        });

        it('should preserve item order within groups', () => {
            const items = [
                makeItem('2026-04-15T14:00:00.000Z'),
                makeItem('2026-04-15T10:00:00.000Z'),
                makeItem('2026-04-15T08:00:00.000Z'),
            ];
            const result = groupByDate(items, getDate, TZ);
            expect(result[0][1]).toEqual(items);
        });

        it('classifies the day boundary in the requested timezone', () => {
            // 2026-04-14T16:00:00Z is the 15th (01:00) in Tokyo but the 14th in UTC.
            const items = [makeItem('2026-04-14T16:00:00.000Z')];

            const inTokyo = groupByDate(items, getDate, 'Asia/Tokyo');
            expect(inTokyo[0][0]).toBe('dateGroupToday');

            const inUtc = groupByDate(items, getDate, 'UTC');
            expect(inUtc[0][0]).toBe('dateGroupYesterday');
        });
    });

    describe('formatHistoryTime', () => {
        const NOW = new Date('2026-04-15T14:00:00.000Z');

        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(NOW);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should format today timestamps as HH:mm', () => {
            const result = formatHistoryTime('2026-04-15T10:30:00.000Z', 'UTC');
            // The exact format depends on locale but should contain hours and minutes
            expect(result).toMatch(/\d{1,2}:\d{2}/);
        });

        it('should format older timestamps as month + day', () => {
            const result = formatHistoryTime('2026-03-10T10:30:00.000Z', 'UTC');
            // Should contain "Mar" or locale equivalent and "10"
            expect(result).toContain('10');
        });

        it('should format yesterday timestamps as month + day', () => {
            const result = formatHistoryTime('2026-04-14T10:30:00.000Z', 'UTC');
            expect(result).toContain('14');
        });

        it('uses the requested timezone for the today/older decision', () => {
            // 2026-04-14T16:00:00Z: 'today' (01:00) in Tokyo, 'yesterday' in UTC.
            const tokyo = formatHistoryTime('2026-04-14T16:00:00.000Z', 'Asia/Tokyo');
            expect(tokyo).toMatch(/\d{1,2}:\d{2}/); // HH:mm → today
            const utc = formatHistoryTime('2026-04-14T16:00:00.000Z', 'UTC');
            expect(utc).toContain('14'); // month + day → not today
        });
    });

    describe('parseCalendarDay', () => {
        it('parses a YYYY-MM-DD date into a comparable day number', () => {
            expect(parseCalendarDay('2026-04-15')).toBe(Date.UTC(2026, 3, 15));
            expect(parseCalendarDay(' 2026-01-01 ')).toBe(Date.UTC(2026, 0, 1));
        });

        it('orders day numbers chronologically', () => {
            expect(parseCalendarDay('2026-04-15')).toBeGreaterThan(
                parseCalendarDay('2026-04-14') as number,
            );
            expect(parseCalendarDay('2026-05-01')).toBeGreaterThan(
                parseCalendarDay('2026-04-30') as number,
            );
        });

        it('rejects malformed values', () => {
            expect(parseCalendarDay('')).toBeNull();
            expect(parseCalendarDay('2026-04')).toBeNull();
            expect(parseCalendarDay('2026/04/15')).toBeNull();
            expect(parseCalendarDay('not-a-date')).toBeNull();
        });

        it('rejects calendar days that do not exist', () => {
            // `Date.UTC` would otherwise normalise these into the next month.
            expect(parseCalendarDay('2026-02-30')).toBeNull();
            expect(parseCalendarDay('2026-04-31')).toBeNull();
            expect(parseCalendarDay('2026-13-01')).toBeNull();
            expect(parseCalendarDay('2025-02-29')).toBeNull();
            expect(parseCalendarDay('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
        });
    });

    describe('calendarDayNumber', () => {
        it('reports the calendar day an instant falls in', () => {
            expect(calendarDayNumber(new Date('2026-04-15T00:00:00.000Z'), 'UTC')).toBe(
                parseCalendarDay('2026-04-15'),
            );
            expect(calendarDayNumber(new Date('2026-04-15T23:59:59.999Z'), 'UTC')).toBe(
                parseCalendarDay('2026-04-15'),
            );
        });

        it('follows the display timezone', () => {
            // 2026-04-14T16:00Z is already the 15th in Tokyo, still the 14th in UTC.
            const instant = new Date('2026-04-14T16:00:00.000Z');
            expect(calendarDayNumber(instant, 'Asia/Tokyo')).toBe(parseCalendarDay('2026-04-15'));
            expect(calendarDayNumber(instant, 'UTC')).toBe(parseCalendarDay('2026-04-14'));
        });

        it('falls back to the OS local timezone for unknown names', () => {
            const instant = new Date('2026-04-15T12:00:00.000Z');
            expect(calendarDayNumber(instant, 'Not/AZone')).toBe(calendarDayNumber(instant));
        });
    });
});
