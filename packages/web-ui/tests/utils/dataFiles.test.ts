import {describe, expect, it, vi} from 'vitest';

import type {TabularisClient} from '@/api/client';
import type {PlatformCapabilities} from '@/platform/capabilities';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {
    classifyDataFiles,
    dataFileDialogExtensions,
    dataFileFormat,
    isFileDrag,
    OPEN_DATA_FILE_EVENT,
    prepareDataFileSource,
    requestOpenDataFiles,
    supportedDataFileFormats,
} from '@/utils/dataFiles';

function driver(id: string, capabilities: Partial<DriverCapabilities>): PluginManifest {
    return {
        id,
        name: id,
        capabilities: {file_based: true, ...capabilities},
    } as PluginManifest;
}

const columnar = driver('columnar', {data_files: ['csv', 'parquet']});
const lines = driver('lines', {data_files: ['ndjson', 'csv']});
const sqlite = driver('sqlite', {});

describe('dataFiles', () => {
    describe('dataFileFormat', () => {
        it('reads the format from the extension, whatever its case', () => {
            expect(dataFileFormat('orders.csv')).toBe('csv');
            expect(dataFileFormat('ORDERS.CSV')).toBe('csv');
            expect(dataFileFormat('cities.tsv')).toBe('tsv');
            expect(dataFileFormat('cities.tab')).toBe('tsv');
            expect(dataFileFormat('items.json')).toBe('json');
            expect(dataFileFormat('events.ndjson')).toBe('ndjson');
            expect(dataFileFormat('events.jsonl')).toBe('ndjson');
            expect(dataFileFormat('metrics.parquet')).toBe('parquet');
            expect(dataFileFormat('metrics.pq')).toBe('parquet');
            expect(dataFileFormat('report.xlsx')).toBe('xlsx');
            expect(dataFileFormat('archive.2024.csv')).toBe('csv');
        });

        it('rejects names that are not data files', () => {
            for (const name of ['notes.txt', 'dump.sql', 'csv', '.csv', 'trailing.', '']) {
                expect(dataFileFormat(name), name).toBeNull();
            }
        });
    });

    describe('supportedDataFileFormats', () => {
        it('collects what file-based drivers declare, once each', () => {
            expect(supportedDataFileFormats([sqlite, columnar, lines])).toEqual([
                'csv',
                'parquet',
                'ndjson',
            ]);
        });

        it('ignores a declaration on a driver that is not file-based', () => {
            const remote = driver('remote', {file_based: false, data_files: ['csv']});

            expect(supportedDataFileFormats([remote, sqlite])).toEqual([]);
        });
    });

    describe('dataFileDialogExtensions', () => {
        it('offers the extensions of the formats drivers can open', () => {
            expect(dataFileDialogExtensions([columnar])).toEqual(['csv', 'parquet', 'pq']);
        });

        it('offers what the suggested plugin opens before any driver is installed', () => {
            expect(dataFileDialogExtensions([sqlite])).toEqual([
                'csv',
                'tsv',
                'tab',
                'json',
                'ndjson',
                'jsonl',
                'parquet',
                'pq',
            ]);
        });

        it('skips a declared format the app has no extension for', () => {
            expect(
                dataFileDialogExtensions([driver('custom', {data_files: ['avro', 'csv']})]),
            ).toEqual(['csv']);
        });
    });

    describe('classifyDataFiles', () => {
        const files = [
            {name: 'orders.csv'},
            {name: 'events.ndjson'},
            {name: 'report.xlsx'},
            {name: 'notes.txt'},
        ];

        it('separates files a driver opens, files needing one and other files', () => {
            expect(classifyDataFiles(files, [sqlite, columnar])).toEqual({
                ready: [{name: 'orders.csv'}],
                needsDriver: [{name: 'events.ndjson'}, {name: 'report.xlsx'}],
                unknown: [{name: 'notes.txt'}],
            });
        });

        it('needs a driver for every data file when none is registered', () => {
            const support = classifyDataFiles(files, [sqlite]);

            expect(support.ready).toEqual([]);
            expect(support.needsDriver.map((file) => file.name)).toEqual([
                'orders.csv',
                'events.ndjson',
                'report.xlsx',
            ]);
        });
    });

    describe('prepareDataFileSource', () => {
        const uploadFile = vi.fn().mockResolvedValue({token: 'upload-1'});
        const readInputBlob = vi.fn();
        const client = {uploadFile} as unknown as TabularisClient;
        const platform = (environment: 'tauri' | 'browser') =>
            ({negotiation: {environment}, readInputBlob}) as unknown as PlatformCapabilities;

        it('passes a host path straight through on desktop', async () => {
            uploadFile.mockClear();

            await expect(
                prepareDataFileSource(client, platform('tauri'), {
                    name: 'orders.csv',
                    reference: '/data/orders.csv',
                }),
            ).resolves.toEqual({filePath: '/data/orders.csv'});
            expect(uploadFile).not.toHaveBeenCalled();
        });

        it('uploads a file picked in the browser', async () => {
            uploadFile.mockClear();
            const blob = new Blob(['id\n1\n']);
            readInputBlob.mockResolvedValueOnce(blob);

            await expect(
                prepareDataFileSource(client, platform('browser'), {
                    name: 'orders.csv',
                    reference: 'browser-file:1',
                }),
            ).resolves.toEqual({uploadToken: 'upload-1'});
            expect(readInputBlob).toHaveBeenCalledWith('browser-file:1');
            expect(uploadFile).toHaveBeenCalledWith({
                contents: blob,
                fileName: 'orders.csv',
                purpose: 'data-file',
            });
        });

        it('uploads a dropped file without going through the picker', async () => {
            uploadFile.mockClear();
            readInputBlob.mockClear();
            const blob = new Blob(['{}\n']);

            await expect(
                prepareDataFileSource(client, platform('browser'), {name: 'events.ndjson', blob}),
            ).resolves.toEqual({uploadToken: 'upload-1'});
            expect(readInputBlob).not.toHaveBeenCalled();
            expect(uploadFile).toHaveBeenCalledWith({
                contents: blob,
                fileName: 'events.ndjson',
                purpose: 'data-file',
            });
        });
    });

    describe('isFileDrag', () => {
        it('accepts drags that carry files and nothing else', () => {
            expect(isFileDrag(['Files'])).toBe(true);
            expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
            expect(isFileDrag(['text/plain'])).toBe(false);
            expect(isFileDrag([])).toBe(false);
            expect(isFileDrag(undefined)).toBe(false);
        });
    });

    describe('requestOpenDataFiles', () => {
        it('dispatches the files to open, or none to let the user pick', () => {
            const received: unknown[] = [];
            const listener = (event: Event) => received.push((event as CustomEvent).detail);
            window.addEventListener(OPEN_DATA_FILE_EVENT, listener);
            const files = [{name: 'orders.csv', reference: '/data/orders.csv'}];

            requestOpenDataFiles();
            requestOpenDataFiles(files);
            window.removeEventListener(OPEN_DATA_FILE_EVENT, listener);

            // jsdom normalises an absent detail to null.
            expect(received).toEqual([null, files]);
        });
    });
});
