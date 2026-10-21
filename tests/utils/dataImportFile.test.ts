import {beforeEach, describe, expect, it, vi} from 'vitest';
import {stat, readTextFile} from '@tauri-apps/plugin-fs';
import {DATA_IMPORT_FILE_LIMIT, readDataImportFile} from '@/utils/dataImportFile';
vi.mock('@tauri-apps/plugin-fs', () => ({stat: vi.fn(), readTextFile: vi.fn()}));
const info = (size: number, isFile = true) => ({size, isFile}) as Awaited<ReturnType<typeof stat>>;
describe('readDataImportFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(stat).mockResolvedValue(info(10));
        vi.mocked(readTextFile).mockResolvedValue('a,b\n1,2');
    });
    it.each(['csv', 'tsv', 'json', 'md', 'CSV'])('reads supported %s files', async (ext) => {
        expect(await readDataImportFile(`/tmp/data.${ext}`)).toBe('a,b\n1,2');
    });
    it('rejects oversized files before reading them', async () => {
        vi.mocked(stat).mockResolvedValue(info(DATA_IMPORT_FILE_LIMIT + 1));
        await expect(readDataImportFile('/tmp/data.csv')).rejects.toMatchObject({code: 'tooLarge'});
        expect(readTextFile).not.toHaveBeenCalled();
    });
    it('accepts the exact size boundary', async () => {
        vi.mocked(stat).mockResolvedValue(info(DATA_IMPORT_FILE_LIMIT));
        await expect(readDataImportFile('/tmp/data.csv')).resolves.toBe('a,b\n1,2');
    });
    it('rechecks UTF-8 bytes if the file grows during the read', async () => {
        vi.mocked(readTextFile).mockResolvedValue(
            '界'.repeat(Math.floor(DATA_IMPORT_FILE_LIMIT / 3) + 1),
        );
        await expect(readDataImportFile('/tmp/data.csv')).rejects.toMatchObject({code: 'tooLarge'});
    });
    it('rejects unsupported extensions without filesystem access', async () => {
        await expect(readDataImportFile('/tmp/data.exe')).rejects.toMatchObject({
            code: 'unsupported',
        });
        expect(stat).not.toHaveBeenCalled();
    });
    it('rejects directories', async () => {
        vi.mocked(stat).mockResolvedValue(info(1, false));
        await expect(readDataImportFile('/tmp/directory.csv')).rejects.toMatchObject({
            code: 'notFile',
        });
        expect(readTextFile).not.toHaveBeenCalled();
    });
    it.each(['stat', 'read'])('propagates %s errors', async (operation) => {
        vi.mocked(operation === 'stat' ? stat : readTextFile).mockRejectedValue(
            new Error('Permission denied'),
        );
        await expect(readDataImportFile('/tmp/data.csv')).rejects.toThrow('Permission denied');
    });
});
