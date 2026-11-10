import type {TabularisClient} from '@/api/client';
import type {Tab} from '@/types/editor';
import type {
    LinkedEntry,
    LinkedFileContent,
    LinkedFileRef,
    LinkedFileSaved,
    LinkedFolderStatus,
} from '@/types/linkedFolders';
import {toErrorMessage} from './errors';
import {getSqlFileName} from './sqlFile';

type LinkedFoldersClient = Pick<TabularisClient, 'call'>;

/** Error codes returned by the linked-folder commands; each maps to `linkedFolders.errors.<code>`. */
const LINKED_FOLDER_ERROR_CODES = [
    'linked_folders_file_unreadable',
    'linked_folder_not_found',
    'linked_folder_unavailable',
    'linked_folder_limit_reached',
    'linked_path_outside_root',
    'linked_path_not_sql_file',
    'linked_directory_unreadable',
    'linked_file_unreadable',
    'linked_file_too_large',
    'linked_file_write_failed',
    'linked_file_conflict_modified',
    'linked_file_conflict_missing',
] as const;

export type LinkedFolderErrorCode = (typeof LINKED_FOLDER_ERROR_CODES)[number];
export type LinkedFileConflictKind = 'modified' | 'missing';

export function getLinkedFolderErrorCode(error: unknown): LinkedFolderErrorCode | null {
    const message = toErrorMessage(error);
    return LINKED_FOLDER_ERROR_CODES.find((code) => message === code) ?? null;
}

/** Translation key for a linked-folder error, or null for an unrelated error. */
export function getLinkedFolderErrorKey(error: unknown): string | null {
    const code = getLinkedFolderErrorCode(error);
    return code ? `linkedFolders.errors.${code}` : null;
}

export function getLinkedFileConflict(error: unknown): LinkedFileConflictKind | null {
    switch (getLinkedFolderErrorCode(error)) {
        case 'linked_file_conflict_modified':
            return 'modified';
        case 'linked_file_conflict_missing':
            return 'missing';
        default:
            return null;
    }
}

/** Key of a directory in the tree's expansion and listing maps. */
export function linkedDirectoryKey(folderId: string, relativePath: string): string {
    return `${folderId}:${relativePath}`;
}

/** Files are deduplicated by their canonical path, so symlink aliases open one tab. */
export function findOpenLinkedFileTab<T extends Pick<Tab, 'sourceFilePath'>>(
    tabs: readonly T[],
    canonicalPath: string,
): T | undefined {
    return tabs.find((tab) => tab.sourceFilePath === canonicalPath);
}

export function createLinkedFileTab(
    folderId: string,
    relativePath: string,
    file: LinkedFileContent,
    schema?: string,
): Partial<Tab> {
    return {
        type: 'console',
        title: getSqlFileName(relativePath),
        query: file.content,
        sourceFilePath: file.path,
        sourceFileContent: file.content,
        sourceFileDirty: false,
        sourceFileLink: {folderId, relativePath, version: file.version},
        ...(schema ? {schema} : {}),
    };
}

/**
 * Tab fields after a successful linked save. The dirty flag is recomputed
 * against `currentQuery`, which may have moved on while the write was in flight.
 */
export function savedLinkedFileTab(
    link: LinkedFileRef,
    saved: LinkedFileSaved,
    savedContent: string,
    currentQuery: string = savedContent,
): Partial<Tab> {
    return {
        sourceFilePath: saved.path,
        sourceFileContent: savedContent,
        sourceFileDirty: currentQuery !== savedContent,
        sourceFileLink: {...link, version: saved.version},
    };
}

export function readLinkedSqlFile(
    client: LinkedFoldersClient,
    folderId: string,
    relativePath: string,
): Promise<LinkedFileContent> {
    return client.call('read_linked_sql_file', {id: folderId, relativePath});
}

/** Write a linked file; without `overwrite` the backend refuses when the disk copy changed or vanished. */
export function writeLinkedSqlFile(
    client: LinkedFoldersClient,
    link: LinkedFileRef,
    content: string,
    overwrite = false,
): Promise<LinkedFileSaved> {
    return client.call('write_linked_sql_file', {
        id: link.folderId,
        relativePath: link.relativePath,
        content,
        expectedVersion: link.version,
        overwrite,
    });
}

