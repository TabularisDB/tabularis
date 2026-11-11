import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AiTab} from '@/components/settings/AiTab';

const {invoke, updateSetting, settings} = vi.hoisted(() => ({
    invoke: vi.fn(),
    updateSetting: vi.fn(),
    settings: {aiEnabled: true, aiProvider: 'openrouter', aiModel: ''},
}));
vi.unmock('lucide-react');
vi.mock('@tauri-apps/api/core', () => ({invoke}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({
        settings,
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
        settings.aiProvider = 'openrouter';
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'check_ai_key_status') return {configured: true, fromEnv: false};
            if (cmd === 'get_ai_models') return {openrouter: []};
            return '';
        });
        updateSetting.mockResolvedValue(undefined);
    });

    it('keeps a blank custom endpoint editable and persists it after entering a host', async () => {
        render(<AiTab />);
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

    it('offers API Route without changing the saved provider until selected', async () => {
        render(<AiTab />);
        await screen.findByText('settings.ai.configured');
        expect(invoke).toHaveBeenCalledWith('check_ai_key_status', {provider: 'api-route'});
        expect(updateSetting).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: /API Route/}));
        expect(updateSetting).toHaveBeenCalledWith('aiProvider', 'api-route');
    });

    it('uses the API Route proxy settings and allows model refresh when selected', async () => {
        settings.aiProvider = 'api-route';
        render(<AiTab />);
        await screen.findByText('settings.ai.configured');
        fireEvent.click(screen.getByRole('button', {name: 'settings.network.modeDisabled'}));
        expect(updateSetting).toHaveBeenLastCalledWith('aiProviderProxies', {
            'api-route': {mode: 'disabled'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'settings.ai.refresh'}));
        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('get_ai_models', {forceRefresh: true}),
        );
    });
});

vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call: (...args: unknown[]) => invoke(...args)};
    return {useTabularisClient: () => client};
});

vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({negotiation: {environment: 'tauri'}}),
}));
