import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AiProviderCatalog} from '@/components/settings/AiProviderCatalog';
import type {RegistryPluginWithStatus} from '@/types/plugins';
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
        render(<AiProviderCatalog installedIds={[]} onInstalled={onInstalled} />);
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
    it('hides installed providers and unrelated kinds', () => {
        registry.plugins = [gemini, {...gemini, id: 'driver', kind: 'driver', name: 'Database'}];
        render(<AiProviderCatalog installedIds={['gemini']} onInstalled={vi.fn()} />);
        expect(screen.queryByText('Google Gemini')).not.toBeInTheDocument();
        expect(screen.queryByText('Database')).not.toBeInTheDocument();
    });
    it('keeps the saved provider untouched after an install failure and allows retry', async () => {
        call.mockRejectedValueOnce(new Error('Package download failed'));
        const onInstalled = vi.fn();
        render(<AiProviderCatalog installedIds={[]} onInstalled={onInstalled} />);
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
        render(<AiProviderCatalog installedIds={[]} onInstalled={vi.fn()} />);
        expect(screen.getByRole('button')).toBeDisabled();
    });
    it('shows an offline message and retries registry discovery', () => {
        registry.plugins = [];
        registry.error = 'offline';
        render(<AiProviderCatalog installedIds={['anthropic']} onInstalled={vi.fn()} />);
        expect(screen.getByRole('status')).toHaveTextContent('settings.ai.providerRegistryOffline');
        fireEvent.click(screen.getByRole('button', {name: 'common.retry'}));
        expect(refresh).toHaveBeenCalled();
    });
});
