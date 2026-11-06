import {describe, expect, it, vi} from 'vitest';
import {
    buildOpenLinkedFileIndex,
    createLinkedFileTab,
    findOpenLinkedFileTab,
    flattenLinkedTree,
    getLinkedFileConflict,
    getLinkedFolderErrorCode,
    getLinkedFolderErrorKey,
    linkedDirectoryKey,
    readLinkedSqlFile,
    savedLinkedFileTab,
    writeLinkedSqlFile,
    type LinkedListingState,
} from '@/utils/linkedFolders';
import type {LinkedEntry, LinkedFolderStatus} from '@/types/linkedFolders';

const folder = (overrides: Partial<LinkedFolderStatus> = {}): LinkedFolderStatus => ({
    id: 'f1',
    name: 'sql',
    path: '/repo/sql',
    available: true,
    ...overrides,
});

const file = (relativePath: string): LinkedEntry => ({
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    kind: 'file',
});
const dir = (relativePath: string): LinkedEntry => ({
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    kind: 'directory',
});
const ready = (entries: LinkedEntry[], truncated = false): LinkedListingState => ({
    status: 'ready',
    entries,
    truncated,
});

describe('linkedFolders', () => {
    describe('errors', () => {
        it('recognises backend error codes in several error shapes', () => {
            expect(getLinkedFolderErrorCode('linked_file_conflict_modified')).toBe(
                'linked_file_conflict_modified',
            );
            expect(getLinkedFolderErrorCode(new Error('linked_folder_unavailable'))).toBe(
                'linked_folder_unavailable',
            );
            expect(getLinkedFolderErrorCode({message: 'linked_path_outside_root'})).toBe(
                'linked_path_outside_root',
            );
        });

        it('ignores unrelated errors', () => {
            expect(getLinkedFolderErrorCode('disk full')).toBeNull();
            expect(getLinkedFolderErrorKey('disk full')).toBeNull();
            expect(getLinkedFolderErrorKey('linked_file_unreadable')).toBe(
                'linkedFolders.errors.linked_file_unreadable',
            );
        });

        it('classifies save conflicts', () => {
            expect(getLinkedFileConflict('linked_file_conflict_modified')).toBe('modified');
            expect(getLinkedFileConflict('linked_file_conflict_missing')).toBe('missing');
            expect(getLinkedFileConflict('linked_file_unreadable')).toBeNull();
        });
    });

    describe('tabs', () => {
        it('deduplicates open files by canonical path', () => {
            const tabs = [
                {id: 'a', sourceFilePath: '/repo/sql/a.sql'},
                {id: 'b', sourceFilePath: '/repo/sql/reports/月次 report.sql'},
                {id: 'c'},
            ];
            expect(findOpenLinkedFileTab(tabs, '/repo/sql/reports/月次 report.sql')?.id).toBe('b');
            expect(findOpenLinkedFileTab(tabs, '/repo/sql/other.sql')).toBeUndefined();
        });

        it('creates a clean tab carrying the link and disk version', () => {
            const tab = createLinkedFileTab(
                'f1',
                'reports/monthly report.sql',
                {path: '/repo/sql/reports/monthly report.sql', content: 'select 1', version: 'v1'},
                'public',
            );
            expect(tab).toMatchObject({
                type: 'console',
                title: 'monthly report.sql',
                query: 'select 1',
                sourceFilePath: '/repo/sql/reports/monthly report.sql',
                sourceFileContent: 'select 1',
                sourceFileDirty: false,
                sourceFileLink: {
                    folderId: 'f1',
                    relativePath: 'reports/monthly report.sql',
                    version: 'v1',
                },
                schema: 'public',
            });
        });

        it('advances the version after a save and keeps newer edits dirty', () => {
            const link = {folderId: 'f1', relativePath: 'a.sql', version: 'v1'};
            const saved = {path: '/repo/sql/a.sql', version: 'v2'};
            expect(savedLinkedFileTab(link, saved, 'select 2')).toMatchObject({
                sourceFileDirty: false,
                sourceFileLink: {version: 'v2'},
            });
            expect(savedLinkedFileTab(link, saved, 'select 2', 'select 3')).toMatchObject({
                sourceFileContent: 'select 2',
                sourceFileDirty: true,
            });
        });

        it('indexes open linked files and their dirty state', () => {
            const index = buildOpenLinkedFileIndex([
                {
                    sourceFileLink: {folderId: 'f1', relativePath: 'a.sql', version: 'v'},
                    sourceFileDirty: false,
                },
                {
                    sourceFileLink: {folderId: 'f1', relativePath: 'b.sql', version: 'v'},
                    sourceFileDirty: true,
                },
                {sourceFileDirty: true},
            ]);
            expect(index.get(linkedDirectoryKey('f1', 'a.sql'))).toEqual({dirty: false});
            expect(index.get(linkedDirectoryKey('f1', 'b.sql'))).toEqual({dirty: true});
            expect(index.size).toBe(2);
        });
    });

    describe('client calls', () => {
        it('reads and writes through the linked commands with the expected version', async () => {
            const call = vi.fn().mockResolvedValue({});
            const client = {call} as never;
            await readLinkedSqlFile(client, 'f1', 'a b/é.sql');
            expect(call).toHaveBeenCalledWith('read_linked_sql_file', {
                id: 'f1',
                relativePath: 'a b/é.sql',
            });
            await writeLinkedSqlFile(
                client,
                {folderId: 'f1', relativePath: 'a.sql', version: 'v1'},
                'x',
            );
            expect(call).toHaveBeenLastCalledWith('write_linked_sql_file', {
                id: 'f1',
                relativePath: 'a.sql',
                content: 'x',
                expectedVersion: 'v1',
                overwrite: false,
            });
            await writeLinkedSqlFile(
                client,
                {folderId: 'f1', relativePath: 'a.sql', version: 'v1'},
                'x',
                true,
            );
            expect(call).toHaveBeenLastCalledWith(
                'write_linked_sql_file',
                expect.objectContaining({overwrite: true}),
            );
        });
    });

    describe('flattenLinkedTree', () => {
        it('lists only roots until one is expanded (lazy traversal)', () => {
            const rows = flattenLinkedTree([folder()], new Set(), {});
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({type: 'root', expanded: false, depth: 0});
        });

        it('shows a loading row while the first listing is pending', () => {
            const rows = flattenLinkedTree([folder()], new Set(['f1:']), {
                'f1:': {status: 'loading'},
            });
            expect(rows.map((r) => r.type)).toEqual(['root', 'status']);
        });

        it('nests expanded directories and skips collapsed ones', () => {
            const rows = flattenLinkedTree([folder()], new Set(['f1:', 'f1:reports']), {
                'f1:': ready([dir('reports'), dir('archive'), file('a.sql')]),
                'f1:reports': ready([file('reports/monthly.sql')]),
                'f1:archive': ready([file('archive/old.sql')]),
            });
            expect(
                rows.map(
                    (r) =>
                        `${r.depth}:${r.type === 'status' ? r.status : r.type === 'root' ? r.name : r.relativePath}`,
                ),
            ).toEqual(['0:sql', '1:reports', '2:reports/monthly.sql', '1:archive', '1:a.sql']);
        });

        it('reports empty, failed and truncated listings', () => {
            const empty = flattenLinkedTree([folder()], new Set(['f1:']), {'f1:': ready([])});
            expect(empty[1]).toMatchObject({type: 'status', status: 'empty'});

            const failed = flattenLinkedTree([folder()], new Set(['f1:']), {
                'f1:': {status: 'error', message: 'nope'},
            });
            expect(failed[1]).toMatchObject({type: 'status', status: 'error', message: 'nope'});

            const truncated = flattenLinkedTree([folder()], new Set(['f1:']), {
                'f1:': ready([file('a.sql')], true),
            });
            expect(truncated.at(-1)).toMatchObject({type: 'status', status: 'truncated'});
        });

        it('never expands an unavailable root', () => {
            const rows = flattenLinkedTree([folder({available: false})], new Set(['f1:']), {});
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({type: 'root', available: false, expanded: false});
        });

        it('keeps the same relative path in two roots apart', () => {
            const rows = flattenLinkedTree(
                [folder(), folder({id: 'f2', name: 'other', path: '/other'})],
                new Set(['f1:', 'f2:']),
                {'f1:': ready([file('a.sql')]), 'f2:': ready([file('a.sql')])},
            );
            const keys = rows.map((r) => r.key);
            expect(new Set(keys).size).toBe(keys.length);
        });
    });
});
