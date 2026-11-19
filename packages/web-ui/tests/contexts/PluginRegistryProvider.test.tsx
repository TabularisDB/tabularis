import {StrictMode, type ReactNode} from 'react';
import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {PluginRegistryProvider} from '@/contexts/PluginRegistryProvider';
import {useConnectionCatalogue} from '@/hooks/useConnectionCatalogue';
import {usePluginRegistry} from '@/hooks/usePluginRegistry';
import type {RegistryPluginWithStatus} from '@/types/plugins';

vi.mock('@/hooks/useTabularisClient', () => import('../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../support/tauriBackedHooks'));
const settings = vi.hoisted(() => ({
    settings: {tabulariumRegistryUrl: 'https://registry.example'},
    isLoading: false,
}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: () => ({allDrivers: []})}));
vi.mock('@/hooks/useSettings', () => ({useSettings: () => settings}));
vi.mock('@tauri-apps/api/event', () => ({listen: vi.fn()}));

const plugin: RegistryPluginWithStatus = {
    id: 'test',
    name: 'Test',
    description: '',
    author: '',
    homepage: '',
    installed_version: '1.0.0',
    latest_version: '2.0.0',
    update_available: true,
    platform_supported: true,
    releases: [{version: '2.0.0', platform_supported: true, min_tabularis_version: null}],
};

const wrapper = ({children}: {children: ReactNode}) => (
    <StrictMode>
        <PluginRegistryProvider>{children}</PluginRegistryProvider>
    </StrictMode>
);

describe('PluginRegistryProvider', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        settings.isLoading = false;
        settings.settings.tabulariumRegistryUrl = 'https://registry.example';
        vi.mocked(invoke).mockResolvedValue([plugin]);
        vi.mocked(listen).mockResolvedValue(vi.fn());
    });

    it('shares one startup request and refreshes all consumers after an update', async () => {
        const {result} = renderHook(
            () => ({sidebar: usePluginRegistry(), tab: usePluginRegistry()}),
            {wrapper},
        );
        await waitFor(() => expect(result.current.sidebar.updates).toHaveLength(1));
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result.current.sidebar).toBe(result.current.tab);
        vi.mocked(invoke).mockResolvedValue([
            {...plugin, installed_version: '2.0.0', update_available: false},
        ]);
        await act(async () => result.current.tab.refresh());
        expect(result.current.sidebar.updates).toHaveLength(0);
    });

    it('resolves a refresh once its result is in, and a replaced one with its replacement', async () => {
        const {result} = renderHook(() => usePluginRegistry(), {wrapper});
        await waitFor(() => expect(result.current.loading).toBe(false));
        const pending: Array<(plugins: RegistryPluginWithStatus[]) => void> = [];
        vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
        const settled: string[] = [];
        let first!: Promise<void>;
        let second!: Promise<void>;
        await act(async () => {
            first = result.current.refresh().then(() => void settled.push('first'));
        });
        await act(async () => {
            second = result.current.refresh().then(() => void settled.push('second'));
        });
        expect(pending).toHaveLength(2);
        // The replaced request answers first: nobody is told the registry is current yet.
        await act(async () => pending[0]([plugin]));
        expect(settled).toEqual([]);
        await act(async () => pending[1]([]));
        await act(async () => Promise.all([first, second]));
        expect(settled.sort()).toEqual(['first', 'second']);
        expect(result.current.plugins).toEqual([]);
    });

    it('ignores stale responses when refreshes overlap', async () => {
        const {result} = renderHook(() => usePluginRegistry(), {wrapper});
        await waitFor(() => expect(result.current.loading).toBe(false));
        let resolveOld!: (plugins: RegistryPluginWithStatus[]) => void;
        vi.mocked(invoke).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveOld = resolve;
                }),
        );
        // The old request stays open, so its refresh must not be awaited here.
        await act(async () => void result.current.refresh());
        vi.mocked(invoke).mockResolvedValue([]);
        await act(async () => result.current.refresh());
        await act(async () => resolveOld([plugin]));
        expect(result.current.updates).toEqual([]);
    });

    it('refreshes on installs from outside Settings and cleans up listeners', async () => {
        const cleanup = vi.fn();
        vi.mocked(listen).mockResolvedValue(cleanup);
        const {result, unmount} = renderHook(() => usePluginRegistry(), {
            wrapper,
        });
        await waitFor(() => expect(result.current.updates).toHaveLength(1));
        vi.mocked(invoke).mockResolvedValue([]);
        const callback = vi
            .mocked(listen)
            .mock.calls.filter(([event]) => event === 'tabularis://plugin-installed')
            .at(-1)![1];
        await act(async () =>
            callback({event: 'tabularis://plugin-installed', id: 1, payload: {}}),
        );
        expect(result.current.updates).toHaveLength(0);
        unmount();
        await waitFor(() =>
            expect(cleanup).toHaveBeenCalledTimes(vi.mocked(listen).mock.calls.length),
        );
    });

    it('waits for settings and recovers from a registry failure', async () => {
        settings.isLoading = true;
        const {result, rerender} = renderHook(() => usePluginRegistry(), {
            wrapper,
        });
        expect(invoke).not.toHaveBeenCalled();
        settings.isLoading = false;
        vi.mocked(invoke).mockRejectedValueOnce(new Error('Offline'));
        rerender();
        await waitFor(() => expect(result.current.error).toBe('Offline'));
        expect(result.current.updates).toEqual([]);
        await act(async () => result.current.refresh());
        expect(result.current.updates).toHaveLength(1);
        expect(result.current.error).toBeNull();
    });

    it('shares each registry result with the connection catalogue, including deep-link installs', async () => {
        settings.settings.tabulariumRegistryUrl = 'https://catalogue.example';
        const {result} = renderHook(
            () => ({registry: usePluginRegistry(), catalogue: useConnectionCatalogue(false)}),
            {wrapper},
        );
        await waitFor(() => expect(result.current.registry.loading).toBe(false));
        expect(result.current.catalogue.registry).toEqual([plugin]);
        expect(invoke).toHaveBeenCalledTimes(1);

        const installed = {...plugin, installed_version: '2.0.0', update_available: false};
        vi.mocked(invoke).mockResolvedValue([installed]);
        const callback = vi
            .mocked(listen)
            .mock.calls.filter(([event]) => event === 'tabularis://plugin-installed')
            .at(-1)![1];
        await act(async () =>
            callback({event: 'tabularis://plugin-installed', id: 1, payload: {}}),
        );
        expect(result.current.catalogue.registry).toEqual([installed]);
        expect(invoke).toHaveBeenCalledTimes(2);
    });
});
