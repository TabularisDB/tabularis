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
    matches: [
        {
            relativePath: 'users.sql',
            lineNumber: 10,
            columnNumber: 8,
            lineContent: 'SELECT * FROM users WHERE active = true;',
        },
        {
            relativePath: 'billing/orders.sql',
            lineNumber: 25,
            columnNumber: 15,
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

        expect(onOpenFile).toHaveBeenCalledWith(folder.id, 'users.sql');
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
        expect(onOpenFile).toHaveBeenCalledWith(folder.id, 'billing/orders.sql');
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
            matches: [
                {
                    relativePath: 'big.sql',
                    lineNumber: 1,
                    columnNumber: 1,
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
});
