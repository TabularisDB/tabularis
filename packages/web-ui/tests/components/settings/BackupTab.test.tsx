import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
vi.unmock('lucide-react');
import {BackupTab} from '@/components/settings/BackupTab';

const mocks = vi.hoisted(() => ({
    call: vi.fn(),
    consumeDownload: vi.fn(),
    downloadFile: vi.fn(),
    showAlert: vi.fn(),
    updateSetting: vi.fn(),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => mocks,
}));

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        negotiation: {environment: 'browser'},
        downloadFile: mocks.downloadFile,
    }),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings: {
            backupMode: 'manual',
            backupTarget: 'local',
            backupDirectory: '/srv/tabularis/backups',
            backupIntervalMinutes: 1440,
            backupRetention: 10,
        },
        updateSetting: mocks.updateSetting,
    }),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: mocks.showAlert}),
}));

vi.mock('@/components/settings/SettingControls', () => ({
    SettingSection: ({children}: {children: React.ReactNode}) => <section>{children}</section>,
    SettingRow: ({
        label,
        description,
        children,
    }: {
        label: string;
        description: string;
        children: React.ReactNode;
    }) => (
        <div>
            <span>{label}</span>
            <span>{description}</span>
            {children}
        </div>
    ),
    SettingToggle: () => null,
    SettingButtonGroup: () => null,
    SettingNumberInput: () => null,
}));

vi.mock('@/components/ui/PasswordInput', () => ({
    PasswordInput: () => <input type="password" />,
}));

describe('BackupTab browser adaptation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.call.mockImplementation((command: string) => {
            if (command === 'get_connections' || command === 'get_registered_drivers')
                return Promise.resolve([]);
            if (command === 'get_database_backup_status')
                return Promise.resolve({isRunning: false});
            if (command === 'get_connections_backup_status') {
                return Promise.resolve({
                    passwordSet: true,
                    targetPasswordSet: true,
                    lastBackupAt: null,
                    targetKind: 'serverDirectory',
                    targetDisplay: '/srv/tabularis/backups',
                });
            }
            if (command === 'run_connections_backup') {
                return Promise.resolve({
                    serverLocation: '/srv/tabularis/backups/tabularis-backup.json',
                    targetKind: 'serverDirectory',
                    download: {
                        kind: 'download',
                        fileName: 'tabularis-backup.json',
                        mimeType: 'application/json',
                        token: 'backup-download',
                        size: 9,
                    },
                });
            }
            return Promise.resolve(null);
        });
        mocks.consumeDownload.mockResolvedValue(
            new Blob(['encrypted'], {type: 'application/json'}),
        );
        mocks.downloadFile.mockResolvedValue(true);
    });

    it('lets browser users set a database backup server directory without a picker', async () => {
        render(<BackupTab />);
        const directory = await screen.findByRole('textbox', {
            name: 'settings.backup.dbBackupDirectory',
        });
        fireEvent.change(directory, {target: {value: '/srv/database-backups'}});
        fireEvent.blur(directory);
        await waitFor(() =>
            expect(mocks.updateSetting).toHaveBeenCalledWith(
                'databaseBackupPlan',
                expect.objectContaining({destinationDirectory: '/srv/database-backups'}),
            ),
        );
    });

    it('labels local targets as server paths and downloads manual backup copies', async () => {
        render(<BackupTab />);

        expect(screen.getAllByText('settings.backup.serverDirectoryDesc')[0]).toBeInTheDocument();
        expect(screen.getByDisplayValue('/srv/tabularis/backups')).toBeInTheDocument();

        const buttons = screen.getAllByRole('button', {
            name: 'settings.backup.backupNow',
        });
        const backupButton = buttons.at(-1)!;
        await waitFor(() => expect(backupButton).toBeEnabled());
        fireEvent.click(backupButton);

        await waitFor(() => {
            expect(mocks.consumeDownload).toHaveBeenCalledWith('backup-download');
            expect(mocks.downloadFile).toHaveBeenCalledWith({
                fileName: 'tabularis-backup.json',
                mimeType: 'application/json',
                contents: expect.any(Uint8Array),
            });
        });
        expect(mocks.showAlert).toHaveBeenCalledWith('settings.backup.backupDone');
    });
});
