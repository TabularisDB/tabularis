import type {DownloadFileRequest} from '@/platform/capabilities';

/** Largest file a plugin can save through the host. */
export const PLUGIN_SAVE_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** Most file systems (ext4, APFS, NTFS) allow 255 bytes or code units per name; UTF-8 bytes are the tighter limit. */
const MAX_FILE_NAME_BYTES = 255;
const utf8 = new TextEncoder();
const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * Validates a plugin's `saveFile` request and turns it into a host download.
 * The data is copied, so the plugin cannot change it while the save dialog is open.
 */
export async function parsePluginSaveFile(value: unknown): Promise<DownloadFileRequest> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('saveFile expects {data, suggestedName, mimeType?}');
    const {data, suggestedName, mimeType} = value as Record<string, unknown>;
    const fileName = pluginSaveFileName(suggestedName);
    if (mimeType !== undefined && (typeof mimeType !== 'string' || !MIME_TYPE.test(mimeType)))
        throw new Error('saveFile mimeType must look like type/subtype');
    return {
        fileName,
        contents: await pluginSaveFileBytes(data),
        ...(mimeType === undefined ? {} : {mimeType}),
    };
}

/** Reduces a suggested name to one file name: no folders, control or reserved characters. */
export function pluginSaveFileName(value: unknown): string {
    if (typeof value !== 'string') throw new Error('saveFile suggestedName must be a string');
    const base = value.split(/[\\/]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    const name = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^[\s.]+|[\s.]+$/g, '');
    if (!name) throw new Error('saveFile suggestedName must contain a file name');
    if (utf8.encode(name).length <= MAX_FILE_NAME_BYTES) return name;
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    const stem = name.slice(0, name.length - extension.length);
    return truncateUtf8(stem, MAX_FILE_NAME_BYTES - utf8.encode(extension).length) + extension;
}

/** The longest prefix of value that fits in maxBytes of UTF-8, ending on a whole character. */
function truncateUtf8(value: string, maxBytes: number): string {
    let bytes = 0;
    let end = 0;
    for (const char of value) {
        bytes += utf8.encode(char).length;
        if (bytes > maxBytes) break;
        end += char.length;
    }
    return value.slice(0, end);
}

async function pluginSaveFileBytes(data: unknown): Promise<Uint8Array> {
    if (data instanceof Blob) {
        checkSize(data.size);
        return new Uint8Array(await data.arrayBuffer());
    }
    if (data instanceof ArrayBuffer) {
        checkSize(data.byteLength);
        return new Uint8Array(data.slice(0));
    }
    if (ArrayBuffer.isView(data)) {
        checkSize(data.byteLength);
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    }
    throw new Error('saveFile data must be a Blob, ArrayBuffer or typed array');
}

function checkSize(bytes: number): void {
    if (bytes > PLUGIN_SAVE_FILE_MAX_BYTES)
        throw new Error(
            `saveFile data is larger than ${PLUGIN_SAVE_FILE_MAX_BYTES / 1024 / 1024} MiB`,
        );
}
