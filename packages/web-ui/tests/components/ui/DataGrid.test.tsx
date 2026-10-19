import {act, render, fireEvent, screen, waitFor} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {openUrl} from '@tauri-apps/plugin-opener';
import {createRef, useState, type ComponentProps} from 'react';
import {vi} from 'vitest';
import {DataGrid, type DataGridCommandTarget} from '@/components/ui/DataGrid';
import {buildPkMap, serializePkKey, USE_DEFAULT_SENTINEL} from '@/utils/dataGrid';
import {KeybindingsContext} from '@/contexts/KeybindingsContext';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());
vi.mock('@/components/ui/CellCodeEditor', () => ({
    CellCodeEditor: ({value, onChange}: {value: string; onChange: (value: string) => void}) => (
        <textarea
            aria-label="Expanded value"
            value={value}
            onChange={(event) => onChange(event.target.value)}
        />
    ),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => databaseMock(),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: vi.fn()}),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: vi.fn()}),
}));

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        openExternalUrl: openUrl,
        writeClipboardHtml: writeHtmlMock,
    }),
}));

const {
    openJsonViewerMock,
    showToastMock,
    openRowEditorMock,
    translationMock,
    scrollToIndexMock,
    scrollToOffsetMock,
    virtualizerRenderControl,
    sidebarState,
    writeHtmlMock,
    databaseMock,
} = vi.hoisted(() => ({
    openJsonViewerMock: vi.fn(),
    showToastMock: vi.fn(),
    openRowEditorMock: vi.fn(),
    translationMock: vi.fn((key: string) => key),
    scrollToIndexMock: vi.fn(),
    scrollToOffsetMock: vi.fn(),
    // Lets a single test simulate the virtualizer's first, unmeasured commit,
    // where it has no virtual items yet.
    virtualizerRenderControl: {forceEmpty: false},
    sidebarState: {isOpen: false, activePanel: null as string | null},
    writeHtmlMock: vi.fn(),
    databaseMock: vi.fn((): Record<string, unknown> => ({
        activeSchema: null,
        connections: [],
        getConnectionData: vi.fn(),
    })),
}));

vi.mock('@/platform/secondaryWindowSessions', () => ({
    getJsonViewerSessionHost: () => ({open: openJsonViewerMock}),
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({showToast: showToastMock}),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: translationMock,
        i18n: {
            language: 'en',
            changeLanguage: vi.fn(),
        },
    }),
    initReactI18next: {
        type: '3rdParty',
        init: vi.fn(),
    },
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {}}),
}));

