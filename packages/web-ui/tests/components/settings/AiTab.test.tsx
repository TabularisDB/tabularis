import {MemoryRouter} from 'react-router-dom';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AiTab} from '@/components/settings/AiTab';
import type {RegistryPluginWithStatus} from '@/types/plugins';

const {invoke, updateSetting, providers, settings, refreshProviders, showAlert, registryPlugins} =
    vi.hoisted(() => ({
        providers: [
            {
                id: 'openrouter',
                name: 'OpenRouter',
                version: '1.0.0',
                kind: 'ai-assistant',
                builtin: true,
                description: 'AI',
                settings: [],
                ai_assistant: {api_version: 1, authentication: 'api-key', default_models: []},
            },
        ],
        invoke: vi.fn(),
        updateSetting: vi.fn(),
        settings: {aiEnabled: true, aiProvider: 'openrouter', aiModel: ''},
        refreshProviders: vi.fn(),
        showAlert: vi.fn(),
        registryPlugins: [] as RegistryPluginWithStatus[],
    }));
vi.mock('@/hooks/useAiProviders', () => ({
    useAiProviders: () => ({
        providers,
        pendingMigration: [],
        error: null,
        loading: false,
        retryMigration: vi.fn(),
        refresh: refreshProviders,
    }),
}));
vi.unmock('lucide-react');
vi.mock('@tauri-apps/api/core', () => ({invoke}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings,
        updateSetting,
    }),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert})}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
    Trans: () => null,
}));

