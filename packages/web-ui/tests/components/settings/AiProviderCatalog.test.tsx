import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AiProviderCatalog} from '@/components/settings/AiProviderCatalog';
import type {RegistryPluginWithStatus} from '@/types/plugins';
import type {AiAssistantManifest} from '@/types/ai';
import {PLUGIN_INSTALL_DEADLINE_MS} from '@/api/pluginLifecycle';

const {call, refresh, registry} = vi.hoisted(() => ({
    call: vi.fn(),
    refresh: vi.fn(),
    registry: {
        plugins: [] as RegistryPluginWithStatus[],
        loading: false,
        error: null as string | null,
    },
}));
vi.mock('@/hooks/usePluginRegistry', () => ({usePluginRegistry: () => ({...registry, refresh})}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => ({call})}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, args?: {provider: string}) =>
            args?.provider ? `${key} ${args.provider}` : key,
    }),
}));

const gemini: RegistryPluginWithStatus = {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Native Gemini API',
    kind: 'ai-assistant',
    author: 'Tabularis',
    homepage: '',
    latest_version: '1.0.0',
    installed_version: null,
    update_available: false,
    platform_supported: true,
    icon: 'https://example.test/gemini.svg',
    releases: [{version: '1.0.0', min_tabularis_version: null, platform_supported: true}],
};
const installedGemini: AiAssistantManifest = {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Native Gemini API',
    version: '1.0.0',
    kind: 'ai-assistant',
    settings: [],
    ai_assistant: {api_version: 1, authentication: 'api-key', default_models: []},
};
describe('Contextual AI provider installation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registry.plugins = [gemini];
        registry.loading = false;
        registry.error = null;
        call.mockResolvedValue(undefined);
    });
    it('installs the compatible universal release then configures the provider', async () => {
        const onInstalled = vi.fn().mockResolvedValue(undefined);
        render(
            <AiProviderCatalog
                installedProviders={[]}
                onInstalled={onInstalled}
                onRemoved={vi.fn()}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', {name: 'settings.ai.installAndUseProvider Google Gemini'}),
        );
        await waitFor(() => expect(onInstalled).toHaveBeenCalledWith('gemini'));
        expect(call).toHaveBeenCalledWith(
            'install_plugin',
            {pluginId: 'gemini', version: '1.0.0'},
            {deadlineMs: PLUGIN_INSTALL_DEADLINE_MS},
        );
        expect(refresh).toHaveBeenCalled();
        expect(document.querySelector('img')?.getAttribute('src')).toBe(gemini.icon);
    });
    it('shows installed external providers and hides built-ins and unrelated kinds', () => {
        registry.plugins = [
            gemini,
            {...gemini, id: 'driver', kind: 'driver', name: 'Database'},
            {...gemini, id: 'openai', name: 'OpenAI'},
        ];
        render(
            <AiProviderCatalog
                installedProviders={[
                    installedGemini,
                    {...installedGemini, id: 'openai', name: 'OpenAI', builtin: true},
                ]}
                onInstalled={vi.fn()}
                onRemoved={vi.fn()}
            />,
        );
        expect(screen.getByText('Google Gemini')).toBeInTheDocument();
        expect(screen.getByText('settings.plugins.installed')).toBeInTheDocument();
        expect(
            screen.getByRole('button', {name: 'settings.ai.removeProvider Google Gemini'}),
        ).toBeEnabled();
        expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
        expect(screen.queryByText('Database')).not.toBeInTheDocument();
    });
    it('keeps the saved provider untouched after an install failure and allows retry', async () => {
        call.mockRejectedValueOnce(new Error('Package download failed'));
        const onInstalled = vi.fn();
        render(
            <AiProviderCatalog
                installedProviders={[]}
                onInstalled={onInstalled}
                onRemoved={vi.fn()}
            />,
        );
        const button = screen.getByRole('button', {
            name: 'settings.ai.installAndUseProvider Google Gemini',
        });
        fireEvent.click(button);
        expect(await screen.findByRole('alert')).toHaveTextContent('Package download failed');
        expect(onInstalled).not.toHaveBeenCalled();
        fireEvent.click(button);
        await waitFor(() => expect(onInstalled).toHaveBeenCalledWith('gemini'));
    });
    it('blocks packages requiring a newer application version', () => {
        registry.plugins = [
            {...gemini, releases: [{...gemini.releases[0], min_tabularis_version: '999.0.0'}]},
        ];
        render(
            <AiProviderCatalog installedProviders={[]} onInstalled={vi.fn()} onRemoved={vi.fn()} />,
        );
        expect(screen.getByRole('button')).toBeDisabled();
    });
    it('shows an offline message and retries registry discovery', () => {
        registry.plugins = [];
        registry.error = 'offline';
        render(
            <AiProviderCatalog installedProviders={[]} onInstalled={vi.fn()} onRemoved={vi.fn()} />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('settings.ai.providerRegistryOffline');
        fireEvent.click(screen.getByRole('button', {name: 'common.retry'}));
        expect(refresh).toHaveBeenCalled();
    });
    it('removes an installed provider after confirmation even when the registry is offline', async () => {
        registry.plugins = [];
        registry.error = 'offline';
        const onRemoved = vi.fn().mockResolvedValue(undefined);
        const {rerender} = render(
            <AiProviderCatalog
                installedProviders={[installedGemini]}
                onInstalled={vi.fn()}
                onRemoved={onRemoved}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', {name: 'settings.ai.removeProvider Google Gemini'}),
        );
        expect(call).not.toHaveBeenCalled();
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('gemini'));
        expect(call).toHaveBeenCalledWith('uninstall_plugin', {pluginId: 'gemini'});
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(refresh).toHaveBeenCalled();
        rerender(
            <AiProviderCatalog
                installedProviders={[]}
                onInstalled={vi.fn()}
                onRemoved={onRemoved}
            />,
        );
        expect(screen.queryByText('Google Gemini')).not.toBeInTheDocument();
    });
    it('keeps the installed provider after a removal failure and allows retry', async () => {
        call.mockRejectedValueOnce(new Error('Package is busy'));
        const onRemoved = vi.fn().mockResolvedValue(undefined);
        render(
            <AiProviderCatalog
                installedProviders={[installedGemini]}
                onInstalled={vi.fn()}
                onRemoved={onRemoved}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', {name: 'settings.ai.removeProvider Google Gemini'}),
        );
        const confirm = within(screen.getByRole('dialog')).getByRole('button', {
            name: 'settings.plugins.remove',
        });
        fireEvent.click(confirm);
        expect(await screen.findByRole('alert')).toHaveTextContent('Package is busy');
        expect(onRemoved).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(screen.getByText('settings.plugins.installed')).toBeInTheDocument();
        fireEvent.click(confirm);
        await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('gemini'));
    });
    it('cancels removal without uninstalling or changing settings', () => {
        const onRemoved = vi.fn();
        render(
            <AiProviderCatalog
                installedProviders={[installedGemini]}
                onInstalled={vi.fn()}
                onRemoved={onRemoved}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', {name: 'settings.ai.removeProvider Google Gemini'}),
        );
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {name: 'common.cancel'}),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(call).not.toHaveBeenCalled();
        expect(onRemoved).not.toHaveBeenCalled();
    });
    it('returns the card to Install and use after removal', async () => {
        const onRemoved = vi.fn().mockResolvedValue(undefined);
        const {rerender} = render(
            <AiProviderCatalog
                installedProviders={[installedGemini]}
                onInstalled={vi.fn()}
                onRemoved={onRemoved}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', {name: 'settings.ai.removeProvider Google Gemini'}),
        );
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'settings.plugins.remove',
            }),
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        rerender(
            <AiProviderCatalog
                installedProviders={[]}
                onInstalled={vi.fn()}
                onRemoved={onRemoved}
            />,
        );
        expect(
            screen.getByRole('button', {name: 'settings.ai.installAndUseProvider Google Gemini'}),
        ).toBeEnabled();
        expect(screen.queryByText('settings.plugins.installed')).not.toBeInTheDocument();
    });
});
