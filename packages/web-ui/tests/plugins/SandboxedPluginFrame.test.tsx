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
const frame = () => (
    <SandboxedPluginFrame pluginId="google-sheets" module="ui/auth.js" context={{}} />
);

describe('SandboxedPluginFrame lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.update = vi.fn().mockResolvedValue(undefined);
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
        mocks.update = vi.fn().mockResolvedValue(undefined);
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

    it('restarts only the Google Sheets driver when its OAuth settings are synchronized', async () => {
        render(frame());
        await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
        await act(async () => {
            await handlers['api.oauth.googleSync']();
        });
        expect(mocks.client.call).toHaveBeenCalledWith('restart_plugin_process', {
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
