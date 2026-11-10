import type {TabularisClient} from '@/api/client';
import type {
    IfTableExists,
    TableExportResult,
    TableImportPreview,
    TableSqlContent,
} from '@/api/contract';
import type {ChosenInputFile, PlatformCapabilities} from '@/platform/capabilities';

const TABLE_IMPORT_PURPOSE = 'table-import';
/** Table transfers stream whole tables; give them as long as database dumps. */
export const TABLE_TRANSFER_DEADLINE_MS = 6 * 60 * 60 * 1_000;

export type PreparedTableImportSource = {filePath: string} | {uploadToken: string};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** `<table>_<yyyyMMdd-HHmmss>.sql`, with characters file systems reject replaced. */
export function tableExportFileName(table: string, now: Date = new Date()): string {
    const safeTable = table.replace(/[\\/:*?"<>|\s.]+/g, '_') || 'table';
    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${safeTable}_${stamp}.sql`;
}

/**
 * Where the desktop app writes an export: `{filePath}` from the native save
 * dialog, `{}` in the browser (the server hands back a download), or `null`
 * when the user closed the dialog.
 */
export async function chooseTableExportTarget(
    platform: PlatformCapabilities,
    suggestedName: string,
): Promise<{filePath?: string} | null> {
    if (platform.negotiation.environment !== 'tauri') return {};
    const target = await platform.chooseSaveTarget({
        suggestedName,
        filters: [{name: 'SQL File', extensions: ['sql']}],
    });
    return target ? {filePath: target.reference} : null;
}

/** Starts the browser download of a finished export; nothing on desktop. */
export async function deliverTableExport(
    client: TabularisClient,
    platform: PlatformCapabilities,
    result: TableExportResult,
): Promise<void> {
    if (platform.negotiation.environment === 'browser' && result.file?.kind === 'download') {
        await client.requestDownload(result.file.token);
    }
}

/** A desktop path, or the browser file uploaded once for preview and import. */
export async function prepareTableImportSource(
    client: TabularisClient,
    platform: PlatformCapabilities,
    file: ChosenInputFile,
): Promise<PreparedTableImportSource> {
    if (platform.negotiation.environment === 'tauri') {
        return {filePath: file.reference};
    }
    const metadata = await client.uploadFile({
        contents: await platform.readInputBlob(file.reference),
        fileName: file.name,
        purpose: TABLE_IMPORT_PURPOSE,
    });
    return {uploadToken: metadata.token};
}

/** The "if the table already exists" choices that make sense for a file. */
export function ifExistsOptions(content: TableSqlContent): IfTableExists[] {
    return content === 'structure_only'
        ? ['fail', 'drop_and_recreate']
        : ['fail', 'drop_and_recreate', 'append'];
}

/** The schema an import targets: what the user typed, else the node's. */
export function resolveImportSchema(
    typed: string,
    fallback: string | undefined,
): string | undefined {
    const trimmed = typed.trim();
    return trimmed || fallback || undefined;
}

/** Whether the import may start: the backend found no problem and the mode fits the file. */
export function canStartTableImport(
    preview: TableImportPreview | null,
    ifExists: IfTableExists,
): boolean {
    if (!preview || preview.problem) return false;
    return ifExistsOptions(preview.header.content).includes(ifExists);
}