vi.mock('@/hooks/useRightSidebar', () => ({
    useRightSidebar: () => ({
        ...sidebarState,
        rowEditorData: null,
        isPinned: false,
        openRowEditor: openRowEditorMock,
        updateRowEditorData: vi.fn(),
        close: vi.fn(),
        toggle: vi.fn(),
        setActivePanel: vi.fn(),
        togglePin: vi.fn(),
        onChangeRef: {current: null},
    }),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// JSDOM has no layout, so the real virtualizer renders zero rows. Mock it to
// render every row — tests here assert behavior, not virtualization. Unless
// virtualizerRenderControl.forceEmpty is set, which simulates the real
// virtualizer's first, unmeasured commit (no virtual items yet).
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({
        count,
        getScrollElement,
    }: {
        count: number;
        getScrollElement: () => HTMLElement | null;
    }) => {
        const items = virtualizerRenderControl.forceEmpty
            ? []
            : Array.from({length: count}, (_, index) => ({
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
            // The real virtualizer applies the offset to the scroll element
            // itself, and — like a real, unmeasured browser viewport — clamps it
            // to 0 when nothing has rendered yet.
            scrollToOffset: (offset: number) => {
                scrollToOffsetMock(offset);
                const el = getScrollElement();
                if (el) el.scrollTop = items.length > 0 ? offset : 0;
            },
        };
    },
}));

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

describe('DataGrid layout', () => {
    it('keeps hidden header tooltips out of scrollable overflow', () => {
        const {container} = render(
            <DataGrid
                columns={['id', 'name']}
                data={[[1, 'Alice']]}
                columnMetadata={[
                    {
                        name: 'id',
                        data_type: 'integer',
                        is_pk: true,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                    {
                        name: 'name',
                        data_type: 'character varying(255)',
                        is_pk: false,
                        is_nullable: false,
                        is_auto_increment: false,
                        comment: 'Customer display name',
                    },
                ]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        const table = container.querySelector('table');
        const tooltips = container.querySelectorAll('[role="tooltip"]');

        expect(table).toHaveClass('w-full');
        expect(tooltips).toHaveLength(2);
        expect(tooltips[0]).toHaveClass('hidden', 'left-0');
        expect(tooltips[1]).toHaveClass('hidden', 'right-0');
        expect(tooltips[1]).not.toHaveClass('left-0');
        expect(tooltips[1]).toHaveTextContent('Customer display name');
    });
});

describe('DataGrid read-only cell viewers (#654)', () => {
    beforeEach(() => {
        openJsonViewerMock.mockReset();
        openJsonViewerMock.mockResolvedValue(undefined);
        openRowEditorMock.mockReset();
    });

    const payload = {status: 'ok'};

    const renderReadOnlyJsonGrid = () =>
        render(
            <DataGrid
                columns={['payload']}
                data={[[payload]]}
                tableName={null}
                pkColumns={null}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

    const cell = (container: HTMLElement) => container.querySelector('td[data-col-index="0"]')!;

    const expectReadOnlyViewer = async () => {
        await waitFor(() =>
            expect(openJsonViewerMock).toHaveBeenCalledWith(
                {
                    value: payload,
                    originalValue: payload,
                    columnName: 'payload',
                    rowLabel: 'Row 1',
                    readOnly: true,
                    cellKey: null,
                },
                undefined,
                undefined,
            ),
        );
    };

    it('opens structured query results on double-click', async () => {
        const {container} = renderReadOnlyJsonGrid();

        fireEvent.doubleClick(cell(container));

        await expectReadOnlyViewer();
    });

    it('opens structured query results from the keyboard', async () => {
        const {container} = renderReadOnlyJsonGrid();
        const grid = container.querySelector('div[tabindex="0"]')!;

        fireEvent.click(cell(container));
        fireEvent.keyDown(grid, {key: 'Enter'});

        await expectReadOnlyViewer();
    });

    it('opens generated JSON columns in the read-only viewer', async () => {
        const {container} = render(
            <DataGrid
                columns={['id', 'payload']}
                data={[[1, payload]]}
                columnMetadata={[
                    {
                        name: 'id',
                        data_type: 'integer',
                        is_pk: true,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                    {
                        name: 'payload',
                        data_type: 'jsonb',
                        is_pk: false,
                        is_nullable: true,
                        is_auto_increment: false,
                        is_generated: true,
                    },
                ]}
                tableName="events"
                pkColumns={['id']}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.doubleClick(container.querySelector('td[data-col-index="1"]')!);

        await waitFor(() =>
            expect(openJsonViewerMock).toHaveBeenCalledWith(
                {
                    value: payload,
                    originalValue: payload,
                    columnName: 'payload',
                    rowLabel: 'id=1',
                    readOnly: true,
                    cellKey: 'pk:{"id":1}:payload',
                },
                undefined,
                undefined,
            ),
        );
        expect(openRowEditorMock).not.toHaveBeenCalled();
    });

    it('does not open the editable row sidebar for read-only blob cells', () => {
        const {container} = render(
            <DataGrid
                columns={['payload']}
                data={[['BLOB:3:application/octet-stream:AQID']]}
                columnMetadata={[
                    {
                        name: 'payload',
                        data_type: 'bytea',
                        is_pk: false,
                        is_nullable: true,
                        is_auto_increment: false,
                    },
                ]}
                tableName="events"
                pkColumns={['id']}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        fireEvent.doubleClick(cell(container));

        expect(openRowEditorMock).not.toHaveBeenCalled();
        expect(openJsonViewerMock).not.toHaveBeenCalled();
    });

    it("opens the row editor with the tab's own schema/database, not the connection's global active schema", () => {
        render(
            <DataGrid
                columns={['id']}
                data={[[1]]}
                tableName="orders"
                connectionId="conn-1"
                schema="sales"
                database="analytics"
                pkColumns={['id']}
                selectedRows={new Set([0])}
                onSelectionChange={vi.fn()}
            />,
        );

        act(() => {
            window.dispatchEvent(new Event('tabularis:toggle-right-sidebar'));
        });

        expect(openRowEditorMock).toHaveBeenCalledWith(
            expect.objectContaining({schema: 'sales', database: 'analytics'}),
        );
    });
});

describe('DataGrid keyboard navigation', () => {
    // The row virtualizer sizes its viewport from offsetWidth/offsetHeight, which
    // JSDOM always reports as zero — without a height no rows would be rendered.
    beforeAll(() => {
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
    });
    afterAll(() => {
        vi.restoreAllMocks();
    });

    const renderGrid = () =>
        render(
            <DataGrid
                columns={['id', 'name']}
                data={[
                    [1, 'Alice'],
                    [2, 'Bob'],
                    [3, 'Carol'],
                ]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

    const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
        container.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;

    const gridOf = (container: HTMLElement) => container.querySelector('div[tabindex="0"]')!;

    const renderJumpGrid = (onMarkForDeletion?: (pkVal: unknown) => void) =>
        render(
            <KeybindingsContext.Provider
                value={{
                    shortcuts: [],
                    matchesShortcut: (event, id) =>
                        id === 'jump_to_column' &&
                        event.ctrlKey &&
                        event.shiftKey &&
                        event.key.toLowerCase() === 'j',
                    saveOverride: async () => {},
                    resetOverride: async () => {},
                    overrides: {},
                    isMac: false,
                }}
            >
                <DataGrid
                    columns={['id', 'customer_name', 'email']}
                    data={[[1, 'Alice', 'alice@example.com']]}
                    columnMetadata={[
                        {
                            name: 'customer_name',
                            data_type: 'varchar',
                            is_pk: false,
                            is_nullable: false,
                            is_auto_increment: false,
                        },
                    ]}
                    pkColumns={onMarkForDeletion ? ['id'] : undefined}
                    selectedRows={onMarkForDeletion ? new Set([0]) : undefined}
                    onMarkForDeletion={onMarkForDeletion}
                    readonly={!onMarkForDeletion}
                />
            </KeybindingsContext.Provider>,
        );

    it('finds a column by keyboard and focuses its cell', async () => {
        const {container} = renderJumpGrid();
        const grid = gridOf(container);
        fireEvent.keyDown(grid, {key: 'J', ctrlKey: true, shiftKey: true});

        const search = screen.getByRole('combobox', {name: 'dataGrid.searchColumns'});
        expect(search).toHaveFocus();
        fireEvent.change(search, {target: {value: 'cust name'}});
        expect(screen.getByRole('option', {name: /customer_name.*varchar/})).toBeInTheDocument();
        fireEvent.keyDown(search, {key: 'Enter'});

        await waitFor(() => expect(cellAt(container, 0, 1)).toHaveClass('ring-2'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(grid).toHaveFocus();
    });

    it('returns focus to the grid when Escape closes the picker', () => {
        const {container} = renderJumpGrid();
        const grid = gridOf(container);
        fireEvent.keyDown(grid, {key: 'j', ctrlKey: true, shiftKey: true});
        fireEvent.keyDown(screen.getByRole('combobox'), {key: 'Escape'});
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(grid).toHaveFocus();
    });

    it('leaves native copy available in the picker search field', () => {
        const {container} = renderJumpGrid();
        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(gridOf(container), {key: 'j', ctrlKey: true, shiftKey: true});
        const search = screen.getByRole('combobox');
        fireEvent.change(search, {target: {value: 'customer'}});
        expect(fireEvent.keyDown(search, {key: 'c', ctrlKey: true})).toBe(true);
    });

    it('does not stage selected rows for deletion from the picker search', () => {
        const onMarkForDeletion = vi.fn();
        const {container} = renderJumpGrid(onMarkForDeletion);
        const grid = gridOf(container);
        fireEvent.keyDown(grid, {key: 'j', ctrlKey: true, shiftKey: true});
        const search = screen.getByRole('combobox', {name: 'dataGrid.searchColumns'});
        fireEvent.change(search, {target: {value: 'customer'}});

        // Native editing keys must not reach the document-level row deletion handler.
        expect(fireEvent.keyDown(search, {key: 'Backspace'})).toBe(true);
        expect(fireEvent.keyDown(search, {key: 'Delete'})).toBe(true);
        expect(onMarkForDeletion).not.toHaveBeenCalled();

        // The keyboard row deletion shortcut still works from the grid itself.
        fireEvent.keyDown(search, {key: 'Escape'});
        fireEvent.keyDown(grid, {key: 'Backspace'});
        expect(onMarkForDeletion).toHaveBeenCalledTimes(1);
    });

    it('focuses the first cell on the first arrow key press', () => {
        const {container} = renderGrid();

        fireEvent.keyDown(gridOf(container), {key: 'ArrowDown'});

        expect(cellAt(container, 0, 0)).toHaveClass('ring-2');
    });

    it('focuses the grid container on cell click so key events reach it', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 0, 0));

        expect(gridOf(container)).toHaveFocus();
    });

    it('moves the focused cell with the arrow keys', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(gridOf(container), {key: 'ArrowDown'});
        fireEvent.keyDown(gridOf(container), {key: 'ArrowRight'});

        expect(cellAt(container, 1, 1)).toHaveClass('ring-2');
        expect(cellAt(container, 0, 0)).not.toHaveClass('ring-2');
    });

    it('clamps navigation at the grid edges', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(gridOf(container), {key: 'ArrowUp'});
        fireEvent.keyDown(gridOf(container), {key: 'ArrowLeft'});

        expect(cellAt(container, 0, 0)).toHaveClass('ring-2');
    });

    it('jumps to the row edges with Home and End', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 1, 0));
        fireEvent.keyDown(gridOf(container), {key: 'End'});
        expect(cellAt(container, 1, 1)).toHaveClass('ring-2');

        fireEvent.keyDown(gridOf(container), {key: 'Home'});
        expect(cellAt(container, 1, 0)).toHaveClass('ring-2');
    });

    it('ignores navigation keys while Alt is held', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(gridOf(container), {key: 'ArrowDown', altKey: true});

        expect(cellAt(container, 0, 0)).toHaveClass('ring-2');
    });

    it('Cmd/Ctrl+Arrow jumps the focused cell to the grid edge', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(gridOf(container), {key: 'ArrowDown', metaKey: true});
        expect(cellAt(container, 2, 0)).toHaveClass('ring-2');

        fireEvent.keyDown(gridOf(container), {key: 'ArrowRight', ctrlKey: true});
        expect(cellAt(container, 2, 1)).toHaveClass('ring-2');

        fireEvent.keyDown(gridOf(container), {key: 'Home', ctrlKey: true});
        expect(cellAt(container, 0, 0)).toHaveClass('ring-2');
    });

    it('Cmd/Ctrl+Arrow without a focused cell is left to the page-level shortcuts', () => {
        const {container} = renderGrid();

        fireEvent.keyDown(gridOf(container), {key: 'ArrowRight', ctrlKey: true});

        expect(container.querySelector('td.ring-2')).toBeNull();
    });

    it('Shift+Arrow extends a cell range from the focused anchor', () => {
        const {container} = renderGrid();

        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(gridOf(container), {key: 'ArrowDown', shiftKey: true});
        fireEvent.keyDown(gridOf(container), {key: 'ArrowRight', shiftKey: true});

        expect(cellAt(container, 0, 0)).toHaveClass('bg-accent-primary/15');
        expect(cellAt(container, 1, 1)).toHaveClass('bg-accent-primary/15');
        expect(cellAt(container, 2, 0)).not.toHaveClass('bg-accent-primary/15');

        // Ctrl+Shift+Arrow extends to the edge.
        fireEvent.keyDown(gridOf(container), {
            key: 'ArrowDown',
            shiftKey: true,
            ctrlKey: true,
        });
        expect(cellAt(container, 2, 1)).toHaveClass('bg-accent-primary/15');
    });

    it('Shift+Space selects the row(s) and Cmd/Ctrl+Space the column(s) of the focused cell', () => {
        const onSelectionChange = vi.fn();
        const {container} = render(
            <DataGrid
                columns={['id', 'name']}
                data={[
                    [1, 'Alice'],
                    [2, 'Bob'],
                ]}
                selectedRows={new Set()}
                onSelectionChange={onSelectionChange}
                readonly
            />,
        );

        fireEvent.click(cellAt(container, 1, 0));
        fireEvent.keyDown(gridOf(container), {key: ' ', shiftKey: true});
        expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([1]));

        fireEvent.keyDown(gridOf(container), {key: ' ', ctrlKey: true});
        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');
        expect(container.querySelectorAll('th')[2]).not.toHaveClass('bg-accent-primary/20');

        // Ctrl+Shift+Space is the IME-safe alternative for column selection.
        fireEvent.click(cellAt(container, 1, 1));
        fireEvent.keyDown(gridOf(container), {
            key: ' ',
            ctrlKey: true,
            shiftKey: true,
        });
        expect(container.querySelectorAll('th')[2]).toHaveClass('bg-accent-primary/20');
    });

    it('leaves keys to focusable controls inside the grid', () => {
        const {container} = render(
            <DataGrid
                columns={['id', 'name']}
                data={[
                    [1, 'Alice'],
                    [2, 'Bob'],
                ]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                onSort={vi.fn()}
                readonly
            />,
        );

        fireEvent.click(cellAt(container, 0, 0));
        fireEvent.keyDown(container.querySelector('[role="button"]')!, {
            key: 'ArrowDown',
        });

        expect(cellAt(container, 0, 0)).toHaveClass('ring-2');
    });
});

describe('DataGrid keyboard editing', () => {
    beforeAll(() => {
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
    });
    afterAll(() => {
        vi.restoreAllMocks();
    });

    const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
        container.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;

    const gridOf = (container: HTMLElement) => container.querySelector('div[tabindex="0"]')!;

    const renderEditableGrid = (
        pendingChanges?: Record<
            string,
            {pkOriginalValue: unknown; changes: Record<string, unknown>}
        >,
    ) =>
        render(
            <DataGrid
                columns={['id', 'name']}
                data={[
                    [1, 'Alice'],
                    [2, 'Bob'],
                ]}
                tableName="users"
                pkColumns={['id']}
                columnMetadata={[
                    {
                        name: 'id',
                        data_type: 'integer',
                        is_pk: true,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                    {
                        name: 'name',
                        data_type: 'character varying(255)',
                        is_pk: false,
                        is_nullable: true,
                        is_auto_increment: false,
                    },
                ]}
                pendingChanges={pendingChanges}
                onPendingChange={vi.fn()}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

    it('opens the editor on Enter and returns focus to the grid on Escape', () => {
        const {container} = renderEditableGrid();

        fireEvent.click(cellAt(container, 0, 1));
        fireEvent.keyDown(gridOf(container), {key: 'Enter'});

        const editor = container.querySelector('textarea')!;
        expect(editor).toBeInTheDocument();

        fireEvent.keyDown(editor, {key: 'Escape'});

        expect(container.querySelector('textarea')).toBeNull();
        expect(gridOf(container)).toHaveFocus();
    });

    it('reports editing immediately and releases the block on cancel and unmount', async () => {
        const ref = createRef<DataGridCommandTarget>();
        const onEditingChange = vi.fn();
        const onPendingChange = vi.fn();
        const {container, unmount} = render(
            <DataGrid
                ref={ref}
                columns={['id', 'name']}
                data={[[1, 'Alice']]}
                tableName="users"
                pkColumns={['id']}
                onPendingChange={onPendingChange}
                onEditingChange={onEditingChange}
            />,
        );
        fireEvent.doubleClick(cellAt(container, 0, 1));
        expect(ref.current?.isEditing()).toBe(true);
        expect(onEditingChange).toHaveBeenLastCalledWith(true);
        fireEvent.keyDown(container.querySelector('textarea')!, {key: 'Escape'});
        expect(ref.current?.isEditing()).toBe(false);
        expect(onEditingChange).toHaveBeenLastCalledWith(false);
        await act(async () => {});
        expect(onPendingChange).not.toHaveBeenCalled();
        fireEvent.doubleClick(cellAt(container, 0, 1));
        unmount();
        expect(onEditingChange).toHaveBeenLastCalledWith(false);
    });

    it('blocks refresh while the expanded text editor is open', () => {
        const ref = createRef<DataGridCommandTarget>();
        const onEditingChange = vi.fn();
        render(
            <DataGrid
                ref={ref}
                columns={['id', 'description']}
                data={[[1, 'long description '.repeat(20)]]}
                tableName="jobs"
                pkColumns={['id']}
                columnMetadata={[
                    {
                        name: 'description',
                        data_type: 'text',
                        is_pk: false,
                        is_nullable: true,
                        is_auto_increment: false,
                    },
                ]}
                onPendingChange={vi.fn()}
                onEditingChange={onEditingChange}
            />,
        );
        fireEvent.click(screen.getByRole('button', {name: 'textCell.expand'}));
        expect(ref.current?.isEditing()).toBe(true);
        expect(onEditingChange).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));
        expect(ref.current?.isEditing()).toBe(false);
        expect(onEditingChange).toHaveBeenLastCalledWith(false);
    });

    it('releases the row-editor block when the sidebar closes', () => {
        const ref = createRef<DataGridCommandTarget>();
        const onEditingChange = vi.fn();
        const grid = () => (
            <DataGrid ref={ref} columns={['id']} data={[[1]]} onEditingChange={onEditingChange} />
        );
        try {
            sidebarState.isOpen = true;
            sidebarState.activePanel = 'row-editor';
            const {rerender} = render(grid());
            expect(ref.current?.isEditing()).toBe(true);
            sidebarState.isOpen = false;
            rerender(grid());
            expect(ref.current?.isEditing()).toBe(false);
            expect(onEditingChange).toHaveBeenLastCalledWith(false);
        } finally {
            sidebarState.isOpen = false;
            sidebarState.activePanel = null;
        }
    });

    it('opens an empty editor for a cell pending the database DEFAULT', () => {
        const pkVal = serializePkKey(buildPkMap(['id'], [1, 'Alice'], [0]));
        const {container} = renderEditableGrid({
            [pkVal]: {
                pkOriginalValue: 1,
                changes: {name: USE_DEFAULT_SENTINEL},
            },
        });

        fireEvent.click(cellAt(container, 0, 1));
        fireEvent.keyDown(gridOf(container), {key: 'Enter'});

        expect(container.querySelector('textarea')).toHaveValue('');
    });

    it('commits the prefilled date of an empty date cell once on Enter (#826)', () => {
        vi.useFakeTimers({toFake: ['Date']});
        vi.setSystemTime(new Date(2026, 8, 27, 15, 30, 0));
        try {
            const onPendingChange = vi.fn();
            const {container} = render(
                <DataGrid
                    columns={['id', 'due']}
                    data={[[1, null]]}
                    tableName="tasks"
                    pkColumns={['id']}
                    columnMetadata={[
                        {
                            name: 'id',
                            data_type: 'integer',
                            is_pk: true,
                            is_nullable: false,
                            is_auto_increment: false,
                        },
                        {
                            name: 'due',
                            data_type: 'date',
                            is_pk: false,
                            is_nullable: true,
                            is_auto_increment: false,
                        },
                    ]}
                    onPendingChange={onPendingChange}
                    selectedRows={new Set()}
                    onSelectionChange={vi.fn()}
                />,
            );

            fireEvent.click(cellAt(container, 0, 1));
            fireEvent.keyDown(gridOf(container), {key: 'Enter'});
            fireEvent.keyDown(container.querySelector('td select')!, {key: 'Enter'});

            expect(onPendingChange).toHaveBeenCalledTimes(1);
            expect(onPendingChange).toHaveBeenCalledWith({id: 1}, 'due', '2026-09-27');
            expect(gridOf(container)).toHaveFocus();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('DataGrid select all', () => {
    const columns = ['id', 'name'];
    const data: unknown[][] = [
        [1, 'Alice'],
        [2, 'Bob'],
    ];

    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        writeText.mockClear();
        showToastMock.mockClear();
        translationMock.mockClear();
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });
    });

    it('copies pending insertions with all loaded rows', async () => {
        const commandTargetRef = createRef<DataGridCommandTarget>();
        render(
            <DataGrid
                ref={commandTargetRef}
                columns={columns}
                data={[[1, 'Alice']]}
                pendingInsertions={{
                    pending: {
                        tempId: 'pending',
                        data: {id: 2, name: 'Pending'},
                        displayIndex: 1,
                    },
                }}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        const command = commandTargetRef.current?.getResultCommands().copyAllRows;
        expect(command?.count).toBe(2);
        await act(async () => {
            await command?.execute();
        });

        expect(writeText).toHaveBeenCalledOnce();
        expect(writeText.mock.calls[0][0]).toContain('Alice');
        expect(writeText.mock.calls[0][0]).toContain('Pending');
    });

    it('copies pending insertions with selected columns', async () => {
        const commandTargetRef = createRef<DataGridCommandTarget>();
        render(
            <DataGrid
                ref={commandTargetRef}
                columns={columns}
                data={[[1, 'Alice']]}
                pendingInsertions={{
                    pending: {
                        tempId: 'pending',
                        data: {id: 2, name: 'Pending'},
                        displayIndex: 1,
                    },
                }}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByText('name'), {metaKey: true});
        const command = commandTargetRef.current?.getResultCommands().copySelectedColumns;
        await act(async () => {
            await command?.execute();
        });

        expect(writeText).toHaveBeenCalledOnce();
        expect(writeText.mock.calls[0][0]).toContain('Alice');
        expect(writeText.mock.calls[0][0]).toContain('Pending');
        expect(translationMock).toHaveBeenCalledWith('dataGrid.copiedRows', {
            count: 2,
        });
    });

    it('copies pending insertion values as a SQL IN clause', async () => {
        const commandTargetRef = createRef<DataGridCommandTarget>();
        render(
            <DataGrid
                ref={commandTargetRef}
                columns={columns}
                data={[[1, 'Alice']]}
                pendingInsertions={{
                    pending: {
                        tempId: 'pending',
                        data: {id: 2, name: 'Pending'},
                        displayIndex: 1,
                    },
                }}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByText('name'), {metaKey: true});
        const command = commandTargetRef.current?.getResultCommands().copyColumnValuesAsSqlIn;
        await act(async () => {
            await command?.execute();
        });

        expect(writeText).toHaveBeenCalledOnce();
        expect(writeText.mock.calls[0][0]).toContain("'Alice'");
        expect(writeText.mock.calls[0][0]).toContain("'Pending'");
    });

    it('copies selected pending insertions from the row context menu', async () => {
        const {container} = render(
            <DataGrid
                columns={columns}
                data={[[1, 'Alice']]}
                pendingInsertions={{
                    pending: {
                        tempId: 'pending',
                        data: {id: 2, name: 'Pending'},
                        displayIndex: 1,
                    },
                }}
                selectedRows={new Set([0, 1])}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelector('td[data-col-index="0"]')!);
        fireEvent.click(await screen.findByText('dataGrid.copySelectedN'));

        await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
        expect(writeText.mock.calls[0][0]).toContain('Alice');
        expect(writeText.mock.calls[0][0]).toContain('Pending');
    });

    it('copies pending insertion values from the column context menu', async () => {
        const {container} = render(
            <DataGrid
                columns={columns}
                data={[[1, 'Alice']]}
                pendingInsertions={{
                    pending: {
                        tempId: 'pending',
                        data: {id: 2, name: 'Pending'},
                        displayIndex: 1,
                    },
                }}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelectorAll('th')[2]);
        fireEvent.click(await screen.findByText('dataGrid.copyColumnValues'));

        await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
        expect(writeText.mock.calls[0][0]).toContain('Alice');
        expect(writeText.mock.calls[0][0]).toContain('Pending');
    });

    it('copies the selected rows as an HTML table with a plain-text fallback', async () => {
        writeHtmlMock.mockReset().mockResolvedValue(undefined);
        const {container} = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set([0, 1])}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelector('td[data-col-index="0"]')!);
        fireEvent.click(await screen.findByText('dataGrid.copyAsHtmlTable'));

        await waitFor(() => expect(writeHtmlMock).toHaveBeenCalledOnce());
        const [html, plainText] = writeHtmlMock.mock.calls[0];
        expect(html).toContain('<table>');
        expect(html).toContain('<th>name</th>');
        expect(html).toContain('<td>Alice</td>');
        expect(html).toContain('<td>Bob</td>');
        expect(plainText).toContain('Alice');
        expect(plainText).toContain('Bob');
        expect(writeText).not.toHaveBeenCalled();
        expect(showToastMock).toHaveBeenCalledWith(expect.anything(), {
            kind: 'success',
        });
    });

    it('copies only the right-clicked row as HTML when nothing is selected', async () => {
        writeHtmlMock.mockReset().mockResolvedValue(undefined);
        const {container} = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelectorAll('td[data-col-index="1"]')[1]!);
        fireEvent.click(await screen.findByText('dataGrid.copyAsHtmlTable'));

        await waitFor(() => expect(writeHtmlMock).toHaveBeenCalledOnce());
        const [html] = writeHtmlMock.mock.calls[0];
        expect(html).toContain('<td>Bob</td>');
        expect(html).not.toContain('Alice');
    });

    it('selects all loaded rows with Cmd/Ctrl+A without copying', () => {
        const onSelectionChange = vi.fn();
        const {container} = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={onSelectionChange}
                readonly
            />,
        );

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'a', metaKey: true});

        expect(onSelectionChange).toHaveBeenCalledWith(new Set([0, 1]));
        // Selecting never touches the clipboard — copying is a separate action.
        expect(writeText).not.toHaveBeenCalled();
    });

    it('copies the selected rows with Cmd/Ctrl+C', async () => {
        const Harness = () => {
            const [selected, setSelected] = useState<Set<number>>(new Set());
            return (
                <DataGrid
                    columns={columns}
                    data={data}
                    selectedRows={selected}
                    onSelectionChange={setSelected}
                    readonly
                />
            );
        };
        const {container} = render(<Harness />);

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'a', metaKey: true});
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        expect(writeText).toHaveBeenCalled();
        expect(writeText.mock.calls[0][0]).toContain('Alice');
        await waitFor(() =>
            expect(showToastMock).toHaveBeenCalledWith('dataGrid.copiedRows', {
                kind: 'success',
            }),
        );
    });

    it('copies pending insertions when selected with Cmd/Ctrl+A', async () => {
        const Harness = () => {
            const [selected, setSelected] = useState<Set<number>>(new Set());
            return (
                <DataGrid
                    columns={columns}
                    data={[[1, 'Alice']]}
                    pendingInsertions={{
                        pending: {
                            tempId: 'pending',
                            data: {id: 2, name: 'Pending'},
                            displayIndex: 1,
                        },
                    }}
                    selectedRows={selected}
                    onSelectionChange={setSelected}
                    readonly
                />
            );
        };
        const {container} = render(<Harness />);

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'a', metaKey: true});
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
        expect(writeText.mock.calls[0][0]).toContain('Alice');
        expect(writeText.mock.calls[0][0]).toContain('Pending');
    });

    it('ignores Cmd/Ctrl+A when the grid was not interacted with', () => {
        const onSelectionChange = vi.fn();
        render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={onSelectionChange}
                readonly
            />,
        );

        fireEvent.keyDown(document, {key: 'a', metaKey: true});

        expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('ignores Cmd/Ctrl+A coming from editable targets', () => {
        const onSelectionChange = vi.fn();
        const {container} = render(
            <>
                <input data-testid="external-input" />
                <DataGrid
                    columns={columns}
                    data={data}
                    selectedRows={new Set()}
                    onSelectionChange={onSelectionChange}
                    readonly
                />
            </>,
        );

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(screen.getByTestId('external-input'), {
            key: 'a',
            metaKey: true,
        });

        expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('toggles select all via the # header cell', () => {
        const calls: Set<number>[] = [];
        const Harness = () => {
            const [selected, setSelected] = useState<Set<number>>(new Set());
            return (
                <DataGrid
                    columns={columns}
                    data={data}
                    selectedRows={selected}
                    onSelectionChange={(next: Set<number>) => {
                        calls.push(next);
                        setSelected(next);
                    }}
                    readonly
                />
            );
        };
        const {container} = render(<Harness />);

        const headerCell = container.querySelector('th')!;
        fireEvent.click(headerCell);
        expect(calls[0]).toEqual(new Set([0, 1]));

        fireEvent.click(headerCell);
        expect(calls[1]).toEqual(new Set());
    });

    it('offers Select All in the row context menu', async () => {
        const onSelectionChange = vi.fn();
        render(
            <DataGrid
                columns={columns}
                data={data}
                tableName="users"
                selectedRows={new Set()}
                onSelectionChange={onSelectionChange}
                readonly
            />,
        );

        fireEvent.contextMenu(screen.getByText('Alice'));

        const item = await screen.findByText('dataGrid.selectAllN');
        fireEvent.click(item);

        expect(onSelectionChange).toHaveBeenCalledWith(new Set([0, 1]));
    });

    it('offers Copy All with the total count when rows are unloaded', async () => {
        const onCopyAllRows = vi.fn();
        render(
            <DataGrid
                columns={columns}
                data={data}
                tableName="users"
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                totalRows={10}
                onCopyAllRows={onCopyAllRows}
                readonly
            />,
        );

        fireEvent.contextMenu(screen.getByText('Alice'));

        // Both scopes are explicit in the menu: the selection and the full result.
        expect(await screen.findByText('dataGrid.copySelectedN')).toBeTruthy();

        const item = await screen.findByText('dataGrid.copyAllRows');
        fireEvent.click(item);

        expect(onCopyAllRows).toHaveBeenCalled();
    });

    it('offers Copy All without a count when the total is unknown', async () => {
        const onCopyAllRows = vi.fn();
        render(
            <DataGrid
                columns={columns}
                data={data}
                tableName="users"
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                totalRows={null}
                hasMore
                onCopyAllRows={onCopyAllRows}
                readonly
            />,
        );

        fireEvent.contextMenu(screen.getByText('Alice'));

        const item = await screen.findByText('dataGrid.copyAll');
        fireEvent.click(item);

        expect(onCopyAllRows).toHaveBeenCalled();
    });

    it('copies a full-page selection instantly and reports N of M in the toast', async () => {
        const onCopyAllRows = vi.fn();
        const Harness = () => {
            const [selected, setSelected] = useState<Set<number>>(new Set());
            return (
                <DataGrid
                    columns={columns}
                    data={data}
                    selectedRows={selected}
                    onSelectionChange={setSelected}
                    totalRows={10}
                    onCopyAllRows={onCopyAllRows}
                    readonly
                />
            );
        };
        const {container} = render(<Harness />);

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'a', metaKey: true});

        // Selecting alone never copies.
        expect(writeText).not.toHaveBeenCalled();

        // Copying is instant — no dialog, no copy-all fetch. The toast states
        // "loaded of total" so a page-only copy is never silent.
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(onCopyAllRows).not.toHaveBeenCalled();
        await waitFor(() =>
            expect(showToastMock).toHaveBeenCalledWith('dataGrid.copiedRowsOfTotal', {
                kind: 'success',
            }),
        );
    });
});

