import {describe, expect, it, vi} from 'vitest';
import type {TabularisClient} from '@/api/client';
import type {TableImportPreview} from '@/api/contract';
import type {PlatformCapabilities} from '@/platform/capabilities';
import {
    canStartTableImport,
    chooseTableExportTarget,
    deliverTableExport,
    ifExistsOptions,
    prepareTableImportSource,
    resolveImportSchema,
    tableExportFileName,
} from '@/utils/tableTransfer';

function asClient(value: object): TabularisClient {
    return value as unknown as TabularisClient;
}

function asPlatform(value: object): PlatformCapabilities {
    return value as unknown as PlatformCapabilities;
}

function preview(overrides: Partial<TableImportPreview> = {}): TableImportPreview {
    return {
        header: {
            formatVersion: 1,
            tabularisVersion: '0.30.0',
            driver: 'postgres',
            driverVersion: null,
            source: 'shop.public.orders',
            table: 'orders',
            content: 'structure_and_data',
            structureSource: 'driver',
            rows: 2,
            exported: '2026-10-30T10:00:00Z',
        },
        structure: 'CREATE TABLE "orders" ("id" integer);',
        structureTruncated: false,
        problem: null,
        ...overrides,
    };
}

describe('tableTransfer', () => {
    describe('tableExportFileName', () => {
        it('names the file after the table and the local time', () => {
            expect(tableExportFileName('orders', new Date(2026, 8, 3, 14, 21, 7))).toBe(
                'orders_20260903-142107.sql',
            );
        });

        it('replaces characters file systems reject', () => {
            expect(tableExportFileName('my orders/2026.v2', new Date(2026, 0, 1, 0, 0, 0))).toBe(
                'my_orders_2026_v2_20260101-000000.sql',
            );
            expect(tableExportFileName('', new Date(2026, 0, 1, 0, 0, 0))).toBe(
                'table_20260101-000000.sql',
            );
        });
    });

    describe('chooseTableExportTarget', () => {
        it('asks for a native save path on desktop', async () => {
            const chooseSaveTarget = vi.fn().mockResolvedValue({reference: '/tmp/orders.sql'});
            await expect(
                chooseTableExportTarget(
                    asPlatform({negotiation: {environment: 'tauri'}, chooseSaveTarget}),
                    'orders.sql',
                ),
            ).resolves.toEqual({filePath: '/tmp/orders.sql'});
            expect(chooseSaveTarget).toHaveBeenCalledWith(
                expect.objectContaining({suggestedName: 'orders.sql'}),
            );
        });

        it('returns null when the save dialog is closed', async () => {
            await expect(
                chooseTableExportTarget(
                    asPlatform({
                        negotiation: {environment: 'tauri'},
                        chooseSaveTarget: vi.fn().mockResolvedValue(null),
                    }),
                    'orders.sql',
                ),
            ).resolves.toBeNull();
        });

        it('needs no path in the browser', async () => {
            await expect(
                chooseTableExportTarget(asPlatform({negotiation: {environment: 'browser'}}), 'x'),
            ).resolves.toEqual({});
        });
    });

    describe('deliverTableExport', () => {
        it('downloads browser exports', async () => {
            const requestDownload = vi.fn().mockResolvedValue(undefined);
            await deliverTableExport(
                asClient({requestDownload}),
                asPlatform({negotiation: {environment: 'browser'}}),
                {
                    rows: 1,
                    bytes: 10,
                    structureSource: 'driver',
                    file: {
                        kind: 'download',
                        fileName: 'orders.sql',
                        mimeType: 'application/sql',
                        token: 'download-token',
                        size: 10,
                    },
                },
            );
            expect(requestDownload).toHaveBeenCalledWith('download-token');
        });

        it('does nothing on desktop', async () => {
            const requestDownload = vi.fn();
            await deliverTableExport(
                asClient({requestDownload}),
                asPlatform({negotiation: {environment: 'tauri'}}),
                {rows: 1, bytes: 10, structureSource: 'generated', file: null},
            );
            expect(requestDownload).not.toHaveBeenCalled();
        });
    });

    describe('prepareTableImportSource', () => {
        it('uploads browser files with the table-import purpose', async () => {
            const uploadFile = vi.fn().mockResolvedValue({token: 'upload-token'});
            await expect(
                prepareTableImportSource(
                    asClient({uploadFile}),
                    asPlatform({
                        negotiation: {environment: 'browser'},
                        readInputBlob: vi.fn().mockResolvedValue(new Blob(['-- x'])),
                    }),
                    {name: 'orders.sql', reference: 'browser-file:1'},
                ),
            ).resolves.toEqual({uploadToken: 'upload-token'});
            expect(uploadFile).toHaveBeenCalledWith(
                expect.objectContaining({fileName: 'orders.sql', purpose: 'table-import'}),
            );
        });

        it('keeps desktop paths local', async () => {
            await expect(
                prepareTableImportSource(
                    asClient({}),
                    asPlatform({negotiation: {environment: 'tauri'}}),
                    {name: 'orders.sql', reference: '/tmp/orders.sql'},
                ),
            ).resolves.toEqual({filePath: '/tmp/orders.sql'});
        });
    });

    describe('ifExistsOptions', () => {
        it('offers appending only when the file has rows', () => {
            expect(ifExistsOptions('structure_and_data')).toEqual([
                'fail',
                'drop_and_recreate',
                'append',
            ]);
            expect(ifExistsOptions('structure_only')).toEqual(['fail', 'drop_and_recreate']);
        });
    });

    describe('resolveImportSchema', () => {
        it('prefers the typed schema, then the node schema', () => {
            expect(resolveImportSchema(' staging ', 'public')).toBe('staging');
            expect(resolveImportSchema('', 'public')).toBe('public');
            expect(resolveImportSchema('  ', undefined)).toBeUndefined();
        });
    });

    describe('canStartTableImport', () => {
        it('needs a preview without problems', () => {
            expect(canStartTableImport(null, 'fail')).toBe(false);
            expect(canStartTableImport(preview({problem: 'read-only'}), 'fail')).toBe(false);
            expect(canStartTableImport(preview(), 'fail')).toBe(true);
        });

        it('refuses to append a structure-only file', () => {
            const structureOnly = preview();
            structureOnly.header = {...structureOnly.header, content: 'structure_only', rows: 0};
            expect(canStartTableImport(structureOnly, 'append')).toBe(false);
            expect(canStartTableImport(structureOnly, 'drop_and_recreate')).toBe(true);
        });
    });
});
