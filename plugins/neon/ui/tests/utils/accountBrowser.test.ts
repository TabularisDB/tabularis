// @vitest-environment jsdom
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useAccountBrowser, type Project} from '../../src/hooks/useAccountBrowser';

const {account} = vi.hoisted(() => ({
    account: {
        connect: vi.fn(),
        secretFields: vi.fn(),
        disconnect: vi.fn(),
        call: vi.fn(),
        importConnection: vi.fn(),
    },
}));
vi.mock('@tabularis/plugin-api', () => ({usePluginAccount: () => account}));

const resources = {databases: [{name: 'neondb'}], roles: [{name: 'owner'}], services: []};
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

describe('Neon account browser', () => {
    it('keeps the newest organization loading state when an older request finishes', async () => {
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.pending).toBe(false));
        const first = deferred<{organizations: []; projects: Project[]}>();
        const second = deferred<{organizations: []; projects: Project[]}>();
        account.call.mockImplementation((_method: string, args: {orgId: string}) =>
            args.orgId === 'first' ? first.promise : second.promise,
        );
        let firstRequest: Promise<void>;
        let secondRequest: Promise<void>;
        act(() => {
            firstRequest = result.current.selectOrganization('first');
        });
        expect(result.current.state.loading).toBe('projects');
        expect(result.current.state.projects).toEqual([]);
        act(() => {
            secondRequest = result.current.selectOrganization('second');
        });
        await act(async () => {
            first.resolve({organizations: [], projects: []});
            await firstRequest;
        });
        expect(result.current.state.pending).toBe(true);
        expect(result.current.state.loading).toBe('projects');
        await act(async () => {
            second.resolve({
                organizations: [],
                projects: [{id: 'p2', name: 'Second', regionId: 'eu'}],
            });
            await secondRequest;
        });
        expect(result.current.state.orgId).toBe('second');
        expect(result.current.state.projects[0].id).toBe('p2');
        expect(result.current.state.pending).toBe(false);
        expect(result.current.state.loading).toBeUndefined();
    });

    it('clears project loading after a discovery failure', async () => {
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.connected).toBe(true));
        account.call.mockRejectedValue(new Error('Network unavailable'));
        await act(async () => {
            await result.current.selectOrganization('team');
        });
        expect(result.current.state.error).toBe('Network unavailable');
        expect(result.current.state.pending).toBe(false);
        expect(result.current.state.loading).toBeUndefined();
    });
    it('links only a CLI profile reference and restores the CLI authentication mode', async () => {
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.connected).toBe(true));
        await act(async () => {
            await result.current.connectCli('DEFAULT');
        });
        expect(account.connect).toHaveBeenCalledWith({NEON_CLI_AUTH: 'DEFAULT'});
        expect(result.current.state.authMode).toBe('cli');
        expect(result.current.state.connected).toBe(true);
    });
    it('recognizes a stored CLI link without a copied API token', async () => {
        account.secretFields.mockResolvedValue(['NEON_CLI_AUTH']);
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.authMode).toBe('cli'));
        expect(result.current.state.connected).toBe(true);
    });
    it('does not call a stale setup completion callback after the driver view closes', async () => {
        account.secretFields.mockResolvedValue(['NEON_API_KEY']);
        account.call.mockResolvedValue({organizations: [], projects: []});
        const pending = deferred<{id: string; name: string; warnings: string[]}>();
        account.importConnection.mockReturnValue(pending.promise);
        const completed = vi.fn();
        const {result, unmount} = renderHook(() => useAccountBrowser(completed));
        await waitFor(() => expect(result.current.state.connected).toBe(true));
        let request: Promise<void> | undefined;
        act(() => {
            request = result.current.importConnection(false);
        });
        unmount();
        await act(async () => {
            pending.resolve({id: 'saved', name: 'Imported', warnings: []});
            await request;
        });
        expect(completed).not.toHaveBeenCalled();
    });
    beforeEach(() => {
        vi.clearAllMocks();
        account.secretFields.mockResolvedValue(['NEON_API_KEY']);
        account.call.mockImplementation(async (method: string) =>
            method === 'account_projects'
                ? {organizations: [], projects: [{id: 'p1', name: 'First', regionId: 'eu'}]}
                : method === 'account_branches'
                  ? {branches: [{id: 'b1', name: 'production'}]}
                  : resources,
        );
    });

    it('ignores a stale branch response after another project is selected', async () => {
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.connected).toBe(true));
        const old = deferred<{branches: {id: string; name: string}[]}>();
        account.call.mockImplementation((_method: string, args: {projectId: string}) =>
            args.projectId === 'p1'
                ? old.promise
                : Promise.resolve({branches: [{id: 'b2', name: 'New branch'}]}),
        );
        act(() => {
            void result.current.selectProject('p1');
        });
        await act(async () => {
            await result.current.selectProject('p2');
        });
        await act(async () => {
            old.resolve({branches: [{id: 'old', name: 'Old branch'}]});
        });
        expect(result.current.state.projectId).toBe('p2');
        expect(result.current.state.branches).toEqual([{id: 'b2', name: 'New branch'}]);
    });

    it('imports selected resources without returning credentials and refreshes host connections', async () => {
        const refresh = vi.fn();
        account.importConnection.mockResolvedValue({
            id: 'saved',
            name: 'Project · production',
            warnings: ['Storage requires credentials'],
        });
        const {result} = renderHook(() => useAccountBrowser(refresh));
        await waitFor(() => expect(result.current.state.connected).toBe(true));
        await act(async () => {
            await result.current.selectProject('p1');
        });
        await act(async () => {
            await result.current.selectBranch('b1');
        });
        await act(async () => {
            await result.current.importConnection(false);
        });
        expect(account.importConnection).toHaveBeenCalledWith({
            projectId: 'p1',
            branchId: 'b1',
            database: 'neondb',
            role: 'owner',
            createServiceCredentials: false,
        });
        expect(refresh).toHaveBeenCalledOnce();
        expect(result.current.state.imported?.id).toBe('saved');
    });

    it('clears a saved key draft even if project discovery fails', async () => {
        account.secretFields.mockResolvedValue([]);
        const clear = vi.fn();
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.connected).toBe(false));
        account.call.mockRejectedValue(new Error('Neon API returned HTTP 403'));
        await act(async () => {
            await result.current.connect('  private-key  ', clear);
        });
        expect(account.connect).toHaveBeenCalledWith({NEON_API_KEY: 'private-key'});
        expect(clear).toHaveBeenCalledOnce();
        expect(result.current.state.connected).toBe(true);
        expect(result.current.state.error).toBe('Neon API returned HTTP 403');
    });
    it('keeps an imported connection visible if refreshing the host list fails', async () => {
        account.importConnection.mockResolvedValue({id: 'saved', name: 'Imported', warnings: []});
        const refresh = vi.fn().mockRejectedValue(new Error('Refresh unavailable'));
        const {result} = renderHook(() => useAccountBrowser(refresh));
        await waitFor(() => expect(result.current.state.connected).toBe(true));
        await act(async () => {
            await result.current.selectProject('p1');
        });
        await act(async () => {
            await result.current.selectBranch('b1');
        });
        await act(async () => {
            await result.current.importConnection(false);
        });
        expect(result.current.state.imported?.id).toBe('saved');
        expect(result.current.state.error).toBe('Refresh unavailable');
        expect(account.importConnection).toHaveBeenCalledOnce();
    });

    it('allows disconnecting a stored account whose discovery permissions were revoked', async () => {
        account.call.mockRejectedValue(new Error('Access denied'));
        const {result} = renderHook(() => useAccountBrowser());
        await waitFor(() => expect(result.current.state.error).toBe('Access denied'));
        expect(result.current.state.connected).toBe(true);
        await act(async () => {
            await result.current.disconnect();
        });
        expect(result.current.state.connected).toBe(false);
        expect(account.disconnect).toHaveBeenCalledOnce();
    });
});