describe('DataGrid column selection', () => {
    const columns = ['id', 'name'];
    const data: unknown[][] = [
        [1, 'Alice'],
        [2, 'Bob'],
    ];

    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        writeText.mockClear();
        showToastMock.mockClear();
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });
    });

    const renderGrid = (onSort = vi.fn()) => {
        const utils = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                onSort={onSort}
                readonly
            />,
        );
        return {...utils, onSort};
    };

    it('Cmd/Ctrl+click toggles a column without sorting', () => {
        const {container, onSort} = renderGrid();

        fireEvent.click(screen.getByText('id'), {metaKey: true});

        expect(onSort).not.toHaveBeenCalled();
        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');

        fireEvent.click(screen.getByText('id'), {metaKey: true});
        expect(container.querySelectorAll('th')[1]).not.toHaveClass('bg-accent-primary/20');
    });

    it('plain header click selects a single column; sorting is on the sort button', () => {
        const {container, onSort} = renderGrid();

        fireEvent.click(screen.getByText('id'));
        expect(onSort).not.toHaveBeenCalled();
        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');

        // Plain click replaces the selection instead of adding to it.
        fireEvent.click(screen.getByText('name'));
        expect(container.querySelectorAll('th')[1]).not.toHaveClass('bg-accent-primary/20');
        expect(container.querySelectorAll('th')[2]).toHaveClass('bg-accent-primary/20');

        fireEvent.click(screen.getAllByLabelText('dataGrid.sortByAsc')[0]);
        expect(onSort).toHaveBeenCalledWith('id');
    });

    it('copies only the selected columns with Cmd/Ctrl+C', async () => {
        renderGrid();

        fireEvent.click(screen.getByText('id'), {metaKey: true});
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied).toContain('id');
        expect(copied).not.toContain('Alice');
        await waitFor(() =>
            expect(showToastMock).toHaveBeenCalledWith('dataGrid.copiedRows', {
                kind: 'success',
            }),
        );
    });

    it('Shift+click range-selects columns from the anchor', async () => {
        renderGrid();

        fireEvent.click(screen.getByText('id'), {metaKey: true});
        fireEvent.click(screen.getByText('name'), {shiftKey: true});
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied).toContain('Alice');
    });

    it('row selection clears column selection and vice versa', () => {
        const {container} = renderGrid();

        fireEvent.click(screen.getByText('id'), {metaKey: true});
        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');

        // Click the row-number cell of the first row → column selection clears.
        fireEvent.click(container.querySelector('tbody tr td')!);
        expect(container.querySelectorAll('th')[1]).not.toHaveClass('bg-accent-primary/20');
    });

    it('header context menu offers select column and copy selected columns', async () => {
        const {container} = renderGrid();

        fireEvent.contextMenu(container.querySelectorAll('th')[1]);
        fireEvent.click(await screen.findByText('dataGrid.selectColumn'));
        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');

        fireEvent.contextMenu(container.querySelectorAll('th')[1]);
        const item = await screen.findByText('dataGrid.copySelectedColumns');
        fireEvent.click(item);

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied).not.toContain('Alice');
    });

    it('Ctrl+click on macOS (contextmenu event) toggles the column without opening the menu', () => {
        const {container} = renderGrid();

        // macOS turns Ctrl+click into a contextmenu event on the header.
        fireEvent.contextMenu(container.querySelectorAll('th')[1], {
            ctrlKey: true,
        });

        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');
        expect(screen.queryByText('dataGrid.copyColumnName')).toBeNull();
    });
});

