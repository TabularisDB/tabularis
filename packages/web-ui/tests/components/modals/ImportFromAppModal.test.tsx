import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {ImportFromAppModal} from '@/components/modals/ImportFromAppModal';

const mocks = vi.hoisted(() => ({
    call: vi.fn(),
    chooseInputFile: vi.fn(),
    chooseServerPath: vi.fn(),
    supports: vi.fn(),
    readInputFile: vi.fn(),
    openExternalUrl: vi.fn(),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({connectionGroups: []}),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => mocks,
}));

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        negotiation: {environment: 'tauri'},
        supports: mocks.supports,
        chooseInputFile: mocks.chooseInputFile,
        chooseServerPath: mocks.chooseServerPath,
        readInputFile: mocks.readInputFile,
        openExternalUrl: mocks.openExternalUrl,
    }),
}));

vi.mock('@/components/ui/Select', () => ({
    Select: () => null,
}));

const TAB_PAYLOAD = {
    version: 1,
    groups: [],
    connections: [{id: 'c1', name: 'Prod'}],
};

const PREVIEW = {
    sourceName: 'Tabularis',
    credentialsAborted: false,
    items: [
        {
            index: 0,
            name: 'Prod',
            driverId: 'postgres',
            driverInstalled: true,
            host: 'db',
            port: 5432,
            database: 'app',
            username: 'u',
            hasSsh: false,
            hasPassword: false,
            status: {kind: 'ready'},
        },
    ],
};

function renderModal(onImported = vi.fn(), onClose = vi.fn()) {
    render(<ImportFromAppModal isOpen={true} onClose={onClose} onImported={onImported} />);
    return {onImported, onClose};
}

async function clickContinue() {
    fireEvent.click(await screen.findByText('common.continue'));
}

function passwordInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (!input) throw new Error('password input not rendered');
    return input;
}

describe('ImportFromAppModal — Tabularis JSON import', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.chooseInputFile.mockResolvedValue({
            name: 'export.json',
            reference: '/tmp/export.json',
        });
        mocks.readInputFile.mockResolvedValue(
            new TextEncoder().encode(JSON.stringify(TAB_PAYLOAD)),
        );
        mocks.call.mockImplementation((command: string) => {
            if (command === 'list_connection_import_sources') return Promise.resolve([]);
            if (command === 'preview_tabularis_import_file') {
                return Promise.resolve({kind: 'preview', preview: PREVIEW});
            }
            return Promise.resolve(undefined);
        });
    });

    it('previews a plaintext export through an opaque file reference, then applies', async () => {
        const {onImported, onClose} = renderModal();

        await clickContinue();

        await waitFor(() => {
            expect(mocks.call).toHaveBeenCalledWith('preview_tabularis_import_file', {
                file: {kind: 'serverPath', path: '/tmp/export.json'},
            });
        });
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.click(await screen.findByText('connections.importFromApp.importCount'));

        await waitFor(() => {
            expect(mocks.call).toHaveBeenCalledWith('apply_prepared_tabularis_import', {
                resolutions: [{index: 0, action: 'import', groupId: ''}],
            });
        });
        expect(onImported).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('prompts for a password before the backend decrypts and previews', async () => {
        mocks.call.mockImplementation((command: string, request?: {password?: string}) => {
            if (command === 'list_connection_import_sources') return Promise.resolve([]);
            if (command === 'preview_tabularis_import_file') {
                return Promise.resolve(
                    request?.password
                        ? {kind: 'preview', preview: PREVIEW}
                        : {kind: 'passwordRequired'},
                );
            }
            return Promise.resolve(undefined);
        });
        renderModal();

        await clickContinue();
        await waitFor(() => expect(passwordInput()).toBeInTheDocument());

        fireEvent.change(passwordInput(), {target: {value: 'hunter2'}});
        fireEvent.click(screen.getByText('connections.importPasswordModal.unlock'));

        await waitFor(() => {
            expect(mocks.call).toHaveBeenCalledWith('preview_tabularis_import_file', {
                file: {kind: 'serverPath', path: '/tmp/export.json'},
                password: 'hunter2',
            });
        });
        await screen.findByText('connections.importFromApp.importCount');
    });

    it('surfaces a wrong-password error and keeps the modal open', async () => {
        mocks.call.mockImplementation((command: string, request?: {password?: string}) => {
            if (command === 'list_connection_import_sources') return Promise.resolve([]);
            if (command === 'preview_tabularis_import_file') {
                return request?.password
                    ? Promise.reject('wrong password or corrupted file')
                    : Promise.resolve({kind: 'passwordRequired'});
            }
            return Promise.resolve(undefined);
        });
        const {onImported, onClose} = renderModal();

        await clickContinue();
        await waitFor(() => expect(passwordInput()).toBeInTheDocument());
        fireEvent.change(passwordInput(), {target: {value: 'bad'}});
        fireEvent.click(screen.getByText('connections.importPasswordModal.unlock'));

        await waitFor(() => {
            expect(screen.getByText(/wrong password or corrupted file/)).toBeInTheDocument();
        });
        expect(onImported).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('ImportFromAppModal — Project Configuration import', () => {
    const PROJECT_CONFIG_SOURCE = {
        id: 'project_config',
        displayName: 'Project Configuration (.env / Compose)',
        available: false,
        connectionCount: 0,
        readsPasswordsFromKeychain: false,
        needsFile: false,
        manualPathSupported: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.chooseServerPath.mockResolvedValue({
            reference: '/projects/my-app',
        });
        mocks.chooseInputFile.mockResolvedValue({
            name: '.env',
            reference: '/projects/my-app/.env',
        });
        mocks.readInputFile.mockResolvedValue(
            new TextEncoder().encode('DATABASE_URL=postgres://localhost/app'),
        );
        mocks.call.mockImplementation((command: string) => {
            if (command === 'list_connection_import_sources') {
                return Promise.resolve([PROJECT_CONFIG_SOURCE]);
            }
            if (command === 'preview_connection_import') {
                return Promise.resolve(PREVIEW);
            }
            return Promise.resolve(undefined);
        });
    });

    it('prompts for directory selection when server path is supported (desktop)', async () => {
        mocks.supports.mockImplementation((cap: string) => cap === 'chooseServerPath');
        renderModal();

        // Select the Project Configuration source radio/item
        const sourceButton = await screen.findByText('Project Configuration (.env / Compose)');
        fireEvent.click(sourceButton);

        await clickContinue();

        await waitFor(() => {
            expect(mocks.chooseServerPath).toHaveBeenCalledWith({kind: 'directory'});
            expect(mocks.call).toHaveBeenCalledWith('preview_connection_import', {
                sourceId: 'project_config',
                includePasswords: true,
                file: {kind: 'serverPath', path: '/projects/my-app'},
            });
        });
    });

    it('falls back to input file upload when chooseServerPath is unsupported (web)', async () => {
        mocks.supports.mockReturnValue(false);
        renderModal();

        const sourceButton = await screen.findByText('Project Configuration (.env / Compose)');
        fireEvent.click(sourceButton);

        await clickContinue();

        await waitFor(() => {
            expect(mocks.chooseInputFile).toHaveBeenCalledWith({
                filters: [{name: 'Configuration Files', extensions: ['env', 'yaml', 'yml']}],
            });
            expect(mocks.call).toHaveBeenCalledWith('preview_connection_import', {
                sourceId: 'project_config',
                includePasswords: true,
                file: {kind: 'serverPath', path: '/projects/my-app/.env'},
            });
        });
    });
});
