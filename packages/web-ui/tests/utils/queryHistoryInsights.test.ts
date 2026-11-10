import {describe, expect, it} from 'vitest';
import {
    computeQueryHistoryInsights,
    evaluateQueryShapeRegression,
    extractStatementKind,
    MIN_REGRESSION_DELTA_MS,
    MIN_REGRESSION_RATIO,
    MIN_REGRESSION_SAMPLES,
    normalizeSqlForInsights,
    sortAndFilterInsightGroups,
    windowHoursForPreset,
} from '@/utils/queryHistoryInsights';
import type {QueryHistoryEntry} from '@/types/queryHistory';

const NOW = new Date('2026-11-07T12:00:00.000Z');

function hoursAgo(hours: number): string {
    return new Date(NOW.getTime() - hours * 3600 * 1000).toISOString();
}

function makeEntry(
    overrides: Partial<QueryHistoryEntry> & {id: string; sql: string},
): QueryHistoryEntry {
    return {
        executedAt: hoursAgo(1),
        executionTimeMs: 25,
        status: 'success',
        rowsAffected: 1,
        error: null,
        database: 'app',
        ...overrides,
    };
}

describe('normalizeSqlForInsights', () => {
    it('normalizes whitespace, comments, string/numeric literals, and IN lists into one canonical shape', () => {
        const q1 = `
            -- fetch active orders
            SELECT id, total_cents
            FROM orders /* inline comment */
            WHERE customer_id = 42
              AND status IN ('paid', 'shipped', 'delivered')
              AND total_cents >= -100.50;
        `;
        const q2 =
            "select id, total_cents from orders where customer_id = 9999 and status in ('pending') and total_cents >= 0";

        expect(normalizeSqlForInsights(q1, 'postgres')).toBe(
            'SELECT id, total_cents FROM orders WHERE customer_id = ? AND status IN (?+) AND total_cents >= ?',
        );
        expect(normalizeSqlForInsights(q2, 'postgres')).toBe(
            normalizeSqlForInsights(q1, 'postgres'),
        );
    });

    it('preserves distinct SQL verbs and distinct table/column identifiers', () => {
        const selectShape = normalizeSqlForInsights(
            'SELECT id FROM users WHERE id = 1',
            'postgres',
        );
        const deleteShape = normalizeSqlForInsights('DELETE FROM users WHERE id = 1', 'postgres');
        const otherTableShape = normalizeSqlForInsights(
            'SELECT id FROM accounts WHERE id = 1',
            'postgres',
        );

        expect(selectShape).not.toBe(deleteShape);
        expect(selectShape).not.toBe(otherTableShape);
        expect(extractStatementKind(selectShape)).toBe('SELECT');
        expect(extractStatementKind(deleteShape)).toBe('DELETE');
    });

    it('handles dialect-specific quoting and comment syntax without corrupting identifiers', () => {
        // PostgreSQL: double quotes are identifiers, dollar-quoted strings are literals, nested block comments are stripped
        expect(
            normalizeSqlForInsights(
                '/* outer /* nested */ comment */ SELECT "User"."Email" FROM "User" WHERE note = $tag$hello 123$tag$ AND id = $1',
                'postgres',
            ),
        ).toBe('SELECT "User"."Email" FROM "User" WHERE note = \'?\' AND id = $1');

        // MySQL: backticks are identifiers, double quotes are string literals, `#` is a line comment, `--1` without whitespace is not a comment
        expect(
            normalizeSqlForInsights(
                'SELECT `orders`.`id` FROM `orders` WHERE label = "vip" # trailing comment\n AND delta = --1',
                'mysql',
            ),
        ).toBe("SELECT `orders`.`id` FROM `orders` WHERE label = '?' AND delta = - ?");

        // SQLite / MSSQL: bracketed identifiers are preserved
        expect(
            normalizeSqlForInsights(
                'SELECT [Order Details].[UnitPrice] FROM [Order Details] WHERE [Quantity] > 10',
                'sqlite',
            ),
        ).toBe('SELECT [Order Details].[UnitPrice] FROM [Order Details] WHERE [Quantity] > ?');
    });
});

