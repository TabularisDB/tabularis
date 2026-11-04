import {invoke} from '@tauri-apps/api/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createPlatformCapabilityNegotiation} from '@/platform/capabilities';
import {
    TauriPlatformCapabilities,
    type TauriPlatformOperations,
} from '@/platform/tauriCapabilities';

const createOperations = (): TauriPlatformOperations => ({
    chooseInputPath: vi.fn(),
    chooseSavePath: vi.fn(),
    chooseServerPath: vi.fn(),
    confirmDialog: vi.fn(),
    showMessageDialog: vi.fn(),
    readClipboardText: vi.fn(),
    writeClipboardText: vi.fn(),
    writeClipboardHtml: vi.fn(),
    writeFileContents: vi.fn(),
    readFileContents: vi.fn(),
    openUrl: vi.fn(),
    isNotificationPermissionGranted: vi.fn(),
    requestNotificationPermission: vi.fn(),
    sendNotification: vi.fn(),
    openRoute: vi.fn(),
    openConnectionRoute: vi.fn(),
    publishRouteEvent: vi.fn(),
    subscribeRouteEvent: vi.fn().mockResolvedValue(vi.fn()),
    closeRoute: vi.fn(),
    requestAttention: vi.fn(),
    restartApplication: vi.fn(),
    openStorageLocation: vi.fn(),
    setNativeWindowTheme: vi.fn(),
    getSystemIsDark: vi.fn().mockResolvedValue(false),
    listenForSystemThemeChanges: vi.fn().mockResolvedValue(vi.fn()),
    currentWindowLabel: vi.fn(() => 'main'),
    getAppDataDir: vi.fn().mockResolvedValue('/data'),
});

