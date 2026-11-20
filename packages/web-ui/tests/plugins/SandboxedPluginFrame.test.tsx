import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import {SandboxedPluginFrame} from '@/plugins/sandbox/SandboxedPluginFrame';
import type {PluginHostHandler} from '@/plugins/sandbox/connectFrame';
import {publishPluginEvent} from '@/utils/pluginEvents';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    call: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    toast: vi.fn(),
    client: {call: vi.fn()},
    i18n: {language: 'en', getResourceBundle: () => ({})},
    navigate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({useNavigate: () => mocks.navigate}));
vi.mock('@/components/plugins/PluginCodeEditor', () => ({
    PluginCodeEditor: ({
        value,
        label,
        onChange,
    }: {
        value: string;
        label?: string;
        onChange: (value: string) => void;
    }) => (
        <textarea
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
        />
    ),
}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: DEFAULT_SETTINGS, updateSetting: mocks.update}),
}));
vi.mock('@/hooks/useToast', () => ({useToast: () => ({showToast: mocks.toast})}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => mocks.client}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key, i18n: mocks.i18n}),
}));
vi.mock('@/plugins/sandbox/connectFrame', () => ({
    connectFrame: mocks.connect,
    pluginFrameUrl: () => '/plugin-frame',
}));

let handlers: Record<string, PluginHostHandler>;
let persistedPlugins: typeof DEFAULT_SETTINGS.plugins;
const savePlugins = async (
    _key: unknown,
    update: (previous: typeof persistedPlugins) => typeof persistedPlugins,
) => {
    persistedPlugins = update(persistedPlugins);
};
const frame = () => (
    <SandboxedPluginFrame pluginId="google-sheets" module="ui/auth.js" context={{}} />
);

