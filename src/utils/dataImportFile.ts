import {readTextFile, stat} from '@tauri-apps/plugin-fs';

export const DATA_IMPORT_FILE_LIMIT = 20 * 1024 * 1024;
export const DATA_IMPORT_EXTENSIONS = ['csv', 'tsv', 'json', 'md'];

export class DataImportFileError extends Error {
    readonly code: 'tooLarge' | 'unsupported' | 'notFile';

    constructor(code: DataImportFileError['code']) {
        super(code);
        this.code = code;
    }
}

/** Read only a supported, bounded text file selected by the native dialog. */
export async function readDataImportFile(path: string): Promise<string> {
    const extension = path.split('.').pop()?.toLowerCase();
    if (!extension || !DATA_IMPORT_EXTENSIONS.includes(extension)) {
        throw new DataImportFileError('unsupported');
    }
    const info = await stat(path);
    if (!info.isFile) throw new DataImportFileError('notFile');
    if (info.size > DATA_IMPORT_FILE_LIMIT) throw new DataImportFileError('tooLarge');
    const text = await readTextFile(path);
    // Recheck in case the file changed between the metadata check and the read.
    if (new TextEncoder().encode(text).byteLength > DATA_IMPORT_FILE_LIMIT) {
        throw new DataImportFileError('tooLarge');
    }
    return text;
}
