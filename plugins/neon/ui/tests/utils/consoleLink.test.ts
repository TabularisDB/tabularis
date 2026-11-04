// @vitest-environment jsdom
import {createElement, Fragment, type ReactNode} from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NeonPanel} from '../../src/NeonPanel';

const {rpc, useRpc, openUrl, t} = vi.hoisted(() => {
    const rpc = {call: vi.fn()};
    return {rpc, useRpc: vi.fn(() => rpc), openUrl: vi.fn(), t: (key: string) => key};
});
vi.mock('@tabularis/plugin-api', () => ({
    usePluginTranslation: () => t,
    usePluginRpc: useRpc,
    openUrl,
    PluginWorkspaceShell: ({actions, children}: {actions: ReactNode; children: ReactNode}) =>
        createElement(Fragment, null, actions, children),
}));
afterEach(cleanup);
beforeEach(() => {
    vi.clearAllMocks();
    openUrl.mockResolvedValue(undefined);
});

describe('Console link connection binding', () => {
    it('reads metadata for each owning connection instead of using the browser default project', async () => {
        rpc.call
            .mockResolvedValueOnce({projectId: 'project-one', branchId: 'br-one'})
            .mockResolvedValueOnce({projectId: 'project-two', branchId: 'br-two'});
        const view = render(
            createElement(NeonPanel, {connectionId: 'saved-one', serviceId: 'database'}),
        );
        fireEvent.click(screen.getByRole('button', {name: 'console'}));
        await waitFor(() =>
            expect(openUrl).toHaveBeenCalledWith(
                'https://console.neon.tech/app/projects/project-one/branches/br-one',
            ),
        );
        expect(useRpc).toHaveBeenCalledWith('neon', 'saved-one');
        view.rerender(createElement(NeonPanel, {connectionId: 'saved-two', serviceId: 'database'}));
        fireEvent.click(screen.getByRole('button', {name: 'console'}));
        await waitFor(() =>
            expect(openUrl).toHaveBeenLastCalledWith(
                'https://console.neon.tech/app/projects/project-two/branches/br-two',
            ),
        );
        expect(useRpc).toHaveBeenCalledWith('neon', 'saved-two');
        expect(rpc.call).toHaveBeenCalledWith('neon_branch_context');
    });
    it('shows a useful error and opens no browser when the saved project is unknown', async () => {
        rpc.call.mockResolvedValue({projectId: null, branchId: null});
        render(createElement(NeonPanel, {connectionId: 'saved', serviceId: 'database'}));
        fireEvent.click(screen.getByRole('button', {name: 'console'}));
        expect((await screen.findByRole('alert')).textContent).toContain('consoleBindingMissing');
        expect(openUrl).not.toHaveBeenCalled();
    });
});