describe('DataGrid cell range selection', () => {
    const columns = ['id', 'name', 'city'];
    const data: unknown[][] = [
        [1, 'Alice', 'Portland'],
        [2, 'Bob', 'Seattle'],
        [3, 'Cara', 'Denver'],
    ];

    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        writeText.mockClear();
        showToastMock.mockClear();
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });
    });

    const renderGrid = (tableName?: string) =>
        render(
            <DataGrid
                columns={columns}
                data={data}
                tableName={tableName}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

    it('Shift+click extends a rectangular range from the focused cell', () => {
        renderGrid();

        fireEvent.click(screen.getByText('Alice'));
        fireEvent.click(screen.getByText('Seattle'), {shiftKey: true});

        // Range rows 0-1 × cols 1-2 highlighted; outside cells are not.
        expect(screen.getByText('Alice').closest('td')).toHaveClass('bg-accent-primary/15');
        expect(screen.getByText('Seattle').closest('td')).toHaveClass('bg-accent-primary/15');
        expect(screen.getByText('Cara').closest('td')).not.toHaveClass('bg-accent-primary/15');
        expect(screen.getByText('Denver').closest('td')).not.toHaveClass('bg-accent-primary/15');
    });

    it('copies only the range with Cmd/Ctrl+C', async () => {
        renderGrid();

        fireEvent.click(screen.getByText('Alice'));
        fireEvent.click(screen.getByText('Seattle'), {shiftKey: true});
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied.startsWith('name,city')).toBe(true);
        expect(copied).toContain('Alice,Portland');
        expect(copied).toContain('Bob,Seattle');
        expect(copied).not.toContain('Cara');
        await waitFor(() =>
            expect(showToastMock).toHaveBeenCalledWith('dataGrid.copiedCells', {
                kind: 'success',
            }),
        );
    });

    it('is mutually exclusive with column selection', () => {
        const {container} = renderGrid();

        fireEvent.click(screen.getByText('id'), {metaKey: true});
        expect(container.querySelectorAll('th')[1]).toHaveClass('bg-accent-primary/20');

        fireEvent.click(screen.getByText('Alice'));
        fireEvent.click(screen.getByText('Seattle'), {shiftKey: true});

        expect(container.querySelectorAll('th')[1]).not.toHaveClass('bg-accent-primary/20');
        expect(screen.getByText('Seattle').closest('td')).toHaveClass('bg-accent-primary/15');
    });

    it('plain click clears the range and moves the anchor', async () => {
        renderGrid();

        fireEvent.click(screen.getByText('Alice'));
        fireEvent.click(screen.getByText('Seattle'), {shiftKey: true});
        expect(screen.getByText('Seattle').closest('td')).toHaveClass('bg-accent-primary/15');

        fireEvent.click(screen.getByText('Cara'));
        expect(screen.getByText('Seattle').closest('td')).not.toHaveClass('bg-accent-primary/15');

        // New anchor: Shift+click now ranges from Cara's row only.
        fireEvent.click(screen.getByText('Denver'), {shiftKey: true});
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied).toContain('Cara,Denver');
        expect(copied).not.toContain('Alice');
    });

    it('offers Copy Range in the row context menu', async () => {
        renderGrid('users');

        fireEvent.click(screen.getByText('Alice'));
        fireEvent.click(screen.getByText('Seattle'), {shiftKey: true});

        fireEvent.contextMenu(screen.getByText('Portland'));
        fireEvent.click(await screen.findByText('dataGrid.copyRangeN'));

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied).toContain('Alice,Portland');
        expect(copied).not.toContain('Cara');
    });
});

