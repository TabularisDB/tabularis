import {describe, expect, it, vi} from 'vitest';
import {
    classifyLookupError,
    collectColumnUsage,
    formatColumnUsageSummary,
    formatUsageTarget,
    isUsageComplete,
    sortEvidence,
    type ColumnUsageLookups,
    type ColumnUsageResult,
} from '@/utils/columnUsageCollector';
import type {ColumnUsageTarget} from '@/utils/columnUsage';
import type {QueryHistoryEntry} from '@/types/queryHistory';
import type {TableSchema} from '@/types/editor';

const target: ColumnUsageTarget = {
    database: 'shop',
    schema: 'public',
    table: 'orders',
    column: 'customer_id',
};

const column = (name: string) => ({
    name,
    data_type: 'int',
    is_pk: false,
    is_nullable: true,
    is_auto_increment: false,
});

const snapshot: TableSchema[] = [
    {
        name: 'orders',
        columns: [column('id'), column('customer_id')],
        foreign_keys: [
            {
                name: 'orders_customer_fk',
                column_name: 'customer_id',
                ref_table: 'customers',
                ref_column: 'id',
            },
        ],
    },
    {
        name: 'shipments',
        columns: [column('id'), column('order_customer_id')],
        foreign_keys: [
            {
                name: 'shipments_customer_fk',
                column_name: 'order_customer_id',
                ref_table: 'orders',
                ref_column: 'customer_id',
            },
            // Same column name, another table: not a dependency.
            {
                name: 'shipments_other_fk',
                column_name: 'x',
                ref_table: 'invoices',
                ref_column: 'customer_id',
            },
        ],
    },
    {name: 'customers', columns: [column('id'), column('name')], foreign_keys: []},
];

const history = (
    id: string,
    sql: string,
    executedAt: string,
    database: string | null = 'shop',
): QueryHistoryEntry => ({
    id,
    sql,
    executedAt,
    executionTimeMs: 1,
    status: 'success',
    rowsAffected: null,
    error: null,
    database,
});

function lookups(overrides: Partial<ColumnUsageLookups> = {}): ColumnUsageLookups {
    return {
        getForeignKeys: async () => snapshot[0].foreign_keys,
        getSchemaSnapshot: async () => snapshot,
        getViews: async () => [
            {
                name: 'big_orders',
                definition: 'SELECT o.customer_id, o.id FROM public.orders o WHERE o.id > 100',
            },
            {name: 'customer_names'},
            {name: 'unrelated', definition: 'SELECT c.customer_id FROM public.invoices c'},
        ],
        getViewDefinition: async (name) =>
            name === 'customer_names' ? 'SELECT name FROM customers' : '',
        getHistory: async () => [
            history(
                'h1',
                "SELECT customer_id FROM orders WHERE email = 'a@b.c'",
                '2026-11-01T10:00:00Z',
            ),
            history('h2', 'SELECT o.customer_id FROM public.orders o', '2026-11-02T10:00:00Z'),
            history('h3', 'SELECT customer_id FROM customers', '2026-11-03T10:00:00Z'),
            history(
                'h4',
                'SELECT o.customer_id FROM public.orders o',
                '2026-11-04T10:00:00Z',
                'other_db',
            ),
        ],
        ...overrides,
    };
}

