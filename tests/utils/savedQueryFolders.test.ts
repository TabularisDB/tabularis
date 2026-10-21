import {describe, it, expect} from 'vitest';
import {
    FOLDERS_FILE_UNREADABLE,
    MAX_FOLDER_NAME_CHARS,
    getFolderErrorMessage,
    getFolderNameError,
    getQueryFolderName,
    groupQueriesByFolder,
} from '@/utils/savedQueryFolders';
import type {SavedQuery, SavedQueryFolder} from '@/contexts/SavedQueriesContext';

const folder = (id: string, name: string): SavedQueryFolder => ({
    id,
    connection_id: 'c1',
    name,
    created_at: null,
});

const query = (id: string, folderId?: string | null): SavedQuery => ({
    id,
    name: `q${id}`,
    sql: 'SELECT 1',
    connection_id: 'c1',
    database: 'db',
    created_at: null,
    updated_at: null,
    folder_id: folderId,
});

describe('getFolderNameError', () => {
    const folders = [folder('f1', 'Reports'), folder('f2', 'Admin')];

    it('accepts a fresh name', () => {
        expect(getFolderNameError('Ops', folders)).toBeNull();
        expect(getFolderNameError('  Ops  ', folders)).toBeNull();
    });

    it('rejects empty and whitespace-only names', () => {
        expect(getFolderNameError('', folders)).toBe('empty');
        expect(getFolderNameError('   ', folders)).toBe('empty');
    });

    it('enforces the length limit in characters', () => {
        expect(getFolderNameError('é'.repeat(MAX_FOLDER_NAME_CHARS), folders)).toBeNull();
        expect(getFolderNameError('é'.repeat(MAX_FOLDER_NAME_CHARS + 1), folders)).toBe('tooLong');
    });

    it('rejects duplicates case-insensitively but lets a folder keep its own name', () => {
        expect(getFolderNameError('reports', folders)).toBe('duplicate');
        expect(getFolderNameError('  ADMIN ', folders)).toBe('duplicate');
        expect(getFolderNameError('reports', folders, 'f1')).toBeNull();
        expect(getFolderNameError('admin', folders, 'f1')).toBe('duplicate');
    });
});

describe('groupQueriesByFolder', () => {
    it('puts everything in unfiled when there are no folders', () => {
        const result = groupQueriesByFolder([query('1'), query('2', null)], []);
        expect(result.folders).toEqual([]);
        expect(result.unfiled.map((q) => q.id)).toEqual(['1', '2']);
    });

    it('groups by folder, sorts folders by name and keeps query order', () => {
        const result = groupQueriesByFolder(
            [query('1', 'f2'), query('2'), query('3', 'f1'), query('4', 'f2')],
            [folder('f2', 'zeta'), folder('f1', 'Alpha')],
        );
        expect(result.folders.map((g) => g.folder.name)).toEqual(['Alpha', 'zeta']);
        expect(result.folders[1].queries.map((q) => q.id)).toEqual(['1', '4']);
        expect(result.unfiled.map((q) => q.id)).toEqual(['2']);
    });

    it('keeps empty folders and does not hide queries pointing at a missing folder', () => {
        const result = groupQueriesByFolder([query('1', 'gone')], [folder('f1', 'Empty')]);
        expect(result.folders).toHaveLength(1);
        expect(result.folders[0].queries).toEqual([]);
        expect(result.unfiled.map((q) => q.id)).toEqual(['1']);
    });

    it('does not mutate its inputs', () => {
        const folders = [folder('f2', 'b'), folder('f1', 'a')];
        groupQueriesByFolder([], folders);
        expect(folders.map((f) => f.id)).toEqual(['f2', 'f1']);
    });
});

describe('getQueryFolderName', () => {
    const folders = [folder('f1', 'Reports')];

    it('returns the folder name, or null for unfiled and unknown folders', () => {
        expect(getQueryFolderName(query('1', 'f1'), folders)).toBe('Reports');
        expect(getQueryFolderName(query('1'), folders)).toBeNull();
        expect(getQueryFolderName(query('1', null), folders)).toBeNull();
        expect(getQueryFolderName(query('1', 'gone'), folders)).toBeNull();
    });
});

describe('getFolderErrorMessage', () => {
    const t = (key: string) => `translated:${key}`;

    it('translates the unreadable-folders-file code, however the error is wrapped', () => {
        expect(getFolderErrorMessage(FOLDERS_FILE_UNREADABLE, t)).toBe(
            'translated:sidebar.foldersFileUnreadable',
        );
        expect(getFolderErrorMessage(new Error(FOLDERS_FILE_UNREADABLE), t)).toBe(
            'translated:sidebar.foldersFileUnreadable',
        );
    });

    it('passes other backend messages through unchanged', () => {
        expect(
            getFolderErrorMessage('Folder is not empty. Move or delete its queries first.', t),
        ).toBe('Folder is not empty. Move or delete its queries first.');
        expect(getFolderErrorMessage(new Error('Folder not found'), t)).toBe('Folder not found');
    });
});