describe('TauriPlatformCapabilities', () => {
    it('advertises every semantic capability as native', () => {
        const capabilities = new TauriPlatformCapabilities(createOperations());

        expect(capabilities.negotiation.environment).toBe('tauri');
        expect(
            Object.values(capabilities.negotiation.capabilities).every(
                (availability) => availability.supported && availability.adaptation === 'native',
            ),
        ).toBe(true);
        expect(capabilities.supports('chooseInputFile')).toBe(true);
    });

    it('normalizes Tauri input and save dialog paths as opaque references', async () => {
        const operations = createOperations();
        vi.mocked(operations.chooseInputPath).mockResolvedValue('/tmp/example.sql');
        vi.mocked(operations.chooseSavePath).mockResolvedValue('/tmp/export.csv');
        vi.mocked(operations.readFileContents).mockResolvedValue(new Uint8Array([1, 2, 3]));
        const capabilities = new TauriPlatformCapabilities(operations);

        await expect(
            capabilities.chooseInputFile({
                title: 'Import',
                filters: [{name: 'SQL', extensions: ['sql']}],
            }),
        ).resolves.toEqual({name: 'example.sql', reference: '/tmp/example.sql'});
        await expect(capabilities.chooseSaveTarget({suggestedName: 'export.csv'})).resolves.toEqual(
            {reference: '/tmp/export.csv'},
        );
        await expect(capabilities.readInputFile('/tmp/example.sql')).resolves.toEqual(
            new Uint8Array([1, 2, 3]),
        );
    });

    it('adapts desktop BLOB paths and inline database values', async () => {
        const operations = createOperations();
        vi.mocked(operations.chooseInputPath).mockResolvedValue('/tmp/image.png');
        vi.mocked(invoke)
            .mockResolvedValueOnce('BLOB_FILE_REF:4:image/png:/tmp/image.png')
            .mockResolvedValueOnce({
                kind: 'inline',
                wireValue: 'BLOB:4:application/octet-stream:AAECAw==',
            });
        const capabilities = new TauriPlatformCapabilities(operations);

        await expect(capabilities.chooseBlob()).resolves.toBe(
            'BLOB_FILE_REF:4:image/png:/tmp/image.png',
        );
        await expect(
            capabilities.fetchDatabaseBlob({
                connectionId: 'connection-1',
                table: 'files',
                colName: 'payload',
                pkMap: {id: 1},
            }),
        ).resolves.toEqual({
            contents: new Uint8Array([0, 1, 2, 3]),
            mimeType: 'application/octet-stream',
        });
        expect(invoke).toHaveBeenNthCalledWith(1, 'load_blob_from_file', {
            filePath: '/tmp/image.png',
        });
        expect(invoke).toHaveBeenNthCalledWith(2, 'fetch_blob', {
            connectionId: 'connection-1',
            table: 'files',
            colName: 'payload',
            pkMap: {id: 1},
        });
    });

    it('delegates dialogs, clipboard, URL, route, attention, and restart operations', async () => {
        const operations = createOperations();
        vi.mocked(operations.readClipboardText).mockResolvedValue('SELECT 1');
        const capabilities = new TauriPlatformCapabilities(operations);

        vi.mocked(operations.confirmDialog).mockResolvedValue(true);
        vi.mocked(operations.chooseServerPath).mockResolvedValue('/tmp/plugins');
        await expect(
            capabilities.chooseServerPath({kind: 'directory', title: 'Plugins'}),
        ).resolves.toEqual({reference: '/tmp/plugins'});
        await expect(capabilities.confirm({message: 'Continue?', kind: 'warning'})).resolves.toBe(
            true,
        );
        await capabilities.showMessage({message: 'Complete', kind: 'info'});
        await expect(capabilities.readClipboard()).resolves.toBe('SELECT 1');
        await capabilities.writeClipboard('SELECT 2');
        await capabilities.openExternalUrl('https://tabularis.dev');
        await capabilities.openRoute({
            route: '/results-window?session=1',
            target: 'new',
            label: 'results-window-1',
            window: {width: 900, height: 600},
        });
        await capabilities.openConnectionRoute({
            connectionId: 'connection-1',
            title: 'Primary',
        });
        await capabilities.publishRouteEvent('results-window:ready', {
            sessionId: '1',
        });
        const unsubscribe = await capabilities.subscribeRouteEvent('results-window:sync', vi.fn());
        unsubscribe();
        await capabilities.closeRoute();
        await capabilities.requestAttention('critical');
        await capabilities.restartApplication();

        expect(operations.chooseServerPath).toHaveBeenCalledWith({
            kind: 'directory',
            title: 'Plugins',
        });
        expect(operations.confirmDialog).toHaveBeenCalledWith({
            message: 'Continue?',
            kind: 'warning',
        });
        expect(operations.showMessageDialog).toHaveBeenCalledWith({
            message: 'Complete',
            kind: 'info',
        });
        expect(operations.writeClipboardText).toHaveBeenCalledWith('SELECT 2');
        expect(operations.openUrl).toHaveBeenCalledWith('https://tabularis.dev');
        expect(operations.openRoute).toHaveBeenCalledWith({
            route: '/results-window?session=1',
            target: 'new',
            label: 'results-window-1',
            window: {width: 900, height: 600},
        });
        expect(operations.openConnectionRoute).toHaveBeenCalledWith({
            connectionId: 'connection-1',
            title: 'Primary',
        });
        expect(operations.publishRouteEvent).toHaveBeenCalledWith('results-window:ready', {
            sessionId: '1',
        });
        expect(operations.subscribeRouteEvent).toHaveBeenCalledWith(
            'results-window:sync',
            expect.any(Function),
        );
        expect(operations.closeRoute).toHaveBeenCalledOnce();
        expect(operations.requestAttention).toHaveBeenCalledWith('critical');
        expect(operations.restartApplication).toHaveBeenCalledOnce();
    });

    it('writes downloads only after the user chooses a target', async () => {
        const operations = createOperations();
        vi.mocked(operations.chooseSavePath)
            .mockResolvedValueOnce('/tmp/data.csv')
            .mockResolvedValueOnce(null);
        const capabilities = new TauriPlatformCapabilities(operations);
        const contents = new Uint8Array([1, 2, 3]);

        await expect(capabilities.downloadFile({fileName: 'data.csv', contents})).resolves.toBe(
            true,
        );
        await expect(
            capabilities.downloadFile({fileName: 'cancelled.csv', contents}),
        ).resolves.toBe(false);

        expect(operations.writeFileContents).toHaveBeenCalledOnce();
        expect(operations.writeFileContents).toHaveBeenCalledWith('/tmp/data.csv', contents);
    });

    it('negotiates notification permission without hiding denial', async () => {
        const operations = createOperations();
        vi.mocked(operations.isNotificationPermissionGranted)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false);
        vi.mocked(operations.requestNotificationPermission)
            .mockResolvedValueOnce('granted')
            .mockResolvedValueOnce('denied');
        const capabilities = new TauriPlatformCapabilities(operations);

        await expect(capabilities.notify({title: 'Ready', body: 'Export complete'})).resolves.toBe(
            'shown',
        );
        await expect(capabilities.notify({title: 'Blocked'})).resolves.toBe('permission-denied');

        expect(operations.sendNotification).toHaveBeenCalledOnce();
        expect(operations.sendNotification).toHaveBeenCalledWith({
            title: 'Ready',
            body: 'Export complete',
        });
    });

    it('rejects calls disabled by negotiated capability flags', async () => {
        const operations = createOperations();
        const negotiation = createPlatformCapabilityNegotiation('tauri', {
            openExternalUrl: {
                supported: false,
                adaptation: 'unsupported',
                reason: 'Disabled for this session',
            },
        });
        const capabilities = new TauriPlatformCapabilities(operations, negotiation);

        await expect(capabilities.openExternalUrl('https://tabularis.dev')).rejects.toMatchObject({
            code: 'PLATFORM_CAPABILITY_UNSUPPORTED',
            capability: 'openExternalUrl',
        });
        expect(operations.openUrl).not.toHaveBeenCalled();
    });
});

