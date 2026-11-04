// @vitest-environment jsdom
import {selectOption} from '../support/select';
import {createElement} from 'react';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {FunctionsManager} from '../../src/FunctionsManager';
import {clearFunctionDraft} from '../../src/utils/functionDrafts';

const {call, openWorkspace} = vi.hoisted(() => ({call: vi.fn(), openWorkspace: vi.fn()}));
vi.mock('../../src/hooks/useNeonManagement', () => {
    const management = {
        scope: {projectId: 'project', branchId: 'branch'},
        pending: false,
        call,
        reload: vi.fn(),
        connectAccount: vi.fn(),
    };
    return {useNeonManagement: () => management};
});
vi.mock('@tabularis/plugin-api', async () => {
    const {PluginSelect} = await import('@/components/plugins/PluginSelect');
    return {
        PluginSelect,
        openUrl: vi.fn(),
        usePluginTranslation: () => (key: string) => key,
        usePluginWorkspace: () => ({openWorkspace}),
        PluginCodeEditor: ({
            value,
            onChange,
            label,
            readOnly,
        }: {
            value: string;
            onChange: (value: string) => void;
            label: string;
            readOnly: boolean;
        }) =>
            createElement('textarea', {
                'aria-label': label,
                value,
                readOnly,
                onChange: (event: {target: {value: string}}) => onChange(event.target.value),
            }),
        PluginResourceList: () => null,
    };
});
const details = {
    slug: 'hello',
    name: 'Hello',
    url: 'https://function.example',
    status: 'completed',
    updatedAt: null,
    source: null,
    environmentKeys: ['EXISTING_SECRET'],
    error: null,
};
function openDisclosure(key: string) {
    const summary = screen.getByText(key);
    const element = summary.closest('details');
    if (element) element.open = true;
}

