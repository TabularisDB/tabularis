import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createRef, useState, type ComponentProps} from 'react';
import {vi} from 'vitest';
import {DataGrid, type DataGridCommandTarget} from '@/components/ui/DataGrid';
import {KeybindingsContext} from '@/contexts/KeybindingsContext';

// Hidden columns in the data grid (#1299). Mocks mirror DataGrid.test.tsx.

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({activeSchema: null, connections: [], getConnectionData: vi.fn()}),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: vi.fn()}),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: vi.fn()}),
}));

const {showToastMock, downloadFileMock, readClipboardMock, translate} = vi.hoisted(() => ({
    showToastMock: vi.fn(),
    downloadFileMock: vi.fn(),
    readClipboardMock: vi.fn(),
    // Stable like react-i18next's own `t`: the grid's column definitions depend on it.
    // Keys come back as they are, with the count when there is one.
    translate: (key: string, options?: {count?: number}) =>
        options?.count === undefined ? key : `${key}:${options.count}`,
}));

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        writeClipboardHtml: vi.fn(),
        downloadFile: downloadFileMock,
        readClipboard: readClipboardMock,
    }),
}));

vi.mock('@/platform/secondaryWindowSessions', () => ({
    getJsonViewerSessionHost: () => ({open: vi.fn()}),
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({showToast: showToastMock}),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: translate,
        i18n: {language: 'en', changeLanguage: vi.fn()},
    }),
    initReactI18next: {type: '3rdParty', init: vi.fn()},
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {}}),
}));

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

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// JSDOM has no layout: render every row.
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
            scrollToIndex: vi.fn(),
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

const columns = ['id', 'customer_id', 'created_by', 'updated_at', 'total'];
const data: unknown[][] = [
    [1, 10, 'ann', '2026-01-01', 99.5],
    [2, 11, 'bob', '2026-01-02', 12],
];
const metadata = columns.map((name) => ({
    name,
    data_type: name === 'id' || name === 'customer_id' ? 'integer' : 'varchar(50)',
    is_pk: name === 'id',
    is_nullable: name !== 'id',
    is_auto_increment: false,
}));

type GridProps = ComponentProps<typeof DataGrid>;

// Keeps the hidden set like the editor does, so hiding shows up in the grid.
function HostedGrid({
    initialHidden = new Set<number>(),
    onHiddenChange,
    ...props
}: Partial<GridProps> & {
    initialHidden?: ReadonlySet<number>;
    onHiddenChange?: (hidden: ReadonlySet<number>) => void;
}) {
    const [hidden, setHidden] = useState(initialHidden);
    return (
        <DataGrid
            columns={columns}
            data={data}
            selectedRows={new Set()}
            onSelectionChange={vi.fn()}
            readonly
            hiddenColumns={hidden}
            onHiddenColumnsChange={(next) => {
                setHidden(next);
                onHiddenChange?.(next);
            }}
            {...props}
        />
    );
}

const headerTexts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('thead th[data-col-index]')).map((th) =>
        th.getAttribute('data-col-index'),
    );

const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
    container.querySelector(`tr[data-row-index="${rowIndex}"] td[data-col-index="${colIndex}"]`)!;

const headerOf = (container: HTMLElement, colIndex: number) =>
    container.querySelector(`th[data-col-index="${colIndex}"]`)!;

const gridOf = (container: HTMLElement) => container.querySelector('div[tabindex="0"]')!;

