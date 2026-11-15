import {act, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {createProviderGuestApi} from '@/plugins/sandbox/providerGuest';

vi.mock('react-i18next', async (importOriginal) => importOriginal());

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
        const {api} = createProviderGuestApi(
            'provider',
            () => context,
            vi.fn().mockResolvedValue(null),
        );
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
        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'Develop'}});
        fireEvent.click(await screen.findByRole('option', {name: 'Development'}));
        expect(onChange).toHaveBeenCalledWith('two');
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
