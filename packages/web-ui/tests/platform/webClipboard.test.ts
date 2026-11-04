import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    readWebClipboardText,
    writeWebClipboardHtml,
    writeWebClipboardText,
} from '@/platform/webClipboard';

describe('webClipboard', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects with NotAllowedError when navigator.clipboard is missing', async () => {
        vi.stubGlobal('navigator', {...navigator, clipboard: undefined});

        await expect(readWebClipboardText()).rejects.toMatchObject({name: 'NotAllowedError'});
        await expect(writeWebClipboardText('a')).rejects.toMatchObject({name: 'NotAllowedError'});
        await expect(writeWebClipboardHtml('<b>a</b>', 'a')).rejects.toMatchObject({
            name: 'NotAllowedError',
        });
    });

    it('falls back to plain text when the clipboard cannot write items', async () => {
        const clipboard = {writeText: vi.fn().mockResolvedValue(undefined)};
        vi.stubGlobal('navigator', {...navigator, clipboard});

        await writeWebClipboardHtml('<b>a</b>', 'a');

        expect(clipboard.writeText).toHaveBeenCalledWith('a');
    });

    it('passes clipboard errors through unchanged', async () => {
        const failure = new DOMException('Denied', 'NotAllowedError');
        vi.stubGlobal('navigator', {
            ...navigator,
            clipboard: {readText: vi.fn().mockRejectedValue(failure)},
        });

        await expect(readWebClipboardText()).rejects.toBe(failure);
    });
});