describe('columnUsageCollector', () => {
    describe('collectColumnUsage', () => {
        it('collects foreign keys both ways, views and history with their confidence', async () => {
            const result = await collectColumnUsage(lookups(), {
                target,
                dialect: 'postgres',
                viewsSupported: true,
            });
            expect(result.sources.foreignKeys.status).toBe('complete');
            expect(result.sources.views).toEqual({status: 'complete', scanned: 3, total: 3});
            expect(result.sources.history).toEqual({status: 'complete', scanned: 3, total: 3});
            expect(isUsageComplete(result)).toBe(true);
            expect(
                result.evidence.map((e) => [
                    e.source,
                    e.confidence,
                    e.reason ?? '',
                    e.objectName ?? e.historyEntry?.id,
                ]),
            ).toEqual([
                ['foreign-key', 'confirmed', '', 'customers'],
                ['foreign-key', 'confirmed', '', 'shipments'],
                ['view', 'parsed', '', 'big_orders'],
                ['history', 'parsed', '', 'h2'],
                ['history', 'uncertain', 'unqualified-schema', 'h1'],
            ]);
            const incoming = result.evidence[1];
            expect(incoming).toMatchObject({
                direction: 'incoming',
                relatedColumn: 'order_customer_id',
            });
        });

        it('keeps literal values out of history snippets', async () => {
            const result = await collectColumnUsage(lookups(), {
                target,
                dialect: 'postgres',
                viewsSupported: true,
            });
            const h1 = result.evidence.find((e) => e.historyEntry?.id === 'h1');
            expect(h1?.snippet?.text).toBe("SELECT customer_id FROM orders WHERE email = '?'");
        });

        it('reports views as unsupported when the driver has no views', async () => {
            const getViews = vi.fn();
            const result = await collectColumnUsage(lookups({getViews}), {
                target,
                dialect: 'postgres',
                viewsSupported: false,
            });
            expect(result.sources.views.status).toBe('unsupported');
            expect(getViews).not.toHaveBeenCalled();
            expect(isUsageComplete(result)).toBe(false);
        });

        it('reports a permission error instead of an empty result', async () => {
            const denied = () => Promise.reject(new Error('permission denied for table pg_views'));
            const result = await collectColumnUsage(
                lookups({getViews: denied, getSchemaSnapshot: denied, getForeignKeys: denied}),
                {target, dialect: 'postgres', viewsSupported: true},
            );
            expect(result.sources.views).toMatchObject({status: 'permission-denied', scanned: 0});
            expect(result.sources.foreignKeys.status).toBe('permission-denied');
            expect(result.sources.views.message).toContain('permission denied');
        });

        it('marks a source partial when some lookups fail or a view body is unreadable', async () => {
            const result = await collectColumnUsage(
                lookups({
                    getSchemaSnapshot: () => Promise.reject('timeout'),
                    getViewDefinition: async () => '',
                }),
                {target, dialect: 'postgres', viewsSupported: true},
            );
            expect(result.sources.foreignKeys).toMatchObject({
                status: 'partial',
                scanned: 1,
                message: 'timeout',
            });
            expect(result.sources.views).toMatchObject({status: 'partial', scanned: 2, total: 3});
        });

        it('stops at the limits and says the result is partial', async () => {
            const many = Array.from({length: 5}, (_, i) =>
                history(`h${i}`, 'SELECT customer_id FROM orders', `2026-11-0${i + 1}T00:00:00Z`),
            );
            const result = await collectColumnUsage(lookups({getHistory: async () => many}), {
                target: {table: 'orders', column: 'customer_id'},
                dialect: 'sqlite',
                viewsSupported: true,
                limits: {maxHistoryEntries: 2, maxViews: 1},
            });
            expect(result.sources.history).toEqual({status: 'partial', scanned: 2, total: 5});
            expect(result.sources.views).toMatchObject({status: 'partial', scanned: 1, total: 3});
            // Newest entries are read first.
            expect(
                result.evidence
                    .filter((e) => e.source === 'history')
                    .map((e) => e.historyEntry?.id),
            ).toEqual(['h4', 'h3']);
        });

        it('skips SQL longer than the limit', async () => {
            const long = `SELECT customer_id FROM orders WHERE id IN (${'1,'.repeat(100)}1)`;
            const result = await collectColumnUsage(
                lookups({getHistory: async () => [history('long', long, '2026-11-01T00:00:00Z')]}),
                {target, dialect: 'postgres', viewsSupported: true, limits: {maxSqlLength: 50}},
            );
            expect(result.sources.history).toEqual({status: 'partial', scanned: 0, total: 1});
        });

        it('stops between lookups once cancelled and marks the rest cancelled', async () => {
            const controller = new AbortController();
            const getHistory = vi.fn(async () => []);
            const result = await collectColumnUsage(
                lookups({
                    getForeignKeys: async () => {
                        controller.abort();
                        return [];
                    },
                    getHistory,
                }),
                {target, dialect: 'postgres', viewsSupported: true, signal: controller.signal},
            );
            expect(result.sources.foreignKeys.status).toBe('cancelled');
            expect(result.sources.views.status).toBe('cancelled');
            expect(result.sources.history.status).toBe('cancelled');
            expect(getHistory).not.toHaveBeenCalled();
        });

        it('reports progress after each source', async () => {
            const steps: string[] = [];
            await collectColumnUsage(lookups(), {
                target,
                dialect: 'postgres',
                viewsSupported: true,
                onProgress: (r) =>
                    steps.push(
                        `${r.sources.foreignKeys.status}/${r.sources.views.status}/${r.sources.history.status}`,
                    ),
            });
            expect(steps).toEqual([
                'complete/pending/pending',
                'complete/complete/pending',
                'complete/complete/complete',
            ]);
        });

        it('treats a missing history as a failure, not as no usage', async () => {
            const result = await collectColumnUsage(
                lookups({getHistory: () => Promise.reject(new Error('history file is locked'))}),
                {target, dialect: 'postgres', viewsSupported: true},
            );
            expect(result.sources.history).toEqual({
                status: 'failed',
                scanned: 0,
                total: null,
                message: 'history file is locked',
            });
        });
    });

    describe('classifyLookupError', () => {
        it('tells permission, unsupported and other errors apart', () => {
            expect(
                classifyLookupError("SELECT command denied to user 'u'@'h' for table 'views'"),
            ).toBe('permission-denied');
            expect(classifyLookupError('ERROR: permission denied for schema private')).toBe(
                'permission-denied',
            );
            expect(classifyLookupError('get_views is not supported by this driver')).toBe(
                'unsupported',
            );
            expect(classifyLookupError('connection reset')).toBe('failed');
        });
    });

    describe('sortEvidence', () => {
        it('orders by confidence and keeps the source order otherwise', () => {
            const sorted = sortEvidence([
                {id: 'a', source: 'history', confidence: 'uncertain'},
                {id: 'b', source: 'view', confidence: 'parsed'},
                {id: 'c', source: 'foreign-key', confidence: 'confirmed'},
                {id: 'd', source: 'history', confidence: 'parsed'},
            ]);
            expect(sorted.map((e) => e.id)).toEqual(['c', 'b', 'd', 'a']);
        });
    });

    describe('formatColumnUsageSummary', () => {
        const t = (key: string, options?: Record<string, unknown>) =>
            options ? `${key}${JSON.stringify(options)}` : key;

        it('lists the scope, every source status and redacted evidence', async () => {
            const result = await collectColumnUsage(lookups(), {
                target,
                dialect: 'postgres',
                viewsSupported: true,
            });
            const text = formatColumnUsageSummary(target, result, t);
            expect(text).toContain(
                'columnUsage.summaryTitle{"column":"public.orders.customer_id"}',
            );
            expect(text).toContain('columnUsage.source.history: columnUsage.status.complete');
            expect(text).not.toContain('a@b.c');
            expect(text).not.toContain('columnUsage.incompleteNote');
        });

        it('never copies comments or the values in them', async () => {
            const commented = [
                history(
                    'c1',
                    "SELECT o.customer_id FROM public.orders o WHERE o.email = 'a@b.com' /* card 4111111111111111 */ AND o.id = 42",
                    '2026-11-05T10:00:00Z',
                ),
                history(
                    'c2',
                    'SELECT o.customer_id FROM public.orders o -- ticket 4111111111111111\nWHERE o.id = 1',
                    '2026-11-06T10:00:00Z',
                ),
            ];
            const result = await collectColumnUsage(lookups({getHistory: async () => commented}), {
                target,
                dialect: 'postgres',
                viewsSupported: true,
            });
            const text = formatColumnUsageSummary(target, result, t);
            expect(result.evidence.filter((e) => e.source === 'history')).toHaveLength(2);
            expect(text).not.toMatch(/4111|a@b\.com|card|ticket/);

            const mysqlResult = await collectColumnUsage(
                lookups({
                    getHistory: async () => [
                        history(
                            'm1',
                            'SELECT o.customer_id FROM shop.orders o # card 4111111111111111\nWHERE 1=1',
                            '2026-11-07T10:00:00Z',
                        ),
                    ],
                }),
                {
                    target: {database: 'shop', table: 'orders', column: 'customer_id'},
                    dialect: 'mysql',
                    viewsSupported: true,
                },
            );
            const mysqlText = formatColumnUsageSummary(
                {database: 'shop', table: 'orders', column: 'customer_id'},
                mysqlResult,
                t,
            );
            expect(mysqlResult.evidence.some((e) => e.historyEntry?.id === 'm1')).toBe(true);
            expect(mysqlText).not.toMatch(/4111|card/);
        });

        it('says when nothing was found and the search was incomplete', () => {
            const empty: ColumnUsageResult = {
                sources: {
                    foreignKeys: {status: 'complete', scanned: 2, total: 2},
                    views: {status: 'permission-denied', scanned: 0, total: null},
                    history: {status: 'complete', scanned: 0, total: 0},
                },
                evidence: [],
            };
            const text = formatColumnUsageSummary({table: 't', column: 'c'}, empty, t);
            expect(text).toContain('columnUsage.summaryNone');
            expect(text).toContain('columnUsage.incompleteNote');
        });
    });

    describe('formatUsageTarget', () => {
        it('joins the parts that exist', () => {
            expect(formatUsageTarget(target)).toBe('public.orders.customer_id');
            expect(formatUsageTarget({table: 'orders', column: 'id'})).toBe('orders.id');
        });
    });
});