describe('Functions manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearFunctionDraft('conn', 'hello');
        clearFunctionDraft('conn', ':create');
        call.mockImplementation(async (method: string) =>
            method === 'account_function_get' ? details : {id: 'deployment', status: 'pending'},
        );
    });
    afterEach(cleanup);

    it('does not use a template for existing source and requires replacement confirmation', async () => {
        render(createElement(FunctionsManager, {connectionId: 'conn', slug: 'hello'}));
        await screen.findByText('functionsManager.sourceUnavailable');
        const editor = screen.getByLabelText('functionsManager.source') as HTMLTextAreaElement;
        expect(editor.value).toBe('');
        fireEvent.change(editor, {target: {value: 'export default {};'}});
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.deploy'}));
        expect(call.mock.calls.some(([method]) => method === 'account_function_deploy')).toBe(
            false,
        );
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.confirmDeployment'}));
        await waitFor(() =>
            expect(call).toHaveBeenCalledWith('account_function_deploy', {
                slug: 'hello',
                source: 'export default {};',
                language: 'javascript',
                createOnly: false,
            }),
        );
    });

    it('creates with an explicit create-only request and opens the named native tab', async () => {
        render(createElement(FunctionsManager, {connectionId: 'conn', create: true}));
        fireEvent.change(screen.getByLabelText('functionsManager.slug'), {target: {value: 'new'}});
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.deploy'}));
        await waitFor(() =>
            expect(call).toHaveBeenCalledWith(
                'account_function_deploy',
                expect.objectContaining({slug: 'new', createOnly: true}),
            ),
        );
        await waitFor(() =>
            expect(openWorkspace).toHaveBeenCalledWith({
                id: 'function:new',
                title: 'Neon · new',
                connectionId: 'conn',
            }),
        );
    });

    it('validates the current TypeScript draft and clears stale results after editing', async () => {
        call.mockResolvedValue({
            valid: false,
            bundleBytes: 0,
            diagnostics: [{message: 'Unexpected token', line: 2, column: 3}],
        });
        render(createElement(FunctionsManager, {connectionId: 'conn', create: true}));
        selectOption(screen.getByLabelText('functionsManager.language'), 'typescript');
        fireEvent.change(screen.getByLabelText('functionsManager.source'), {
            target: {value: 'export default = {'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.validate'}));
        await screen.findByText('2:3 · Unexpected token');
        expect(call).toHaveBeenCalledWith('account_function_validate', {
            source: 'export default = {',
            language: 'typescript',
        });
        expect(call.mock.calls.some(([method]) => method === 'account_function_deploy')).toBe(
            false,
        );
        fireEvent.change(screen.getByLabelText('functionsManager.source'), {
            target: {
                value: 'export default {fetch(request: Request) {return new Response(request.url)}}',
            },
        });
        expect(screen.queryByText('2:3 · Unexpected token')).toBeNull();
    });

    it('returns to the functions list without losing the source draft', async () => {
        render(createElement(FunctionsManager, {connectionId: 'conn', create: true}));
        fireEvent.change(screen.getByLabelText('functionsManager.source'), {
            target: {value: 'export default {fetch() {return new Response("draft")}}'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.backToList'}));
        expect(openWorkspace).toHaveBeenCalledWith({
            id: 'functions',
            title: 'Neon · tabs.functions',
            connectionId: 'conn',
        });
        expect(call).not.toHaveBeenCalledWith('account_function_deploy', expect.anything());
    });

    it('sends only changed environment keys and clears their draft after save', async () => {
        render(createElement(FunctionsManager, {connectionId: 'conn', slug: 'hello'}));
        await screen.findByText('EXISTING_SECRET');
        openDisclosure('functionsManager.environment');
        const input = screen.getByLabelText(
            'functionsManager.environmentChanges',
        ) as HTMLTextAreaElement;
        fireEvent.change(input, {target: {value: '{"API_TOKEN":"new-private","OLD_TOKEN":null}'}});
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.saveEnvironment'}));
        await waitFor(() =>
            expect(call).toHaveBeenCalledWith('account_function_deploy', {
                slug: 'hello',
                envChanges: {API_TOKEN: 'new-private', OLD_TOKEN: null},
            }),
        );
        await waitFor(() => expect(input.value).toBe(''));
        expect(screen.queryByText('new-private')).toBeNull();
    });

    it('keeps source edits when a backgrounded function tab remounts', async () => {
        const first = render(
            createElement(FunctionsManager, {connectionId: 'conn', slug: 'hello'}),
        );
        await screen.findByText('functionsManager.sourceUnavailable');
        fireEvent.change(screen.getByLabelText('functionsManager.source'), {
            target: {value: 'export default { fetch() {} };'},
        });
        first.unmount();
        render(createElement(FunctionsManager, {connectionId: 'conn', slug: 'hello'}));
        await waitFor(() =>
            expect(
                (screen.getByLabelText('functionsManager.source') as HTMLTextAreaElement).value,
            ).toBe('export default { fetch() {} };'),
        );
    });

    it('does not navigate back to a function after its deploying tab is closed', async () => {
        let resolveDeployment!: (value: {id: string; status: string}) => void;
        const deployment = new Promise<{id: string; status: string}>((resolve) => {
            resolveDeployment = resolve;
        });
        call.mockImplementation(async (method: string) =>
            method === 'account_function_deploy' ? deployment : details,
        );
        const view = render(createElement(FunctionsManager, {connectionId: 'conn', create: true}));
        fireEvent.change(screen.getByLabelText('functionsManager.slug'), {
            target: {value: 'closed'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.deploy'}));
        view.unmount();
        await act(async () => {
            resolveDeployment({id: 'deployment', status: 'pending'});
            await deployment;
        });
        expect(openWorkspace).not.toHaveBeenCalled();
    });

    it('requires confirmation before deleting a deployed function', async () => {
        render(createElement(FunctionsManager, {connectionId: 'conn', slug: 'hello'}));
        await screen.findByText('functionsManager.sourceUnavailable');
        openDisclosure('functionsManager.dangerZone');
        fireEvent.click(screen.getByRole('button', {name: 'functionsManager.deleteFunction'}));
        expect(call.mock.calls.some(([method]) => method === 'account_function_delete')).toBe(
            false,
        );
        await act(async () =>
            fireEvent.click(screen.getByRole('button', {name: 'functionsManager.confirmDelete'})),
        );
        expect(call).toHaveBeenCalledWith('account_function_delete', {slug: 'hello'});
    });
});
