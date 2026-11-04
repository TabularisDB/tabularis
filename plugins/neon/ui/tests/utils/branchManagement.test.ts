// @vitest-environment jsdom
import {selectOption} from '../support/select';
import {createElement} from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BranchSelector} from '../../src/BranchSelector';
import {BranchesManager} from '../../src/BranchesManager';
const {state, accountCall, openWorkspace} = vi.hoisted(() => ({
    state: {
        context: {
            data: {
                projectId: 'project',
                branchId: 'source',
                branchName: 'production',
                database: 'neondb',
                role: 'owner',
            },
            pending: false,
        },
        listing: {
            data: {
                projectName: 'Project',
                branches: [
                    {
                        id: 'source',
                        name: 'production',
                        parentId: null,
                        state: 'ready',
                        isDefault: true,
                        protected: false,
                    },
                    {
                        id: 'target',
                        name: 'feature',
                        parentId: 'source',
                        state: 'ready',
                        isDefault: false,
                        protected: false,
                    },
                ],
                bindings: [],
            },
            pending: false,
        },
        action: {pending: false},
        management: {
            scope: {projectId: 'project', branchId: 'source'},
            pending: false,
            call: vi.fn(),
            connectAccount: vi.fn(),
            reload: vi.fn(),
        },
        pending: false,
        openBranch: vi.fn(),
        mutate: vi.fn().mockResolvedValue({message: 'done'}),
        refresh: vi.fn(),
    },
    accountCall: vi.fn(),
    openWorkspace: vi.fn(),
}));
vi.mock('../../src/hooks/useBranches', () => ({useBranches: () => state}));
vi.mock('@tabularis/plugin-api', async () => {
    const {PluginSelect} = await import('@/components/plugins/PluginSelect');
    return {
        PluginSelect,
        usePluginTranslation: () => (key: string) => key,
        usePluginAccount: () => ({call: accountCall}),
        usePluginWorkspace: () => ({openWorkspace}),
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
                        {key: item.id, onClick: () => onOpen(item.id)},
                        item.title,
                    ),
                ),
            ),
    };
});
beforeEach(() => {
    vi.clearAllMocks();
    accountCall.mockResolvedValue({databases: [{name: 'neondb'}], roles: [{name: 'owner'}]});
});
afterEach(cleanup);
describe('branch navigation and management', () => {
    it('switches from the header and opens a normal management tab', () => {
        render(createElement(BranchSelector, {connectionId: 'saved'}));
        selectOption(screen.getByLabelText('branches.switchBranch'), 'target');
        expect(state.openBranch).toHaveBeenCalledWith('target');
        fireEvent.click(screen.getByRole('button', {name: 'branches.manage'}));
        expect(openWorkspace).toHaveBeenCalledWith({
            id: 'branches',
            title: 'Neon · branches.title',
            connectionId: 'saved',
        });
    });
    it('offers new connection creation with explicit database, role and credential consent', async () => {
        render(createElement(BranchesManager, {connectionId: 'saved'}));
        const button = screen.getByRole('button', {name: 'branches.openNew'});
        await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(button);
        expect(state.openBranch).toHaveBeenCalledWith('source', true, {
            database: 'neondb',
            role: 'owner',
            createServiceCredentials: false,
        });
    });
    it('blocks current/default deletion and requires the exact target name', async () => {
        render(createElement(BranchesManager, {connectionId: 'saved'}));
        await waitFor(() => expect(accountCall).toHaveBeenCalled());
        const disclosure = screen
            .getByText('branches.delete', {selector: 'summary'})
            .closest('details')!;
        disclosure.open = true;
        expect(
            (screen.getByRole('button', {name: 'branches.delete'}) as HTMLButtonElement).disabled,
        ).toBe(true);
        fireEvent.click(screen.getByRole('button', {name: 'feature'}));
        await waitFor(() =>
            expect(
                (screen.getByRole('button', {name: 'branches.delete'}) as HTMLButtonElement)
                    .disabled,
            ).toBe(false),
        );
        fireEvent.click(screen.getByRole('button', {name: 'branches.delete'}));
        const confirmation = screen.getByRole('button', {name: 'branches.confirmDelete'});
        fireEvent.change(screen.getByLabelText('branches.typeName'), {target: {value: 'wrong'}});
        expect((confirmation as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('branches.typeName'), {target: {value: 'feature'}});
        fireEvent.click(confirmation);
        await waitFor(() =>
            expect(state.mutate).toHaveBeenCalledWith(
                'account_branch_delete',
                {targetBranchId: 'target', confirmName: 'feature'},
                'branches.deleted',
            ),
        );
    });
});
