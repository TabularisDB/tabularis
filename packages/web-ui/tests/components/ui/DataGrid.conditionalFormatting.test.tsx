import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {ComponentProps} from 'react';
import {vi} from 'vitest';
import {DataGrid} from '@/components/ui/DataGrid';
import {UI_STATE_KEYS, uiStateStore} from '@/utils/uiStateStore';
import {formatRulesScope, type FormatRule} from '@/utils/conditionalFormatting';
import {KeybindingsContext} from '@/contexts/KeybindingsContext';

// Conditional formatting in the data grid (#991). Mocks mirror DataGrid.test.tsx.

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
    // Keys come back as they are, with the rule names when there are some.
    translate: (key: string, options?: {names?: string}) =>
        options?.names === undefined ? key : `${key}:${options.names}`,
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

const columns = ['id', 'status', 'amount', 'deleted_at'];
const data: unknown[][] = [
    [1, 'paid', 10, null],
    [2, 'failed', 20, null],
    [3, 'paid', -5, null],
    [4, 'paid', 7, '2026-01-01'],
];
const metadata = columns.map((name) => ({
    name,
    data_type: name === 'id' || name === 'amount' ? 'integer' : 'varchar(50)',
    is_pk: name === 'id',
    is_nullable: name !== 'id',
    is_auto_increment: false,
}));

const rules: FormatRule[] = [
    {
        id: 'a',
        name: 'Failed',
        column: 'status',
        operator: '=',
        value: 'failed',
        tone: 'danger',
        target: 'row',
    },
    {
        id: 'b',
        name: 'Negative',
        column: 'amount',
        operator: '<',
        value: '0',
        tone: 'danger',
        target: 'cell',
    },
    {
        id: 'c',
        name: 'Deleted',
        column: 'deleted_at',
        operator: 'IS NOT NULL',
        value: '',
        tone: 'muted',
        target: 'row',
    },
];

const seed = (tableRules: FormatRule[], table = 'orders') =>
    uiStateStore.set(UI_STATE_KEYS.gridFormatRules.key, {
        conn1: {[formatRulesScope('shop', 'public', table)]: tableRules},
    });

type GridProps = ComponentProps<typeof DataGrid>;

function Grid(props: Partial<GridProps>) {
    return (
        <DataGrid
            columns={columns}
            data={data}
            columnMetadata={metadata}
            tableName="orders"
            connectionId="conn1"
            database="shop"
            schema="public"
            pkColumns={['id']}
            selectedRows={new Set()}
            onSelectionChange={vi.fn()}
            conditionalFormatting
            {...props}
        />
    );
}

const rowOf = (container: HTMLElement, rowIndex: number) =>
    container.querySelector(`tr[data-row-index="${rowIndex}"]`)!;
const rowNumberOf = (container: HTMLElement, rowIndex: number) =>
    rowOf(container, rowIndex).querySelector('td')!;
const cellAt = (container: HTMLElement, rowIndex: number, colIndex: number) =>
    container.querySelector(`td[data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`)!;
const headerOf = (container: HTMLElement, colIndex: number) =>
    container.querySelector(`th[data-col-index="${colIndex}"]`)!;

