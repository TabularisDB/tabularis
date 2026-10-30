import {fireEvent, render, screen} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import type {ComponentProps} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DataGrid} from '@/components/ui/DataGrid';
import {KeybindingsContext} from '@/contexts/KeybindingsContext';
import {buildPkMap, serializePkKey} from '@/utils/dataGrid';

// Find in results (#1298), end to end through the grid. The grid's own
// behaviour is covered in DataGrid.test.tsx; these tests share its mocks.

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

const {clientCall, scrollToIndexMock} = vi.hoisted(() => ({
    clientCall: vi.fn(),
    scrollToIndexMock: vi.fn(),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({activeSchema: null, connections: [], getConnectionData: vi.fn()}),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: vi.fn()})}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => ({call: clientCall})}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({usePlatformCapabilities: () => ({})}));
vi.mock('@/platform/secondaryWindowSessions', () => ({
    getJsonViewerSessionHost: () => ({open: vi.fn()}),
}));
vi.mock('@/hooks/useToast', () => ({useToast: () => ({showToast: vi.fn()})}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            key === 'dataGrid.find.position' ? `${options?.current} of ${options?.total}` : key,
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
    initReactI18next: {type: '3rdParty', init: vi.fn()},
}));
// Masking stays on with its default patterns: an "email" column is masked.
vi.mock('@/hooks/useSettings', () => ({useSettings: () => ({settings: {}})}));
vi.mock('@/hooks/useRightSidebar', () => ({
    useRightSidebar: () => ({
        isOpen: false,
        activePanel: null,
        rowEditorData: null,
        isPinned: false,
        openRowEditor: vi.fn(),
        updateRowEditorData: vi.fn(),
        close: vi.fn(),
        toggle: vi.fn(),
        setActivePanel: vi.fn(),
        togglePin: vi.fn(),
        onChangeRef: {current: null},
    }),
}));
vi.mock('@tauri-apps/api/event', () => ({listen: vi.fn().mockResolvedValue(vi.fn())}));
// JSDOM has no layout: render every row, and record scrolls to a row.
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({count}: {count: number}) => {
        const items = Array.from({length: count}, (_, index) => ({
            index,
            key: index,
            start: index * 35,
            end: (index + 1) * 35,
            size: 35,
        }));
        return {
            getVirtualItems: () => items,
            getTotalSize: () => count * 35,
            scrollToIndex: scrollToIndexMock,
            scrollToOffset: vi.fn(),
        };
    },
}));
vi.stubGlobal(
    'ResizeObserver',
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
);

afterEach(() => {
    clientCall.mockClear();
    scrollToIndexMock.mockClear();
    vi.mocked(invoke).mockClear();
});

const ORDERS = [
    [1, 'REFUND requested', 'alice@example.com'],
    [2, 'paid', 'refund@example.com'],
    [3, 'refund', null],
    [4, 'Refunded', 'carol@example.com'],
];