describe('DataGrid hidden columns (#1299)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        writeText.mockClear();
        showToastMock.mockClear();
        downloadFileMock.mockReset().mockResolvedValue(true);
        readClipboardMock.mockReset();
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });
    });

    describe('rendering', () => {
        it('leaves hidden columns out and keeps the others in order', () => {
            const {container} = render(<HostedGrid initialHidden={new Set([2, 3])} />);

            expect(headerTexts(container)).toEqual(['0', '1', '4']);
            const firstRow = container.querySelector('tr[data-row-index="0"]')!;
            expect(Array.from(firstRow.querySelectorAll('td')).map((td) => td.textContent)).toEqual(
                ['1', '1', '10', '99.5'],
            );
            expect(screen.queryByText('ann')).toBeNull();
        });

        it('never hides every column, whatever it is given', () => {
            const {container} = render(<HostedGrid initialHidden={new Set([0, 1, 2, 3, 4])} />);
            expect(headerTexts(container)).toEqual(['0', '1', '2', '3', '4']);
        });
    });

    describe('header menu', () => {
        it('hides the right-clicked column', () => {
            const onHiddenChange = vi.fn();
            const {container} = render(<HostedGrid onHiddenChange={onHiddenChange} />);

            fireEvent.contextMenu(headerOf(container, 2));
            fireEvent.click(screen.getByText('dataGrid.columnVisibility.hideColumn'));

            expect([...onHiddenChange.mock.lastCall![0]]).toEqual([2]);
            expect(headerTexts(container)).toEqual(['0', '1', '3', '4']);
            expect(gridOf(container)).toHaveFocus();
        });

        it("can't hide the last visible column", () => {
            const onHiddenChange = vi.fn();
            const {container} = render(
                <HostedGrid
                    initialHidden={new Set([0, 1, 2, 3])}
                    onHiddenChange={onHiddenChange}
                />,
            );

            fireEvent.contextMenu(headerOf(container, 4));
            const hide = screen
                .getByText('dataGrid.columnVisibility.hideColumn')
                .closest('button')!;
            expect(hide).toBeDisabled();
            fireEvent.click(hide);
            expect(onHiddenChange).not.toHaveBeenCalled();
        });

        it('hides every selected column when the clicked one is selected', () => {
            const onHiddenChange = vi.fn();
            const {container} = render(<HostedGrid onHiddenChange={onHiddenChange} />);

            const selectButtons = screen.getAllByLabelText('dataGrid.selectColumn');
            fireEvent.click(selectButtons[2]);
            fireEvent.click(selectButtons[3], {metaKey: true});
            fireEvent.contextMenu(headerOf(container, 3));
            fireEvent.click(screen.getByText('dataGrid.columnVisibility.hideColumns:2'));

            expect([...onHiddenChange.mock.lastCall![0]].sort()).toEqual([2, 3]);
        });

        it('shows the hidden columns again', () => {
            const onHiddenChange = vi.fn();
            const {container} = render(
                <HostedGrid initialHidden={new Set([1, 3])} onHiddenChange={onHiddenChange} />,
            );

            fireEvent.contextMenu(headerOf(container, 0));
            fireEvent.click(screen.getByText('dataGrid.columnVisibility.showAllColumns:2'));

            expect(onHiddenChange.mock.lastCall![0].size).toBe(0);
            expect(headerTexts(container)).toEqual(['0', '1', '2', '3', '4']);
        });

        it('opens the column list from "Choose columns…"', () => {
            const onHiddenChange = vi.fn();
            const {container} = render(<HostedGrid onHiddenChange={onHiddenChange} />);

            fireEvent.contextMenu(headerOf(container, 1));
            fireEvent.click(screen.getByText('dataGrid.columnVisibility.chooseColumns'));
            const dialog = screen.getByRole('dialog', {name: 'dataGrid.columnVisibility.title'});
            expect(dialog).toBeInTheDocument();

            fireEvent.click(screen.getByRole('checkbox', {name: 'updated_at'}));
            expect([...onHiddenChange.mock.lastCall![0]]).toEqual([3]);
            expect(headerTexts(container)).toEqual(['0', '1', '2', '4']);
            // Keys in the list don't move the grid's focused cell.
            fireEvent.keyDown(screen.getByRole('checkbox', {name: 'id'}), {key: 'ArrowRight'});
            expect(container.querySelector('.ring-2')).toBeNull();

            fireEvent.keyDown(screen.getByRole('checkbox', {name: 'id'}), {key: 'Escape'});

            expect(screen.queryByRole('dialog')).toBeNull();
            expect(headerOf(container, 1).querySelector('[role="button"]')).toHaveFocus();
        });

        it('offers no hiding when the host keeps no hidden set', () => {
            const {container} = render(
                <DataGrid
                    columns={columns}
                    data={data}
                    selectedRows={new Set()}
                    onSelectionChange={vi.fn()}
                    readonly
                />,
            );

            fireEvent.contextMenu(headerOf(container, 1));
            expect(screen.queryByText('dataGrid.columnVisibility.hideColumn')).toBeNull();
            expect(screen.queryByText('dataGrid.columnVisibility.chooseColumns')).toBeNull();
        });
    });

    describe('copy and export', () => {
        it('copies the selected rows with the visible columns only', async () => {
            const {container} = render(
                <HostedGrid initialHidden={new Set([2, 3])} selectedRows={new Set([0, 1])} />,
            );

            fireEvent.contextMenu(cellAt(container, 0, 1));
            fireEvent.click(await screen.findByText('dataGrid.copySelectedN:2'));

            await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
            expect(writeText.mock.calls[0][0]).toBe('id,customer_id,total\n1,10,99.5\n2,11,12');
        });

        it('exports the selected rows with the visible columns only', async () => {
            const {container} = render(
                <HostedGrid initialHidden={new Set([1, 2, 3])} selectedRows={new Set([1])} />,
            );

            fireEvent.contextMenu(cellAt(container, 1, 0));
            fireEvent.click(await screen.findByText('dataGrid.exportSelectedRows:1'));
            fireEvent.click(await screen.findByText('dataGrid.exportSelectedRowsCsv'));

            await waitFor(() => expect(downloadFileMock).toHaveBeenCalledOnce());
            const csv = new TextDecoder().decode(downloadFileMock.mock.calls[0][0].contents);
            expect(csv).toBe('id,total\n2,12\n');
        });

        it('copies a cell range without the hidden columns inside it', async () => {
            const ref = createRef<DataGridCommandTarget>();
            const {container} = render(<HostedGrid ref={ref} initialHidden={new Set([2, 3])} />);

            fireEvent.click(cellAt(container, 0, 1));
            fireEvent.click(cellAt(container, 1, 4), {shiftKey: true});
            const command = ref.current?.getResultCommands().copySelectedCells;
            expect(command?.count).toBe(4);
            await act(async () => {
                await command?.execute();
            });

            expect(writeText.mock.calls[0][0]).toBe('customer_id,total\n10,99.5\n11,12');
        });

        it('keeps every column in "Copy all"', async () => {
            const ref = createRef<DataGridCommandTarget>();
            render(<HostedGrid ref={ref} initialHidden={new Set([2, 3])} />);

            await act(async () => {
                await ref.current?.getResultCommands().copyAllRows?.execute();
            });

            expect(writeText.mock.calls[0][0]).toContain('created_by');
            expect(writeText.mock.calls[0][0]).toContain('ann');
        });
    });

    describe('keyboard', () => {
        it('moves across hidden columns', () => {
            const {container} = render(<HostedGrid initialHidden={new Set([2, 3])} />);
            const grid = gridOf(container);

            fireEvent.click(cellAt(container, 0, 1));
            fireEvent.keyDown(grid, {key: 'ArrowRight'});
            expect(cellAt(container, 0, 4)).toHaveClass('ring-2');
            fireEvent.keyDown(grid, {key: 'ArrowLeft'});
            expect(cellAt(container, 0, 1)).toHaveClass('ring-2');
            fireEvent.keyDown(grid, {key: 'End'});
            expect(cellAt(container, 0, 4)).toHaveClass('ring-2');
        });

        it('starts on the first visible column and jumps to the visible edges', () => {
            const {container} = render(<HostedGrid initialHidden={new Set([0, 4])} />);
            const grid = gridOf(container);

            fireEvent.keyDown(grid, {key: 'ArrowDown'});
            expect(cellAt(container, 0, 1)).toHaveClass('ring-2');
            fireEvent.keyDown(grid, {key: 'ArrowRight', ctrlKey: true});
            expect(cellAt(container, 0, 3)).toHaveClass('ring-2');
            fireEvent.keyDown(grid, {key: 'Home', ctrlKey: true});
            expect(cellAt(container, 0, 1)).toHaveClass('ring-2');
        });

        it('extends a range over hidden columns', async () => {
            const ref = createRef<DataGridCommandTarget>();
            const {container} = render(<HostedGrid ref={ref} initialHidden={new Set([2, 3])} />);
            const grid = gridOf(container);

            fireEvent.click(cellAt(container, 0, 1));
            fireEvent.keyDown(grid, {key: 'ArrowRight', shiftKey: true});
            expect(ref.current?.getResultCommands().copySelectedCells?.count).toBe(2);
            expect(cellAt(container, 0, 4)).toHaveClass('bg-accent-primary/15');
        });

        it('moves the focused cell off a column when it gets hidden', () => {
            const {container, rerender} = render(
                <DataGrid
                    columns={columns}
                    data={data}
                    readonly
                    hiddenColumns={new Set()}
                    onHiddenColumnsChange={vi.fn()}
                />,
            );
            fireEvent.click(cellAt(container, 0, 2));
            rerender(
                <DataGrid
                    columns={columns}
                    data={data}
                    readonly
                    hiddenColumns={new Set([2])}
                    onHiddenColumnsChange={vi.fn()}
                />,
            );
            expect(cellAt(container, 0, 3)).toHaveClass('ring-2');
        });
    });

    describe('editing', () => {
        const editableProps = {
            readonly: false,
            tableName: 'orders',
            pkColumns: ['id'],
            columnMetadata: metadata,
            nullableColumns: columns.slice(1),
        };

        it('stages an edit with the primary key while the key column is hidden', async () => {
            const onPendingChange = vi.fn();
            const {container} = render(
                <HostedGrid
                    {...editableProps}
                    initialHidden={new Set([0])}
                    onPendingChange={onPendingChange}
                />,
            );

            fireEvent.doubleClick(cellAt(container, 1, 2));
            const editor = container.querySelector('textarea')!;
            fireEvent.change(editor, {target: {value: 'carol'}});
            fireEvent.keyDown(editor, {key: 'Enter'});
            await act(async () => {});

            expect(onPendingChange).toHaveBeenCalledWith({id: 2}, 'created_by', 'carol');
        });

        it('tabs from cell to cell over hidden columns', async () => {
            const {container} = render(
                <HostedGrid
                    {...editableProps}
                    initialHidden={new Set([2, 3])}
                    onPendingChange={vi.fn()}
                />,
            );

            fireEvent.doubleClick(cellAt(container, 0, 1));
            fireEvent.keyDown(container.querySelector('textarea')!, {key: 'Tab'});
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
            });

            expect(cellAt(container, 0, 4).querySelector('textarea')).not.toBeNull();
        });

        it('pastes into the visible columns only', async () => {
            const onPendingChange = vi.fn();
            readClipboardMock.mockResolvedValue('20\t77');
            const {container} = render(
                <HostedGrid
                    {...editableProps}
                    initialHidden={new Set([2, 3])}
                    onPendingChange={onPendingChange}
                />,
            );

            fireEvent.mouseDown(cellAt(container, 0, 1));
            fireEvent.click(cellAt(container, 0, 1));
            fireEvent.keyDown(document, {key: 'v', metaKey: true});

            await waitFor(() => expect(onPendingChange).toHaveBeenCalledTimes(2));
            expect(onPendingChange.mock.calls).toEqual([
                [{id: 1}, 'customer_id', '20'],
                [{id: 1}, 'total', '77'],
            ]);
        });

        it('leaves hidden columns out of "Edit selection" on selected rows', async () => {
            const onPendingChange = vi.fn();
            const {container} = render(
                <HostedGrid
                    {...editableProps}
                    initialHidden={new Set([2])}
                    selectedRows={new Set([0])}
                    onPendingChange={onPendingChange}
                />,
            );

            fireEvent.contextMenu(cellAt(container, 0, 3));
            fireEvent.mouseEnter(await screen.findByText('dataGrid.editSelection'));
            // The submenu's entry, after the clicked cell's own "Set NULL".
            fireEvent.click((await screen.findAllByText('dataGrid.setNull')).at(-1)!);

            const touched = onPendingChange.mock.calls.map((call) => call[1]);
            expect(touched).toEqual(['customer_id', 'updated_at', 'total']);
        });
    });

    it('freezes the first visible column', () => {
        const {container} = render(<HostedGrid initialHidden={new Set([0])} />);

        fireEvent.contextMenu(headerOf(container, 1));
        fireEvent.click(screen.getByText('dataGrid.freezeFirstColumn'));

        expect(headerOf(container, 1)).toHaveClass('sticky');
        expect(cellAt(container, 0, 1)).toHaveClass('sticky');
        expect(headerOf(container, 2)).not.toHaveClass('sticky');
    });

    it('lists only visible columns in Jump to column', () => {
        const {container} = render(
            <KeybindingsContext.Provider
                value={{
                    shortcuts: [],
                    matchesShortcut: (event, id) =>
                        id === 'jump_to_column' && event.ctrlKey && event.key === 'j',
                    saveOverride: async () => {},
                    resetOverride: async () => {},
                    overrides: {},
                    isMac: false,
                }}
            >
                <HostedGrid initialHidden={new Set([1, 2])} />
            </KeybindingsContext.Provider>,
        );

        fireEvent.keyDown(gridOf(container), {key: 'j', ctrlKey: true});
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
            'id',
            'updated_at',
            'total',
        ]);
    });
});