describe('DataGrid conditional formatting (#991)', () => {
    afterEach(() => {
        uiStateStore.set(UI_STATE_KEYS.gridFormatRules.key, null);
    });

    it('tints a matching row and exposes the rule name for screen readers', () => {
        seed(rules);
        const {container} = render(<Grid />);

        expect(rowOf(container, 1).className).toContain('bg-accent-error/15');
        expect(rowNumberOf(container, 1)).toHaveAttribute('title', 'Failed');
        expect(rowNumberOf(container, 1).querySelector('.sr-only')?.textContent).toBe(
            'dataGrid.conditionalFormatting.matchedRules:Failed',
        );
        expect(rowOf(container, 0).className).not.toContain('bg-accent-');
        expect(rowNumberOf(container, 0)).not.toHaveAttribute('title');
        expect(rowNumberOf(container, 0).querySelector('.sr-only')).toBeNull();
    });

    it('colors only the cell of a cell rule', () => {
        seed(rules);
        const {container} = render(<Grid />);

        expect(cellAt(container, 2, 2).className).toContain('text-accent-error');
        expect(cellAt(container, 2, 2).className).not.toContain('text-secondary');
        expect(cellAt(container, 2, 1).className).not.toContain('text-accent-error');
        expect(rowOf(container, 2).className).not.toContain('bg-accent-');
        expect(rowNumberOf(container, 2)).toHaveAttribute('title', 'Negative');
    });

    it('dims every cell of a muted row', () => {
        seed(rules);
        const {container} = render(<Grid />);

        for (const colIndex of [0, 1, 2, 3]) {
            expect(cellAt(container, 3, colIndex).className).toContain('text-muted');
            // The default text color would win over the rule's color.
            expect(cellAt(container, 3, colIndex).className).not.toContain('text-secondary');
        }
        expect(cellAt(container, 0, 1).className).not.toContain('text-muted');
    });

    it('formats the records in the transposed layout too', () => {
        seed(rules);
        const {container} = render(<Grid transposed />);

        expect(cellAt(container, 1, 0).className).toContain('bg-accent-error/15');
        expect(cellAt(container, 1, 3).className).toContain('bg-accent-error/15');
        expect(cellAt(container, 0, 0).className).not.toContain('bg-accent-error');
        expect(cellAt(container, 2, 2).className).toContain('text-accent-error');
        const recordHeader = container.querySelector('th[data-record-index="1"]')!;
        expect(recordHeader).toHaveAttribute('title', 'Failed');
        expect(recordHeader.querySelector('.sr-only')?.textContent).toBe(
            'dataGrid.conditionalFormatting.matchedRules:Failed',
        );
    });

    it('applies only the rules of its own table', () => {
        seed(rules, 'customers');
        const {container} = render(<Grid />);
        expect(rowOf(container, 1).className).not.toContain('bg-accent-');
    });

    it('stays off for query results', () => {
        seed(rules);
        const {container} = render(<Grid conditionalFormatting={false} />);

        expect(rowOf(container, 1).className).not.toContain('bg-accent-');
        fireEvent.contextMenu(headerOf(container, 1));
        expect(screen.queryByText('dataGrid.conditionalFormatting.menu')).toBeNull();
    });

    it('adds a rule from the column header menu and applies it on save', async () => {
        const {container} = render(<Grid />);
        expect(rowOf(container, 1).className).not.toContain('bg-accent-');

        fireEvent.contextMenu(headerOf(container, 1));
        fireEvent.click(screen.getByText('dataGrid.conditionalFormatting.menu'));
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('dataGrid.conditionalFormatting.empty');

        fireEvent.click(screen.getByText('dataGrid.conditionalFormatting.addRule'));
        // The new rule starts on the right-clicked column.
        expect(screen.getByLabelText('dataGrid.conditionalFormatting.column')).toHaveValue(
            'status',
        );

        // Saving an incomplete rule is refused with a message.
        fireEvent.click(screen.getByText('common.save'));
        expect(screen.getByText('dataGrid.conditionalFormatting.incomplete')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('dataGrid.conditionalFormatting.name'), {
            target: {value: 'Failed orders'},
        });
        fireEvent.change(screen.getByLabelText('dataGrid.conditionalFormatting.value'), {
            target: {value: "'failed'"},
        });
        fireEvent.click(screen.getByText('common.save'));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(rowOf(container, 1).className).toContain('bg-accent-error/15');
        expect(rowNumberOf(container, 1)).toHaveAttribute('title', 'Failed orders');
        const stored = uiStateStore.get<Record<string, Record<string, FormatRule[]>>>(
            UI_STATE_KEYS.gridFormatRules.key,
            {},
        );
        expect(stored.conn1[formatRulesScope('shop', 'public', 'orders')]).toMatchObject([
            {name: 'Failed orders', column: 'status', operator: '=', value: "'failed'"},
        ]);
    });

    it('keeps the saved rules when the editor is cancelled', () => {
        seed(rules);
        const {container} = render(<Grid />);

        fireEvent.contextMenu(headerOf(container, 1));
        fireEvent.click(screen.getByText('dataGrid.conditionalFormatting.menu'));
        fireEvent.click(screen.getAllByLabelText('dataGrid.conditionalFormatting.remove')[0]);
        fireEvent.click(screen.getByText('common.cancel'));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(rowOf(container, 1).className).toContain('bg-accent-error/15');
    });
});
