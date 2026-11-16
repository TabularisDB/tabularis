import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DATA_IMPORT_FILE_LIMIT, readDataImportFile} from '@/utils/dataImportFile';
const readInputFile = vi.fn();
const platform = {readInputFile};
const file = (name = 'data.csv') => ({name, reference: 'opaque-reference'});
describe('readDataImportFile', () => {
    beforeEach(() => {
        readInputFile.mockReset();
        readInputFile.mockResolvedValue(new TextEncoder().encode('a,b\n1,2'));
    });
    it.each(['csv', 'tsv', 'json', 'md', 'CSV'])(
        'reads supported %s files through opaque references',
        async (ext) => {
            expect(await readDataImportFile(file(`data.${ext}`), platform)).toBe('a,b\n1,2');
            expect(readInputFile).toHaveBeenCalledWith('opaque-reference');
        },
    );
    it('rejects oversized bytes before text decoding', async () => {
        readInputFile.mockResolvedValue(new Uint8Array(DATA_IMPORT_FILE_LIMIT + 1));
        await expect(readDataImportFile(file(), platform)).rejects.toMatchObject({
            code: 'tooLarge',
        });
    });
    it('accepts the exact byte limit', async () => {
        readInputFile.mockResolvedValue(new Uint8Array(DATA_IMPORT_FILE_LIMIT));
        expect((await readDataImportFile(file(), platform)).length).toBe(DATA_IMPORT_FILE_LIMIT);
    });
    it('rejects unsupported extensions before reading', async () => {
        await expect(readDataImportFile(file('data.exe'), platform)).rejects.toMatchObject({
            code: 'unsupported',
        });
        expect(readInputFile).not.toHaveBeenCalled();
    });
    it('propagates read errors', async () => {
        readInputFile.mockRejectedValue(new Error('Permission denied'));
        await expect(readDataImportFile(file(), platform)).rejects.toThrow('Permission denied');
    });
});