describe('SandboxedPluginFrame lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        persistedPlugins = {};
        mocks.update = vi.fn(savePlugins);
        mocks.client.call.mockImplementation(async (command: string) =>
            command === 'get_config' ? {plugins: persistedPlugins} : null,
        );
        mocks.connect.mockImplementation(async (_frame, methods) => {
            handlers = methods;
            return {call: mocks.call, close: mocks.close};
        });
        Object.defineProperty(navigator, 'userActivation', {
            configurable: true,
            value: {isActive: true},
        });
    });

    it('keeps the connected port and uses the latest settings writer after a provider render', async () => {
        const {rerender, unmount} = render(frame());
        await waitFor(() =>
            expect(mocks.call).toHaveBeenCalledWith('slot.context', expect.any(Array)),
        );
        await act(async () => {
            await handlers['api.setting.set']('client_id', 'first');
        });
        const previousWriter = mocks.update;
        mocks.update = vi.fn(savePlugins);
        rerender(frame());
        await act(async () => {
            await handlers['api.setting.set']('client_secret', 'second');
        });
        expect(previousWriter).toHaveBeenCalledTimes(1);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.connect).toHaveBeenCalledTimes(1);
        expect(mocks.close).not.toHaveBeenCalled();
        unmount();
        expect(mocks.close).toHaveBeenCalledTimes(1);
    });

    it('fails a plugin settings write when the session cannot read shared configuration', async () => {
        mocks.client.call.mockRejectedValue(new Error('Administrator access required'));
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await expect(handlers['api.setting.set']('client_id', 'value')).rejects.toThrow(
            'Administrator access required',
        );
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('explains when remote sessions lack administrator access', async () => {
        mocks.client.call.mockRejectedValue(
            Object.assign(new Error('Forbidden'), {code: 'FORBIDDEN'}),
        );
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await expect(handlers['api.setting.set']('client_id', 'value')).rejects.toThrow(
            'Changing shared plugin settings requires administrator access.',
        );
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('accepts persisted JSON objects with reordered keys', async () => {
        mocks.client.call.mockImplementation(async () => ({
            plugins: {'google-sheets': {settings: {options: {first: 1, nested: {a: 2, z: 3}}}}},
        }));
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await expect(
            handlers['api.setting.set']('options', {nested: {z: 3, a: 2}, first: 1}),
        ).resolves.toBeNull();
    });

    it('reports settings that were not persisted', async () => {
        mocks.update = vi.fn().mockResolvedValue(undefined);
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await expect(handlers['api.setting.set']('client_id', 'value')).rejects.toThrow(
            'Plugin setting could not be saved',
        );
    });

    it('synchronizes only the Google Sheets driver without restarting it', async () => {
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await act(async () => {
            await handlers['api.oauth.googleSync']();
        });
        expect(mocks.client.call).toHaveBeenCalledWith('sync_plugin_settings', {
            pluginId: 'google-sheets',
        });
    });

    it('rejects OAuth synchronization from another plugin', async () => {
        render(<SandboxedPluginFrame pluginId="other" module="ui/index.js" context={{}} />);
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await expect(handlers['api.oauth.googleSync']()).rejects.toThrow(
            'Google OAuth synchronization is only available to Google Sheets',
        );
        expect(mocks.client.call).not.toHaveBeenCalled();
    });

    it('notifies the guest when the host close control or Escape dismisses its overlay', async () => {
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        act(() => {
            handlers['ui.modal'](true);
        });
        fireEvent.click(screen.getByRole('button', {name: 'settings.plugins.closePluginOverlay'}));
        expect(mocks.call).toHaveBeenCalledWith('ui.closeModal');
        expect(
            screen.queryByRole('button', {name: 'settings.plugins.closePluginOverlay'}),
        ).toBeNull();
        mocks.call.mockClear();
        act(() => {
            handlers['ui.modal'](true);
        });
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(mocks.call).toHaveBeenCalledWith('ui.closeModal');
    });

    it('keeps a slot inside its host overlay while preserving the frame across guest modals', async () => {
        const {container} = render(
            <div data-testid="host-overlay" style={{position: 'fixed', zIndex: 100}}>
                {frame()}
            </div>,
        );
        const overlay = screen.getByTestId('host-overlay');
        await waitFor(() => expect(overlay.querySelector('iframe')).not.toBeNull());
        const iframe = overlay.querySelector('iframe');
        expect(iframe).not.toBeNull();
        await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
        act(() => handlers['ui.modal'](true));
        expect(overlay.querySelector('iframe')).toBe(iframe);
        expect(
            overlay.contains(
                screen.getByRole('button', {name: 'settings.plugins.closePluginOverlay'}),
            ),
        ).toBe(true);
        expect(mocks.connect).toHaveBeenCalledTimes(1);
        expect(container.contains(iframe)).toBe(true);
    });

    it('tracks layout-only movement and clips inline frames to scrolling ancestors', async () => {
        const {container} = render(
            <div data-testid="clip-parent" style={{overflow: 'hidden'}}>
                {frame()}
            </div>,
        );
        const parent = screen.getByTestId('clip-parent');
        const anchor = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        let left = 100;
        vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() =>
            DOMRect.fromRect({x: left, y: 100, width: 200, height: 100}),
        );
        vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(
            DOMRect.fromRect({x: 120, y: 120, width: 100, height: 50}),
        );
        Object.defineProperty(parent, 'clientWidth', {configurable: true, value: 100});
        Object.defineProperty(parent, 'clientHeight', {configurable: true, value: 50});
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        act(() => handlers['ui.resize'](100));
        const iframe = screen.getByTitle('Plugin google-sheets') as HTMLIFrameElement;
        const projectedFrame = iframe.parentElement as HTMLElement;
        await waitFor(() =>
            expect(projectedFrame.style.clipPath).toBe('inset(20px 80px 30px 20px)'),
        );
        left = 110;
        await waitFor(() => expect(projectedFrame.style.left).toBe('110px'));
        act(() => handlers['ui.modal'](true));
        expect(projectedFrame.style.clipPath).toBe('');
        expect(screen.getByTitle('Plugin google-sheets')).toBe(iframe);
    });
    it('lets an inline frame grow with its content and caps it to one page of its scrollport', async () => {
        const {container} = render(
            <div data-testid="scrollport" style={{overflowY: 'auto', padding: 20}}>
                {frame()}
            </div>,
        );
        Object.defineProperty(screen.getByTestId('scrollport'), 'clientHeight', {
            configurable: true,
            value: 620,
        });
        const anchor = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        const canvas = screen.getByTitle('Plugin google-sheets').parentElement as HTMLElement;
        // A short loading state must not pin the frame once the real form renders.
        act(() => handlers['ui.resize'](150));
        expect(canvas.style.height).toBe('150px');
        act(() => handlers['ui.resize'](420));
        expect(canvas.style.height).toBe('420px');
        expect(anchor.style.height).toBe('420px');
        act(() => handlers['ui.resize'](900));
        expect(canvas.style.height).toBe('580px');
        expect(anchor.style.height).toBe('580px');
        act(() => handlers['ui.resize'](300));
        expect(canvas.style.height).toBe('300px');
    });
    it('allocates a definite workspace canvas independent of guest content sizing', async () => {
        const {container} = render(
            <div style={{height: 720, display: 'flex', flexDirection: 'column'}}>
                <SandboxedPluginFrame
                    pluginId="provider"
                    module="ui/workspace.js"
                    context={{
                        __tabularisSlot: 'editor.workspace.content',
                        workspaceId: 'functions-new',
                        workspaceActive: true,
                    }}
                />
            </div>,
        );
        const anchor = container.querySelector('[aria-hidden="true"]') as HTMLElement;
        let canvasHeight = 720;
        vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() =>
            DOMRect.fromRect({x: 312, y: 30, width: 1000, height: canvasHeight}),
        );
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        const iframe = screen.getByTitle('Plugin provider');
        const canvas = iframe.parentElement as HTMLElement;
        expect(iframe).toHaveAttribute('data-plugin-slot', 'editor.workspace.content');
        expect(iframe).toHaveAttribute('data-plugin-workspace', 'functions-new');
        await waitFor(() => expect(canvas.style.height).toBe('720px'));
        act(() => handlers['ui.resize'](170));
        expect(canvas.style.height).toBe('720px');
        canvasHeight = 600;
        await waitFor(() => expect(canvas.style.height).toBe('600px'));
    });

    it('projects only approved native editor props inside the clipped frame and returns edits', async () => {
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        act(() =>
            handlers['ui.native.set']({
                id: 'source',
                kind: 'codeEditor',
                rect: {left: 10, top: 20, width: 300, height: 250},
                props: {
                    value: 'const value = 1;',
                    label: 'Function source',
                    language: 'typescript',
                },
            }),
        );
        const source = screen.getByRole('textbox', {name: 'Function source'});
        expect(source.closest('[data-plugin-frame]')).toHaveStyle({overflow: 'hidden'});
        fireEvent.change(source, {target: {value: 'const value = 2;'}});
        expect(mocks.call).toHaveBeenCalledWith('ui.native.event', [
            'source',
            'change',
            {value: 'const value = 2;', generation: 0, revision: 1},
        ]);
        act(() => handlers['ui.popover']('language-select', true));
        expect(screen.queryByRole('textbox', {name: 'Function source'})).not.toBeInTheDocument();
        expect(source.isConnected).toBe(true);
        act(() => handlers['ui.popover']('language-select', false));
        expect(screen.getByRole('textbox', {name: 'Function source'})).toBe(source);
        act(() => handlers['ui.modal'](true));
        expect(screen.queryByRole('textbox', {name: 'Function source'})).not.toBeInTheDocument();
        act(() =>
            handlers['ui.native.set']({
                id: 'modal-source',
                kind: 'codeEditor',
                modal: true,
                rect: {
                    left: 30,
                    top: 40,
                    width: 200,
                    height: 250,
                    clip: {top: 20, right: 0, bottom: 30, left: 0},
                },
                props: {value: '', label: 'Modal source'},
            }),
        );
        expect(screen.getByRole('textbox', {name: 'Modal source'}).parentElement).toHaveStyle({
            clipPath: 'inset(20px 0px 30px 0px)',
        });
        act(() => handlers['ui.modal'](false));
        expect(screen.getByRole('textbox', {name: 'Function source'})).toBe(source);
        expect(screen.queryByRole('textbox', {name: 'Modal source'})).not.toBeInTheDocument();
        expect(() =>
            handlers['ui.native.set']({
                id: 'unsafe',
                kind: 'NewConnectionModal',
                rect: {left: 0, top: 0, width: 300, height: 250},
                props: {},
            }),
        ).toThrow('Unsupported');
        act(() => handlers['ui.native.remove']('source'));
        expect(screen.queryByRole('textbox', {name: 'Function source'})).not.toBeInTheDocument();
    });

    it('forwards only setup callbacks supplied by the host and awaits import refresh', async () => {
        const onConnectionCreated = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        render(
            <SandboxedPluginFrame
                pluginId="provider"
                module="ui/setup.js"
                context={{driver: 'provider', onConnectionCreated, onClose}}
            />,
        );
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await handlers['slot.onConnectionCreated']();
        expect(onConnectionCreated).toHaveBeenCalledOnce();
        handlers['slot.onClose']();
        expect(onClose).toHaveBeenCalledOnce();
        expect(mocks.call).toHaveBeenCalledWith('slot.context', [
            expect.objectContaining({__tabularisHostCallbacks: ['onConnectionCreated', 'onClose']}),
        ]);
    });
    it('does not dismiss a newly opened popover when the initial closed-modal status arrives late', async () => {
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        act(() => handlers['ui.popover']('language-select', true));
        mocks.call.mockClear();
        act(() => handlers['ui.modal'](false));
        expect(mocks.call).not.toHaveBeenCalledWith('ui.closePopovers');
        act(() => handlers['ui.modal'](true));
        expect(mocks.call).toHaveBeenCalledWith('ui.closePopovers');
    });
    it('relays bounded events only to this plugin and disposes subscriptions with the frame', async () => {
        const {unmount} = render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        handlers['api.event.subscribe']('branch-changed');
        await publishPluginEvent('foreign', 'branch-changed', {branch: 'other'});
        expect(mocks.call).not.toHaveBeenCalledWith('api.event', expect.anything());
        await handlers['api.event.publish']('branch-changed', {branch: 'child'});
        expect(mocks.call).toHaveBeenCalledWith('api.event', ['branch-changed', {branch: 'child'}]);
        await expect(
            handlers['api.event.publish']('branch-changed', {source: 'x'.repeat(65_537)}),
        ).rejects.toThrow();
        mocks.call.mockClear();
        unmount();
        await publishPluginEvent('google-sheets', 'branch-changed', {branch: 'later'});
        expect(mocks.call).not.toHaveBeenCalledWith('api.event', expect.anything());
    });
});