describe('AiTab proxy configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        providers.splice(1);
        registryPlugins.splice(0);
        Object.assign(settings, {aiEnabled: true, aiProvider: 'openrouter', aiModel: ''});
        refreshProviders.mockResolvedValue(undefined);
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'check_ai_key_status') return {configured: true, fromEnv: false};
            if (cmd === 'get_ai_models') return {openrouter: []};
            return '';
        });
        updateSetting.mockResolvedValue(undefined);
    });

    it('keeps a blank custom endpoint editable and persists it after entering a host', async () => {
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        await screen.findByText('settings.ai.configured');
        fireEvent.click(screen.getByRole('button', {name: 'settings.network.modeCustom'}));
        const host = await screen.findByPlaceholderText('127.0.0.1');
        expect(host).toHaveValue('');
        expect(updateSetting).toHaveBeenLastCalledWith('aiProviderProxies', {});
        fireEvent.change(host, {target: {value: 'proxy.example.test'}});
        await waitFor(() =>
            expect(updateSetting).toHaveBeenLastCalledWith('aiProviderProxies', {
                openrouter: {
                    mode: 'custom',
                    endpoint: {
                        protocol: 'http',
                        host: 'proxy.example.test',
                        port: 7890,
                        username: undefined,
                    },
                },
            }),
        );
        fireEvent.click(screen.getByRole('button', {name: 'settings.network.modeInherit'}));
        expect(screen.queryByPlaceholderText('127.0.0.1')).not.toBeInTheDocument();
        expect(updateSetting).toHaveBeenLastCalledWith('aiProviderProxies', {});
    });
    it('selects an installed provider without a hardcoded provider entry', async () => {
        providers.push({...providers[0], id: 'community-ai', name: 'Community AI'});
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', {name: 'Community AI'}));
        expect(updateSetting).toHaveBeenCalledWith('aiProvider', 'community-ai');
        expect(updateSetting).toHaveBeenCalledWith('aiModel', '');
        expect(screen.queryByRole('button', {name: 'Anthropic'})).not.toBeInTheDocument();
    });
    it('clears the active provider and model and disables AI after removal', async () => {
        providers.push({...providers[0], id: 'gemini', name: 'Google Gemini', builtin: false});
        Object.assign(settings, {aiProvider: 'gemini', aiModel: 'models/saved-model'});
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', {name: 'settings.ai.removeProvider'}));
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        await waitFor(() => expect(refreshProviders).toHaveBeenCalled());
        expect(invoke).toHaveBeenCalledWith('uninstall_plugin', {pluginId: 'gemini'});
        expect(updateSetting.mock.calls).toEqual([
            ['aiEnabled', false],
            ['aiModel', ''],
            ['aiProvider', ''],
        ]);
        expect(showAlert).toHaveBeenCalledWith('settings.ai.activeProviderRemoved', {
            title: 'common.success',
            kind: 'info',
        });
    });
    it('preserves the selected provider when removing an unused provider', async () => {
        providers.push({...providers[0], id: 'gemini', name: 'Google Gemini', builtin: false});
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', {name: 'settings.ai.removeProvider'}));
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        await waitFor(() => expect(refreshProviders).toHaveBeenCalled());
        expect(updateSetting).not.toHaveBeenCalled();
        expect(showAlert).not.toHaveBeenCalled();
    });
    it('allows removing a provider while AI is disabled', async () => {
        providers.push({...providers[0], id: 'gemini', name: 'Google Gemini', builtin: false});
        settings.aiEnabled = false;
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        const remove = screen.getByRole('button', {name: 'settings.ai.removeProvider'});
        expect(remove).toBeEnabled();
        fireEvent.click(remove);
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        await waitFor(() => expect(refreshProviders).toHaveBeenCalled());
        expect(updateSetting).not.toHaveBeenCalled();
    });
    it('enables AI when installing and using a provider while AI is disabled', async () => {
        settings.aiEnabled = false;
        registryPlugins.push({
            id: 'gemini',
            name: 'Google Gemini',
            description: 'Native Gemini API',
            kind: 'ai-assistant',
            author: 'Tabularis',
            homepage: '',
            latest_version: '1.0.1',
            installed_version: null,
            update_available: false,
            platform_supported: true,
            releases: [{version: '1.0.1', min_tabularis_version: null, platform_supported: true}],
        });
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        const install = screen.getByRole('button', {name: 'settings.ai.installAndUseProvider'});
        expect(install).toBeEnabled();
        fireEvent.click(install);
        await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('aiEnabled', true));
        expect(updateSetting.mock.calls).toEqual([
            ['aiModel', ''],
            ['aiProvider', 'gemini'],
            ['aiEnabled', true],
        ]);
    });
    it('preserves AI settings when uninstalling the active provider fails', async () => {
        providers.push({...providers[0], id: 'gemini', name: 'Google Gemini', builtin: false});
        settings.aiProvider = 'gemini';
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'uninstall_plugin') throw new Error('Removal failed');
            if (cmd === 'get_ai_models') return {};
            if (cmd === 'check_ai_key_status') return {configured: true, fromEnv: false};
            return '';
        });
        render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', {name: 'settings.ai.removeProvider'}));
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        expect(await screen.findByRole('alert')).toHaveTextContent('Removal failed');
        expect(updateSetting).not.toHaveBeenCalled();
        expect(refreshProviders).not.toHaveBeenCalled();
    });
    it('preserves a provider selected while removal is in progress', async () => {
        providers.push({...providers[0], id: 'gemini', name: 'Google Gemini', builtin: false});
        settings.aiProvider = 'gemini';
        let completeRemoval: () => void = () => {
            throw new Error('Removal has not started');
        };
        const removal = new Promise<void>((resolve) => {
            completeRemoval = resolve;
        });
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'uninstall_plugin') return removal;
            if (cmd === 'get_ai_models') return {};
            if (cmd === 'check_ai_key_status') return {configured: true, fromEnv: false};
            return '';
        });
        const {rerender} = render(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', {name: 'settings.ai.removeProvider'}));
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        settings.aiProvider = 'openrouter';
        rerender(
            <MemoryRouter>
                <AiTab />
            </MemoryRouter>,
        );
        completeRemoval();
        await waitFor(() => expect(refreshProviders).toHaveBeenCalled());
        expect(updateSetting).not.toHaveBeenCalled();
        expect(showAlert).not.toHaveBeenCalled();
    });
});

vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call: (...args: unknown[]) => invoke(...args)};
    return {useTabularisClient: () => client};
});

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({negotiation: {environment: 'tauri'}}),
}));

vi.mock('@/hooks/usePluginRegistry', () => ({
    usePluginRegistry: () => ({
        plugins: registryPlugins,
        loading: false,
        error: null,
        refresh: vi.fn(),
    }),
}));