describe('DataGrid JSON context menu', () => {
    beforeEach(() => {
        openJsonViewerMock.mockReset();
        openJsonViewerMock.mockResolvedValue(undefined);
    });

    it('opens value-detected JSON cells in read-only grids without metadata', async () => {
        const payload = {status: 'ok'};
        const {container} = render(
            <DataGrid
                columns={['payload']}
                data={[[payload]]}
                tableName={null}
                pkColumns={null}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        fireEvent.contextMenu(container.querySelector('td[data-col-index="0"]')!);
        const openJsonItem = await screen.findByText('contextMenu.openJsonEditor');
        expect(screen.queryByText('dataGrid.setNull')).toBeNull();
        expect(screen.queryByText('contextMenu.openSidebar')).toBeNull();
        fireEvent.click(openJsonItem);

        await waitFor(() =>
            expect(openJsonViewerMock).toHaveBeenCalledWith(
                {
                    value: payload,
                    originalValue: payload,
                    columnName: 'payload',
                    rowLabel: 'Row 1',
                    readOnly: true,
                    cellKey: null,
                },
                undefined,
                undefined,
            ),
        );
    });

    it('opens value-detected JSON cells in tableless query results', async () => {
        const payload = {status: 'ok'};
        const {container} = render(
            <DataGrid
                columns={['payload']}
                data={[[payload]]}
                tableName={null}
                pkColumns={null}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelector('td[data-col-index="0"]')!);
        const openJsonItem = await screen.findByText('contextMenu.openJsonEditor');
        expect(screen.queryByText('dataGrid.setNull')).toBeNull();
        expect(screen.queryByText('dataGrid.pasteCells')).toBeNull();
        expect(screen.queryByText('contextMenu.openSidebar')).toBeNull();
        fireEvent.click(openJsonItem);

        await waitFor(() =>
            expect(openJsonViewerMock).toHaveBeenCalledWith(
                {
                    value: payload,
                    originalValue: payload,
                    columnName: 'payload',
                    rowLabel: 'Row 1',
                    readOnly: true,
                    cellKey: null,
                },
                undefined,
                undefined,
            ),
        );
    });
});

describe('DataGrid UUID context menu', () => {
    it('stages a new UUID v4 for editable UUID columns', async () => {
        const onPendingChange = vi.fn();
        const {container} = render(
            <DataGrid
                columns={['id', 'token']}
                data={[[1, 'old-token']]}
                tableName="users"
                pkColumns={['id']}
                columnMetadata={[
                    {
                        name: 'id',
                        data_type: 'integer',
                        is_pk: true,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                    {
                        name: 'token',
                        data_type: 'UUID',
                        is_pk: false,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                ]}
                onPendingChange={onPendingChange}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelector('td[data-col-index="1"]')!);
        fireEvent.click(await screen.findByText('dataGrid.setRandomUuid'));

        expect(onPendingChange).toHaveBeenCalledOnce();
        const [pkValue, columnName, value] = onPendingChange.mock.calls[0];
        expect(pkValue).toEqual({id: 1});
        expect(columnName).toBe('token');
        expect(value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it('stages a UUID on a pending insertion row', async () => {
        const onPendingInsertionChange = vi.fn();
        const {container} = render(
            <DataGrid
                columns={['id', 'token']}
                data={[[1, 'existing-token']]}
                tableName="users"
                pkColumns={['id']}
                pendingInsertions={{
                    pending: {
                        tempId: 'pending',
                        data: {id: 2, token: null},
                        displayIndex: 1,
                    },
                }}
                columnMetadata={[
                    {
                        name: 'id',
                        data_type: 'integer',
                        is_pk: true,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                    {
                        name: 'token',
                        data_type: 'uuid',
                        is_pk: false,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                ]}
                onPendingInsertionChange={onPendingInsertionChange}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(
            container.querySelector('tr[data-row-index="1"] td[data-col-index="1"]')!,
        );
        fireEvent.click(await screen.findByText('dataGrid.setRandomUuid'));

        expect(onPendingInsertionChange).toHaveBeenCalledOnce();
        const [tempId, columnName, value] = onPendingInsertionChange.mock.calls[0];
        expect(tempId).toBe('pending');
        expect(columnName).toBe('token');
        expect(value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it('does not offer the UUID action in a read-only grid', async () => {
        const {container} = render(
            <DataGrid
                columns={['token']}
                data={[['old-token']]}
                tableName="users"
                columnMetadata={[
                    {
                        name: 'token',
                        data_type: 'uniqueidentifier',
                        is_pk: false,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                ]}
                readonly
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelector('td[data-col-index="0"]')!);

        expect(screen.queryByText('dataGrid.setRandomUuid')).toBeNull();
    });
});

describe('DataGrid sensitive-column masking (#485)', () => {
    // The file-level useSettings mock returns `{}`, so masking defaults to ON
    // with DEFAULT_MASKING_PATTERNS — a column named "email" masks by default.
    beforeAll(() => {
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
    });
    afterAll(() => {
        vi.restoreAllMocks();
    });

    const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
        container.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;

    const renderMaskedGrid = () =>
        render(
            <DataGrid
                columns={['id', 'email']}
                data={[
                    [1, 'alice@example.com'],
                    [2, 'bob@example.com'],
                ]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

    it('masks sensitive columns with a placeholder and hides the real value', () => {
        const {container} = renderMaskedGrid();

        expect(cellAt(container, 0, 1)).toHaveTextContent('••••••');
        expect(cellAt(container, 1, 1)).toHaveTextContent('••••••');
        expect(container).not.toHaveTextContent('alice@example.com');
        // Non-sensitive columns are untouched.
        expect(cellAt(container, 0, 0)).toHaveTextContent('1');
    });

    it('reveals a whole column from the header eye toggle', () => {
        const {container} = renderMaskedGrid();

        const headerToggle = container.querySelector('button[title="dataGrid.revealColumn"]')!;
        expect(headerToggle).toBeInTheDocument();
        fireEvent.click(headerToggle);

        expect(cellAt(container, 0, 1)).toHaveTextContent('alice@example.com');
        expect(cellAt(container, 1, 1)).toHaveTextContent('bob@example.com');
        // Toggling again re-masks the column.
        fireEvent.click(container.querySelector('button[title="dataGrid.maskColumn"]')!);
        expect(cellAt(container, 0, 1)).toHaveTextContent('••••••');
    });

    it('reveals only a single cell from its eye button', () => {
        const {container} = renderMaskedGrid();

        const cellToggle = cellAt(container, 1, 1).querySelector(
            'button[title="dataGrid.revealCell"]',
        )!;
        fireEvent.click(cellToggle);

        expect(cellAt(container, 1, 1)).toHaveTextContent('bob@example.com');
        expect(cellAt(container, 0, 1)).toHaveTextContent('••••••');

        // The revealed cell offers an eye-off toggle to re-mask just that cell.
        fireEvent.click(
            cellAt(container, 1, 1).querySelector('button[title="dataGrid.maskCell"]')!,
        );
        expect(cellAt(container, 1, 1)).toHaveTextContent('••••••');
    });

    it('copies the real value from a masked cell (display-only masking)', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });
        const {container} = renderMaskedGrid();

        fireEvent.click(cellAt(container, 0, 1));
        fireEvent.keyDown(document, {key: 'c', metaKey: true});

        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('alice@example.com'));
    });

    it('does not open the editor on double-click while a cell is masked', () => {
        const {container} = render(
            <DataGrid
                columns={['id', 'email']}
                data={[[1, 'alice@example.com']]}
                tableName="users"
                pkColumns={['id']}
                columnMetadata={[
                    {
                        name: 'id',
                        data_type: 'integer',
                        is_pk: true,
                        is_nullable: false,
                        is_auto_increment: false,
                    },
                    {
                        name: 'email',
                        data_type: 'character varying(255)',
                        is_pk: false,
                        is_nullable: true,
                        is_auto_increment: false,
                    },
                ]}
                onPendingChange={vi.fn()}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );

        fireEvent.doubleClick(cellAt(container, 0, 1));

        expect(container.querySelector('textarea')).toBeNull();

        // After revealing the cell, editing works again.
        fireEvent.click(
            cellAt(container, 0, 1).querySelector('button[title="dataGrid.revealCell"]')!,
        );
        fireEvent.doubleClick(cellAt(container, 0, 1));
        expect(container.querySelector('textarea')).toBeInTheDocument();
    });
});

describe('DataGrid filter-by-value context menu', () => {
    const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
        container.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;

    const usersMetadata = [
        {
            name: 'id',
            data_type: 'integer',
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
        },
        {
            name: 'name',
            data_type: 'character varying(255)',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
        {
            name: 'email',
            data_type: 'character varying(255)',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
        {
            name: 'avatar',
            data_type: 'bytea',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
        {
            name: 'settings',
            data_type: 'jsonb',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
    ];

    const renderUsersGrid = (overrides: Partial<ComponentProps<typeof DataGrid>> = {}) => {
        const onFilterByValue = vi.fn();
        const utils = render(
            <DataGrid
                columns={['id', 'name', 'email', 'avatar', 'settings']}
                data={[[1, 'Alice', 'alice@example.com', 'BLOB:3:image/png:AAEC', {theme: 'dark'}]]}
                tableName="users"
                pkColumns={['id']}
                columnMetadata={usersMetadata}
                onFilterByValue={onFilterByValue}
                // Read-only keeps the editing items (and their icons) out of the
                // menu; the filter items only depend on tableName.
                readonly
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                {...overrides}
            />,
        );
        return {...utils, onFilterByValue};
    };

    // The operators live in a "Filter by this value" flyout opened on hover.
    const openFilterSubmenu = async () => {
        fireEvent.mouseEnter(await screen.findByText('dataGrid.filterByValue'));
    };

    it('offers = / <> on a regular cell and passes the cell value', async () => {
        const {container, onFilterByValue} = renderUsersGrid();

        fireEvent.contextMenu(cellAt(container, 0, 1));
        await openFilterSubmenu();
        fireEvent.click(await screen.findByText('dataGrid.filterEquals'));

        expect(screen.queryByText('dataGrid.filterIsNull')).toBeNull();
        expect(onFilterByValue).toHaveBeenCalledWith(
            'name',
            '=',
            'Alice',
            'character varying(255)',
        );
    });

    it('offers only IS NULL / IS NOT NULL on a masked cell and never passes its value', async () => {
        const {container, onFilterByValue} = renderUsersGrid();

        // "email" is masked by DEFAULT_MASKING_PATTERNS (settings mock is `{}`).
        expect(cellAt(container, 0, 2)).toHaveTextContent('••••••');
        fireEvent.contextMenu(cellAt(container, 0, 2));
        await openFilterSubmenu();

        expect(await screen.findByText('dataGrid.filterIsNull')).toBeInTheDocument();
        expect(screen.getByText('dataGrid.filterIsNotNull')).toBeInTheDocument();
        expect(screen.queryByText('dataGrid.filterEquals')).toBeNull();
        expect(screen.queryByText('dataGrid.filterNotEquals')).toBeNull();
        expect(screen.queryByText('dataGrid.filterContains')).toBeNull();

        fireEvent.click(screen.getByText('dataGrid.filterIsNotNull'));
        expect(onFilterByValue).toHaveBeenCalledWith(
            'email',
            'IS NOT NULL',
            null,
            'character varying(255)',
        );
        expect(JSON.stringify(onFilterByValue.mock.calls)).not.toContain('alice@example.com');
    });

    it('offers = / <> again once the masked cell is revealed', async () => {
        const {container} = renderUsersGrid();

        fireEvent.click(
            cellAt(container, 0, 2).querySelector('button[title="dataGrid.revealCell"]')!,
        );
        fireEvent.contextMenu(cellAt(container, 0, 2));
        await openFilterSubmenu();

        expect(await screen.findByText('dataGrid.filterEquals')).toBeInTheDocument();
        expect(screen.queryByText('dataGrid.filterIsNull')).toBeNull();
    });

    it('offers comparison operators on a numeric cell', async () => {
        const {container, onFilterByValue} = renderUsersGrid();

        fireEvent.contextMenu(cellAt(container, 0, 0));
        await openFilterSubmenu();

        for (const key of [
            'dataGrid.filterEquals',
            'dataGrid.filterNotEquals',
            'dataGrid.filterGreaterThan',
            'dataGrid.filterGreaterOrEqual',
            'dataGrid.filterLessThan',
        ]) {
            expect(await screen.findByText(key)).toBeInTheDocument();
        }
        expect(screen.queryByText('dataGrid.filterContains')).toBeNull();

        fireEvent.click(screen.getByText('dataGrid.filterLessOrEqual'));
        expect(onFilterByValue).toHaveBeenCalledWith('id', '<=', 1, 'integer');
    });

    it('offers contains on a text cell', async () => {
        const {container, onFilterByValue} = renderUsersGrid();

        fireEvent.contextMenu(cellAt(container, 0, 1));
        await openFilterSubmenu();

        expect(screen.queryByText('dataGrid.filterGreaterThan')).toBeNull();
        fireEvent.click(await screen.findByText('dataGrid.filterContains'));
        expect(onFilterByValue).toHaveBeenCalledWith(
            'name',
            'contains',
            'Alice',
            'character varying(255)',
        );
    });

    it('hides the items on BLOB and JSON cells', async () => {
        const {container} = renderUsersGrid();

        fireEvent.contextMenu(cellAt(container, 0, 3));
        // Wait for the menu itself, then check the filter items are absent.
        await screen.findByText('dataGrid.copyCell');
        expect(screen.queryByText('dataGrid.filterByValue')).toBeNull();
        fireEvent.keyDown(document, {key: 'Escape'});

        fireEvent.contextMenu(cellAt(container, 0, 4));
        await screen.findByText('contextMenu.openJsonEditor');
        expect(screen.queryByText('dataGrid.filterByValue')).toBeNull();
    });

    it('hides the items on pending insertion rows', async () => {
        const {container} = renderUsersGrid({
            pendingInsertions: {
                pending: {
                    tempId: 'pending',
                    data: {id: 2, name: 'Bob'},
                    displayIndex: 1,
                },
            },
        });

        fireEvent.contextMenu(cellAt(container, 1, 1));
        await screen.findByText('dataGrid.copyCell');
        expect(screen.queryByText('dataGrid.filterByValue')).toBeNull();
    });

    it('hides the items when there is no table (query results)', async () => {
        const {container} = renderUsersGrid({tableName: null});

        fireEvent.contextMenu(cellAt(container, 0, 1));
        await screen.findByText('dataGrid.copyCell');
        expect(screen.queryByText('dataGrid.filterByValue')).toBeNull();
    });
});

describe('DataGrid column statistics (#1001)', () => {
    const metadata = [
        {
            name: 'id',
            data_type: 'integer',
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
        },
        {
            name: 'status',
            data_type: 'varchar(20)',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
        // "email" matches the default masking patterns.
        {
            name: 'email',
            data_type: 'varchar(255)',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
        {
            name: 'settings',
            data_type: 'jsonb',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
    ];

    const stats = {
        rowCount: 3,
        nullCount: 0,
        distinctCount: 2,
        min: null,
        max: null,
        topValues: [
            {value: 'open', count: 2},
            {value: 'closed', count: 1},
        ],
        filtered: false,
    };

    const renderStatsGrid = (overrides: Partial<ComponentProps<typeof DataGrid>> = {}) => {
        const onFilterByValue = vi.fn();
        const onLoadColumnStats = vi.fn().mockResolvedValue(stats);
        const utils = render(
            <DataGrid
                columns={['id', 'status', 'email', 'settings']}
                data={[[1, 'open', 'a@example.com', {a: 1}]]}
                tableName="orders"
                columnMetadata={metadata}
                onFilterByValue={onFilterByValue}
                onLoadColumnStats={onLoadColumnStats}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
                {...overrides}
            />,
        );
        const header = (index: number) => utils.container.querySelectorAll('th')[index + 1];
        return {...utils, header, onFilterByValue, onLoadColumnStats};
    };

    it('opens the popover from the header menu and loads the stats only then', async () => {
        const {header, onLoadColumnStats} = renderStatsGrid();
        expect(onLoadColumnStats).not.toHaveBeenCalled();

        fireEvent.contextMenu(header(1));
        fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));

        expect(await screen.findByRole('dialog')).toHaveTextContent('status');
        expect(onLoadColumnStats).toHaveBeenCalledTimes(1);
        expect(onLoadColumnStats).toHaveBeenCalledWith(
            'status',
            {distinct: true, minMax: false, topValues: true},
            expect.any(AbortSignal),
        );
        expect(screen.queryByText('dataGrid.copyColumnName')).toBeNull();
    });

    it('computes min / max for numeric columns', async () => {
        const {header, onLoadColumnStats} = renderStatsGrid();
        fireEvent.contextMenu(header(0));
        fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));
        await screen.findByRole('dialog');
        expect(onLoadColumnStats).toHaveBeenCalledWith(
            'id',
            {distinct: true, minMax: true, topValues: true},
            expect.any(AbortSignal),
        );
    });

    it('only counts rows and NULLs for JSON columns', async () => {
        const {header, onLoadColumnStats} = renderStatsGrid();
        fireEvent.contextMenu(header(3));
        fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));
        await screen.findByRole('dialog');
        expect(onLoadColumnStats).toHaveBeenCalledWith(
            'settings',
            {distinct: false, minMax: false, topValues: false},
            expect.any(AbortSignal),
        );
    });

    it('never asks a masked column for its values', async () => {
        const {header, onLoadColumnStats} = renderStatsGrid();
        fireEvent.contextMenu(header(2));
        fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));
        await screen.findByRole('dialog');
        expect(onLoadColumnStats).toHaveBeenCalledWith(
            'email',
            {distinct: true, minMax: false, topValues: false},
            expect.any(AbortSignal),
        );
    });

    it('filters the table with = when a top value is clicked', async () => {
        const {header, onFilterByValue} = renderStatsGrid();
        fireEvent.contextMenu(header(1));
        fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));

        const values = await screen.findAllByTitle('dataGrid.columnStats.filterBy');
        fireEvent.click(values[1]);

        expect(onFilterByValue).toHaveBeenCalledWith('status', '=', 'closed', 'varchar(20)');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('aborts the load when the popover closes', async () => {
        let signal: AbortSignal | undefined;
        const onLoadColumnStats = vi.fn((_c: string, _s: unknown, sig: AbortSignal) => {
            signal = sig;
            return new Promise<never>(() => {});
        });
        const {header} = renderStatsGrid({onLoadColumnStats});
        fireEvent.contextMenu(header(1));
        fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));
        fireEvent.click(await screen.findByRole('button', {name: 'common.cancel'}));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(signal?.aborted).toBe(true);
    });

    it.each([
        ['without a loader', {onLoadColumnStats: undefined}],
        ['for query results (no table)', {tableName: null}],
    ])('hides the entry %s', async (_label, overrides) => {
        const {header} = renderStatsGrid(overrides);
        fireEvent.contextMenu(header(1));
        await screen.findByText('dataGrid.copyColumnName');
        expect(screen.queryByText('dataGrid.columnStatistics')).toBeNull();
    });

    describe('focus when the popover closes (#1138)', () => {
        const gridOf = (container: HTMLElement) =>
            container.querySelector<HTMLElement>('div[tabindex="0"]')!;
        // The header's focusable "select column" control.
        const headerControl = (header: Element) =>
            header.querySelector<HTMLElement>('[role="button"]')!;

        const openStats = async (overrides: Partial<ComponentProps<typeof DataGrid>> = {}) => {
            const utils = renderStatsGrid(overrides);
            const control = headerControl(utils.header(1));
            control.focus();
            // Shift+F10 / the context-menu key fire contextmenu on the focused control.
            fireEvent.contextMenu(control);
            fireEvent.click(await screen.findByText('dataGrid.columnStatistics'));
            const dialog = await screen.findByRole('dialog');
            expect(dialog).toHaveFocus();
            return {...utils, control, dialog};
        };

        it('returns focus to the column header on Escape', async () => {
            const {control, dialog} = await openStats();
            fireEvent.keyDown(dialog, {key: 'Escape'});
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(control).toHaveFocus();
        });

        it('returns focus to the column header from the close button', async () => {
            const {control} = await openStats();
            await screen.findByText('dataGrid.columnStats.rows');
            fireEvent.click(screen.getByRole('button', {name: 'dataGrid.columnStats.close'}));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(control).toHaveFocus();
        });

        it('returns focus to the column header when the load is cancelled', async () => {
            const {control} = await openStats({
                onLoadColumnStats: vi.fn(() => new Promise<never>(() => {})),
            });
            fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(control).toHaveFocus();
        });

        it('falls back to the grid when the header is gone', async () => {
            const {container, dialog, rerender} = await openStats();
            // The column the popover was opened for is no longer rendered.
            rerender(
                <DataGrid
                    columns={['id']}
                    data={[[1]]}
                    tableName="orders"
                    columnMetadata={metadata}
                    onFilterByValue={vi.fn()}
                    onLoadColumnStats={vi.fn().mockResolvedValue(stats)}
                    selectedRows={new Set()}
                    onSelectionChange={vi.fn()}
                    readonly
                />,
            );
            fireEvent.keyDown(dialog, {key: 'Escape'});
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(gridOf(container)).toHaveFocus();
        });

        it('leaves focus on what was clicked outside the popover', async () => {
            const {control} = await openStats();
            const elsewhere = document.createElement('button');
            document.body.appendChild(elsewhere);
            try {
                // A real click focuses the target on mousedown; jsdom only dispatches it.
                fireEvent.mouseDown(elsewhere);
                elsewhere.focus();
                expect(screen.queryByRole('dialog')).toBeNull();
                expect(elsewhere).toHaveFocus();
                expect(control).not.toHaveFocus();
            } finally {
                elsewhere.remove();
            }
        });

        it('focuses the grid when a top value is picked', async () => {
            const {container, onFilterByValue} = await openStats();
            const values = await screen.findAllByTitle('dataGrid.columnStats.filterBy');
            fireEvent.click(values[0]);
            expect(onFilterByValue).toHaveBeenCalledWith('status', '=', 'open', 'varchar(20)');
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(gridOf(container)).toHaveFocus();
        });
    });
});

describe('DataGrid open link context menu', () => {
    const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
        container.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;

    // "email" is masked by DEFAULT_MASKING_PATTERNS (settings mock is `{}`).
    const renderLinksGrid = () =>
        render(
            <DataGrid
                columns={['id', 'website', 'contact', 'email', 'notes']}
                data={[
                    [
                        1,
                        '  https://example.com/profile  ',
                        'mailto:alice@example.com',
                        'mailto:alice@example.com',
                        'plain text',
                    ],
                    [2, 'file:///etc/passwd', 'javascript:alert(1)', null, 'ftp://host/x'],
                ]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

    beforeEach(() => {
        vi.mocked(openUrl).mockReset();
        vi.mocked(openUrl).mockResolvedValue(undefined);
        showToastMock.mockClear();
    });

    it('opens the trimmed URL of an http(s) cell', async () => {
        const {container} = renderLinksGrid();

        fireEvent.contextMenu(cellAt(container, 0, 1));
        fireEvent.click(await screen.findByText('contextMenu.openLink'));

        expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/profile');
    });

    it('opens a mailto address', async () => {
        const {container} = renderLinksGrid();

        fireEvent.contextMenu(cellAt(container, 0, 2));
        fireEvent.click(await screen.findByText('contextMenu.openLink'));

        expect(openUrl).toHaveBeenCalledExactlyOnceWith('mailto:alice@example.com');
    });

    it('never offers the entry for other schemes or plain text', async () => {
        const {container} = renderLinksGrid();

        for (const [row, col] of [
            [0, 4],
            [1, 1],
            [1, 2],
            [1, 4],
        ] as const) {
            fireEvent.contextMenu(cellAt(container, row, col));
            await screen.findByText('dataGrid.copyCell');
            expect(screen.queryByText('contextMenu.openLink')).toBeNull();
            fireEvent.keyDown(document, {key: 'Escape'});
        }
    });

    it('never offers the entry for a masked cell', async () => {
        const {container} = renderLinksGrid();

        expect(cellAt(container, 0, 3)).toHaveTextContent('••••••');
        fireEvent.contextMenu(cellAt(container, 0, 3));
        await screen.findByText('dataGrid.copyCell');
        expect(screen.queryByText('contextMenu.openLink')).toBeNull();
        expect(openUrl).not.toHaveBeenCalled();
    });

    it('logs a failure to open the link and reports it with an error toast', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(openUrl).mockRejectedValue('no handler');
        const {container} = renderLinksGrid();

        fireEvent.contextMenu(cellAt(container, 0, 1));
        fireEvent.click(await screen.findByText('contextMenu.openLink'));

        await waitFor(() =>
            expect(showToastMock).toHaveBeenCalledWith(
                expect.stringContaining('contextMenu.openLinkFailed'),
                {kind: 'error'},
            ),
        );
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

describe('DataGrid vertical scroll position across tab switches (#823)', () => {
    // Editor.tsx keys the <DataGrid> it renders by the active tab's id (plus
    // sort/filter/result state), so switching tabs fully unmounts the previous
    // grid and mounts a fresh one for the newly active tab — it does not just
    // hide it. Editor.tsx is expected to remember the last scrollTop it saw
    // (via onScrollTopChange) and hand it back as initialScrollTop when the
    // tab's grid is remounted.
    it('restores the scrollTop the caller passes back in as initialScrollTop', () => {
        scrollToOffsetMock.mockClear();
        const columns = ['id'];
        const data = Array.from({length: 200}, (_, i) => [i]);

        const {container, unmount} = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
            />,
        );
        const scrollEl = container.querySelector('.overflow-auto') as HTMLElement;
        expect(scrollEl).not.toBeNull();

        fireEvent.scroll(scrollEl, {target: {scrollTop: 400}});
        expect(scrollEl.scrollTop).toBe(400);

        // Simulate switching away and back to this tab: the old grid is gone,
        // a brand new one is mounted in its place.
        unmount();

        const {container: container2} = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                initialScrollTop={400}
            />,
        );
        const scrollEl2 = container2.querySelector('.overflow-auto') as HTMLElement;

        expect(scrollToOffsetMock).toHaveBeenCalledWith(400);
        expect(scrollEl2.scrollTop).toBe(400);
    });

    it('reports scroll position changes via onScrollTopChange', () => {
        const onScrollTopChange = vi.fn();
        const {container} = render(
            <DataGrid
                columns={['id']}
                data={Array.from({length: 200}, (_, i) => [i])}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                onScrollTopChange={onScrollTopChange}
            />,
        );
        const scrollEl = container.querySelector('.overflow-auto') as HTMLElement;

        fireEvent.scroll(scrollEl, {target: {scrollTop: 250}});

        expect(onScrollTopChange).toHaveBeenCalledWith(250);
    });

    // Editor.tsx also remounts this grid when a pending insertion is added,
    // and separately decides — outside this component's own lifecycle,
    // because a fresh mount can never observe its own "count changed" —
    // whether this mount is that kind of insert. It passes that decision in
    // as scrollToNewInsertion, which must win over any restored offset from
    // the grid's previous mount: an inserted row should always be scrolled
    // into view, never left below a stale scroll position.
    it('scrolls to the newly inserted row instead of restoring initialScrollTop when both are set', () => {
        scrollToIndexMock.mockClear();
        scrollToOffsetMock.mockClear();
        const data = Array.from({length: 200}, (_, i) => [i]);

        const {container} = render(
            <DataGrid
                columns={['id']}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                initialScrollTop={5000}
                scrollToNewInsertion
            />,
        );

        expect(scrollToIndexMock).toHaveBeenCalledWith(data.length - 1, {
            align: 'end',
        });

        // The restore path must not also have run: it goes through
        // scrollToOffset, which would clobber whatever the (mocked)
        // scroll-to-bottom did.
        expect(scrollToOffsetMock).not.toHaveBeenCalled();
        const scrollEl = container.querySelector('.overflow-auto') as HTMLElement;
        expect(scrollEl.scrollTop).toBe(0);
    });

    it('restores initialScrollTop when there is no new insertion to scroll to', () => {
        scrollToIndexMock.mockClear();
        scrollToOffsetMock.mockClear();
        const data = Array.from({length: 200}, (_, i) => [i]);

        const {container} = render(
            <DataGrid
                columns={['id']}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                initialScrollTop={400}
                scrollToNewInsertion={false}
            />,
        );

        expect(scrollToIndexMock).not.toHaveBeenCalled();
        expect(scrollToOffsetMock).toHaveBeenCalledWith(400);
        const scrollEl = container.querySelector('.overflow-auto') as HTMLElement;
        expect(scrollEl.scrollTop).toBe(400);
    });

    // The real virtualizer renders no rows on its very first commit, before
    // it has measured the scroll container. Restoring then would call
    // scrollToOffset while the container's scrollHeight still equals its
    // clientHeight, which clamps the offset to 0 — and the has-run ref would
    // then mark the restore done for good, so it never gets another chance.
    it('restores initialScrollTop once the virtualizer has rendered rows, not on the first, empty render', () => {
        scrollToOffsetMock.mockClear();
        virtualizerRenderControl.forceEmpty = true;
        let forceRerender = () => {};
        const data = Array.from({length: 200}, (_, i) => [i]);
        const Harness = () => {
            const [, setTick] = useState(0);
            forceRerender = () => setTick((n) => n + 1);
            return (
                <DataGrid
                    columns={['id']}
                    data={data}
                    selectedRows={new Set()}
                    onSelectionChange={vi.fn()}
                    initialScrollTop={400}
                />
            );
        };

        try {
            const {container} = render(<Harness />);
            const scrollEl = container.querySelector('.overflow-auto') as HTMLElement;

            // No rows rendered yet: the restore must not fire.
            expect(scrollToOffsetMock).not.toHaveBeenCalled();
            expect(scrollEl.scrollTop).toBe(0);

            // The virtualizer measures the viewport and re-renders with rows.
            virtualizerRenderControl.forceEmpty = false;
            act(() => forceRerender());

            expect(scrollToOffsetMock).toHaveBeenCalledWith(400);
            expect(scrollEl.scrollTop).toBe(400);
        } finally {
            virtualizerRenderControl.forceEmpty = false;
        }
    });
});

describe('DataGrid Edit selection context menu (#1000)', () => {
    const columns = ['id', 'name', 'city'];
    const metadata = [
        {
            name: 'id',
            data_type: 'integer',
            is_pk: true,
            is_nullable: false,
            is_auto_increment: false,
        },
        {
            name: 'name',
            data_type: 'varchar(50)',
            is_pk: false,
            is_nullable: false,
            is_auto_increment: false,
        },
        {
            name: 'city',
            data_type: 'varchar(50)',
            is_pk: false,
            is_nullable: true,
            is_auto_increment: false,
        },
    ];
    const data: unknown[][] = [
        [1, ' alice ', 'Portland'],
        [2, 'Bob', null],
        [3, 'cara', 'denver'],
    ];
    const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
        container.querySelector(
            `tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`,
        )!;

    const renderGrid = (overrides: Partial<ComponentProps<typeof DataGrid>> = {}) => {
        const onPendingChange = vi.fn();
        const utils = render(
            <DataGrid
                columns={columns}
                data={data}
                tableName="people"
                pkColumns={['id']}
                columnMetadata={metadata}
                nullableColumns={['city']}
                onPendingChange={onPendingChange}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                {...overrides}
            />,
        );
        return {...utils, onPendingChange};
    };

    // Header text also appears in the column tooltip, so select by the header's own button.
    const selectColumn = (colIndex: number) =>
        fireEvent.click(screen.getAllByLabelText('dataGrid.selectColumn')[colIndex], {
            metaKey: true,
        });

    const openEditSelection = async () => {
        fireEvent.mouseEnter(await screen.findByText('dataGrid.editSelection'));
    };

    beforeEach(() => {
        showToastMock.mockClear();
        translationMock.mockClear();
    });

    it('changes the case of every cell in the range, not only the clicked one', async () => {
        const {container, onPendingChange} = renderGrid();

        fireEvent.click(cellAt(container, 0, 1));
        fireEvent.click(cellAt(container, 2, 2), {shiftKey: true});
        fireEvent.contextMenu(cellAt(container, 1, 1));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.upperCase'));

        expect(onPendingChange.mock.calls).toEqual([
            [{id: 1}, 'name', ' ALICE '],
            [{id: 2}, 'name', 'BOB'],
            [{id: 3}, 'name', 'CARA'],
            [{id: 1}, 'city', 'PORTLAND'],
            [{id: 3}, 'city', 'DENVER'],
        ]);
        expect(showToastMock).toHaveBeenCalledWith('dataGrid.editedCells', {
            kind: 'success',
        });
    });

    it('fills a selected column down from its first cell', async () => {
        const {container, onPendingChange} = renderGrid();

        selectColumn(2);
        fireEvent.contextMenu(cellAt(container, 2, 2));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.fillDown'));

        expect(onPendingChange.mock.calls).toEqual([
            [{id: 2}, 'city', 'Portland'],
            [{id: 3}, 'city', 'Portland'],
        ]);
    });

    it('transforms the pending value the grid shows, not the stored one', async () => {
        const {container, onPendingChange} = renderGrid({
            pendingChanges: {
                [serializePkKey({id: 2})]: {
                    pkOriginalValue: {id: 2},
                    changes: {name: '  Robert '},
                },
            },
        });

        selectColumn(1);
        fireEvent.contextMenu(cellAt(container, 0, 1));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.trimWhitespace'));

        expect(onPendingChange.mock.calls).toEqual([
            [{id: 1}, 'name', 'alice'],
            [{id: 2}, 'name', 'Robert'],
        ]);
    });

    it('stages nothing and says so when the edit changes no cell', async () => {
        const {container, onPendingChange} = renderGrid();

        fireEvent.contextMenu(cellAt(container, 1, 1));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.titleCase'));

        expect(onPendingChange).not.toHaveBeenCalled();
        expect(showToastMock).toHaveBeenCalledWith('dataGrid.editSelectionNoChange', {
            kind: 'info',
        });
    });

    it('disables fill down for a single row and offers Set NULL only on nullable columns', async () => {
        const {container, onPendingChange} = renderGrid();

        fireEvent.click(cellAt(container, 0, 1));
        fireEvent.click(cellAt(container, 1, 2), {shiftKey: true});
        fireEvent.contextMenu(cellAt(container, 0, 1));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.setNull'));

        expect(onPendingChange.mock.calls).toEqual([[{id: 1}, 'city', null]]);

        fireEvent.click(cellAt(container, 0, 1));
        fireEvent.contextMenu(cellAt(container, 0, 1));
        await openEditSelection();
        expect((await screen.findByText('dataGrid.fillDown')).closest('button')).toBeDisabled();
        expect(screen.queryByText('dataGrid.setNull')).toBeNull();
    });

    it('sets every selected cell to the value typed in the dialog', async () => {
        const {container, onPendingChange} = renderGrid();

        fireEvent.click(cellAt(container, 1, 1));
        fireEvent.click(cellAt(container, 2, 2), {shiftKey: true});
        fireEvent.contextMenu(cellAt(container, 2, 1));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.setToValue'));

        fireEvent.change(screen.getByLabelText('dataGrid.setToValueLabel'), {
            target: {value: 'n/a'},
        });
        fireEvent.click(screen.getByText('dataGrid.setToValueApply'));

        expect(onPendingChange.mock.calls).toEqual([
            [{id: 2}, 'name', 'n/a'],
            [{id: 3}, 'name', 'n/a'],
            [{id: 2}, 'city', 'n/a'],
            [{id: 3}, 'city', 'n/a'],
        ]);
        expect(screen.queryByLabelText('dataGrid.setToValueLabel')).toBeNull();
    });

    it('stages NULL over the text "null" and JSON values copied by fill down', async () => {
        const {container, onPendingChange} = renderGrid({
            columns: ['id', 'name', 'city', 'settings'],
            columnMetadata: [
                ...metadata,
                {
                    name: 'settings',
                    data_type: 'jsonb',
                    is_pk: false,
                    is_nullable: true,
                    is_auto_increment: false,
                },
            ],
            data: [
                [1, 'a', 'null', {theme: 'dark'}],
                [2, 'b', 'Oslo', {theme: 'light'}],
            ],
        });

        fireEvent.contextMenu(cellAt(container, 0, 2));
        await openEditSelection();
        // The single-cell Set NULL is in the main menu too; the submenu's comes last.
        fireEvent.click((await screen.findAllByText('dataGrid.setNull')).at(-1)!);
        expect(onPendingChange.mock.calls).toEqual([[{id: 1}, 'city', null]]);

        onPendingChange.mockClear();
        selectColumn(3);
        fireEvent.contextMenu(cellAt(container, 1, 3));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.fillDown'));
        expect(onPendingChange.mock.calls).toEqual([[{id: 2}, 'settings', {theme: 'dark'}]]);
    });

    it.each([
        ['a read-only grid', {readonly: true}, 'dataGrid.editSelectionReadOnly'],
        ['a result without a source table', {tableName: null}, 'dataGrid.editSelectionNoTable'],
        ['a table without a primary key', {pkColumns: null}, 'dataGrid.editSelectionNoKey'],
    ])('shows the submenu disabled with the reason on %s', async (_, overrides, reason) => {
        const {container} = renderGrid(overrides);

        fireEvent.contextMenu(cellAt(container, 0, 1));

        expect(
            (await screen.findByText('dataGrid.editSelectionUnavailable')).closest('button'),
        ).toBeDisabled();
        expect(screen.queryByText('dataGrid.editSelection')).toBeNull();
        expect(translationMock).toHaveBeenCalledWith('dataGrid.editSelectionUnavailable', {
            reason,
        });
    });

    it('triggers onUndo when Cmd/Ctrl+Z is pressed and canUndo is true', async () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const {container} = renderGrid({
            onUndo,
            onRedo,
            canUndo: true,
            canRedo: false,
        });

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'z', ctrlKey: true});
        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onRedo).not.toHaveBeenCalled();
    });

    it('triggers onRedo when Cmd/Ctrl+Shift+Z or Ctrl+Y is pressed and canRedo is true', async () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const {container} = renderGrid({
            onUndo,
            onRedo,
            canUndo: false,
            canRedo: true,
        });

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'z', ctrlKey: true, shiftKey: true});
        expect(onRedo).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(document, {key: 'y', ctrlKey: true});
        expect(onRedo).toHaveBeenCalledTimes(2);
        expect(onUndo).not.toHaveBeenCalled();
    });

    it('ignores Ctrl+Z when canUndo is false', async () => {
        const onUndo = vi.fn();
        const {container} = renderGrid({
            onUndo,
            canUndo: false,
        });

        fireEvent.mouseDown(container.querySelector('table')!);
        fireEvent.keyDown(document, {key: 'z', ctrlKey: true});
        expect(onUndo).not.toHaveBeenCalled();
    });

    it('ignores Ctrl+Z while editing a cell inline', async () => {
        const onUndo = vi.fn();
        const {container} = renderGrid({
            onUndo,
            canUndo: true,
            readonly: false,
        });

        fireEvent.mouseDown(container.querySelector('table')!);
        const targetCell = cellAt(container, 0, 1);
        fireEvent.doubleClick(targetCell);

        // Editing cell is active with inline text input
        fireEvent.keyDown(document, {key: 'z', ctrlKey: true});
        expect(onUndo).not.toHaveBeenCalled();
    });

    it('ignores Ctrl+Z when an editable text input has focus', async () => {
        const onUndo = vi.fn();
        const {container} = renderGrid({
            onUndo,
            canUndo: true,
        });

        fireEvent.mouseDown(container.querySelector('table')!);
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        fireEvent.keyDown(input, {key: 'z', ctrlKey: true});
        expect(onUndo).not.toHaveBeenCalled();

        document.body.removeChild(input);
    });

    it('calls onBeginBatchEdit and onEndBatchEdit around batch cell writes', async () => {
        const onBeginBatchEdit = vi.fn();
        const onEndBatchEdit = vi.fn();
        const {container, onPendingChange} = renderGrid({
            onBeginBatchEdit,
            onEndBatchEdit,
        });

        selectColumn(1);
        fireEvent.contextMenu(cellAt(container, 0, 1));
        await openEditSelection();
        fireEvent.click(await screen.findByText('dataGrid.upperCase'));

        expect(onBeginBatchEdit).toHaveBeenCalledTimes(1);
        expect(onEndBatchEdit).toHaveBeenCalledTimes(1);
        expect(onPendingChange).toHaveBeenCalledTimes(3);
    });
});

describe('DataGrid copy column names as SQL list', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        writeText.mockClear();
        showToastMock.mockClear();
        translationMock.mockClear();
        databaseMock.mockReset();
        databaseMock.mockReturnValue({
            activeSchema: null,
            connections: [],
            getConnectionData: vi.fn(),
        });
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });
    });

    it('copies all column names as a quoted SQL list in result-column order and shows the toast', async () => {
        const {container} = render(
            <DataGrid
                columns={['select', 'full name', 'col"quote']}
                data={[[1, 'Alice', 'x']]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        fireEvent.contextMenu(container.querySelectorAll('th')[1]);
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNames'));
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNamesSqlList'));

        await waitFor(() =>
            expect(writeText).toHaveBeenCalledWith('"select", "full name", "col""quote"'),
        );
        expect(showToastMock).toHaveBeenCalledWith('dataGrid.copiedColumnNames', {
            kind: 'success',
        });
        expect(translationMock).toHaveBeenCalledWith('dataGrid.copiedColumnNames', {
            count: 3,
        });
    });

    it('copies a quoted column name with the active driver quote and escaping', async () => {
        databaseMock.mockReturnValue({
            activeSchema: null,
            connections: [],
            activeDriver: 'postgres',
            getConnectionData: vi.fn(),
        });

        const {container} = render(
            <DataGrid
                columns={['we"ird']}
                data={[[1]]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        fireEvent.contextMenu(container.querySelectorAll('th')[1]);
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNameQuoted'));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('"we""ird"'));
    });

    it("honors the grid connection's own capabilities and driver over the globally active connection", async () => {
        databaseMock.mockReturnValue({
            activeSchema: null,
            connections: [],
            activeDriver: 'postgres',
            activeCapabilities: {
                schemas: true,
                views: true,
                routines: false,
                file_based: false,
                folder_based: false,
                identifier_quote: '"',
                alter_primary_key: false,
            },
            getConnectionData: vi.fn((id: string) =>
                id === 'mysql-conn'
                    ? {
                          driver: 'mysql',
                          capabilities: null,
                      }
                    : undefined,
            ),
        });

        const {container} = render(
            <DataGrid
                connectionId="mysql-conn"
                columns={['id', 'user`name']}
                data={[[1, 'Alice']]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        fireEvent.contextMenu(container.querySelectorAll('th')[1]);
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNames'));
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNamesSqlList'));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('`id`, `user``name`'));
    });

    it('falls back to the active connection when the grid connection data is missing', async () => {
        databaseMock.mockReturnValue({
            activeSchema: null,
            connections: [],
            activeDriver: 'postgres',
            activeCapabilities: {
                schemas: true,
                views: true,
                routines: false,
                file_based: false,
                folder_based: false,
                identifier_quote: '"',
                alter_primary_key: false,
            },
            getConnectionData: vi.fn(() => undefined),
        });

        const {container} = render(
            <DataGrid
                connectionId="missing-conn"
                columns={['col1', 'col2']}
                data={[[1, 2]]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );

        fireEvent.contextMenu(container.querySelectorAll('th')[1]);
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNames'));
        fireEvent.click(await screen.findByText('dataGrid.copyColumnNamesSqlList'));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith('"col1", "col2"'));
    });
});

describe('DataGrid column resizing (#1151)', () => {
    const columns = ['id', 'name', 'email'];
    const data = [
        [1, 'Alice', 'alice@example.com'],
        [2, 'Bob', 'bob@example.com'],
    ];
    // Every measured header cell (the row-number column included) is 100px.
    const MEASURED = 100;
    let frames: FrameRequestCallback[];
    let clientWidthDescriptor: PropertyDescriptor | undefined;
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;

    const flushFrames = () =>
        act(() => {
            const pending = frames;
            frames = [];
            pending.forEach((cb) => cb(0));
        });

    beforeEach(() => {
        frames = [];
        // Frames run only when a test flushes them, like a real browser would.
        window.requestAnimationFrame = (cb: FrameRequestCallback) => {
            frames.push(cb);
            return frames.length;
        };
        window.cancelAnimationFrame = vi.fn();
        // JSDOM has no layout: give the grid a viewport and the headers a width
        // so the widths get measured and locked like in the app (#844).
        clientWidthDescriptor = Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            'clientWidth',
        );
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get: () => 800,
        });
        vi.spyOn(HTMLTableCellElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: MEASURED,
        } as DOMRect);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.requestAnimationFrame = originalRaf;
        window.cancelAnimationFrame = originalCancelRaf;
        if (clientWidthDescriptor) {
            Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
        } else {
            delete (HTMLElement.prototype as {clientWidth?: number}).clientWidth;
        }
    });

    const renderGrid = (props: Partial<ComponentProps<typeof DataGrid>> = {}) => {
        const onSort = vi.fn();
        const utils = render(
            <DataGrid
                columns={columns}
                data={data}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                onSort={onSort}
                readonly
                {...props}
            />,
        );
        const table = utils.container.querySelector('table')!;
        const col = (index: number) => table.querySelectorAll('col')[index] as HTMLTableColElement;
        return {...utils, onSort, table, col};
    };

    const separators = () => screen.getAllByRole('separator');

    it('adds a focusable, labelled resize separator to each data column', () => {
        renderGrid();

        expect(separators()).toHaveLength(columns.length);
        const handle = separators()[1];
        expect(handle).toHaveAttribute('tabindex', '0');
        expect(handle).toHaveAttribute('aria-orientation', 'vertical');
        expect(handle).toHaveAttribute('aria-valuenow', String(MEASURED));
        expect(handle).toHaveAttribute('aria-valuemin', '48');
        expect(handle).toHaveAttribute('aria-valuemax', '2000');
        expect(handle).toHaveAttribute('aria-label', 'dataGrid.resizeColumn');
        expect(translationMock).toHaveBeenCalledWith('dataGrid.resizeColumn', {
            col: 'name',
        });
        expect(handle.className).toContain('cursor-col-resize');
        expect(handle.className).toContain('focus-visible:outline-focus');
    });

    it('drags only the target column wider and narrower', () => {
        const {col, table} = renderGrid();
        expect(table.style.width).toBe('');

        fireEvent.mouseDown(separators()[1], {button: 0, clientX: 300});
        fireEvent.mouseMove(window, {clientX: 360});
        flushFrames();
        // Painted straight to the column while dragging.
        expect(col(2).style.width).toBe('160px');
        fireEvent.mouseUp(window);

        expect(col(2).style.width).toBe('160px');
        expect(separators()[1]).toHaveAttribute('aria-valuenow', '160');
        expect(col(0).style.width).toBe(`${MEASURED}px`);
        expect(col(1).style.width).toBe(`${MEASURED}px`);
        expect(col(3).style.width).toBe(`${MEASURED}px`);
        // The table is exactly as wide as its columns, so the others keep theirs.
        expect(table.style.width).toBe('460px');

        fireEvent.mouseDown(separators()[1], {button: 0, clientX: 300});
        fireEvent.mouseMove(window, {clientX: 220});
        fireEvent.mouseUp(window);
        expect(col(2).style.width).toBe('80px');
        expect(table.style.width).toBe('380px');
    });

    it('keeps a drag within the minimum and maximum widths', () => {
        const {col} = renderGrid();

        fireEvent.mouseDown(separators()[0], {button: 0, clientX: 300});
        fireEvent.mouseMove(window, {clientX: -1000});
        fireEvent.mouseUp(window);
        expect(col(1).style.width).toBe('48px');

        fireEvent.mouseDown(separators()[0], {button: 0, clientX: 0});
        fireEvent.mouseMove(window, {clientX: 9000});
        fireEvent.mouseUp(window);
        expect(col(1).style.width).toBe('2000px');
    });

    it('does not sort or select the column while resizing', () => {
        const {container, onSort} = renderGrid();
        const handle = separators()[0];

        fireEvent.mouseDown(handle, {button: 0, clientX: 300});
        fireEvent.mouseMove(window, {clientX: 340});
        fireEvent.mouseUp(handle);
        fireEvent.click(handle);
        fireEvent.doubleClick(handle);

        expect(onSort).not.toHaveBeenCalled();
        expect(container.querySelectorAll('th')[1]).not.toHaveClass('bg-accent-primary/20');
    });

    it('resizes from the keyboard in steps, Shift for larger steps, Home/End for the limits', () => {
        const {col} = renderGrid();
        const handle = () => separators()[2];

        fireEvent.keyDown(handle(), {key: 'ArrowRight'});
        expect(col(3).style.width).toBe('110px');
        expect(handle()).toHaveAttribute('aria-valuenow', '110');

        fireEvent.keyDown(handle(), {key: 'ArrowLeft', shiftKey: true});
        expect(col(3).style.width).toBe('60px');

        fireEvent.keyDown(handle(), {key: 'Home'});
        expect(handle()).toHaveAttribute('aria-valuenow', '48');
        fireEvent.keyDown(handle(), {key: 'ArrowLeft'});
        expect(handle()).toHaveAttribute('aria-valuenow', '48');

        fireEvent.keyDown(handle(), {key: 'End'});
        expect(handle()).toHaveAttribute('aria-valuenow', '2000');
        expect(col(1).style.width).toBe(`${MEASURED}px`);
    });

    it("keeps keys on the separator away from the grid's keyboard model", () => {
        const onSelectionChange = vi.fn();
        const {container} = renderGrid({onSelectionChange});
        fireEvent.click(container.querySelector('td[data-col-index="0"]')!);
        const focusedBefore = container.querySelector('.ring-accent-primary');
        expect(focusedBefore).toHaveAttribute('data-col-index', '0');
        onSelectionChange.mockClear();

        // Arrow keys resize instead of moving the focused cell, and Shift+Space
        // does not select the focused cell's row.
        fireEvent.keyDown(separators()[0], {key: 'ArrowRight'});
        fireEvent.keyDown(separators()[0], {key: ' ', shiftKey: true});

        expect(container.querySelector('.ring-accent-primary')).toBe(focusedBefore);
        expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('keeps the resized widths while rows change and re-measures for new columns', () => {
        const {col, rerender} = renderGrid();
        fireEvent.keyDown(separators()[0], {key: 'ArrowRight', shiftKey: true});
        expect(col(1).style.width).toBe('150px');

        // More rows for the same columns (scrolling, paging, refreshing).
        rerender(
            <DataGrid
                columns={columns}
                data={[...data, [3, 'Carol', 'carol@example.com']]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );
        expect(col(1).style.width).toBe('150px');

        rerender(
            <DataGrid
                columns={['sku', 'price']}
                data={[['a', 1]]}
                selectedRows={new Set()}
                onSelectionChange={vi.fn()}
                readonly
            />,
        );
        expect(col(1).style.width).toBe(`${MEASURED}px`);
        expect(separators()).toHaveLength(2);
    });
});
