// @vitest-environment jsdom
import {createElement, type ReactNode} from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {NeonPanel} from '../../src/NeonPanel';

const {rpc, workspace, t} = vi.hoisted(() => ({
    rpc: {call: vi.fn()},
    workspace: {openWorkspace: vi.fn()},
    t: (key: string) => key,
}));
vi.mock('@tabularis/plugin-api', () => ({
    usePluginTranslation: () => t,
    usePluginRpc: () => rpc,
    usePluginWorkspace: () => workspace,
    PluginWorkspaceShell: ({children}: {children: ReactNode}) => children,
}));
afterEach(cleanup);

describe('Neon overview', () => {
    it('opens connection-scoped branch management without legacy service API-key calls', async () => {
        rpc.call.mockResolvedValue({
            branch: 'production',
            projectId: 'project',
            database: {columns: [], rows: []},
            services: [],
        });
        render(createElement(NeonPanel, {connectionId: 'saved', serviceId: 'overview'}));
        await waitFor(() => expect(rpc.call).toHaveBeenCalledWith('neon_status'));
        fireEvent.click(await screen.findByRole('button', {name: 'branches.manage'}));
        await waitFor(() =>
            expect(workspace.openWorkspace).toHaveBeenCalledWith({
                id: 'branches',
                title: 'Neon · tabs.branches',
                connectionId: 'saved',
            }),
        );
        expect(rpc.call.mock.calls.some(([method]) => method === 'neon_project_branches')).toBe(
            false,
        );
        expect(screen.queryByText('branchesHint')).toBeNull();
    });
});
