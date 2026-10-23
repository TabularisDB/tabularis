import type {SavedQuery, SavedQueryFolder} from '@/contexts/SavedQueriesContext';
import {toErrorMessage} from './errors';

export const MAX_FOLDER_NAME_CHARS = 64;
export const UNFILED_OPTION = '__unfiled__';

/** Error code the backend returns when `folders.json` cannot be read. */
export const FOLDERS_FILE_UNREADABLE = 'folders_file_unreadable';

export type FolderNameError = 'empty' | 'tooLong' | 'duplicate';

export interface FolderGroup {
    folder: SavedQueryFolder;
    queries: SavedQuery[];
}

export interface GroupedSavedQueries {
    folders: FolderGroup[];
    unfiled: SavedQuery[];
}

/** Mirrors the backend rules so the modal can give instant feedback. */
export function getFolderNameError(
    name: string,
    folders: SavedQueryFolder[],
    ignoreId?: string,
): FolderNameError | null {
    const trimmed = name.trim();
    if (!trimmed) return 'empty';
    if ([...trimmed].length > MAX_FOLDER_NAME_CHARS) return 'tooLong';
    const wanted = trimmed.toLowerCase();
    const taken = folders.some((f) => f.id !== ignoreId && f.name.trim().toLowerCase() === wanted);
    return taken ? 'duplicate' : null;
}

/**
 * Splits queries into folders (sorted by name) and the Unfiled remainder. A
 * query pointing at a folder that is not in the list stays visible as Unfiled.
 * Query order inside each bucket is preserved.
 */
export function groupQueriesByFolder(
    queries: SavedQuery[],
    folders: SavedQueryFolder[],
): GroupedSavedQueries {
    const buckets = new Map<string, SavedQuery[]>();
    for (const folder of folders) buckets.set(folder.id, []);

    const unfiled: SavedQuery[] = [];
    for (const query of queries) {
        const bucket = query.folder_id ? buckets.get(query.folder_id) : undefined;
        if (bucket) bucket.push(query);
        else unfiled.push(query);
    }

    const groups = [...folders]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}))
        .map((folder) => ({folder, queries: buckets.get(folder.id) ?? []}));

    return {folders: groups, unfiled};
}

/** Name of the folder a query is in, or null when it is Unfiled. */
export function getQueryFolderName(query: SavedQuery, folders: SavedQueryFolder[]): string | null {
    if (!query.folder_id) return null;
    return folders.find((f) => f.id === query.folder_id)?.name ?? null;
}

/**
 * Message to show for a failed folder command. Known backend error codes are
 * translated; anything else is shown as the backend sent it.
 */
export function getFolderErrorMessage(error: unknown, t: (key: string) => string): string {
    const message = toErrorMessage(error);
    if (message.includes(FOLDERS_FILE_UNREADABLE)) {
        return t('sidebar.foldersFileUnreadable');
    }
    return message;
}