function renderFindGrid(props: Partial<ComponentProps<typeof DataGrid>> = {}) {
    const view = render(
        <KeybindingsContext.Provider
            value={{
                shortcuts: [],
                matchesShortcut: (event, id) =>
                    id === 'find_in_grid' &&
                    event.ctrlKey &&
                    !event.shiftKey &&
                    event.key.toLowerCase() === 'f',
                saveOverride: async () => {},
                resetOverride: async () => {},
                overrides: {},
                isMac: false,
            }}
        >
            <DataGrid
                columns={['id', 'status', 'email']}
                data={ORDERS}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
                {...props}
            />
        </KeybindingsContext.Provider>,
    );
    const grid = view.container.querySelector<HTMLElement>('div[tabindex="0"]')!;
    const cell = (rowIndex: number, colIndex: number) =>
        view.container.querySelector<HTMLElement>(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;
    const findState = () =>
        Array.from(view.container.querySelectorAll<HTMLElement>('td[data-find-match]')).map(
            (td) =>
                `${td.closest('tr')!.dataset.rowIndex}:${td.dataset.colIndex}:${td.dataset.findMatch}`,
        );
    const openFind = () => {
        fireEvent.keyDown(grid, {key: 'f', ctrlKey: true});
        return screen.getByRole('searchbox', {name: 'dataGrid.find.label'});
    };
    const search = (query: string) => fireEvent.change(openFind(), {target: {value: query}});
    return {...view, grid, cell, findState, openFind, search};
}

describe('DataGrid find in results (#1298)', () => {
    it('opens with Ctrl+F from the grid, with focus in the search field', () => {
        const {openFind} = renderFindGrid();
        expect(screen.queryByRole('search')).not.toBeInTheDocument();
        expect(openFind()).toHaveFocus();
        expect(screen.getByRole('search', {name: 'dataGrid.find.label'})).toBeInTheDocument();
    });

    it('highlights the matching cells and marks the first as current', () => {
        const {search, findState} = renderFindGrid();
        search('refund');
        expect(findState()).toEqual(['0:1:current', '2:1:match', '3:1:match']);
        expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });

    it('updates the count while typing', () => {
        const {search, findState} = renderFindGrid();
        search('r');
        expect(screen.getByText('1 of 3')).toBeInTheDocument();
        search('refunded');
        expect(findState()).toEqual(['3:1:current']);
        expect(screen.getByText('1 of 1')).toBeInTheDocument();
    });

    it('moves with Enter and Shift+Enter and wraps around', () => {
        const {search, findState} = renderFindGrid();
        search('refund');
        const field = screen.getByRole('searchbox');

        fireEvent.keyDown(field, {key: 'Enter'});
        expect(findState()).toContain('2:1:current');
        expect(screen.getByText('2 of 3')).toBeInTheDocument();
        fireEvent.keyDown(field, {key: 'Enter'});
        fireEvent.keyDown(field, {key: 'Enter'});
        expect(findState()).toContain('0:1:current');
        fireEvent.keyDown(field, {key: 'Enter', shiftKey: true});
        expect(findState()).toContain('3:1:current');
        expect(screen.getByText('3 of 3')).toBeInTheDocument();
    });

    it('moves with the arrow buttons', () => {
        const {search, findState} = renderFindGrid();
        search('refund');
        fireEvent.click(screen.getByRole('button', {name: 'dataGrid.find.previous'}));
        expect(findState()).toContain('3:1:current');
        fireEvent.click(screen.getByRole('button', {name: 'dataGrid.find.next'}));
        expect(findState()).toContain('0:1:current');
    });

    it('starts from the focused cell', () => {
        const {cell, search, findState} = renderFindGrid();
        fireEvent.click(cell(1, 0));
        search('refund');
        expect(findState()).toEqual(['0:1:match', '2:1:current', '3:1:match']);
    });

    it('matches case-sensitively when asked', () => {
        const {search, findState} = renderFindGrid();
        search('Refund');
        fireEvent.click(screen.getByRole('button', {name: 'dataGrid.find.matchCase'}));
        expect(findState()).toEqual(['3:1:current']);
    });

    it('does not match masked cells until they are revealed', () => {
        const {container, search, findState} = renderFindGrid();
        search('example');
        expect(findState()).toEqual([]);
        expect(screen.getAllByText('dataGrid.find.noResults').length).toBeGreaterThan(0);

        fireEvent.click(container.querySelector('button[title="dataGrid.revealColumn"]')!);
        expect(findState()).toEqual(['0:2:current', '1:2:match', '3:2:match']);
    });

    it('never matches NULL cells', () => {
        const {search, findState} = renderFindGrid({columns: ['id', 'status', 'note']});
        search('null');
        expect(findState()).toEqual([]);
    });

    it('searches the values the grid shows, pending edits included', () => {
        const pkKey = serializePkKey(buildPkMap(['id'], ORDERS[1], [0]));
        const {search, findState} = renderFindGrid({
            columns: ['id', 'status', 'note'],
            tableName: 'orders',
            pkColumns: ['id'],
            readonly: false,
            pendingChanges: {[pkKey]: {pkOriginalValue: {id: 2}, changes: {status: 'chargeback'}}},
        });
        search('chargeback');
        expect(findState()).toEqual(['1:1:current']);
        search('paid');
        expect(findState()).toEqual([]);
    });

    it('closes on Escape, clears the highlight and focuses the current match', () => {
        const {grid, cell, search, findState} = renderFindGrid();
        search('refund');
        fireEvent.keyDown(screen.getByRole('searchbox'), {key: 'Enter'});
        fireEvent.keyDown(screen.getByRole('searchbox'), {key: 'Escape'});

        expect(screen.queryByRole('search')).not.toBeInTheDocument();
        expect(findState()).toEqual([]);
        expect(grid).toHaveFocus();
        expect(cell(2, 1)).toHaveClass('ring-2');
    });

    it('closes on Escape from the grid without moving its focused cell', () => {
        const {grid, cell, search, findState} = renderFindGrid();
        search('refund');
        fireEvent.click(cell(1, 0));
        fireEvent.keyDown(grid, {key: 'Escape'});

        expect(screen.queryByRole('search')).not.toBeInTheDocument();
        expect(findState()).toEqual([]);
        expect(cell(1, 0)).toHaveClass('ring-2');
    });

    it('returns focus to the grid when closed without a match', () => {
        const {grid, search} = renderFindGrid();
        search('chargeback');
        fireEvent.click(screen.getByRole('button', {name: 'dataGrid.find.close'}));
        expect(screen.queryByRole('search')).not.toBeInTheDocument();
        expect(grid).toHaveFocus();
    });

    it('refocuses the open bar on Ctrl+F from the grid', () => {
        const {grid, search} = renderFindGrid();
        search('refund');
        grid.focus();
        fireEvent.keyDown(grid, {key: 'f', ctrlKey: true});
        expect(screen.getByRole('searchbox')).toHaveFocus();
        expect(screen.getAllByRole('search')).toHaveLength(1);
    });

    it('keeps the grid shortcut out of editors inside the grid', () => {
        const {grid} = renderFindGrid();
        const editor = document.createElement('textarea');
        grid.appendChild(editor);
        fireEvent.keyDown(editor, {key: 'f', ctrlKey: true});
        expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('follows refreshed rows without running a query', () => {
        const {search, findState, rerender} = renderFindGrid();
        search('refund');
        rerender(
            <KeybindingsContext.Provider
                value={{
                    shortcuts: [],
                    matchesShortcut: () => false,
                    saveOverride: async () => {},
                    resetOverride: async () => {},
                    overrides: {},
                    isMac: false,
                }}
            >
                <DataGrid
                    columns={['id', 'status', 'email']}
                    data={[...ORDERS, [5, 'refund pending', null]]}
                    selectedRows={new Set()}
                    onSelectionChange={vi.fn()}
                    readonly
                />
            </KeybindingsContext.Provider>,
        );
        expect(findState()).toEqual(['0:1:current', '2:1:match', '3:1:match', '4:1:match']);
        expect(clientCall).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('says when only the loaded rows are searched', () => {
        const {openFind} = renderFindGrid({hasMore: true});
        openFind();
        expect(screen.getByText('dataGrid.find.loadedRowsOnly')).toBeInTheDocument();
    });
});
