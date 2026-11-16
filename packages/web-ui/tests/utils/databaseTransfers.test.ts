import {describe, expect, it, vi} from 'vitest';
import type {TabularisClient} from '@/api/client';
import type {PlatformCapabilities} from '@/platform/capabilities';
import {
    databaseImportFilters,
    dumpSaveFilters,
    isNativeBackupFile,
    prepareDatabaseImportSource,
    runDatabaseDump,
} from '@/utils/databaseTransfers';

function asClient(value: object): TabularisClient {
    return value as unknown as TabularisClient;
}

function asPlatform(value: object): PlatformCapabilities {
    return value as unknown as PlatformCapabilities;
}

describe('databaseTransfers', () => {
    it('uses the native backup filter and retains the explicit format in the desktop request', async () => {
        const chooseSaveTarget = vi.fn().mockResolvedValue({reference: '/tmp/database.bin'});
        const call = vi.fn().mockResolvedValue(null);
        await runDatabaseDump(
            asClient({call}),
            asPlatform({negotiation: {environment: 'tauri'}, chooseSaveTarget}),
            {connectionId: 'plugin', options: {format: 'opaque', structure: true, data: true}},
            'database.bin',
            {format: 'opaque', extension: 'bin', label: 'Opaque backup (.bin)'},
        );
        expect(chooseSaveTarget).toHaveBeenCalledWith({
            suggestedName: 'database.bin',
            filters: [{name: 'Opaque backup (.bin)', extensions: ['bin']}],
        });
        expect(call).toHaveBeenCalledWith(
            'dump_database',
            expect.objectContaining({
                filePath: '/tmp/database.bin',
                options: {format: 'opaque', structure: true, data: true},
            }),
            expect.any(Object),
        );
    });
    it('uploads browser imports with a purpose-bound opaque token', async () => {
        const uploadFile = vi.fn().mockResolvedValue({token: 'upload-token'});
        const readInputBlob = vi.fn().mockResolvedValue(new Blob(['SELECT 1;']));

        await expect(
            prepareDatabaseImportSource(
                asClient({uploadFile}),
                asPlatform({
                    negotiation: {environment: 'browser'},
                    readInputBlob,
                }),
                {name: 'backup.sql', reference: 'browser-file:1'},
            ),
        ).resolves.toEqual({uploadToken: 'upload-token'});

        expect(uploadFile).toHaveBeenCalledWith(
            expect.objectContaining({
                fileName: 'backup.sql',
                purpose: 'database-import',
            }),
        );
    });

    it('keeps desktop import paths local to the Tauri adapter', async () => {
        await expect(
            prepareDatabaseImportSource(
                asClient({}),
                asPlatform({negotiation: {environment: 'tauri'}}),
                {name: 'backup.sql', reference: '/tmp/backup.sql'},
            ),
        ).resolves.toEqual({filePath: '/tmp/backup.sql'});
    });

    it('requests and saves a streamed browser dump download', async () => {
        const call = vi.fn().mockResolvedValue({
            kind: 'download',
            fileName: 'database.sql',
            mimeType: 'application/sql',
            token: 'download-token',
            size: 42,
        });
        const requestDownload = vi.fn().mockResolvedValue(undefined);

        await expect(
            runDatabaseDump(
                asClient({call, requestDownload}),
                asPlatform({negotiation: {environment: 'browser'}}),
                {
                    connectionId: 'connection-1',
                    options: {structure: true, data: true, tables: ['users']},
                },
                'database.sql',
            ),
        ).resolves.toBe(true);

        expect(call).toHaveBeenCalledWith(
            'dump_database',
            {
                connectionId: 'connection-1',
                options: {structure: true, data: true, tables: ['users']},
            },
            expect.any(Object),
        );
        expect(requestDownload).toHaveBeenCalledWith('download-token');
    });

    it('uses a native save target without exposing a browser download', async () => {
        const chooseSaveTarget = vi.fn().mockResolvedValue({reference: '/tmp/database.sql'});
        const call = vi.fn().mockResolvedValue(null);

        await expect(
            runDatabaseDump(
                asClient({call}),
                asPlatform({
                    negotiation: {environment: 'tauri'},
                    chooseSaveTarget,
                }),
                {
                    connectionId: 'connection-1',
                    options: {structure: true, data: false},
                },
                'database.sql',
            ),
        ).resolves.toBe(true);

        expect(call).toHaveBeenCalledWith(
            'dump_database',
            expect.objectContaining({filePath: '/tmp/database.sql'}),
            expect.any(Object),
        );
    });

    it('builds import filters and native-file detection from the plugin capability', () => {
        const capabilities = {
            format: 'sql',
            native_backup: {format: 'opaque', extension: '.bin', label: 'Opaque backup (.bin)'},
            create_database: true,
            requires_empty_target: true,
            target_label: 'Path',
        };
        expect(databaseImportFilters(capabilities)).toEqual([
            {name: 'SQL / Zip / Opaque backup (.bin)', extensions: ['sql', 'zip', 'bin']},
        ]);
        expect(isNativeBackupFile('backup.BIN', capabilities)).toBe(true);
        expect(isNativeBackupFile('backup.sql', capabilities)).toBe(false);
        expect(databaseImportFilters(null)).toEqual([
            {name: 'SQL / Zip File', extensions: ['sql', 'zip']},
        ]);
        const unsafe = {
            ...capabilities,
            native_backup: {
                format: 'opaque',
                extension: '../evil',
                label: 'Opaque backup (.bin)',
            },
        };
        expect(databaseImportFilters(unsafe)).toEqual([
            {name: 'SQL / Zip File', extensions: ['sql', 'zip']},
        ]);
        expect(isNativeBackupFile('backup.evil', unsafe)).toBe(false);
        expect(dumpSaveFilters(unsafe.native_backup)).toEqual([
            {name: 'SQL File', extensions: ['sql']},
        ]);
        const legacy = {
            ...capabilities,
            native_backup: true,
        } as unknown as typeof capabilities;
        expect(databaseImportFilters(legacy)).toEqual([
            {name: 'SQL / Zip File', extensions: ['sql', 'zip']},
        ]);
        expect(isNativeBackupFile('backup.fbk', legacy)).toBe(false);
    });
});
