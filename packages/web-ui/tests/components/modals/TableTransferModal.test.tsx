import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {TableTransferModal} from '@/components/modals/TableTransferModal';
import type {TableTransferPlan, TableTransferResult} from '@/api/contract';

const mocks = vi.hoisted(() => ({
    call: vi.fn(),
    subscribe: vi.fn().mockResolvedValue(() => {}),
    showAlert: vi.fn(),
    guard: vi.fn(),
    connections: [
        {id: 'pg-1', name: 'Staging PG', params: {driver: 'postgres', database: 'app'}},
        {id: 'lite-1', name: 'Local SQLite', params: {driver: 'sqlite', database: '/tmp/a.db'}},
        {id: 'my-1', name: 'MySQL', params: {driver: 'mysql', database: 'app'}},
    ],
}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => mocks}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => ({connections: mocks.connections})}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: mocks.showAlert})}));
vi.mock('@/hooks/useProductionGuard', () => ({useProductionGuard: () => mocks.guard}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));

const okPlan = (blocking = false): TableTransferPlan => ({
    blocking,
    issues: [],
    tables: [
        {
            sourceTable: 'customers',
            targetTable: 'customers',
            blocking,
            estimatedRows: 100,
            issues: blocking ? [{code: 'incompatibleTypes', column: 'id'}] : [],
            columns: [
                {
                    sourceColumn: 'id',
                    sourceType: 'integer',
                    targetColumn: 'id',
                    targetType: 'INTEGER',
                    rule: 'exact',
                    skipped: false,
                    issue: blocking ? 'incompatibleTypes' : null,
                },
            ],
        },
    ],
});

const result = (status: TableTransferResult['status'], written: number): TableTransferResult => ({
    transferId: 'job',
    status,
    tables: [
        {
            sourceTable: 'customers',
            targetTable: 'customers',
            status,
            rowsRead: written,
            rowsWritten: written,
            rowsSkipped: 0,
            rowsFailed: 0,
            error: null,
        },
    ],
});

function setup(
    plan = okPlan(),
    run: Promise<TableTransferResult> = Promise.resolve(result('completed', 100)),
) {
    mocks.call.mockImplementation(async (command: string) => {
        switch (command) {
            case 'get_table_transfer_capabilities':
                return {
                    pairs: [
                        {source: 'postgres', target: 'postgres'},
                        {source: 'postgres', target: 'sqlite'},
                    ],
                    writeModes: ['append'],
                    conflictModes: ['fail', 'skip'],
                    maxBatchRows: 5000,
                    defaultBatchRows: 500,
                };
            case 'get_schemas':
                return [];
            case 'get_tables':
                return [{name: 'customers'}];
            case 'get_columns':
                return [{name: 'id'}];
            case 'plan_table_transfer':
                return plan;
            case 'run_table_transfer':
                return run;
            default:
                return undefined;
        }
    });
    const onClose = vi.fn();
    render(
        <TableTransferModal
            isOpen
            onClose={onClose}
            sourceConnectionId="pg-1"
            sourceTable="customers"
            sourceSchema="public"
        />,
    );
    return {onClose};
}

async function reachReview() {
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('tableTransfer.targetConnection'), {
        target: {value: 'lite-1'},
    });
    await waitFor(() =>
        expect(screen.getByLabelText('tableTransfer.targetTable')).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('tableTransfer.targetTable'), {
        target: {value: 'customers'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.review'}));
    await waitFor(() =>
        expect(screen.getByRole('button', {name: 'tableTransfer.start'})).toBeInTheDocument(),
    );
}

describe('TableTransferModal', () => {
    beforeEach(() => {
        mocks.call.mockReset();
        mocks.showAlert.mockClear();
        mocks.guard.mockReset().mockResolvedValue(true);
    });

    it('offers only connections the capability matrix allows as a target', async () => {
        setup();
        await act(async () => {});
        const options = screen.getAllByRole('option').map((option) => option.textContent);
        expect(options).toContain('Staging PG');
        expect(options).toContain('Local SQLite');
        expect(options).not.toContain('MySQL');
    });

    it('plans with the explicit source and target, then runs append-only', async () => {
        setup();
        await reachReview();
        expect(mocks.call).toHaveBeenCalledWith('plan_table_transfer', {
            request: expect.objectContaining({
                sourceConnectionId: 'pg-1',
                sourceSchema: 'public',
                targetConnectionId: 'lite-1',
                tables: [{sourceTable: 'customers', targetTable: 'customers'}],
            }),
        });

        fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.start'}));
        await waitFor(() => expect(mocks.guard).toHaveBeenCalledWith('lite-1'));
        await waitFor(() =>
            expect(mocks.call).toHaveBeenCalledWith(
                'run_table_transfer',
                {
                    request: expect.objectContaining({
                        conflict: 'fail',
                        transferId: expect.any(String),
                    }),
                },
                expect.objectContaining({cancellationId: expect.any(String)}),
            ),
        );
        expect(await screen.findByText('tableTransfer.status.completed')).toBeInTheDocument();
    });

    it('does not start while the plan has blocking issues', async () => {
        setup(okPlan(true));
        await reachReview();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'tableTransfer.issue.incompatibleTypes',
        );
        expect(screen.getByRole('button', {name: 'tableTransfer.start'})).toBeDisabled();
    });

    it('does not run when the production write guard is declined', async () => {
        setup();
        await reachReview();
        mocks.guard.mockResolvedValue(false);
        fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.start'}));
        await act(async () => {});
        expect(mocks.call).not.toHaveBeenCalledWith(
            'run_table_transfer',
            expect.anything(),
            expect.anything(),
        );
    });

    it('cancels a running transfer and says what stays committed', async () => {
        let finish!: (value: TableTransferResult) => void;
        setup(
            okPlan(),
            new Promise<TableTransferResult>((resolve) => {
                finish = resolve;
            }),
        );
        await reachReview();
        fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.start'}));
        const cancel = await screen.findByRole('button', {name: 'common.cancel'});
        fireEvent.click(cancel);
        await waitFor(() =>
            expect(mocks.call).toHaveBeenCalledWith('cancel_table_transfer', {
                transferId: expect.any(String),
            }),
        );
        await act(async () => {
            finish(result('cancelled', 500));
        });
        expect(await screen.findByText('tableTransfer.status.cancelled')).toBeInTheDocument();
        expect(screen.getByText('tableTransfer.committedRemain')).toBeInTheDocument();
    });

    it('returns to the review step with the error when the run request fails', async () => {
        let fail!: (error: Error) => void;
        setup(
            okPlan(),
            new Promise<TableTransferResult>((_, reject) => {
                fail = reject;
            }),
        );
        await reachReview();
        fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.start'}));
        await screen.findByRole('button', {name: 'common.cancel'});
        await act(async () => {
            fail(new Error('connection lost'));
        });
        expect(await screen.findByText(/connection lost/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'tableTransfer.start'})).toBeEnabled();
    });
});
