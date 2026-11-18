import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {SaveHistoryModal} from '@/components/modals/SaveHistoryModal';
import {TabularisClient} from '@/api/client';
import {TauriTransport} from '@/api/transports/tauriTransport';
import {TabularisClientProvider} from '@/contexts/TabularisClientProvider';
import type {RestorePlan, SaveRecord} from '@/types/saveHistory';

const guard = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useProductionGuard', () => ({useProductionGuard: () => guard}));

const record: SaveRecord = {
    id: 'rec-1',
    savedAt: '2026-11-18T10:00:00Z',
    database: null,
    schema: 'public',
    table: 'orders',
    key: {id: 7},
    columns: [
        {
            name: 'status',
            dataType: 'text',
            pre: {kind: 'text', value: 'open'},
            post: {kind: 'text', value: 'closed'},
        },
        {name: 'note', dataType: 'text', pre: {kind: 'null'}, post: {kind: 'text', value: ''}},
    ],
    restorable: true,
    nonRestorableReason: null,
    restoredAt: null,
};

const plan = (over: Partial<RestorePlan> = {}): RestorePlan => ({
    recordId: 'rec-1',
    status: 'ready',
    reason: null,
    columns: [
        {
            name: 'status',
            dataType: 'text',
            expected: {kind: 'text', value: 'closed'},
            current: {kind: 'text', value: 'closed'},
            restoreTo: {kind: 'text', value: 'open'},
            conflict: false,
        },
        {
            name: 'note',
            dataType: 'text',
            expected: {kind: 'text', value: ''},
            current: {kind: 'text', value: ''},
            restoreTo: {kind: 'null'},
            conflict: false,
        },
    ],
    ...over,
});

const client = new TabularisClient(new TauriTransport());

function backend(options: {
    enabled?: boolean;
    supported?: boolean;
    records?: SaveRecord[];
    planResult?: RestorePlan;
    applyResult?: RestorePlan;
}) {
    vi.mocked(invoke).mockImplementation(async (command) => {
        switch (command) {
            case 'get_save_history_status':
                return {supported: options.supported ?? true, enabled: options.enabled ?? true};
            case 'list_save_history':
                return options.records ?? [record];
            case 'plan_save_restore':
                return options.planResult ?? plan();
            case 'apply_save_restore':
                return options.applyResult ?? plan({status: 'restored'});
            case 'set_save_history_enabled':
                return {supported: true, enabled: true};
            default:
                return null;
        }
    });
}

const renderModal = (onRestored = vi.fn()) =>
    render(
        <TabularisClientProvider client={client}>
            <SaveHistoryModal
                isOpen
                onClose={vi.fn()}
                connectionId="c1"
                table="orders"
                schema="public"
                onRestored={onRestored}
            />
        </TabularisClientProvider>,
    );

const callsTo = (command: string) =>
    vi.mocked(invoke).mock.calls.filter(([name]) => name === command);

beforeEach(() => {
    vi.mocked(invoke).mockReset();
    guard.mockReset();
    guard.mockResolvedValue(true);
});

