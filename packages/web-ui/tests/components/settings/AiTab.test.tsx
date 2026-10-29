import {MemoryRouter} from 'react-router-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AiTab} from '@/components/settings/AiTab';

const {invoke, updateSetting, providers} = vi.hoisted(() => ({
    providers: [
        {
            id: 'openrouter',
            name: 'OpenRouter',
            version: '1.0.0',
            kind: 'ai-assistant',
            description: 'AI',
            settings: [],
            ai_assistant: {api_version: 1, authentication: 'api-key', default_models: []},
        },
    ],
    invoke: vi.fn(),
    updateSetting: vi.fn(),
}));
vi.mock('@/hooks/useAiProviders', () => ({
    useAiProviders: () => ({
        providers,
        pendingMigration: [],
        error: null,
        loading: false,
        retryMigration: vi.fn(),
    }),
}));
vi.unmock('lucide-react');
vi.mock('@tauri-apps/api/core', () => ({invoke}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings: {aiEnabled: true, aiProvider: 'openrouter', aiModel: ''},
        updateSetting,
    }),
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
    Trans: () => null,
}));

describe('AiTab proxy configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        providers.splice(1);
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
});

vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call: (...args: unknown[]) => invoke(...args)};
    return {useTabularisClient: () => client};
});

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({negotiation: {environment: 'tauri'}}),
}));
