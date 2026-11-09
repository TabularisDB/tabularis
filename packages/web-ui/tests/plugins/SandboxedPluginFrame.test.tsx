import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_SETTINGS} from '@/contexts/SettingsContext';
import {SandboxedPluginFrame} from '@/plugins/sandbox/SandboxedPluginFrame';
import type {PluginHostHandler} from '@/plugins/sandbox/connectFrame';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    call: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    toast: vi.fn(),
    client: {call: vi.fn()},
    i18n: {language: 'en', getResourceBundle: () => ({})},
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
});
