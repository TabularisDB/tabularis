// @vitest-environment jsdom
import {renderHook, waitFor, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useNeonManagement} from '../../src/hooks/useNeonManagement';

const {account, rpc, translate, modal} = vi.hoisted(() => ({
    account: {call: vi.fn(), secretFields: vi.fn()},
    rpc: {call: vi.fn()},
    translate: (key: string) => key,
    modal: {openModal: vi.fn(), closeModal: vi.fn()},
}));
vi.mock('@tabularis/plugin-api', () => ({
    usePluginAccount: () => account,
    usePluginRpc: () => rpc,
    usePluginTranslation: () => translate,
    usePluginModal: () => modal,
}));

describe('management connection scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        account.secretFields.mockResolvedValue(['NEON_API_KEY']);
        rpc.call.mockResolvedValue({
            projectId: 'project-one',
            branchId: null,
            branchName: 'production',
        });
        account.call.mockResolvedValue({branches: [{id: 'br-one', name: 'production'}]});
    });
    it('resolves legacy branch names and prevents caller arguments from retargeting a mutation', async () => {
        const {result} = renderHook(() => useNeonManagement('connection-one'));
        await waitFor(() =>
            expect(result.current.scope).toEqual({projectId: 'project-one', branchId: 'br-one'}),
        );
        await result.current.call('account_function_delete', {
            slug: 'example',
            projectId: 'foreign',
            branchId: 'foreign',
        });
        expect(account.call).toHaveBeenLastCalledWith('account_function_delete', {
            slug: 'example',
            projectId: 'project-one',
            branchId: 'br-one',
        });
    });
    it('requires an explicit existing branch and connected account', async () => {
        account.secretFields.mockResolvedValue([]);
        const {result} = renderHook(() => useNeonManagement('connection-one'));
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(result.current.scope).toBeNull();
        await expect(
            result.current.call('account_function_delete', {slug: 'example'}),
        ).rejects.toThrow('management.connectRequired');
        expect(account.call).not.toHaveBeenCalled();
    });
    it('discards old connection resolution after switching connections', async () => {
        let finish!: (value: unknown) => void;
        rpc.call.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );
        const {result, rerender} = renderHook(({id}) => useNeonManagement(id), {
            initialProps: {id: 'old'},
        });
        await waitFor(() => expect(rpc.call).toHaveBeenCalledOnce());
        rpc.call.mockResolvedValue({
            projectId: 'new-project',
            branchId: 'br-new',
            branchName: 'development',
        });
        rerender({id: 'new'});
        await waitFor(() => expect(result.current.scope?.branchId).toBe('br-new'));
        await act(async () =>
            finish({projectId: 'old-project', branchId: 'br-old', branchName: 'production'}),
        );
        expect(result.current.scope).toEqual({projectId: 'new-project', branchId: 'br-new'});
    });
});
