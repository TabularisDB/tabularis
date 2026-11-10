import type {TabularisClient} from '@/api/client';
import type {OpenDataFileRequest} from '@/api/contract';
import type {PlatformCapabilities} from '@/platform/capabilities';
import type {PluginManifest} from '@/types/plugins';

const DATA_FILE_PURPOSE = 'data-file';

/** Plugin suggested when no installed driver can open a data file. */
export const DATA_FILE_PLUGIN_ID = 'duckdb';

/** Formats the suggested plugin opens, offered in the file picker before it is installed. */
const SUGGESTED_PLUGIN_FORMATS: readonly string[] = ['csv', 'tsv', 'json', 'ndjson', 'parquet'];

/** File extensions of each data file format. Mirrors `application/data_files.rs`. */
const FORMAT_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
    csv: ['csv'],
    tsv: ['tsv', 'tab'],
    json: ['json'],
    ndjson: ['ndjson', 'jsonl'],
    parquet: ['parquet', 'pq'],
    xlsx: ['xlsx'],
};

/** Window event that asks the app to open data files; see `requestOpenDataFiles`. */
export const OPEN_DATA_FILE_EVENT = 'tabularis:open-data-file';

/**
 * A data file the user picked: a platform file reference (a host path on
 * desktop, a picked browser file) or a file dropped onto the browser window.
 */
export type DataFileInput =
    | {readonly name: string; readonly reference: string}
    | {readonly name: string; readonly blob: Blob};

/** Data file format of a file name, from its extension; `null` when it is not a data file. */
export function dataFileFormat(fileName: string): string | null {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0 || dot === fileName.length - 1) return null;
    const extension = fileName.slice(dot + 1).toLowerCase();
    const match = Object.entries(FORMAT_EXTENSIONS).find(([, extensions]) =>
        extensions.includes(extension),
    );
    return match ? match[0] : null;
}

/** Formats the registered drivers can open, in the order drivers declare them. */
export function supportedDataFileFormats(drivers: readonly PluginManifest[]): string[] {
    const formats = drivers
        .filter((driver) => driver.capabilities.file_based)
        .flatMap((driver) => driver.capabilities.data_files ?? []);
    return Array.from(new Set(formats));
}

/** File extensions to offer in the picker: what the drivers open, or what the suggested plugin would. */
export function dataFileDialogExtensions(drivers: readonly PluginManifest[]): string[] {
    const supported = supportedDataFileFormats(drivers);
    const formats = supported.length > 0 ? supported : SUGGESTED_PLUGIN_FORMATS;
    return formats.flatMap((format) => FORMAT_EXTENSIONS[format] ?? []);
}

export interface DataFileSupport<T extends {readonly name: string}> {
    /** Files a registered driver can open now. */
    readonly ready: T[];
    /** Data files no registered driver declares: a plugin has to be installed or updated. */
    readonly needsDriver: T[];
    /** Files that are not data files at all. */
    readonly unknown: T[];
}

/** Sorts files by whether a registered driver can open them. */
export function classifyDataFiles<T extends {readonly name: string}>(
    files: readonly T[],
    drivers: readonly PluginManifest[],
): DataFileSupport<T> {
    const supported = new Set(supportedDataFileFormats(drivers));
    const result: DataFileSupport<T> = {ready: [], needsDriver: [], unknown: []};
    for (const file of files) {
        const format = dataFileFormat(file.name);
        if (format === null) result.unknown.push(file);
        else if (supported.has(format)) result.ready.push(file);
        else result.needsDriver.push(file);
    }
    return result;
}

/** A desktop path, or the token of the file uploaded to the server from the browser. */
export async function prepareDataFileSource(
    client: TabularisClient,
    platform: PlatformCapabilities,
    file: DataFileInput,
): Promise<Pick<OpenDataFileRequest, 'filePath' | 'uploadToken'>> {
    if ('reference' in file && platform.negotiation.environment === 'tauri') {
        return {filePath: file.reference};
    }
    const contents = 'blob' in file ? file.blob : await platform.readInputBlob(file.reference);
    const metadata = await client.uploadFile({
        contents,
        fileName: file.name,
        purpose: DATA_FILE_PURPOSE,
    });
    return {uploadToken: metadata.token};
}

/** A data file at a host path, as the system passes it on "Open with". */
export function dataFileFromPath(path: string): DataFileInput {
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    return {name, reference: path};
}

/** Whether a drag carries files from outside the page (not an in-app drag). */
export function isFileDrag(types: readonly string[] | undefined): boolean {
    return types?.includes('Files') === true;
}

/**
 * Asks the app to open data files. Without `files` the user picks one. Handled
 * by `DataFileGate`, mounted once in the main layout.
 */
export function requestOpenDataFiles(files?: readonly DataFileInput[]): void {
    window.dispatchEvent(
        new CustomEvent<readonly DataFileInput[] | undefined>(OPEN_DATA_FILE_EVENT, {
            detail: files,
        }),
    );
}
