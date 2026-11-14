import {describe, expect, it, vi} from 'vitest';
import {
    classifyLookupError,
    collectColumnUsage,
    failPendingSources,
    formatColumnUsageSummary,
    formatUsageTarget,
    isFailedRun,
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

        describe('foreign keys across schemas', () => {
            const fk = (
                name: string,
                column_name: string,
                ref_table: string,
                ref_column: string,
                ref_schema?: string | null,
            ) => ({
                name,
                column_name,
                ref_table,
                ref_column,
                ...(ref_schema !== undefined ? {ref_schema} : {}),
            });
            const fkLookups = (
                outgoing: ReturnType<typeof fk>[],
                tables: TableSchema[],
            ): ColumnUsageLookups =>
                lookups({
                    getForeignKeys: async () => outgoing,
                    getSchemaSnapshot: async () => tables,
                    getViews: async () => [],
                    getHistory: async () => [],
                });
            const collectFks = async (
                outgoing: ReturnType<typeof fk>[],
                tables: TableSchema[],
                usageTarget: ColumnUsageTarget = target,
            ) =>
                (
                    await collectColumnUsage(fkLookups(outgoing, tables), {
                        target: usageTarget,
                        dialect: 'postgres',
                        viewsSupported: true,
                    })
                ).evidence.map((e) => ({
                    direction: e.direction,
                    confidence: e.confidence,
                    objectSchema: e.objectSchema,
                    objectName: e.objectName,
                    relatedColumn: e.relatedColumn,
                }));
            const invoices = (...foreign_keys: ReturnType<typeof fk>[]): TableSchema => ({
                name: 'invoices',
                columns: [column('id'), column('customer_id')],
                foreign_keys,
            });

            it('does not report a key into the same table name in another schema as incoming', async () => {
                const evidence = await collectFks(
                    [],
                    [
                        invoices(
                            fk(
                                'invoices_sales_fk',
                                'customer_id',
                                'orders',
                                'customer_id',
                                'sales',
                            ),
                        ),
                    ],
                );
                expect(evidence).toEqual([]);
            });

            it('reports an incoming key whose referenced schema is the target schema', async () => {
                const evidence = await collectFks(
                    [],
                    [
                        invoices(
                            fk(
                                'invoices_public_fk',
                                'customer_id',
                                'orders',
                                'customer_id',
                                'public',
                            ),
                            fk(
                                'invoices_sales_fk',
                                'customer_id',
                                'orders',
                                'customer_id',
                                'sales',
                            ),
                            fk(
                                'invoices_archive_fk',
                                'customer_id',
                                'orders',
                                'customer_id',
                                'archive',
                            ),
                        ),
                    ],
                );
                expect(evidence).toEqual([
                    {
                        direction: 'incoming',
                        confidence: 'confirmed',
                        objectSchema: 'public',
                        objectName: 'invoices',
                        relatedColumn: 'customer_id',
                    },
                ]);
            });

            it('reads a key without a referenced schema as one into the source schema', async () => {
                for (const refSchema of [undefined, null, '']) {
                    const evidence = await collectFks(
                        [fk('orders_customer_fk', 'customer_id', 'customers', 'id', refSchema)],
                        [
                            invoices(
                                fk(
                                    'invoices_fk',
                                    'customer_id',
                                    'orders',
                                    'customer_id',
                                    refSchema,
                                ),
                            ),
                        ],
                    );
                    expect(
                        evidence.map((e) => [e.direction, e.objectSchema, e.objectName]),
                    ).toEqual([
                        ['outgoing', 'public', 'customers'],
                        ['incoming', 'public', 'invoices'],
                    ]);
                }
            });

            it('opens an outgoing key in the schema it references', async () => {
                const evidence = await collectFks(
                    [
                        fk('orders_sales_customer_fk', 'customer_id', 'customers', 'id', 'sales'),
                        fk('orders_public_customer_fk', 'customer_id', 'customers', 'id', 'public'),
                        fk('orders_other_fk', 'region_id', 'regions', 'id', 'sales'),
                    ],
                    [],
                );
                expect(evidence).toEqual([
                    {
                        direction: 'outgoing',
                        confidence: 'confirmed',
                        objectSchema: 'sales',
                        objectName: 'customers',
                        relatedColumn: 'id',
                    },
                    {
                        direction: 'outgoing',
                        confidence: 'confirmed',
                        objectSchema: 'public',
                        objectName: 'customers',
                        relatedColumn: 'id',
                    },
                ]);
            });

            it('compares catalog names the way the dialect stores them', async () => {
                // PostgreSQL keeps the case of quoted names, so these are other relations.
                for (const key of [
                    fk('invoices_fk', 'customer_id', 'orders', 'customer_id', 'PUBLIC'),
                    fk('invoices_fk', 'customer_id', 'Orders', 'customer_id', 'public'),
                    fk('invoices_fk', 'customer_id', 'orders', 'CUSTOMER_ID', 'public'),
                ]) {
                    expect(await collectFks([], [invoices(key)])).toEqual([]);
                }
                expect(
                    await collectFks(
                        [
                            fk('orders_upper_fk', 'CUSTOMER_ID', 'customers', 'id', 'public'),
                            fk('orders_fk', 'customer_id', 'customers', 'id', 'public'),
                        ],
                        [],
                    ),
                ).toEqual([
                    {
                        direction: 'outgoing',
                        confidence: 'confirmed',
                        objectSchema: 'public',
                        objectName: 'customers',
                        relatedColumn: 'id',
                    },
                ]);

                // A mixed-case catalog target matches its exact spelling only.
                const mixed: ColumnUsageTarget = {
                    database: 'shop',
                    schema: 'Sales',
                    table: 'Orders',
                    column: 'CustomerId',
                };
                const keys = [
                    fk('exact_fk', 'customer_id', 'Orders', 'CustomerId', 'Sales'),
                    fk('lower_fk', 'customer_id', 'orders', 'customerid', 'sales'),
                ];
                expect(
                    (await collectFks([], [invoices(...keys)], mixed)).map((e) => e.objectSchema),
                ).toEqual(['Sales']);

                // SQLite compares names without case. MySQL column names
                // ignore case, but its table names are case-sensitive on Linux.
                const mysqlTarget: ColumnUsageTarget = {
                    database: 'shop',
                    table: 'orders',
                    column: 'customer_id',
                };
                const inDialect = async (dialect: string) =>
                    (
                        await collectColumnUsage(
                            fkLookups(
                                [fk('orders_fk', 'CUSTOMER_ID', 'customers', 'id')],
                                [
                                    invoices(
                                        fk('a', 'customer_id', 'Orders', 'customer_id'),
                                        fk('b', 'customer_id', 'orders', 'CUSTOMER_ID'),
                                        fk('c', 'customer_id', 'ORDERS', 'Customer_Id'),
                                        fk('d', 'customer_id', 'orders', 'customer_id'),
                                    ),
                                ],
                            ),
                            {target: mysqlTarget, dialect, viewsSupported: true},
                        )
                    ).evidence.map((e) => `${e.direction}:${e.constraintName}`);
                expect(await inDialect('sqlite')).toEqual([
                    'outgoing:orders_fk',
                    'incoming:a',
                    'incoming:b',
                    'incoming:c',
                    'incoming:d',
                ]);
                expect(await inDialect('mysql')).toEqual([
                    'outgoing:orders_fk',
                    'incoming:b',
                    'incoming:d',
                ]);
            });

            it('matches SQLite names without case for ASCII letters only', async () => {
                // As SQLite reports it: `REFERENCES ORDERS(ID)` keeps the
                // spelling of the clause, and "Ä" and "ä" are two tables.
                const tables: TableSchema[] = [
                    {name: 'Ä', columns: [column('id')], foreign_keys: []},
                    {name: 'ä', columns: [column('id')], foreign_keys: []},
                    {name: 'orders', columns: [column('id')], foreign_keys: []},
                    {
                        name: 'invoices',
                        columns: [column('parent_id'), column('o')],
                        foreign_keys: [
                            fk('invoices_parent', 'parent_id', 'Ä', 'id'),
                            fk('invoices_order', 'o', 'ORDERS', 'ID'),
                        ],
                    },
                ];
                const incoming = async (table: string) =>
                    (
                        await collectColumnUsage(fkLookups([], tables), {
                            target: {table, column: 'id'},
                            dialect: 'sqlite',
                            viewsSupported: true,
                        })
                    ).evidence.map((e) => e.constraintName);
                expect(await incoming('ä')).toEqual([]);
                expect(await incoming('Ä')).toEqual(['invoices_parent']);
                expect(await incoming('orders')).toEqual(['invoices_order']);
            });

            it('compares SQL Server catalog names exactly while the collation is unknown', async () => {
                const target: ColumnUsageTarget = {
                    database: 'shop',
                    schema: 'dbo',
                    table: 'orders',
                    column: 'customer_id',
                };
                for (const dialect of ['mssql', 'generic']) {
                    const result = await collectColumnUsage(
                        fkLookups(
                            [
                                fk('out_upper', 'CUSTOMER_ID', 'customers', 'id', 'dbo'),
                                fk('out_exact', 'customer_id', 'customers', 'id', 'dbo'),
                            ],
                            [
                                invoices(
                                    fk('in_table', 'customer_id', 'Orders', 'customer_id', 'dbo'),
                                    fk('in_column', 'customer_id', 'orders', 'CUSTOMER_ID', 'dbo'),
                                    fk('in_schema', 'customer_id', 'orders', 'customer_id', 'DBO'),
                                    fk('in_exact', 'customer_id', 'orders', 'customer_id', 'dbo'),
                                ),
                            ],
                        ),
                        {target, dialect, viewsSupported: true},
                    );
                    expect(result.evidence.map((e) => e.constraintName)).toEqual([
                        'out_exact',
                        'in_exact',
                    ]);
                }
            });

            it('marks MySQL history that spells the table in another case as uncertain', async () => {
                const result = await collectColumnUsage(
                    lookups({
                        getForeignKeys: async () => [],
                        getSchemaSnapshot: async () => snapshot,
                        getViews: async () => [],
                        getHistory: async () => [
                            history(
                                'h1',
                                'SELECT o.CUSTOMER_ID FROM Orders o',
                                '2026-11-01T10:00:00Z',
                            ),
                            history(
                                'h2',
                                'SELECT o.customer_id FROM orders o',
                                '2026-11-02T10:00:00Z',
                            ),
                            history(
                                'h3',
                                'SELECT customer_id FROM orders',
                                '2026-11-03T10:00:00Z',
                                'SHOP',
                            ),
                        ],
                    }),
                    {
                        target: {database: 'shop', table: 'orders', column: 'customer_id'},
                        dialect: 'mysql',
                        viewsSupported: true,
                    },
                );
                expect(
                    result.evidence
                        .filter((e) => e.source === 'history')
                        .map((e) => [
                            e.historyEntry?.id,
                            e.reason ? `${e.confidence}:${e.reason}` : e.confidence,
                        ]),
                ).toEqual([
                    ['h2', 'parsed'],
                    ['h1', 'uncertain:name-case'],
                ]);
            });

            it('reads the columns of a quoted table name from the snapshot', async () => {
                // Unqualified `customer_id` is several-tables only when the
                // other table really has that column.
                const tables: TableSchema[] = [
                    {name: 'orders', columns: [column('customer_id')], foreign_keys: []},
                    {name: 'Archive', columns: [column('customer_id')], foreign_keys: []},
                    {name: 'archive', columns: [column('id')], foreign_keys: []},
                ];
                const evidence = async (sql: string) =>
                    (
                        await collectColumnUsage(
                            lookups({
                                getForeignKeys: async () => [],
                                getSchemaSnapshot: async () => tables,
                                getViews: async () => [],
                                getHistory: async () => [
                                    history('h1', sql, '2026-11-01T10:00:00Z'),
                                ],
                            }),
                            {target, dialect: 'postgres', viewsSupported: true},
                        )
                    ).evidence.map((e) =>
                        e.reason ? `${e.confidence}:${e.reason}` : e.confidence,
                    );
                expect(
                    await evidence('SELECT customer_id FROM public.orders, public.archive'),
                ).toEqual(['parsed']);
                expect(
                    await evidence('SELECT customer_id FROM public.orders, public."Archive"'),
                ).toEqual(['uncertain:several-tables']);
            });

            it('compares nothing when neither side knows a schema', async () => {
                const evidence = await collectFks(
                    [fk('orders_customer_fk', 'customer_id', 'customers', 'id')],
                    [invoices(fk('invoices_fk', 'customer_id', 'orders', 'customer_id'))],
                    {database: 'shop', table: 'orders', column: 'customer_id'},
                );
                expect(evidence).toEqual([
                    {
                        direction: 'outgoing',
                        confidence: 'confirmed',
                        objectSchema: undefined,
                        objectName: 'customers',
                        relatedColumn: 'id',
                    },
                    {
                        direction: 'incoming',
                        confidence: 'confirmed',
                        objectSchema: undefined,
                        objectName: 'invoices',
                        relatedColumn: 'customer_id',
                    },
                ]);
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

        it('keeps whether a history run failed, and its error, on the evidence', async () => {
            const failed: QueryHistoryEntry = {
                ...history(
                    'f1',
                    'SELECT o.customer_id FROM public.orders o',
                    '2026-11-08T10:00:00Z',
                ),
                status: 'error',
                error: 'column o.customer_id does not exist',
            };
            const ok = history(
                's1',
                'SELECT o.customer_id FROM public.orders o',
                '2026-11-09T10:00:00Z',
            );
            const result = await collectColumnUsage(
                lookups({getHistory: async () => [failed, ok]}),
                {target, dialect: 'postgres', viewsSupported: true},
            );
            const byId = (id: string) => result.evidence.find((e) => e.historyEntry?.id === id)!;
            expect(byId('f1').historyEntry).toMatchObject({
                status: 'error',
                error: 'column o.customer_id does not exist',
            });
            expect(byId('f1').confidence).toBe('parsed');
            expect(isFailedRun(byId('f1'))).toBe(true);
            expect(byId('s1').historyEntry).toMatchObject({status: 'success', error: null});
            expect(isFailedRun(byId('s1'))).toBe(false);
            expect(result.evidence.filter((e) => e.source !== 'history').some(isFailedRun)).toBe(
                false,
            );
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

        it('lets an abort during the history scan stop it', async () => {
            const controller = new AbortController();
            const entries = Array.from({length: 1500}, (_, k) =>
                history(
                    `h${k}`,
                    'SELECT o.customer_id FROM public.orders o',
                    `2026-11-01T00:${String(k % 60).padStart(2, '0')}:00Z`,
                ),
            );
            const result = await collectColumnUsage(
                lookups({
                    getHistory: async () => {
                        // A timer, like a Stop click, only runs once the scan yields.
                        setTimeout(() => controller.abort(), 0);
                        return entries;
                    },
                }),
                {target, dialect: 'postgres', viewsSupported: true, signal: controller.signal},
            );
            expect(result.sources.history.status).toBe('cancelled');
            expect(result.sources.history.scanned).toBeLessThan(entries.length);
            expect(result.sources.history.total).toBe(entries.length);
        });

        it('marks what was still pending as failed when the collection throws', () => {
            const partial: ColumnUsageResult = {
                sources: {
                    foreignKeys: {status: 'complete', scanned: 2, total: 2},
                    views: {status: 'pending', scanned: 0, total: null},
                    history: {status: 'pending', scanned: 0, total: null},
                },
                evidence: [],
            };
            const failed = failPendingSources(partial, new Error('parser broke'));
            expect(failed.sources.foreignKeys).toEqual(partial.sources.foreignKeys);
            expect(failed.sources.views).toMatchObject({status: 'failed', message: 'parser broke'});
            expect(failed.sources.history.status).toBe('failed');
            expect(isUsageComplete(failed)).toBe(false);
            const fromNothing = failPendingSources(null, 'boom');
            expect(Object.values(fromNothing.sources).map((source) => source.status)).toEqual([
                'failed',
                'failed',
                'failed',
            ]);
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

        it('marks failed runs without copying their error text', async () => {
            const failed: QueryHistoryEntry = {
                ...history(
                    'f1',
                    'SELECT o.customer_id FROM public.orders o',
                    '2026-11-08T10:00:00Z',
                ),
                status: 'error',
                error: 'duplicate key value (email)=(a@b.com)',
            };
            const ok = history(
                's1',
                'SELECT o.customer_id FROM public.orders o',
                '2026-11-09T10:00:00Z',
            );
            const result = await collectColumnUsage(
                lookups({getHistory: async () => [failed, ok]}),
                {target, dialect: 'postgres', viewsSupported: true},
            );
            const lines = formatColumnUsageSummary(target, result, t).split('\n');
            const runLine = (date: string) =>
                lines.find((line) => line.includes(`columnUsage.historyTitle{"date":"${date}"}`));
            expect(runLine('2026-11-08T10:00:00Z')).toContain('(columnUsage.failedRun)');
            expect(runLine('2026-11-09T10:00:00Z')).not.toContain('columnUsage.failedRun');
            expect(lines.join('\n')).not.toMatch(/duplicate|a@b\.com/);
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
