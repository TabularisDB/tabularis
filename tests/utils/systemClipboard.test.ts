import {beforeEach, describe, expect, it, vi} from 'vitest';
import {readText, writeHtml, writeText} from '@tauri-apps/plugin-clipboard-manager';
import {readClipboardText, writeClipboardHtml, writeClipboardText} from '@/utils/systemClipboard';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
    readText: vi.fn(),
    writeText: vi.fn(),
    writeHtml: vi.fn(),
}));

const webview = {
    readText: vi.fn(),
    writeText: vi.fn(),
    write: vi.fn(),
};

const x11Unreachable = new Error(
    'Unknown error while interacting with the clipboard: X11 server connection timed out because it was unreachable',
);

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', {value: webview, configurable: true});
});

describe('readClipboardText', () => {
    it('reads through the plugin when it works', async () => {
        vi.mocked(readText).mockResolvedValue('select 1');

        await expect(readClipboardText()).resolves.toBe('select 1');
        expect(webview.readText).not.toHaveBeenCalled();
    });

    it('falls back to the webview clipboard when the plugin fails', async () => {
        vi.mocked(readText).mockRejectedValue(x11Unreachable);
        webview.readText.mockResolvedValue('select 2');

        await expect(readClipboardText()).resolves.toBe('select 2');
    });

    it('rejects with the webview error when both backends fail', async () => {
        vi.mocked(readText).mockRejectedValue(x11Unreachable);
        webview.readText.mockRejectedValue(new Error('NotAllowedError'));

        await expect(readClipboardText()).rejects.toThrow('NotAllowedError');
    });
});

describe('writeClipboardText', () => {
    it('writes through the plugin when it works', async () => {
        vi.mocked(writeText).mockResolvedValue(undefined);

        await writeClipboardText('abc');

        expect(writeText).toHaveBeenCalledWith('abc');
        expect(webview.writeText).not.toHaveBeenCalled();
    });

    it('falls back to the webview clipboard when the plugin fails', async () => {
        vi.mocked(writeText).mockRejectedValue(x11Unreachable);
        webview.writeText.mockResolvedValue(undefined);

        await writeClipboardText('abc');

        expect(webview.writeText).toHaveBeenCalledWith('abc');
    });
});

describe('writeClipboardHtml', () => {
    it('writes through the plugin when it works', async () => {
        vi.mocked(writeHtml).mockResolvedValue(undefined);

        await writeClipboardHtml('<table></table>', 'a,b');

        expect(writeHtml).toHaveBeenCalledWith('<table></table>', 'a,b');
        expect(webview.write).not.toHaveBeenCalled();
    });

    it('falls back to a webview ClipboardItem with both flavors', async () => {
        vi.mocked(writeHtml).mockRejectedValue(x11Unreachable);
        webview.write.mockResolvedValue(undefined);
        const items: Record<string, Blob>[] = [];
        vi.stubGlobal(
            'ClipboardItem',
            class {
                constructor(data: Record<string, Blob>) {
                    items.push(data);
                }
            },
        );

        await writeClipboardHtml('<table></table>', 'a,b');

        expect(webview.write).toHaveBeenCalledOnce();
        expect(Object.keys(items[0])).toEqual(['text/html', 'text/plain']);
        await expect(items[0]['text/plain'].text()).resolves.toBe('a,b');
        vi.unstubAllGlobals();
    });

    it('falls back to plain text when the webview has no ClipboardItem', async () => {
        vi.mocked(writeHtml).mockRejectedValue(x11Unreachable);
        vi.stubGlobal('ClipboardItem', undefined);
        webview.writeText.mockResolvedValue(undefined);

        await writeClipboardHtml('<table></table>', 'a,b');

        expect(webview.writeText).toHaveBeenCalledWith('a,b');
        vi.unstubAllGlobals();
    });
});
