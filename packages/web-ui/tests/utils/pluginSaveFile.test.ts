import {describe, expect, it} from 'vitest';
import {
    PLUGIN_SAVE_FILE_MAX_BYTES,
    parsePluginSaveFile,
    pluginSaveFileName,
} from '@/utils/pluginSaveFile';

describe('pluginSaveFileName', () => {
    it('keeps only the base name of a suggested path', () => {
        expect(pluginSaveFileName('photo.jpg')).toBe('photo.jpg');
        expect(pluginSaveFileName('../../.ssh/authorized_keys')).toBe('authorized_keys');
        expect(pluginSaveFileName('C:\\Users\\me\\report.csv')).toBe('report.csv');
    });

    it('drops control and reserved characters and leading or trailing dots', () => {
        expect(pluginSaveFileName('a\u0000b\nc<d>:e"f|g?h*.png')).toBe('abcdefgh.png');
        expect(pluginSaveFileName('..bashrc')).toBe('bashrc');
        expect(pluginSaveFileName(' name. ')).toBe('name');
    });

    it('shortens a long name to 255 characters and keeps its extension', () => {
        const name = pluginSaveFileName(`${'x'.repeat(300)}.jpeg`);
        expect(name).toHaveLength(255);
        expect(name.endsWith('x.jpeg')).toBe(true);
    });

    it('shortens a long multibyte name to 255 UTF-8 bytes without splitting a character', () => {
        const utf8 = new TextEncoder();
        for (const char of ['界', '😀']) {
            const name = pluginSaveFileName(`${char.repeat(100)}.txt`);
            expect(utf8.encode(name).length).toBeLessThanOrEqual(255);
            expect(name.endsWith(`${char}.txt`)).toBe(true);
            expect(new TextDecoder().decode(utf8.encode(name))).toBe(name);
        }
        expect(pluginSaveFileName(`${'界'.repeat(85)}.txt`)).toBe(`${'界'.repeat(83)}.txt`);
    });

    it('refuses a name that is not a string or names no file', () => {
        expect(() => pluginSaveFileName(undefined)).toThrow('must be a string');
        expect(() => pluginSaveFileName('folder/')).toThrow('must contain a file name');
        expect(() => pluginSaveFileName('..')).toThrow('must contain a file name');
    });
});

describe('parsePluginSaveFile', () => {
    it('reads Blob, ArrayBuffer and typed-array data', async () => {
        const bytes = [1, 2, 3, 4];
        for (const data of [
            new Blob([new Uint8Array(bytes)]),
            new Uint8Array(bytes).buffer,
            new Uint8Array(bytes),
            new DataView(new Uint8Array(bytes).buffer),
        ]) {
            const request = await parsePluginSaveFile({data, suggestedName: 'a.bin'});
            expect(Array.from(request.contents)).toEqual(bytes);
        }
    });

    it('takes only the viewed bytes of a typed array and copies them', async () => {
        const buffer = new Uint8Array([9, 1, 2, 9]);
        const request = await parsePluginSaveFile({
            data: buffer.subarray(1, 3),
            suggestedName: 'part.bin',
        });
        buffer.fill(0);
        expect(Array.from(request.contents)).toEqual([1, 2]);
    });

    it('passes the MIME type on and refuses one that is malformed', async () => {
        const data = new Uint8Array([1]);
        await expect(
            parsePluginSaveFile({data, suggestedName: 'a.png', mimeType: 'image/png'}),
        ).resolves.toMatchObject({fileName: 'a.png', mimeType: 'image/png'});
        await expect(
            parsePluginSaveFile({data, suggestedName: 'a.png', mimeType: 'text/html\r\nX: 1'}),
        ).rejects.toThrow('type/subtype');
    });

    it('refuses other data and data over the size cap', async () => {
        for (const data of ['text', [1, 2], {length: 1}, null]) {
            await expect(parsePluginSaveFile({data, suggestedName: 'a.bin'})).rejects.toThrow(
                'must be a Blob, ArrayBuffer or typed array',
            );
        }
        const tooLarge = {size: PLUGIN_SAVE_FILE_MAX_BYTES + 1} as Blob;
        Object.setPrototypeOf(tooLarge, Blob.prototype);
        await expect(parsePluginSaveFile({data: tooLarge, suggestedName: 'a.bin'})).rejects.toThrow(
            'larger than 64 MiB',
        );
        await expect(
            parsePluginSaveFile({
                data: new ArrayBuffer(PLUGIN_SAVE_FILE_MAX_BYTES + 1),
                suggestedName: 'a.bin',
            }),
        ).rejects.toThrow('larger than 64 MiB');
    });

    it('refuses a request that is not an object', async () => {
        await expect(parsePluginSaveFile('a.bin')).rejects.toThrow('expects {data');
    });
});
