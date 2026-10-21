import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {PluginSettingsPage} from '@/components/settings/PluginSettingsPage';
import {useDrivers} from '@/hooks/useDrivers';
import {useSettings} from '@/hooks/useSettings';
import {useDatabase} from '@/hooks/useDatabase';
import {useConnectionCatalogue} from '@/hooks/useConnectionCatalogue';
import type {PluginManifest} from '@/types/plugins';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => {
            if (!options) return key;
            return Object.entries(options).reduce(
                (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
                key,
            );
        },
    }),
}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: vi.fn()}));
vi.mock('@/hooks/useSettings', () => ({useSettings: vi.fn()}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: vi.fn()}));
vi.mock('@/hooks/useConnectionCatalogue', () => ({
    useConnectionCatalogue: vi.fn(),
}));
vi.mock('@/components/ui/SlotAnchor', () => ({
    SlotAnchor: () => null,
}));

const manifest: PluginManifest = {
    id: 'test-plugin',
    name: 'Test plugin',
    version: '1.0.0',
    description: 'A test driver',
    default_port: 1234,
    capabilities: {
        schemas: false,
        views: false,
        routines: false,
        file_based: false,
        folder_based: false,
        identifier_quote: '"',
        alter_primary_key: false,
    },
};

describe('PluginSettingsPage restart during save', () => {
    const refresh = vi.fn();
    const updateSetting = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
        updateSetting.mockResolvedValue(undefined);
        vi.mocked(useDrivers).mockReturnValue({
            allDrivers: [manifest],
            installedPlugins: [manifest],
            refresh,
        } as ReturnType<typeof useDrivers>);
        vi.mocked(useSettings).mockReturnValue({
            settings: {plugins: {}, pluginCallTimeoutSeconds: 120},
            updateSetting,
            isLoading: false,
            isLanguageReady: true,
            isLanguageSettled: true,
        } as ReturnType<typeof useSettings>);
        vi.mocked(useDatabase).mockReturnValue({
            openConnectionIds: [],
            connectionDataMap: {},
            disconnect: vi.fn(),
        } as unknown as ReturnType<typeof useDatabase>);
        vi.mocked(useConnectionCatalogue).mockReturnValue({
            registry: [],
        } as ReturnType<typeof useConnectionCatalogue>);
    });

    it('keeps Save busy while disable drains, then enables the driver once', async () => {
        let finishDisable!: () => void;
        const pendingDisable = new Promise<void>((resolve) => {
            finishDisable = resolve;
        });
        vi.mocked(invoke).mockImplementation(async (command) => {
            if (command === 'disable_plugin') return pendingDisable;
            if (command === 'enable_plugin') return;
            throw new Error(`Unexpected command: ${command}`);
        });

        render(<PluginSettingsPage pluginId="test-plugin" />);
        const save = screen.getByRole('button', {name: 'common.save'});
        fireEvent.click(save);
        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('disable_plugin', {pluginId: 'test-plugin'}),
        );
        expect(save).toBeDisabled();
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(invoke).not.toHaveBeenCalledWith('enable_plugin', expect.anything());

        fireEvent.click(save);
        expect(
            vi.mocked(invoke).mock.calls.filter(([command]) => command === 'disable_plugin'),
        ).toHaveLength(1);

        await act(async () => finishDisable());
        await waitFor(() =>
            expect(invoke).toHaveBeenCalledWith('enable_plugin', {pluginId: 'test-plugin'}),
        );
        await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'false'));
        expect(save).toBeEnabled();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(screen.getByText('settings.plugins.pluginSettings.saved')).toBeInTheDocument();
    });

    it('saves a per-plugin shutdown grace and clears it to inherit the global value', async () => {
        vi.mocked(invoke).mockResolvedValue(undefined);
        render(<PluginSettingsPage pluginId="test-plugin" />);

        const grace = screen.getByRole('spinbutton', {
            name: 'settings.plugins.pluginSettings.shutdownGrace',
        });
        expect(grace).toHaveValue(null);
        expect(grace).toHaveAttribute(
            'placeholder',
            'settings.plugins.pluginSettings.shutdownGracePlaceholder',
        );

        fireEvent.change(grace, {target: {value: '15'}});
        const save = screen.getByRole('button', {name: 'common.save'});
        fireEvent.click(save);
        await waitFor(() =>
            expect(updateSetting).toHaveBeenCalledWith('plugins', {
                'test-plugin': expect.objectContaining({shutdownGraceSeconds: 15}),
            }),
        );
        await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'false'));

        fireEvent.click(
            screen.getByRole('button', {
                name: 'settings.plugins.pluginSettings.shutdownGraceInherit',
            }),
        );
        fireEvent.click(save);
        await waitFor(() => {
            const saved = updateSetting.mock.calls.at(-1)?.[1] as {
                'test-plugin': {shutdownGraceSeconds?: number};
            };
            expect(saved['test-plugin'].shutdownGraceSeconds).toBeUndefined();
        });
    });
});