describe('evaluateQueryShapeRegression', () => {
    it('requires at least MIN_REGRESSION_SAMPLES timed executions in both periods', () => {
        const underSampled = evaluateQueryShapeRegression(2, 250, 5, 20);
        expect(underSampled.isRegressed).toBe(false);
        expect(underSampled.regressionStatus).toBe('insufficientSamples');
        expect(underSampled.deltaAvgMs).toBe(230);

        const priorUnderSampled = evaluateQueryShapeRegression(5, 250, 2, 20);
        expect(priorUnderSampled.isRegressed).toBe(false);
        expect(priorUnderSampled.regressionStatus).toBe('insufficientSamples');
    });

    it('requires both absolute (>= 10ms) and relative (>= +25%) increase to flag a regression', () => {
        expect(MIN_REGRESSION_SAMPLES).toBe(3);
        expect(MIN_REGRESSION_DELTA_MS).toBe(10);
        expect(MIN_REGRESSION_RATIO).toBe(0.25);

        // Large relative (+100%) but tiny absolute (+4ms < 10ms) -> stable, not noisy
        const tinyDelta = evaluateQueryShapeRegression(4, 8, 4, 4);
        expect(tinyDelta.isRegressed).toBe(false);
        expect(tinyDelta.regressionStatus).toBe('stable');

        // Large absolute (+15ms) but small relative (+15% < 25%) -> stable
        const smallRatio = evaluateQueryShapeRegression(4, 115, 4, 100);
        expect(smallRatio.isRegressed).toBe(false);
        expect(smallRatio.regressionStatus).toBe('stable');

        // Meets both thresholds (+40ms, +100%) -> regressed
        const regressed = evaluateQueryShapeRegression(4, 80, 4, 40);
        expect(regressed.isRegressed).toBe(true);
        expect(regressed.regressionStatus).toBe('regressed');
        expect(regressed.deltaAvgMs).toBe(40);
        expect(regressed.relativeDeltaAvg).toBe(1);

        // Meets improvement thresholds (-30ms, -50%) -> improved
        const improved = evaluateQueryShapeRegression(4, 30, 4, 60);
        expect(improved.isRegressed).toBe(false);
        expect(improved.regressionStatus).toBe('improved');
    });
});

