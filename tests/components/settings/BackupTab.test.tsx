import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BackupTab} from '@/components/settings/BackupTab';
import type {DatabaseBackupPlan, DatabaseBackupStatus} from '@/types/databaseBackup';

const {invoke, updateSetting, showAlert, settings} = vi.hoisted(() => ({
    invoke: vi.fn(),
    updateSetting: vi.fn(),
    showAlert: vi.fn(),
    settings: {current: {} as Record<string, unknown>},
}));
vi.unmock('lucide-react');
vi.mock('@tauri-apps/api/core', () => ({invoke}));
vi.mock('@tauri-apps/plugin-dialog', () => ({open: vi.fn()}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: settings.current, updateSetting}),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert})}));

const plan: DatabaseBackupPlan = {
    enabled: true,
    connectionId: 'conn_pg',
    database: 'production',
    time: '02:00',
    timezone: 'UTC',
    destinationDirectory: '/backups',
    retention: 7,
    includeStructure: true,
    includeData: true,
};

const idleStatus: DatabaseBackupStatus = {
    lastRunAt: null,
    lastSuccessfulRunAt: null,
    lastOutcome: null,
    lastError: null,
    lastBackupFile: null,
    nextRunAt: null,
    isRunning: false,
};

function mockBackend(dbStatus: () => DatabaseBackupStatus) {
    invoke.mockImplementation(async (cmd: string) => {
        switch (cmd) {
            case 'get_database_backup_status':
                return dbStatus();
            case 'get_connections_backup_status':
                return {passwordSet: false, targetPasswordSet: false};
            case 'get_connections':
            case 'get_registered_drivers':
                return [];
            default:
                return undefined;
        }
    });
}

const dbStatusCalls = () =>
    invoke.mock.calls.filter(([cmd]) => cmd === 'get_database_backup_status').length;

describe('BackupTab database backups', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settings.current = {databaseBackupPlan: plan};
        updateSetting.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('exposes the content options as toggle buttons and keeps one selected', async () => {
        mockBackend(() => idleStatus);
        settings.current = {databaseBackupPlan: {...plan, includeData: false}};
        render(<BackupTab />);

        const structure = await screen.findByRole('button', {
            name: 'settings.backup.dbBackupIncludeStructure',
        });
        const data = screen.getByRole('button', {name: 'settings.backup.dbBackupIncludeData'});

        expect(structure).toHaveAttribute('aria-pressed', 'true');
        expect(data).toHaveAttribute('aria-pressed', 'false');
        // Unchecking the only selected option would write an empty dump.
        expect(structure).toBeDisabled();
        expect(data).toBeEnabled();

        fireEvent.click(data);
        expect(updateSetting).toHaveBeenCalledWith(
            'databaseBackupPlan',
            expect.objectContaining({includeStructure: true, includeData: true}),
        );
    });

    it('cancels the backend run in progress without naming a connection', async () => {
        mockBackend(() => ({...idleStatus, isRunning: true}));
        render(<BackupTab />);

        fireEvent.click(
            await screen.findByRole('button', {name: 'settings.backup.dbBackupCancel'}),
        );

        await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_database_backup'));
    });

    it('polls the status, so a scheduled run that starts while open shows a Cancel button', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        let running = false;
        mockBackend(() => ({...idleStatus, isRunning: running}));
        render(<BackupTab />);

        await waitFor(() => expect(dbStatusCalls()).toBeGreaterThan(0));
        expect(screen.queryByRole('button', {name: 'settings.backup.dbBackupCancel'})).toBeNull();

        // The scheduler starts a run in the background.
        running = true;
        const before = dbStatusCalls();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(15_000);
        });

        expect(dbStatusCalls()).toBeGreaterThan(before);
        expect(
            await screen.findByRole('button', {name: 'settings.backup.dbBackupCancel'}),
        ).toBeInTheDocument();
    });
});