describe('DataGrid hidden column widths (#1299)', () => {
    const MEASURED = 100;
    let clientWidthDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
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
        if (clientWidthDescriptor) {
            Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
        } else {
            delete (HTMLElement.prototype as {clientWidth?: number}).clientWidth;
        }
    });

    const renderGrid = (hidden: ReadonlySet<number>) => {
        const props = {
            columns,
            data,
            readonly: true,
            onHiddenColumnsChange: vi.fn(),
        };
        const utils = render(<DataGrid {...props} hiddenColumns={hidden} />);
        const cols = () =>
            Array.from(utils.container.querySelectorAll('col')).map((col) => col.style.width);
        const setHidden = (next: ReadonlySet<number>) =>
            utils.rerender(<DataGrid {...props} hiddenColumns={next} />);
        return {...utils, cols, setHidden};
    };

    it('locks a width per rendered column', () => {
        const {cols} = renderGrid(new Set([1, 2]));
        expect(cols()).toEqual(['100px', '100px', '100px', '100px']);
        expect(screen.getAllByRole('separator')).toHaveLength(3);
    });

    it('resizes the column the handle belongs to', () => {
        const {cols} = renderGrid(new Set([1, 2]));
        // Handles: id, updated_at, total.
        fireEvent.keyDown(screen.getAllByRole('separator')[2], {key: 'ArrowRight'});
        expect(cols()).toEqual(['100px', '100px', '100px', '110px']);
    });

    it('keeps resized widths and measures a column when it is shown', () => {
        const {cols, setHidden} = renderGrid(new Set([1]));
        fireEvent.keyDown(screen.getAllByRole('separator')[3], {key: 'ArrowRight'});
        expect(cols()).toEqual(['100px', '100px', '100px', '100px', '110px']);

        setHidden(new Set());
        // The shown column is measured; the resized one keeps its width.
        expect(cols()).toEqual(['100px', '100px', '100px', '100px', '100px', '110px']);
    });
});