describe('computeQueryHistoryInsights', () => {
    it('partitions current vs prior windows, excludes missing durations from averages, and tracks coverage', () => {
        const entries: QueryHistoryEntry[] = [
            // Current 24h window: 3 timed samples (60ms, 90ms, 120ms -> avg 90ms) + 1 untimed error
            makeEntry({
                id: 'c1',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 1',
                executedAt: hoursAgo(2),
                executionTimeMs: 60,
            }),
            makeEntry({
                id: 'c2',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 2',
                executedAt: hoursAgo(5),
                executionTimeMs: 90,
            }),
            makeEntry({
                id: 'c3',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 3',
                executedAt: hoursAgo(8),
                executionTimeMs: 120,
            }),
            makeEntry({
                id: 'c4-untimed',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 4',
                executedAt: hoursAgo(10),
                executionTimeMs: null,
                status: 'error',
            }),
            // Prior 24h window (24h..48h ago): 3 timed samples (20ms, 30ms, 40ms -> avg 30ms)
            makeEntry({
                id: 'p1',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 10',
                executedAt: hoursAgo(26),
                executionTimeMs: 20,
            }),
            makeEntry({
                id: 'p2',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 11',
                executedAt: hoursAgo(30),
                executionTimeMs: 30,
            }),
            makeEntry({
                id: 'p3',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 12',
                executedAt: hoursAgo(36),
                executionTimeMs: 40,
            }),
            // Older than prior window (> 48h ago): ignored
            makeEntry({
                id: 'old-1',
                sql: 'SELECT * FROM invoices WHERE tenant_id = 99',
                executedAt: hoursAgo(60),
                executionTimeMs: 999,
            }),
        ];

        const response = computeQueryHistoryInsights(entries, {
            windowHours: windowHoursForPreset('last24Hours'),
            now: NOW,
            maxStoredExecutions: 8,
        });

        expect(response.coverage.currentWindowExecutions).toBe(4);
        expect(response.coverage.currentWindowMissingDurationCount).toBe(1);
        expect(response.coverage.priorWindowExecutions).toBe(3);
        expect(response.coverage.retentionCapReached).toBe(true);
        expect(response.coverage.priorWindowFullyCovered).toBe(true);

        expect(response.groups).toHaveLength(1);
        const group = response.groups[0];
        expect(group.fingerprint).toBe('SELECT * FROM invoices WHERE tenant_id = ?');
        expect(group.callCount).toBe(4);
        expect(group.timedSampleCount).toBe(3);
        expect(group.missingDurationCount).toBe(1);
        expect(group.avgDurationMs).toBe(90);
        expect(group.totalDurationMs).toBe(270);
        expect(group.failureCount).toBe(1);
        expect(group.failureRate).toBe(0.25);
        expect(group.priorCallCount).toBe(3);
        expect(group.priorTimedSampleCount).toBe(3);
        expect(group.priorAvgDurationMs).toBe(30);
        expect(group.deltaAvgMs).toBe(60);
        expect(group.relativeDeltaAvg).toBe(2);
        expect(group.isRegressed).toBe(true);
        expect(group.regressionStatus).toBe('regressed');
        expect(group.contributingExecutions.map((e) => e.id)).toEqual([
            'c1',
            'c2',
            'c3',
            'c4-untimed',
        ]);
    });

    it('supports sorting and filtering insight groups by search and regressionsOnly', () => {
        const entries: QueryHistoryEntry[] = [
            // Shape A: regressed (avg 100ms vs prior 20ms)
            ...[1, 2, 3].map((i) =>
                makeEntry({
                    id: `a-cur-${i}`,
                    sql: `SELECT * FROM slow_reports WHERE id = ${i}`,
                    executedAt: hoursAgo(i),
                    executionTimeMs: 100,
                }),
            ),
            ...[1, 2, 3].map((i) =>
                makeEntry({
                    id: `a-pri-${i}`,
                    sql: `SELECT * FROM slow_reports WHERE id = ${i}`,
                    executedAt: hoursAgo(24 + i),
                    executionTimeMs: 20,
                }),
            ),
            // Shape B: high call count, stable (5 calls @ 10ms)
            ...[1, 2, 3, 4, 5].map((i) =>
                makeEntry({
                    id: `b-cur-${i}`,
                    sql: `SELECT id FROM fast_lookup WHERE code = '${i}'`,
                    executedAt: hoursAgo(i),
                    executionTimeMs: 10,
                }),
            ),
        ];

        const insights = computeQueryHistoryInsights(entries, {
            windowHours: 24,
            now: NOW,
        });

        expect(insights.groups).toHaveLength(2);
        expect(
            sortAndFilterInsightGroups(insights.groups, {sortBy: 'callCount'}).map(
                (g) => g.callCount,
            ),
        ).toEqual([5, 3]);
        expect(
            sortAndFilterInsightGroups(insights.groups, {regressionsOnly: true}).map(
                (g) => g.fingerprint,
            ),
        ).toEqual(['SELECT * FROM slow_reports WHERE id = ?']);
        expect(
            sortAndFilterInsightGroups(insights.groups, {search: 'fast_lookup'}).map(
                (g) => g.fingerprint,
            ),
        ).toEqual(["SELECT id FROM fast_lookup WHERE code = '?'"]);
    });
});
