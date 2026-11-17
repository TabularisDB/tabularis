import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LinkedFolderSearchModal} from '@/components/modals/LinkedFolderSearchModal';

const client = vi.hoisted(() => ({call: vi.fn()}));
const platform = vi.hoisted(() => ({supports: vi.fn()}));
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => {
    if (!options) return key;
    return `${key}:${JSON.stringify(options)}`;
});

vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => client}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({usePlatformCapabilities: () => platform}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t})}));
vi.mock('lucide-react', async () => await vi.importActual('lucide-react'));

const folder = {id: 'test-folder-1', name: 'Queries', path: '/repo/queries', available: true};

const mockSearchResults = {
    query: 'users',
    matches: [
        {
            relativePath: 'users.sql',
            lineNumber: 10,
            columnNumber: 15,
            matchLength: 5,
            lineContent: 'SELECT * FROM users WHERE active = true;',
        },
        {
            relativePath: 'billing/orders.sql',
            lineNumber: 25,
            columnNumber: 6,
            matchLength: 5,
            lineContent: 'JOIN users ON users.id = orders.user_id',
        },
    ],
    truncated: false,
    filesSearched: 5,
    filesSkipped: 0,
};

describe('LinkedFolderSearchModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        platform.supports.mockReturnValue(true);
        client.call.mockImplementation(async (command: string, args?: unknown) => {
            if (command === 'search_linked_folder') {
                return mockSearchResults;
            }
            if (command === 'cancel_linked_folder_search') {
                return undefined;
            }
            if (command === 'read_linked_sql_file') {
                const req = args as {relativePath: string};
                if (req.relativePath === 'users.sql') {
                    return {
                        content: '-- Header\nSELECT * FROM users WHERE active = true;\n-- Footer',
                        dirty: false,
                    };
                }
                return {content: 'dummy sql', dirty: false};
            }
            throw new Error(`Unexpected command: ${command}`);
        });
    });

    it('searches for queries and renders matches with preview', async () => {
        const user = userEvent.setup();
        const onOpenFile = vi.fn();
        const onClose = vi.fn();

        render(
            <LinkedFolderSearchModal folder={folder} onClose={onClose} onOpenFile={onOpenFile} />,
        );

        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'users');

        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('search_linked_folder', {
                id: folder.id,
                query: 'users',
                caseSensitive: false,
            });
        });

        // Check match items appear
        expect((await screen.findAllByText('users.sql')).length).toBeGreaterThan(0);
        expect(screen.getByText('billing/orders.sql')).toBeInTheDocument();

        // Check preview content is loaded for selected first match
        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('read_linked_sql_file', {
                id: folder.id,
                relativePath: 'users.sql',
            });
        });

        // Open in editor button
        const openBtn = screen.getByRole('button', {name: 'linkedFolderSearch.openInEditor'});
        await user.click(openBtn);

        expect(onOpenFile).toHaveBeenCalledWith(folder.id, 'users.sql', {
            lineNumber: 10,
            columnNumber: 15,
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('toggles case sensitive search', async () => {
        const user = userEvent.setup();
        render(<LinkedFolderSearchModal folder={folder} onClose={vi.fn()} onOpenFile={vi.fn()} />);

        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'USERS');

        const caseBtn = screen.getByRole('button', {name: 'linkedFolderSearch.matchCase'});
        await user.click(caseBtn);

        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('search_linked_folder', {
                id: folder.id,
                query: 'USERS',
                caseSensitive: true,
            });
        });
    });

    it('navigates matches with keyboard and opens on Enter', async () => {
        const user = userEvent.setup();
        const onOpenFile = vi.fn();
        const onClose = vi.fn();

        render(
            <LinkedFolderSearchModal folder={folder} onClose={onClose} onOpenFile={onOpenFile} />,
        );

        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'users');

        await screen.findByRole('listbox');
        expect((await screen.findAllByText('users.sql')).length).toBeGreaterThan(0);

        // Navigate to second item with ArrowDown
        await user.keyboard('{ArrowDown}');

        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('read_linked_sql_file', {
                id: folder.id,
                relativePath: 'billing/orders.sql',
            });
        });

        // Press Enter to open
        await user.keyboard('{Enter}');
        expect(onOpenFile).toHaveBeenCalledWith(folder.id, 'billing/orders.sql', {
            lineNumber: 25,
            columnNumber: 6,
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('displays empty state when no matches found', async () => {
        const user = userEvent.setup();
        client.call.mockResolvedValueOnce({
            matches: [],
            truncated: false,
            filesSearched: 5,
            filesSkipped: 0,
        });

        render(<LinkedFolderSearchModal folder={folder} onClose={vi.fn()} onOpenFile={vi.fn()} />);

        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'nonexistent');

        expect(await screen.findByText('linkedFolderSearch.noMatchesTitle')).toBeInTheDocument();
    });

    it('displays truncated warning when results are truncated', async () => {
        const user = userEvent.setup();
        client.call.mockResolvedValueOnce({
            query: 'SELECT',
            matches: [
                {
                    relativePath: 'big.sql',
                    lineNumber: 1,
                    columnNumber: 1,
                    matchLength: 6,
                    lineContent: 'SELECT 1;',
                },
            ],
            truncated: true,
            filesSearched: 10,
            filesSkipped: 2,
        });

        render(<LinkedFolderSearchModal folder={folder} onClose={vi.fn()} onOpenFile={vi.fn()} />);

        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'SELECT');

        expect(await screen.findByText('linkedFolderSearch.truncatedWarning')).toBeInTheDocument();
    });

    it('shows unavailable message in browser mode', () => {
        platform.supports.mockReturnValue(false);
        render(<LinkedFolderSearchModal folder={folder} onClose={vi.fn()} onOpenFile={vi.fn()} />);

        expect(screen.getByText('linkedFolders.unavailableMessage')).toBeInTheDocument();
    });

    it('drops stale in-flight results when query is cleared', async () => {
        const user = userEvent.setup();
        let resolveSearch!: (val: typeof mockSearchResults) => void;
        client.call.mockImplementation((command: string) => {
            if (command === 'search_linked_folder') {
                return new Promise((resolve) => {
                    resolveSearch = resolve;
                });
            }
            if (command === 'cancel_linked_folder_search') {
                return Promise.resolve(undefined);
            }
            return Promise.resolve({content: 'dummy', dirty: false});
        });

        render(<LinkedFolderSearchModal folder={folder} onClose={vi.fn()} onOpenFile={vi.fn()} />);
        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'users');

        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('search_linked_folder', expect.anything());
        });

        // Clear the query while the first request is still pending and wait for
        // the debounced empty-query cancellation to run before resolving.
        await user.clear(input);
        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('cancel_linked_folder_search', undefined);
        });

        // Resolve the stale request after the query has been cleared; it must not render old matches
        resolveSearch(mockSearchResults);
        await waitFor(() => {
            expect(screen.getByText('linkedFolderSearch.typeToSearch')).toBeInTheDocument();
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });
    });

    it('caches file preview by path across matches in the same file', async () => {
        const user = userEvent.setup();
        client.call.mockImplementation(async (command: string) => {
            if (command === 'search_linked_folder') {
                return {
                    query: 'users',
                    matches: [
                        {
                            relativePath: 'users.sql',
                            lineNumber: 1,
                            columnNumber: 15,
                            matchLength: 5,
                            lineContent: 'SELECT * FROM users;',
                        },
                        {
                            relativePath: 'users.sql',
                            lineNumber: 2,
                            columnNumber: 15,
                            matchLength: 5,
                            lineContent: 'DELETE FROM users;',
                        },
                    ],
                    truncated: false,
                    filesSearched: 1,
                    filesSkipped: 0,
                };
            }
            if (command === 'read_linked_sql_file') {
                return {content: 'SELECT * FROM users;\nDELETE FROM users;', dirty: false};
            }
            return undefined;
        });

        render(<LinkedFolderSearchModal folder={folder} onClose={vi.fn()} onOpenFile={vi.fn()} />);
        const input = screen.getByRole('textbox', {name: 'linkedFolderSearch.inputPlaceholder'});
        await user.type(input, 'users');

        await screen.findByRole('listbox');
        await waitFor(() => {
            expect(client.call).toHaveBeenCalledWith('read_linked_sql_file', {
                id: folder.id,
                relativePath: 'users.sql',
            });
        });

        // Select second match in the same file
        await user.keyboard('{ArrowDown}');

        const readCalls = client.call.mock.calls.filter(([cmd]) => cmd === 'read_linked_sql_file');
        expect(readCalls).toHaveLength(1);
    });
});
