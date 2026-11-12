import type {TabularisClient} from '@/api/client';
import type {DatabaseDumpRequest} from '@/api/contract';
import type {
    ChosenInputFile,
    PlatformCapabilities,
    PlatformFileFilter,
} from '@/platform/capabilities';
import type {DatabaseSqlCapabilities, NativeBackupCapability} from '@/types/plugins';
import {saveGeneratedFile} from './connectionFiles';

const DATABASE_IMPORT_PURPOSE = 'database-import';
const DATABASE_JOB_DEADLINE_MS = 6 * 60 * 60 * 1_000;

export function nativeBackupExtension(native: NativeBackupCapability): string {
    return native.extension.replace(/^\./, '');
}

export function isNativeBackupFile(
    fileName: string,
    capabilities: DatabaseSqlCapabilities | null | undefined,
): boolean {
    const native = capabilities?.native_backup;
    if (!native) return false;
    return fileName.toLowerCase().endsWith(`.${nativeBackupExtension(native).toLowerCase()}`);
}

export function databaseImportFilters(
    capabilities: DatabaseSqlCapabilities | null | undefined,
): PlatformFileFilter[] {
    const native = capabilities?.native_backup;
    if (!native) {
        return [{name: 'SQL / Zip File', extensions: ['sql', 'zip']}];
    }
    const extension = nativeBackupExtension(native);
    return [
        {
            name: `SQL / Zip / ${native.label}`,
            extensions: ['sql', 'zip', extension],
        },
    ];
}

export function dumpSaveFilters(native: NativeBackupCapability | null | undefined): PlatformFileFilter[] {
    if (!native) {
        return [{name: 'SQL File', extensions: ['sql']}];
    }
    return [{name: native.label, extensions: [nativeBackupExtension(native)]}];
}

export type PreparedDatabaseImportSource = {filePath: string} | {uploadToken: string};

export async function prepareDatabaseImportSource(
    client: TabularisClient,
    platform: PlatformCapabilities,
    file: ChosenInputFile,
): Promise<PreparedDatabaseImportSource> {
    if (platform.negotiation.environment === 'tauri') {
        return {filePath: file.reference};
    }

    const metadata = await client.uploadFile({
        contents: await platform.readInputBlob(file.reference),
        fileName: file.name,
        purpose: DATABASE_IMPORT_PURPOSE,
    });
    return {uploadToken: metadata.token};
}

export async function runDatabaseDump(
    client: TabularisClient,
    platform: PlatformCapabilities,
    request: DatabaseDumpRequest,
    suggestedName: string,
    nativeFormat?: NativeBackupCapability | null,
): Promise<boolean> {
    let commandRequest = request;
    if (platform.negotiation.environment === 'tauri') {
        const target = await platform.chooseSaveTarget({
            suggestedName,
            filters: dumpSaveFilters(nativeFormat),
        });
        if (!target) return false;
        commandRequest = {...request, filePath: target.reference};
    }

    const generated = await client.call('dump_database', commandRequest, {
        deadlineMs: DATABASE_JOB_DEADLINE_MS,
        cancellationId: crypto.randomUUID(),
    });
    if (!generated) return true;
    if (platform.negotiation.environment === 'browser' && generated.kind === 'download') {
        await client.requestDownload(generated.token);
        return true;
    }
    return saveGeneratedFile(client, platform, generated);
}

export const DATABASE_TRANSFER_DEADLINE_MS = DATABASE_JOB_DEADLINE_MS;
