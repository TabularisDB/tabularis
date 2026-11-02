import {describe, expect, it, vi} from 'vitest';

// Deliberately NOT mocking @tauri-apps/api: importing the module in a browser-like
// environment (no __TAURI_INTERNALS__) must not throw.
vi.unmock('@tauri-apps/api/core');

describe('connectFrame in a browser environment', () => {
    it('imports without the Tauri internals and builds a browser URL', async () => {
        const {registerActivePlatformCapabilities} =
            await import('../../src/platform/activeCapabilities');
        const {BrowserPlatformCapabilities} =
            await import('../../src/platform/browserCapabilities');
        registerActivePlatformCapabilities(new BrowserPlatformCapabilities({} as never));
        const {pluginFrameUrl} = await import('../../src/plugins/sandbox/connectFrame');
        expect(pluginFrameUrl('my-plugin', 'ui/index.js')).toBe(
            '/api/v1/sandbox/plugins/my-plugin/__guest__.html?module=ui%2Findex.js&mode=ui',
        );
    });
});