describe('TauriPlatformCapabilities host window integration', () => {
    it('forwards native window theme, system theme, label and storage folder', async () => {
        const operations = createOperations();
        vi.mocked(operations.getSystemIsDark).mockResolvedValue(true);
        vi.mocked(operations.currentWindowLabel).mockReturnValue('conn-1');
        const capabilities = new TauriPlatformCapabilities(operations);
        const onChange = vi.fn();

        await capabilities.setNativeWindowTheme('dark');
        await capabilities.setNativeWindowTheme(null);
        await expect(capabilities.getSystemIsDark()).resolves.toBe(true);
        await capabilities.listenForSystemThemeChanges(onChange);
        await capabilities.openStorageLocation();

        expect(operations.setNativeWindowTheme).toHaveBeenNthCalledWith(1, 'dark');
        expect(operations.setNativeWindowTheme).toHaveBeenNthCalledWith(2, null);
        expect(operations.listenForSystemThemeChanges).toHaveBeenCalledWith(onChange);
        expect(operations.openStorageLocation).toHaveBeenCalledOnce();
        expect(capabilities.currentWindowLabel()).toBe('conn-1');
        expect(capabilities.supports('openStorageLocation')).toBe(true);
    });
});

describe('TauriPlatformCapabilities clipboard fallback', () => {
    const pluginFailure = new Error('X11 server connection timed out');

    const stubWebClipboard = (withClipboardItem = true) => {
        const clipboard = {
            readText: vi.fn().mockResolvedValue('from webview'),
            writeText: vi.fn().mockResolvedValue(undefined),
            write: vi.fn().mockResolvedValue(undefined),
        };
        vi.stubGlobal('navigator', {...navigator, clipboard});
        vi.stubGlobal(
            'ClipboardItem',
            withClipboardItem
                ? class {
                      constructor(readonly items: Record<string, Blob>) {}
                  }
                : undefined,
        );
        return clipboard;
    };

    const failingOperations = () => {
        const operations = createOperations();
        vi.mocked(operations.readClipboardText).mockRejectedValue(pluginFailure);
        vi.mocked(operations.writeClipboardText).mockRejectedValue(pluginFailure);
        vi.mocked(operations.writeClipboardHtml).mockRejectedValue(pluginFailure);
        return operations;
    };

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('leaves the webview clipboard untouched while the plugin works', async () => {
        const clipboard = stubWebClipboard();
        const operations = createOperations();
        vi.mocked(operations.readClipboardText).mockResolvedValue('from plugin');
        const capabilities = new TauriPlatformCapabilities(operations);

        await expect(capabilities.readClipboard()).resolves.toBe('from plugin');
        await capabilities.writeClipboard('SELECT 1');
        await capabilities.writeClipboardHtml('<b>1</b>', '1');

        expect(operations.writeClipboardText).toHaveBeenCalledWith('SELECT 1');
        expect(operations.writeClipboardHtml).toHaveBeenCalledWith('<b>1</b>', '1');
        expect(clipboard.readText).not.toHaveBeenCalled();
        expect(clipboard.writeText).not.toHaveBeenCalled();
        expect(clipboard.write).not.toHaveBeenCalled();
    });

    it('reads and writes text through the webview when the plugin fails', async () => {
        const clipboard = stubWebClipboard();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const capabilities = new TauriPlatformCapabilities(failingOperations());

        await expect(capabilities.readClipboard()).resolves.toBe('from webview');
        await capabilities.writeClipboard('SELECT 1');

        expect(clipboard.writeText).toHaveBeenCalledWith('SELECT 1');
    });

    it('writes HTML and plain-text flavors through the webview when the plugin fails', async () => {
        const clipboard = stubWebClipboard();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const capabilities = new TauriPlatformCapabilities(failingOperations());

        await capabilities.writeClipboardHtml('<b>1</b>', '1');

        const [[item]] = clipboard.write.mock.calls[0] as [[{items: Record<string, Blob>}]];
        await expect(item.items['text/html'].text()).resolves.toBe('<b>1</b>');
        await expect(item.items['text/plain'].text()).resolves.toBe('1');
        expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it('writes only the plain text when the webview has no ClipboardItem', async () => {
        const clipboard = stubWebClipboard(false);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const capabilities = new TauriPlatformCapabilities(failingOperations());

        await capabilities.writeClipboardHtml('<b>1</b>', '1');

        expect(clipboard.writeText).toHaveBeenCalledWith('1');
        expect(clipboard.write).not.toHaveBeenCalled();
    });

    it('rejects with the webview error and keeps trying the plugin when both fail', async () => {
        const clipboard = stubWebClipboard();
        const webviewFailure = new DOMException('Denied', 'NotAllowedError');
        clipboard.writeText.mockRejectedValue(webviewFailure);
        const operations = failingOperations();
        const capabilities = new TauriPlatformCapabilities(operations);

        await expect(capabilities.writeClipboard('a')).rejects.toBe(webviewFailure);
        await expect(capabilities.writeClipboard('b')).rejects.toBe(webviewFailure);

        expect(operations.writeClipboardText).toHaveBeenCalledTimes(2);
    });

    it('skips the plugin for the session once a webview write succeeded', async () => {
        const clipboard = stubWebClipboard();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const operations = failingOperations();
        const capabilities = new TauriPlatformCapabilities(operations);

        await capabilities.writeClipboard('a');
        await capabilities.writeClipboard('b');
        await expect(capabilities.readClipboard()).resolves.toBe('from webview');

        expect(operations.writeClipboardText).toHaveBeenCalledOnce();
        expect(operations.readClipboardText).not.toHaveBeenCalled();
        expect(clipboard.writeText).toHaveBeenNthCalledWith(2, 'b');
        expect(warn).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledWith(expect.any(String), pluginFailure);
    });

    it('keeps the plugin when a failed read meets an empty webview clipboard', async () => {
        const clipboard = stubWebClipboard();
        clipboard.readText.mockResolvedValue('');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const operations = failingOperations();
        const capabilities = new TauriPlatformCapabilities(operations);

        await expect(capabilities.readClipboard()).resolves.toBe('');
        await capabilities.readClipboard();

        expect(operations.readClipboardText).toHaveBeenCalledTimes(2);
        expect(warn).not.toHaveBeenCalled();
    });

    it('skips the plugin once the webview read text the plugin could not', async () => {
        stubWebClipboard();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const operations = failingOperations();
        const capabilities = new TauriPlatformCapabilities(operations);

        await capabilities.readClipboard();
        await capabilities.readClipboard();

        expect(operations.readClipboardText).toHaveBeenCalledOnce();
    });
});
