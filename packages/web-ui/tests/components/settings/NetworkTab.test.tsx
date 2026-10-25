import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NetworkTab} from '@/components/settings/NetworkTab';
import type {GlobalProxySettings, ProxyEndpoint} from '@/types/proxy';

const state = vi.hoisted(() => ({
    proxy: undefined as GlobalProxySettings | undefined,
    updateSetting: vi.fn(),
    refreshCatalogue: vi.fn(),
    refreshRegistry: vi.fn(),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {proxy: state.proxy}, updateSetting: state.updateSetting}),
}));
vi.mock('@/hooks/useConnectionCatalogue', () => ({
    useConnectionCatalogue: () => ({refresh: state.refreshCatalogue}),
}));
vi.mock('@/hooks/usePluginRegistry', () => ({
    usePluginRegistry: () => ({refresh: state.refreshRegistry}),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));
vi.mock('@/components/settings/ProxyFields', () => ({
    ProxyFields: ({
        endpoint,
        onEndpointChange,
    }: {
        endpoint: ProxyEndpoint;
        onEndpointChange: (next: ProxyEndpoint) => void;
    }) => (
        <input
            aria-label="custom-proxy-host"
            value={endpoint.host}
            onChange={(event) => onEndpointChange({...endpoint, host: event.target.value})}
        />
    ),
}));

const group = (name: string) =>
    within(screen.getByRole('group', {name: `settings.network.scopes.${name}`}));

const configured = (): GlobalProxySettings => ({
    endpoint: {protocol: 'http', host: 'proxy.example', port: 7890},
    modes: {app_http: 'custom', ai: 'custom', database: 'custom', ssh_tunnel: 'custom'},
});

describe('NetworkTab proxy modes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.proxy = undefined;
        state.updateSetting.mockImplementation(
            async (
                _key: string,
                updater: (current: GlobalProxySettings | undefined) => GlobalProxySettings,
            ) => {
                state.proxy = updater(state.proxy);
            },
        );
    });

    it('defaults app and AI to System and database and SSH to Disabled', () => {
        render(<NetworkTab />);
        expect(screen.queryByRole('textbox', {name: 'custom-proxy-host'})).not.toBeInTheDocument();
        for (const scope of ['appHttp', 'ai']) {
            expect(
                group(scope).getByRole('button', {name: 'settings.network.modeSystem'}),
            ).toHaveAttribute('aria-pressed', 'true');
        }
        for (const scope of ['database', 'sshTunnel']) {
            expect(
                group(scope).getByRole('button', {name: 'settings.network.modeDisabled'}),
            ).toHaveAttribute('aria-pressed', 'true');
            expect(
                group(scope).queryByRole('button', {name: 'settings.network.modeSystem'}),
            ).not.toBeInTheDocument();
        }
    });

    it('shows the shared custom server below routing choices and keeps its address when hidden', () => {
        const {rerender} = render(<NetworkTab />);
        fireEvent.click(
            group('database').getByRole('button', {name: 'settings.network.modeCustom'}),
        );
        rerender(<NetworkTab />);

        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
            'settings.network.applyTo',
            'settings.network.customTitle',
        ]);
        expect(screen.getByRole('alert')).toHaveTextContent('settings.network.incompleteCustom');
        fireEvent.change(screen.getByRole('textbox', {name: 'custom-proxy-host'}), {
            target: {value: 'proxy.example'},
        });
        rerender(<NetworkTab />);
        fireEvent.click(
            group('database').getByRole('button', {name: 'settings.network.modeDisabled'}),
        );
        rerender(<NetworkTab />);

        expect(screen.queryByRole('textbox', {name: 'custom-proxy-host'})).not.toBeInTheDocument();
        expect(state.proxy?.endpoint?.host).toBe('proxy.example');
    });

    it('saves only the endpoint and explicit modes', () => {
        state.proxy = configured();
        render(<NetworkTab />);
        fireEvent.click(
            group('appHttp').getByRole('button', {name: 'settings.network.modeSystem'}),
        );
        expect(state.proxy).toEqual({
            endpoint: configured().endpoint,
            modes: {app_http: 'system', ai: 'custom', database: 'custom', ssh_tunnel: 'custom'},
        });
        expect(Object.keys(state.proxy ?? {})).toEqual(['endpoint', 'modes']);
    });

    it('keeps both choices when two scopes change before a rerender', () => {
        render(<NetworkTab />);
        fireEvent.click(
            group('appHttp').getByRole('button', {name: 'settings.network.modeCustom'}),
        );
        fireEvent.click(group('ai').getByRole('button', {name: 'settings.network.modeDisabled'}));
        expect(state.proxy?.modes).toEqual({
            app_http: 'custom',
            ai: 'disabled',
            database: 'disabled',
            ssh_tunnel: 'disabled',
        });
    });

    it('refreshes the registry and connection catalogue after changing app routing', async () => {
        state.proxy = configured();
        render(<NetworkTab />);
        fireEvent.click(
            group('appHttp').getByRole('button', {name: 'settings.network.modeSystem'}),
        );
        await waitFor(() => {
            expect(state.refreshRegistry).toHaveBeenCalledTimes(1);
            expect(state.refreshCatalogue).toHaveBeenCalledTimes(1);
        });
    });

    it('coalesces custom proxy host edits into one catalogue refresh', async () => {
        state.proxy = configured();
        render(<NetworkTab />);
        const host = screen.getByRole('textbox', {name: 'custom-proxy-host'});
        fireEvent.change(host, {target: {value: 'proxy-one'}});
        fireEvent.change(host, {target: {value: 'proxy-two'}});
        await waitFor(() => {
            expect(state.refreshRegistry).toHaveBeenCalledTimes(1);
            expect(state.refreshCatalogue).toHaveBeenCalledTimes(1);
        });
    });
});
