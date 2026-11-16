import {afterEach, describe, expect, it, vi} from 'vitest';

// Deliberately NOT mocking @tauri-apps/api: importing the module in a browser-like
// environment (no __TAURI_INTERNALS__) must not throw.
vi.unmock('@tauri-apps/api/core');

describe('connectFrame in a browser environment', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('imports without the Tauri internals and builds a browser URL', async () => {
        const {registerActivePlatformCapabilities} =
            await import('../../src/platform/activeCapabilities');
        const {BrowserPlatformCapabilities} =
            await import('../../src/platform/browserCapabilities');
        registerActivePlatformCapabilities(new BrowserPlatformCapabilities({} as never));
        const {pluginFrameUrl} = await import('../../src/plugins/sandbox/connectFrame');
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    baseUrl: '/api/v1/sandbox/plugins/session/ticket/my-plugin/',
                }),
            }),
        );
        await expect(pluginFrameUrl('my-plugin', 'ui/index.js')).resolves.toBe(
            '/api/v1/sandbox/plugins/session/ticket/my-plugin/__guest__.html?module=ui%2Findex.js&mode=ui',
        );
    });

    it('rejects unauthorized or cross-plugin asset capabilities', async () => {
        const {registerActivePlatformCapabilities} =
            await import('../../src/platform/activeCapabilities');
        const {BrowserPlatformCapabilities} =
            await import('../../src/platform/browserCapabilities');
        registerActivePlatformCapabilities(new BrowserPlatformCapabilities({} as never));
        const {pluginFrameUrl} = await import('../../src/plugins/sandbox/connectFrame');
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce({ok: false, status: 401})
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        baseUrl: '/api/v1/sandbox/plugins/session/ticket/other-plugin/',
                    }),
                }),
        );
        await expect(pluginFrameUrl('my-plugin', 'ui/index.js')).rejects.toThrow(
            'access failed (401)',
        );
        await expect(pluginFrameUrl('my-plugin', 'ui/index.js')).rejects.toThrow(
            'Invalid plugin sandbox access response',
        );
    });
});

it('prefixes the sandbox ticket and guest URL with runtime configuration', async () => {
    const {registerActivePlatformCapabilities} = await import('@/platform/activeCapabilities');
    const {BrowserPlatformCapabilities} = await import('@/platform/browserCapabilities');
    registerActivePlatformCapabilities(new BrowserPlatformCapabilities({} as never));
    const {pluginFrameUrl} = await import('@/plugins/sandbox/connectFrame');
    const meta = document.createElement('meta');
    meta.name = 'tabularis-public-base';
    meta.content = '/workspaces/test/';
    document.head.append(meta);
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({baseUrl: '/api/v1/sandbox/plugins/session/ticket/probe/'}),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
        await expect(pluginFrameUrl('probe', 'ui.js')).resolves.toBe(
            '/workspaces/test/api/v1/sandbox/plugins/session/ticket/probe/__guest__.html?module=ui.js&mode=ui',
        );
        expect(fetchMock.mock.calls[0][0]).toBe('/workspaces/test/api/v1/sandbox-ticket/probe');
    } finally {
        meta.remove();
        vi.unstubAllGlobals();
    }
});
