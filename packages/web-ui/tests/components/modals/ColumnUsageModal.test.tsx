import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {ColumnUsageModal} from '@/components/modals/ColumnUsageModal';
import type {QueryHistoryEntry} from '@/types/queryHistory';

const clientMock = vi.hoisted(() => ({call: vi.fn()}));
const navigationMock = vi.hoisted(() => ({open: vi.fn()}));
const openEditorMock = vi.hoisted(() => vi.fn());
const collectorMock = vi.hoisted(() => ({fail: null as Error | null}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => clientMock,
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({connections: [{id: 'conn-1', name: 'Shop'}]}),
}));

vi.mock('@/hooks/useDatabaseObjectNavigation', () => ({
    useDatabaseObjectNavigation: () => navigationMock,
}));

vi.mock('@/utils/editorNavigation', () => ({
    openEditor: openEditorMock,
}));

// Lets a test make the collection throw, as an unexpected parser error would.
vi.mock('@/utils/columnUsageCollector', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/columnUsageCollector')>();
    return {
        ...actual,
        collectColumnUsage: (...args: Parameters<typeof actual.collectColumnUsage>) =>
            collectorMock.fail
                ? Promise.reject(collectorMock.fail)
                : actual.collectColumnUsage(...args),
    };
});

const historyEntry = (overrides: Partial<QueryHistoryEntry>): QueryHistoryEntry => ({
    id: 'h1',
    sql: 'SELECT o.customer_id FROM public.orders o',
    executedAt: '2026-11-01T10:00:00Z',
    executionTimeMs: 1,
    status: 'success',
    rowsAffected: null,
    error: null,
    database: 'shop',
    ...overrides,
});

interface Responses {
    get_foreign_keys?: () => Promise<unknown>;
    get_query_history?: () => Promise<unknown>;
}

const respond = (responses: Responses = {}) => {
    clientMock.call.mockImplementation((command: string) => {
        switch (command) {
            case 'get_foreign_keys':
                return responses.get_foreign_keys?.() ?? Promise.resolve([]);
            case 'get_schema_snapshot':
                return Promise.resolve([]);
            case 'get_views':
                return Promise.resolve([]);
            case 'get_query_history':
                return responses.get_query_history?.() ?? Promise.resolve({entries: []});
            default:
                return Promise.reject(new Error(`unexpected ${command}`));
        }
    });
};

const renderModal = (onClose = vi.fn()) => {
    render(
        <ColumnUsageModal
            isOpen
            onClose={onClose}
            connectionId="conn-1"
            driver="postgres"
            table="orders"
            column="customer_id"
            schema="public"
            database="shop"
        />,
    );
    return onClose;
};

const sourceRow = (key: string) =>
    screen.getByText(`columnUsage.source.${key}`).closest('li') as HTMLElement;

describe('ColumnUsageModal', () => {
    beforeEach(() => {
        clientMock.call.mockReset();
        navigationMock.open.mockReset();
        openEditorMock.mockReset();
        collectorMock.fail = null;
    });

    it('puts the initial focus on the Close button of the footer', async () => {
        respond();
        renderModal();
        const closeButtons = screen.getAllByRole('button', {name: 'common.close'});
        const footerClose = closeButtons[closeButtons.length - 1];
        expect(footerClose).toHaveTextContent('common.close');
        expect(document.activeElement).toBe(footerClose);
        await screen.findByRole('button', {name: /columnUsage.rerun/});
    });

    it('stops between lookups and marks what was left as cancelled', async () => {
        let resolveKeys: (value: unknown) => void = () => {};
        respond({
            get_foreign_keys: () =>
                new Promise((resolve) => {
                    resolveKeys = resolve;
                }),
        });
        renderModal();
        const stop = await screen.findByRole('button', {name: /columnUsage.cancel/});
        fireEvent.click(stop);
        await act(async () => resolveKeys([]));

        await screen.findByRole('button', {name: /columnUsage.rerun/});
        expect(within(sourceRow('views')).getByText('columnUsage.status.cancelled')).toBeTruthy();
        expect(within(sourceRow('history')).getByText('columnUsage.status.cancelled')).toBeTruthy();
        const commands = clientMock.call.mock.calls.map(([command]) => command);
        expect(commands).not.toContain('get_views');
        expect(commands).not.toContain('get_query_history');
        expect(screen.getByText('columnUsage.noneIncomplete')).toBeInTheDocument();
    });

    it('settles every source as failed when the collection throws unexpectedly', async () => {
        respond();
        collectorMock.fail = new Error('parser exploded');
        renderModal();

        await screen.findByRole('button', {name: /columnUsage.rerun/});
        for (const key of ['foreignKeys', 'views', 'history']) {
            const row = sourceRow(key);
            expect(within(row).getByText('columnUsage.status.failed')).toBeTruthy();
            expect(within(row).getByText(/parser exploded/)).toBeTruthy();
        }
        expect(screen.queryByRole('button', {name: /columnUsage.cancel/})).toBeNull();

        // Search again runs a fresh collection.
        collectorMock.fail = null;
        fireEvent.click(screen.getByRole('button', {name: /columnUsage.rerun/}));
        await waitFor(() =>
            expect(
                within(sourceRow('history')).getByText('columnUsage.status.complete'),
            ).toBeTruthy(),
        );
    });

    it('opens a referenced table in the schema its key points to', async () => {
        respond({
            get_foreign_keys: () =>
                Promise.resolve([
                    {
                        name: 'orders_customer_fk',
                        column_name: 'customer_id',
                        ref_schema: 'sales',
                        ref_table: 'customers',
                        ref_column: 'id',
                    },
                ]),
        });
        const onClose = renderModal();

        const open = await screen.findByRole('button', {name: 'columnUsage.openAria'});
        fireEvent.click(open);
        expect(navigationMock.open).toHaveBeenCalledWith('customers', 'sales', undefined, 'shop');
        expect(openEditorMock).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('opens a history entry in an editor without running it', async () => {
        respond({
            get_query_history: () => Promise.resolve({entries: [historyEntry({})]}),
        });
        const onClose = renderModal();

        fireEvent.click(await screen.findByRole('button', {name: 'columnUsage.openAria'}));
        expect(openEditorMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                kind: 'console',
                initialQuery: 'SELECT o.customer_id FROM public.orders o',
                preventAutoRun: true,
                database: 'shop',
                targetConnectionId: 'conn-1',
            }),
        );
        expect(navigationMock.open).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('marks a history run that failed, with its error, and only that one', async () => {
        respond({
            get_query_history: () =>
                Promise.resolve({
                    entries: [
                        historyEntry({
                            id: 'f1',
                            status: 'error',
                            error: 'column o.customer_id does not exist',
                        }),
                        historyEntry({id: 's1', executedAt: '2026-11-02T10:00:00Z'}),
                    ],
                }),
        });
        renderModal();

        await screen.findByRole('button', {name: /columnUsage.rerun/});
        const items = screen
            .getAllByRole('button', {name: 'columnUsage.openAria'})
            .map((button) => button.closest('li') as HTMLElement);
        expect(items).toHaveLength(2);
        const failed = items.filter((item) => within(item).queryByText('columnUsage.failedRun'));
        expect(failed).toHaveLength(1);
        expect(
            within(failed[0]).getByText('column o.customer_id does not exist'),
        ).toBeInTheDocument();
        expect(screen.getAllByText('column o.customer_id does not exist')).toHaveLength(1);
    });
});
