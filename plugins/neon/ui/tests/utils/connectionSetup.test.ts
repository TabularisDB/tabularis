// @vitest-environment jsdom
import {createElement} from 'react';
import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import {afterEach, beforeEach, describe, it, expect, vi} from 'vitest';
import NeonActions from '../../src/index';
import {ConnectionSetup} from '../../src/ConnectionSetup';

const {rpc, account, inlineAuth, t} = vi.hoisted(() => ({
    rpc: {call: vi.fn()},
    account: {secretFields: vi.fn()},
    inlineAuth: vi.fn(),
    t: (key: string) => key,
}));
vi.mock('@tabularis/plugin-api', () => ({
    usePluginTranslation: () => t,
    usePluginRpc: () => rpc,
    usePluginAccount: () => account,
    usePluginWorkspace: () => ({openWorkspace: vi.fn()}),
    usePluginConnection: () => ({}),
    usePluginModal: () => ({openModal: vi.fn(), closeModal: vi.fn()}),
    PluginExplorerSection: () => null,
}));
vi.mock('../../src/AccountWizard', () => ({
    AccountWizard: ({onConnected, onClose}: {onConnected: () => void; onClose: () => void}) =>
        createElement(
            'div',
            null,
            createElement('button', {onClick: onConnected}, 'Import selected branch'),
            createElement('button', {onClick: onClose}, 'Done'),
        ),
}));
vi.mock('../../src/components/ManagementAccountForm', () => ({
    ManagementAccountForm: (props: unknown) => {
        inlineAuth(props);
        return createElement('p', null, 'Inline Neon account access');
    },
}));

describe('Neon plugin connection setup', () => {
    afterEach(cleanup);
    beforeEach(() => {
        vi.clearAllMocks();
        account.secretFields.mockResolvedValue(['NEON_API_KEY']);
        rpc.call.mockResolvedValue({
            projectId: 'project-one',
            branchId: 'br-production',
            branchName: 'production',
        });
    });
    it('has no global connection-page launcher or foreign-driver auth UI', () => {
        const {container, rerender} = render(
            createElement(NeonActions, {pluginId: 'neon', context: {onConnectionCreated: vi.fn()}}),
        );
        expect(container.innerHTML).toBe('');
        rerender(
            createElement(NeonActions, {
                pluginId: 'neon',
                context: {
                    driver: 'postgresql',
                    isEditing: false,
                    onConnectionCreated: vi.fn(),
                    onClose: vi.fn(),
                },
            }),
        );
        expect(container.innerHTML).toBe('');
    });
    it('owns Neon onboarding inside the selected driver and notifies the host only after import', () => {
        const onCreated = vi.fn(),
            onClose = vi.fn();
        render(
            createElement(NeonActions, {
                pluginId: 'neon',
                context: {
                    driver: 'neon',
                    connectionId: null,
                    isEditing: false,
                    onConnectionCreated: onCreated,
                    onClose,
                },
            }),
        );
        expect(screen.getByText('connectionSetup.branches')).toBeDefined();
        expect(screen.getByText('connectionSetup.backend')).toBeDefined();
        fireEvent.click(screen.getByRole('button', {name: 'Import selected branch'}));
        expect(onCreated).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Done'}));
        expect(onClose).toHaveBeenCalledOnce();
    });
    it('shows the existing branch without importing a duplicate connection', async () => {
        const imported = vi.fn();
        render(
            createElement(ConnectionSetup, {
                connectionId: 'saved-neon',
                isEditing: true,
                onConnectionCreated: imported,
                onClose: vi.fn(),
            }),
        );
        await waitFor(() => expect(screen.getByText('project-one')).toBeDefined());
        expect(screen.getByText('production')).toBeDefined();
        expect(screen.queryByRole('button', {name: 'Import selected branch'})).toBeNull();
        expect(imported).not.toHaveBeenCalled();
        expect(rpc.call).toHaveBeenCalledWith('neon_management_context');
    });
    it('offers inline account authentication for a saved branch without a stored account', async () => {
        account.secretFields.mockResolvedValue([]);
        render(
            createElement(ConnectionSetup, {
                connectionId: 'saved-neon',
                isEditing: true,
                onConnectionCreated: vi.fn(),
                onClose: vi.fn(),
            }),
        );
        await waitFor(() => expect(screen.getByText('Inline Neon account access')).toBeDefined());
        expect(inlineAuth).toHaveBeenLastCalledWith(
            expect.objectContaining({projectId: 'project-one'}),
        );
    });
});
