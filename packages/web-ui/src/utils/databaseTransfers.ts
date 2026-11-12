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
const NATIVE_BACKUP_EXTENSION = /^[A-Za-z0-9]{1,16}$/;

export function nativeBackupExtension(native: NativeBackupCapability): string | null {
    const extension = native.extension.trim().replace(/^\.+/, '');
    return NATIVE_BACKUP_EXTENSION.test(extension) ? extension : null;
}

export function declaredNativeBackup(
    capabilities: DatabaseSqlCapabilities | null | undefined,
): NativeBackupCapability | null {
    const native = capabilities?.native_backup;
    if (!native || typeof native !== 'object') {
        return null;
    }
    return nativeBackupExtension(native) ? native : null;
}

export function isNativeBackupFile(
    fileName: string,
    capabilities: DatabaseSqlCapabilities | null | undefined,
): boolean {
    const native = declaredNativeBackup(capabilities);
    if (!native) return false;
    const extension = nativeBackupExtension(native);
    if (!extension) return false;
    return fileName.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
}

export function databaseImportFilters(
    capabilities: DatabaseSqlCapabilities | null | undefined,
): PlatformFileFilter[] {
    const native = declaredNativeBackup(capabilities);
    const extension = native ? nativeBackupExtension(native) : null;
    if (!native || !extension) {
        return [{name: 'SQL / Zip File', extensions: ['sql', 'zip']}];
    }
    return [
        {
            name: `SQL / Zip / ${native.label}`,
            extensions: ['sql', 'zip', extension],
        },
    ];
}

export function dumpSaveFilters(
    native: NativeBackupCapability | null | undefined,
): PlatformFileFilter[] {
    if (!native || typeof native !== 'object') {
        return [{name: 'SQL File', extensions: ['sql']}];
    }
    const extension = nativeBackupExtension(native);
    if (!extension) {
        return [{name: 'SQL File', extensions: ['sql']}];
    }
    return [{name: native.label, extensions: [extension]}];
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
