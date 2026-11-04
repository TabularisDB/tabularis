// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AuthManager} from '../../src/AuthManager';

const {rpcCall, manageCall, openWorkspace, scope} = vi.hoisted(() => ({
    rpcCall: vi.fn(),
    manageCall: vi.fn(),
    openWorkspace: vi.fn(),
    scope: {
        current: {projectId: 'project', branchId: 'branch'} as {
            projectId: string;
            branchId: string;
        } | null,
    },
}));
vi.mock('@tabularis/plugin-api', async () => {
    const {createElement} = await import('react');
    const {PluginSelect} = await import('@/components/plugins/PluginSelect');
    const rpc = {call: rpcCall};
    const workspace = {openWorkspace};
    return {
        PluginSelect,
        usePluginRpc: () => rpc,
        usePluginWorkspace: () => workspace,
        usePluginTranslation: () => (key: string) => key,
        PluginResourceList: ({
            items,
            onOpen,
        }: {
            items: {id: string; title: string}[];
            onOpen: (id: string) => void;
        }) =>
            createElement(
                'div',
                null,
                ...items.map((item) =>
                    createElement(
                        'button',
                        {key: item.id, type: 'button', onClick: () => onOpen(item.id)},
                        item.title,
                    ),
                ),
            ),
    };
});
vi.mock('../../src/hooks/useNeonManagement', () => ({
    useNeonManagement: () => ({
        scope: scope.current,
        pending: false,
        call: manageCall,
        reload: vi.fn(),
        connectAccount: vi.fn(),
    }),
}));

const user = {
    id: 'existing-user',
    name: 'Existing User',
    email: 'existing@example.com',
    emailVerified: true,
    createdAt: '2026-10-31T12:00:00Z',
    role: 'user',
};

describe('Auth management actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        scope.current = {projectId: 'project', branchId: 'branch'};
        rpcCall.mockImplementation(async (method: string) =>
            method === 'neon_auth_users_page'
                ? {users: [user], total: 1}
                : {
                      user,
                      sessions: [],
                      capabilities: {
                          profileUpdate: false,
                          sessionRevoke: false,
                          passwordReset: false,
                      },
                  },
        );
        manageCall.mockResolvedValue({id: 'new-user'});
    });
    afterEach(cleanup);

    it('creates an identity without asking for a password and refreshes the user list', async () => {
        render(createElement(AuthManager, {connectionId: 'connection'}));
        await screen.findByRole('button', {name: 'Existing User'});
        fireEvent.click(screen.getByRole('button', {name: 'authManager.addUser'}));
        fireEvent.change(screen.getByLabelText('authManager.name'), {target: {value: 'New User'}});
        fireEvent.change(screen.getByLabelText('authManager.email'), {
            target: {value: 'new@example.com'},
        });
        expect(screen.queryByLabelText(/password/i)).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'authManager.createUser'}));
        await waitFor(() =>
            expect(manageCall).toHaveBeenCalledWith('account_auth_create_user', {
                name: 'New User',
                email: 'new@example.com',
            }),
        );
        await screen.findByText('authManager.userCreated');
        expect((screen.getByLabelText('authManager.email') as HTMLInputElement).value).toBe('');
        await waitFor(() =>
            expect(
                rpcCall.mock.calls.filter(([method]) => method === 'neon_auth_users_page').length,
            ).toBe(2),
        );
    });

    it('requires explicit confirmation before deleting the selected user', async () => {
        render(createElement(AuthManager, {connectionId: 'connection', userId: user.id}));
        await screen.findByRole('heading', {name: 'Existing User'});
        fireEvent.click(screen.getByRole('button', {name: 'authManager.deleteUser'}));
        expect(manageCall).not.toHaveBeenCalled();
        expect(screen.getByText('authManager.deleteConfirm')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', {name: 'authManager.cancel'}));
        expect(screen.queryByText('authManager.deleteConfirm')).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'authManager.deleteUser'}));
        fireEvent.click(screen.getByRole('button', {name: 'authManager.confirmDelete'}));
        await waitFor(() =>
            expect(manageCall).toHaveBeenCalledExactlyOnceWith('account_auth_delete_user', {
                userId: user.id,
            }),
        );
        await screen.findByText('authManager.userDeleted');
        expect(screen.queryByRole('button', {name: 'authManager.deleteUser'})).toBeNull();
    });

    it('opens details in a connection-bound native workspace tab', async () => {
        render(createElement(AuthManager, {connectionId: 'connection'}));
        fireEvent.click(await screen.findByRole('button', {name: 'Existing User'}));
        expect(openWorkspace).toHaveBeenCalledWith({
            id: 'auth-user:existing-user',
            title: 'Neon · existing@example.com',
            connectionId: 'connection',
        });
    });

    it('allows read-only inspection while account management is disconnected', async () => {
        scope.current = null;
        render(createElement(AuthManager, {connectionId: 'connection', userId: user.id}));
        await screen.findByRole('heading', {name: 'Existing User'});
        expect(
            (screen.getByRole('button', {name: 'authManager.saveRole'}) as HTMLButtonElement)
                .disabled,
        ).toBe(true);
        expect(
            (screen.getByRole('button', {name: 'authManager.deleteUser'}) as HTMLButtonElement)
                .disabled,
        ).toBe(true);
        expect(screen.getByText('authManager.sessionsReadOnly')).toBeTruthy();
        expect(manageCall).not.toHaveBeenCalled();
    });
});