export type LinkedListingState =
    | {readonly status: 'loading'}
    | {readonly status: 'error'; readonly message: string}
    | {
          readonly status: 'ready';
          readonly entries: readonly LinkedEntry[];
          readonly truncated: boolean;
      };

export type LinkedTreeRow =
    | {
          readonly type: 'root';
          readonly key: string;
          readonly folderId: string;
          readonly relativePath: '';
          readonly name: string;
          readonly path: string;
          readonly depth: 0;
          readonly expanded: boolean;
          readonly available: boolean;
      }
    | {
          readonly type: 'directory';
          readonly key: string;
          readonly folderId: string;
          readonly relativePath: string;
          readonly name: string;
          readonly depth: number;
          readonly expanded: boolean;
      }
    | {
          readonly type: 'file';
          readonly key: string;
          readonly folderId: string;
          readonly relativePath: string;
          readonly name: string;
          readonly depth: number;
      }
    | {
          readonly type: 'status';
          readonly key: string;
          readonly depth: number;
          readonly status: 'loading' | 'error' | 'empty' | 'truncated';
          readonly message?: string;
      };

/**
 * Flattens the linked roots and the directories listed so far into visible
 * rows. Directories that were never expanded contribute nothing, which keeps
 * traversal lazy.
 */
export function flattenLinkedTree(
    folders: readonly LinkedFolderStatus[],
    expanded: ReadonlySet<string>,
    listings: Readonly<Record<string, LinkedListingState>>,
): LinkedTreeRow[] {
    const rows: LinkedTreeRow[] = [];

    const pushListing = (folderId: string, relativePath: string, depth: number): void => {
        const key = linkedDirectoryKey(folderId, relativePath);
        const listing = listings[key];
        if (!listing || listing.status === 'loading') {
            rows.push({type: 'status', key: `${key}:loading`, depth, status: 'loading'});
            return;
        }
        if (listing.status === 'error') {
            rows.push({
                type: 'status',
                key: `${key}:error`,
                depth,
                status: 'error',
                message: listing.message,
            });
            return;
        }
        if (listing.entries.length === 0) {
            rows.push({type: 'status', key: `${key}:empty`, depth, status: 'empty'});
            return;
        }
        for (const entry of listing.entries) {
            const entryKey = linkedDirectoryKey(folderId, entry.relativePath);
            if (entry.kind === 'file') {
                rows.push({
                    type: 'file',
                    key: entryKey,
                    folderId,
                    relativePath: entry.relativePath,
                    name: entry.name,
                    depth,
                });
                continue;
            }
            const isExpanded = expanded.has(entryKey);
            rows.push({
                type: 'directory',
                key: entryKey,
                folderId,
                relativePath: entry.relativePath,
                name: entry.name,
                depth,
                expanded: isExpanded,
            });
            if (isExpanded) pushListing(folderId, entry.relativePath, depth + 1);
        }
        if (listing.truncated) {
            rows.push({type: 'status', key: `${key}:truncated`, depth, status: 'truncated'});
        }
    };

    for (const folder of folders) {
        const key = linkedDirectoryKey(folder.id, '');
        const isExpanded = folder.available && expanded.has(key);
        rows.push({
            type: 'root',
            key,
            folderId: folder.id,
            relativePath: '',
            name: folder.name,
            path: folder.path,
            depth: 0,
            expanded: isExpanded,
            available: folder.available,
        });
        if (isExpanded) pushListing(folder.id, '', 1);
    }
    return rows;
}

/** Open linked files by `folderId:relativePath`, with whether they hold unsaved edits. */
export function buildOpenLinkedFileIndex(
    tabs: readonly Pick<Tab, 'sourceFileLink' | 'sourceFileDirty'>[],
): Map<string, {dirty: boolean}> {
    const index = new Map<string, {dirty: boolean}>();
    for (const tab of tabs) {
        if (!tab.sourceFileLink) continue;
        const {folderId, relativePath} = tab.sourceFileLink;
        const key = linkedDirectoryKey(folderId, relativePath);
        index.set(key, {dirty: (index.get(key)?.dirty ?? false) || tab.sourceFileDirty === true});
    }
    return index;
}