describe('SaveHistoryModal', () => {
    it('lists the saves of the table with the connection scope', async () => {
        backend({});
        renderModal();
        expect(await screen.findByText(/id = 7/)).toBeInTheDocument();
        expect(callsTo('list_save_history')[0][1]).toEqual({
            connectionId: 'c1',
            table: 'orders',
            schema: 'public',
        });
    });

    it('shows the empty state and the off state of recording', async () => {
        backend({records: [], enabled: false});
        renderModal();
        expect(await screen.findByText('saveHistory.emptyDisabled')).toBeInTheDocument();
        expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('disables recording for a driver that cannot record', async () => {
        backend({records: [], enabled: false, supported: false});
        renderModal();
        expect(await screen.findByText('saveHistory.recording.unsupported')).toBeInTheDocument();
        expect(screen.getByRole('checkbox')).toBeDisabled();
    });

    it('turns recording on through the backend', async () => {
        backend({records: [], enabled: false});
        renderModal();
        const toggle = await screen.findByRole('checkbox');
        await waitFor(() => expect(toggle).not.toBeDisabled());
        fireEvent.click(toggle);
        await waitFor(() =>
            expect(callsTo('set_save_history_enabled')[0][1]).toEqual({
                connectionId: 'c1',
                enabled: true,
            }),
        );
    });

    it('reviews the plan before anything is written', async () => {
        backend({});
        renderModal();
        fireEvent.click(await screen.findByText(/id = 7/));
        expect(await screen.findByText('saveHistory.status.ready')).toBeInTheDocument();
        expect(callsTo('plan_save_restore')[0][1]).toEqual({
            connectionId: 'c1',
            recordId: 'rec-1',
        });
        expect(callsTo('apply_save_restore')).toHaveLength(0);
        expect(screen.getByText('saveHistory.plan.nullValue')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'saveHistory.actions.restore'})).toBeEnabled();
    });

    it('asks the write guard, restores and tells the grid to reload', async () => {
        backend({});
        const onRestored = vi.fn();
        renderModal(onRestored);
        fireEvent.click(await screen.findByText(/id = 7/));
        await screen.findByText('saveHistory.status.ready');
        fireEvent.click(screen.getByRole('button', {name: 'saveHistory.actions.restore'}));
        await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
        expect(guard).toHaveBeenCalledWith('c1');
        expect(callsTo('apply_save_restore')[0][1]).toEqual({
            connectionId: 'c1',
            recordId: 'rec-1',
        });
    });

    it('does not write when the write guard refuses', async () => {
        backend({});
        guard.mockResolvedValue(false);
        renderModal();
        fireEvent.click(await screen.findByText(/id = 7/));
        await screen.findByText('saveHistory.status.ready');
        fireEvent.click(screen.getByRole('button', {name: 'saveHistory.actions.restore'}));
        await waitFor(() => expect(guard).toHaveBeenCalled());
        expect(callsTo('apply_save_restore')).toHaveLength(0);
    });

    it('blocks the restore when the row changed since the save', async () => {
        const conflict = plan({status: 'conflict'});
        conflict.columns[0] = {
            ...conflict.columns[0],
            current: {kind: 'text', value: 'shipped'},
            conflict: true,
        };
        backend({planResult: conflict});
        renderModal();
        fireEvent.click(await screen.findByText(/id = 7/));
        expect(await screen.findByText('saveHistory.status.conflict')).toBeInTheDocument();
        expect(screen.getByText('shipped')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'saveHistory.actions.restore'})).toBeDisabled();
    });

    it.each([
        ['row_missing', 'saveHistory.status.rowMissing'],
        ['already_restored', 'saveHistory.status.alreadyRestored'],
    ] as const)('blocks the restore for a %s save', async (status, message) => {
        backend({planResult: plan({status})});
        renderModal();
        fireEvent.click(await screen.findByText(/id = 7/));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'saveHistory.actions.restore'})).toBeDisabled();
    });

    it('explains why a save is for review only', async () => {
        const reviewOnly: SaveRecord = {
            ...record,
            restorable: false,
            nonRestorableReason: 'table_has_triggers',
        };
        backend({
            records: [reviewOnly],
            planResult: plan({status: 'not_restorable', reason: 'table_has_triggers'}),
        });
        renderModal();
        expect(await screen.findByText('saveHistory.list.reviewOnly')).toBeInTheDocument();
        fireEvent.click(screen.getByText(/id = 7/));
        expect(
            await screen.findByText(/saveHistory\.reason\.tableHasTriggers/),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'saveHistory.actions.restore'})).toBeDisabled();
    });

    it('states that a restore is not a rollback', async () => {
        backend({});
        renderModal();
        fireEvent.click(await screen.findByText(/id = 7/));
        expect(await screen.findByText('saveHistory.plan.intro')).toBeInTheDocument();
    });
});
