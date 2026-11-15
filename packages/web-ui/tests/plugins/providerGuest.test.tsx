import {act, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {createProviderGuestApi} from '@/plugins/sandbox/providerGuest';
import {useEffect} from 'react';

vi.mock('react-i18next', async (importOriginal) => importOriginal());
vi.mock('lucide-react', async (importOriginal) => importOriginal());

describe('isolated provider guest facade', () => {
    const context = {
        connectionId: 'own',
        driver: 'provider',
        providerConnections: [{id: 'own', name: 'Provider database'}],
    };
    it('marshals account calls without exposing a generic invoke or stored secret read API', async () => {
        const call = vi.fn().mockResolvedValue([]);
        const {api} = createProviderGuestApi('provider', () => context, call);
        const {result} = renderHook(() => api.usePluginAccount('provider'));
        expect(result.current.connections).toEqual(context.providerConnections);
        await result.current.connect({token: 'synthetic'});
        expect(call).toHaveBeenCalledWith('provider.account', 'connect', {token: 'synthetic'});
        await result.current.callConnection('own', 'read_status', {});
        expect(call).toHaveBeenLastCalledWith(
            'provider.accountConnection',
            'own',
            'read_status',
            {},
        );
        expect(api).not.toHaveProperty('invoke');
        expect(result.current).not.toHaveProperty('getSecrets');
        expect(() => renderHook(() => api.usePluginAccount('foreign'))).toThrow('own provider');
    });
    it('preserves RPC errors and binds the default connection from host context', async () => {
        const failure = new Error('Administrator access required');
        const call = vi.fn().mockRejectedValue(failure);
        const {api} = createProviderGuestApi('provider', () => context, call);
        const {result} = renderHook(() => api.usePluginRpc('provider'));
        await expect(result.current.call('read_status')).rejects.toBe(failure);
        expect(call).toHaveBeenCalledWith('provider.connection', 'call', 'own', 'read_status', {});
    });
    it('retains account callback identities when importing refreshes the host connection list', async () => {
        let snapshot = {...context};
        const call = vi.fn().mockResolvedValue(null);
        const reload = vi.fn();
        const {api} = createProviderGuestApi('provider', () => snapshot, call);
        const {result, rerender} = renderHook(() => {
            const account = api.usePluginAccount('provider');
            useEffect(() => {
                reload();
            }, [account.call, account.secretFields, account.importConnection]);
            return account;
        });
        const before = result.current;
        snapshot = {
            ...context,
            providerConnections: [
                ...context.providerConnections,
                {id: 'imported', name: 'Imported database'},
            ],
        };
        rerender();
        expect(result.current).not.toBe(before);
        expect(result.current.connections).toHaveLength(2);
        for (const name of [
            'openConnection',
            'callConnection',
            'prepare',
            'connect',
            'secretFields',
            'disconnect',
            'call',
            'importConnection',
        ] as const)
            expect(result.current[name]).toBe(before[name]);
        expect(reload).toHaveBeenCalledOnce();
        await result.current.call('account_status');
        expect(call).toHaveBeenCalledWith('provider.account', 'call', 'account_status', {});
    });
    it('uses stable workspace reservations and reports asynchronous host failures', async () => {
        const call = vi.fn().mockImplementation(async (method: string) => {
            if (method === 'provider.openWorkspace') throw new Error('Connection is inactive');
            return null;
        });
        const {api} = createProviderGuestApi('provider', () => context, call);
        const {result} = renderHook(() => api.usePluginWorkspace('provider'));
        const options = {id: 'services', title: 'Provider services'};
        expect(result.current.openWorkspace(options)).toBe(result.current.openWorkspace(options));
        expect(() => result.current.openWorkspace({...options, connectionId: 'foreign'})).toThrow(
            'Select the workspace',
        );
        await waitFor(() =>
            expect(call).toHaveBeenCalledWith('api.toast', 'error', 'Connection is inactive'),
        );
    });
    it('renders the shared searchable selection inside the guest', async () => {
        const onChange = vi.fn();
        const call = vi.fn().mockResolvedValue(null);
        const {api} = createProviderGuestApi('provider', () => context, call);
        render(
            <api.PluginSelect
                ariaLabel="Branch"
                value="one"
                options={[
                    {value: 'one', label: 'Main'},
                    {value: 'two', label: 'Development'},
                ]}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByRole('combobox'));
        expect(call).toHaveBeenCalledWith('ui.popover', expect.any(String), true);
        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'Develop'}});
        fireEvent.click(await screen.findByRole('option', {name: 'Development'}));
        expect(onChange).toHaveBeenCalledWith('two');
        expect(call).toHaveBeenLastCalledWith('ui.popover', expect.any(String), false);
    });
    it('renders service icons inside the guest with the host document fallback', () => {
        const call = vi.fn().mockResolvedValue(null);
        const {api} = createProviderGuestApi('provider', () => context, call);
        render(
            <api.PluginExplorerSection
                pluginId="provider"
                providerName="Provider"
                items={[
                    {id: 'users', label: 'Users', icon: 'users'},
                    {id: 'branches', label: 'Branches', icon: 'branches'},
                    {id: 'unknown', label: 'Unknown', icon: 'constructor'},
                    {id: 'default', label: 'Default'},
                ]}
            />,
        );
        for (const [label, icon] of [
            ['Users', 'users'],
            ['Branches', 'git-branch'],
            ['Unknown', 'file-text'],
            ['Default', 'file-text'],
        ]) {
            const svg = screen.getByRole('button', {name: label}).querySelector(`.lucide-${icon}`);
            expect(svg).toBeInTheDocument();
            expect(svg).toHaveAttribute('aria-hidden', 'true');
        }
        fireEvent.click(screen.getByRole('button', {name: 'Users'}));
        expect(call).toHaveBeenCalledWith('provider.openWorkspace', {
            id: 'users',
            title: 'Provider · Users',
            connectionId: 'own',
        });
    });
    it('releases the native overlay layer when a popover is dismissed or its component unmounts', () => {
        const call = vi.fn().mockResolvedValue(null);
        const {api} = createProviderGuestApi('provider', () => context, call);
        const {unmount} = render(
            <api.PluginSelect
                ariaLabel="Language"
                value="js"
                options={[{value: 'js', label: 'JavaScript'}]}
                onChange={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('combobox'));
        expect(call).toHaveBeenLastCalledWith('ui.popover', expect.any(String), true);
        act(() => window.dispatchEvent(new Event('tabularis:close-popovers')));
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(call).toHaveBeenLastCalledWith('ui.popover', expect.any(String), false);
        fireEvent.click(screen.getByRole('combobox'));
        unmount();
        expect(call).toHaveBeenLastCalledWith('ui.popover', expect.any(String), false);
    });
    it('projects native editor data and receives host change and diagnostics callbacks', async () => {
        const call = vi.fn().mockResolvedValue(null);
        const bridge = createProviderGuestApi('provider', () => context, call);
        const onChange = vi.fn();
        const onDiagnostics = vi.fn();
        const {unmount} = render(
            <bridge.api.PluginCodeEditor
                value="const value = 1;"
                language="typescript"
                onChange={onChange}
                onDiagnostics={onDiagnostics}
            />,
        );
        await waitFor(() =>
            expect(call).toHaveBeenCalledWith(
                'ui.native.set',
                expect.objectContaining({
                    kind: 'codeEditor',
                    props: {value: 'const value = 1;', language: 'typescript'},
                }),
            ),
        );
        const message = call.mock.calls.find(([method]) => method === 'ui.native.set')?.[1] as {
            id: string;
        };
        act(() =>
            bridge.nativeEvent(message.id, 'change', {
                value: 'const value = 2;',
                generation: 0,
                revision: 1,
            }),
        );
        expect(onChange).toHaveBeenCalledWith('const value = 2;');
        act(() =>
            bridge.nativeEvent(message.id, 'diagnostics', [
                {severity: 'error', message: 'Missing name', line: 1, column: 1},
            ]),
        );
        expect(onDiagnostics).toHaveBeenCalledOnce();
        unmount();
        expect(call).toHaveBeenCalledWith('ui.native.remove', message.id);
    });
    it('acknowledges host edits while assigning new generations to intentional source replacements', () => {
        const call = vi.fn().mockResolvedValue(null);
        const bridge = createProviderGuestApi('provider', () => context, call);
        const onChange = vi.fn();
        const view = (value: string) => (
            <bridge.api.PluginCodeEditor value={value} onChange={onChange} />
        );
        const {rerender} = render(view(''));
        const first = call.mock.calls.find(([method]) => method === 'ui.native.set')?.[1] as {
            id: string;
        };
        act(() => {
            bridge.nativeEvent(first.id, 'change', {value: 'c', generation: 0, revision: 1});
            bridge.nativeEvent(first.id, 'change', {value: 'const', generation: 0, revision: 2});
        });
        rerender(view('const'));
        expect(call).toHaveBeenCalledWith(
            'ui.native.set',
            expect.objectContaining({
                props: {value: 'const'},
                editorState: {generation: 0, revision: 2},
            }),
        );
        // A deliberate reset to an intermediate typed value is a replacement, not an old echo.
        rerender(view('c'));
        expect(call).toHaveBeenLastCalledWith(
            'ui.native.set',
            expect.objectContaining({
                props: {value: 'c'},
                editorState: {generation: 1, revision: 0},
            }),
        );
        act(() =>
            bridge.nativeEvent(first.id, 'change', {
                value: 'older host edit',
                generation: 0,
                revision: 3,
            }),
        );
        expect(onChange).not.toHaveBeenCalledWith('older host edit');
        rerender(view('new document'));
        expect(call).toHaveBeenLastCalledWith(
            'ui.native.set',
            expect.objectContaining({editorState: {generation: 2, revision: 0}}),
        );
        expect(onChange).toHaveBeenCalledWith('const');
    });
    it('seeds a language or filename model switch with the edited draft', () => {
        const call = vi.fn().mockResolvedValue(null);
        const bridge = createProviderGuestApi('provider', () => context, call);
        const view = (value: string, language: 'javascript' | 'typescript', fileName: string) => (
            <bridge.api.PluginCodeEditor
                value={value}
                language={language}
                fileName={fileName}
                onChange={vi.fn()}
            />
        );
        const {rerender} = render(view('initial source', 'javascript', 'index.js'));
        const first = call.mock.calls.find(([method]) => method === 'ui.native.set')?.[1] as {
            id: string;
        };
        act(() =>
            bridge.nativeEvent(first.id, 'change', {
                value: 'edited source marker',
                generation: 0,
                revision: 1,
            }),
        );
        rerender(view('edited source marker', 'javascript', 'index.js'));
        rerender(view('edited source marker', 'typescript', 'index.ts'));
        expect(call).toHaveBeenLastCalledWith(
            'ui.native.set',
            expect.objectContaining({
                props: expect.objectContaining({
                    value: 'edited source marker',
                    language: 'typescript',
                    fileName: 'index.ts',
                }),
                editorState: {generation: 1, revision: 0},
            }),
        );
        rerender(view('edited source marker', 'typescript', 'renamed.ts'));
        expect(call).toHaveBeenLastCalledWith(
            'ui.native.set',
            expect.objectContaining({editorState: {generation: 2, revision: 0}}),
        );
    });
    it('subscribes once per event name, uses the latest listener and rejects cross-plugin publishers', async () => {
        const call = vi.fn().mockResolvedValue(null);
        const bridge = createProviderGuestApi('provider', () => context, call);
        const first = vi.fn();
        const second = vi.fn();
        const {rerender, unmount} = renderHook(
            ({listener}) => bridge.api.usePluginEvent('provider', 'branch-changed', listener),
            {initialProps: {listener: first}},
        );
        expect(call).toHaveBeenCalledWith('api.event.subscribe', 'branch-changed');
        rerender({listener: second});
        act(() => bridge.pluginEvent('branch-changed', {branch: 'child'}));
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith({branch: 'child'});
        expect(call.mock.calls.filter(([name]) => name === 'api.event.subscribe')).toHaveLength(1);
        await bridge.api.publishPluginEvent('provider', 'branch-changed', {branch: 'child'});
        expect(call).toHaveBeenCalledWith('api.event.publish', 'branch-changed', {branch: 'child'});
        expect(() => bridge.api.publishPluginEvent('foreign', 'branch-changed', {})).toThrow(
            'own provider',
        );
        unmount();
        expect(call).toHaveBeenCalledWith('api.event.unsubscribe', 'branch-changed');
    });
});
