import {StrictMode} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ExportTableModal} from '@/components/modals/ExportTableModal';
import {ImportTableModal} from '@/components/modals/ImportTableModal';
import type {TableImportPreview} from '@/api/contract';

const mocks = vi.hoisted(() => ({
    call: vi.fn(),
    uploadFile: vi.fn(),
    requestDownload: vi.fn(),
    subscribe: vi.fn().mockResolvedValue(() => {}),
    platform: {
        negotiation: {environment: 'tauri'},
        chooseSaveTarget: vi.fn(),
        readInputBlob: vi.fn().mockResolvedValue(new Blob(['-- Tabularis table export'])),
    },
}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => mocks}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => mocks.platform,
}));
const t = (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key;
vi.mock('react-i18next', () => ({useTranslation: () => ({t})}));

function preview(overrides: Partial<TableImportPreview> = {}): TableImportPreview {
    return {
        header: {
            formatVersion: 1,
            tabularisVersion: '0.30.0',
            driver: 'postgres',
            driverVersion: null,
            source: 'shop.public.orders',
            table: 'orders',
            content: 'structure_and_data',
            structureSource: 'driver',
            rows: 2,
            exported: '2026-10-30T10:00:00Z',
        },
        structure: 'CREATE TABLE "orders" ("id" integer);',
        structureTruncated: false,
        problem: null,
        ...overrides,
    };
}

beforeEach(() => {
    mocks.call.mockReset();
    mocks.uploadFile.mockReset();
    mocks.requestDownload.mockReset();
    mocks.subscribe.mockClear();
    mocks.platform.chooseSaveTarget.mockReset();
    mocks.platform.negotiation.environment = 'tauri';
});

describe('ExportTableModal', () => {
    const props = () => ({
        isOpen: true,
        onClose: vi.fn(),
        connectionId: 'connection-1',
        table: 'orders',
        schema: 'public',
        database: 'shop',
    });

    it('exports the chosen content to the picked file and shows the result', async () => {
        mocks.platform.chooseSaveTarget.mockResolvedValue({reference: '/tmp/orders.sql'});
        mocks.call.mockResolvedValue({
            rows: 1234,
            bytes: 2048,
            structureSource: 'driver',
            file: null,
        });
        render(<ExportTableModal {...props()} />);

        fireEvent.click(screen.getByLabelText('tableTransfer.structureOnly'));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });

        expect(mocks.platform.chooseSaveTarget).toHaveBeenCalledWith(
            expect.objectContaining({
                suggestedName: expect.stringMatching(/^orders_\d{8}-\d{6}\.sql$/),
            }),
        );
        expect(mocks.call).toHaveBeenCalledWith(
            'export_table_to_sql',
            {
                connectionId: 'connection-1',
                options: {
                    table: 'orders',
                    content: 'structure_only',
                    schema: 'public',
                    database: 'shop',
                },
                filePath: '/tmp/orders.sql',
            },
            expect.objectContaining({cancellationId: expect.any(String)}),
        );
        expect(await screen.findByText('/tmp/orders.sql')).toBeInTheDocument();
        expect(screen.getByText('1,234')).toBeInTheDocument();
        expect(screen.getByText('tableTransfer.fileSize {"size":"2.0 KB"}')).toBeInTheDocument();
    });

    it('does nothing when the save dialog is closed', async () => {
        mocks.platform.chooseSaveTarget.mockResolvedValue(null);
        render(<ExportTableModal {...props()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });
        expect(mocks.call).not.toHaveBeenCalled();
        expect(screen.getByRole('button', {name: 'tableTransfer.export'})).toBeInTheDocument();
    });

    it('warns when the structure was generated and downloads browser exports', async () => {
        mocks.platform.negotiation.environment = 'browser';
        mocks.call.mockResolvedValue({
            rows: 2,
            bytes: 100,
            structureSource: 'generated',
            file: {
                kind: 'download',
                fileName: 'orders.sql',
                mimeType: 'application/sql',
                token: 'download-token',
                size: 100,
            },
        });
        render(<ExportTableModal {...props()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });
        expect(mocks.call.mock.calls[0][1]).not.toHaveProperty('filePath');
        expect(mocks.requestDownload).toHaveBeenCalledWith('download-token');
        expect(
            await screen.findByText('tableTransfer.generatedStructureExported'),
        ).toBeInTheDocument();
    });

    it('cancels a running export through cancel_export', async () => {
        mocks.platform.chooseSaveTarget.mockResolvedValue({reference: '/tmp/orders.sql'});
        mocks.call.mockImplementation((command: string) =>
            command === 'export_table_to_sql' ? new Promise(() => {}) : Promise.resolve(undefined),
        );
        render(<ExportTableModal {...props()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));
        });
        expect(mocks.call).toHaveBeenCalledWith('cancel_export', {connectionId: 'connection-1'});
    });

    it('cancels instead of closing when Escape is pressed during an export', async () => {
        mocks.platform.chooseSaveTarget.mockResolvedValue({reference: '/tmp/orders.sql'});
        mocks.call.mockImplementation((command: string) =>
            command === 'export_table_to_sql' ? new Promise(() => {}) : Promise.resolve(undefined),
        );
        const callbacks = props();
        render(<ExportTableModal {...callbacks} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });
        await act(async () => {
            fireEvent.keyDown(window, {key: 'Escape'});
        });
        expect(mocks.call).toHaveBeenCalledWith('cancel_export', {connectionId: 'connection-1'});
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it('keeps one progress subscription while rows come in', async () => {
        mocks.platform.chooseSaveTarget.mockResolvedValue({reference: '/tmp/orders.sql'});
        mocks.call.mockImplementation((command: string) =>
            command === 'export_table_to_sql' ? new Promise(() => {}) : Promise.resolve(undefined),
        );
        render(<ExportTableModal {...props()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });
        const onProgress = mocks.subscribe.mock.calls[0][1];
        await act(async () => {
            onProgress({connection_id: 'connection-1', rows_processed: 500});
            onProgress({connection_id: 'connection-1', rows_processed: 1000});
        });
        expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    });

    it('shows an error when the save dialog fails', async () => {
        mocks.platform.chooseSaveTarget.mockRejectedValue(new Error('dialog unavailable'));
        render(<ExportTableModal {...props()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.export'}));
        });
        expect(await screen.findByText(/dialog unavailable/)).toBeInTheDocument();
        expect(mocks.call).not.toHaveBeenCalled();
    });
});

describe('ImportTableModal', () => {
    const props = () => ({
        isOpen: true,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
        connectionId: 'connection-1',
        connectionName: 'Staging',
        inputFile: {reference: '/tmp/orders.sql', name: 'orders.sql'},
        database: 'shop',
        schema: 'public',
        schemaEditable: true,
    });

    it('previews the file, then imports with the chosen mode and schema', async () => {
        mocks.call.mockImplementation((command: string) =>
            Promise.resolve(
                command === 'read_table_sql_header'
                    ? preview()
                    : {table: 'orders', statements: 2, rows: 2},
            ),
        );
        const callbacks = props();
        render(
            <StrictMode>
                <ImportTableModal {...callbacks} />
            </StrictMode>,
        );

        expect(
            await screen.findByText('CREATE TABLE "orders" ("id" integer);'),
        ).toBeInTheDocument();
        expect(mocks.call).toHaveBeenCalledExactlyOnceWith('read_table_sql_header', {
            connectionId: 'connection-1',
            filePath: '/tmp/orders.sql',
        });
        expect(screen.getByText('Staging')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('tableTransfer.schema'), {
            target: {value: 'staging'},
        });
        fireEvent.change(screen.getByLabelText('tableTransfer.ifExists'), {
            target: {value: 'append'},
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.import'}));
        });

        expect(mocks.call).toHaveBeenLastCalledWith(
            'import_table_from_sql',
            {
                connectionId: 'connection-1',
                filePath: '/tmp/orders.sql',
                options: {ifExists: 'append', schema: 'staging', database: 'shop'},
            },
            expect.objectContaining({cancellationId: expect.any(String)}),
        );
        expect(callbacks.onSuccess).toHaveBeenCalledWith(
            {table: 'orders', statements: 2, rows: 2},
            'staging',
            'shop',
        );
    });

    it('uploads a browser file once and reuses its token for the import', async () => {
        mocks.platform.negotiation.environment = 'browser';
        mocks.uploadFile.mockResolvedValue({token: 'upload-token'});
        mocks.call.mockImplementation((command: string) =>
            Promise.resolve(
                command === 'read_table_sql_header'
                    ? preview()
                    : {table: 'orders', statements: 2, rows: 2},
            ),
        );
        render(
            <StrictMode>
                <ImportTableModal {...props()} />
            </StrictMode>,
        );
        await screen.findByText('CREATE TABLE "orders" ("id" integer);');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.import'}));
        });
        expect(mocks.uploadFile).toHaveBeenCalledOnce();
        expect(mocks.call).toHaveBeenLastCalledWith(
            'import_table_from_sql',
            expect.objectContaining({uploadToken: 'upload-token'}),
            expect.any(Object),
        );
    });

    it('shows why a file cannot be imported and keeps Import disabled', async () => {
        mocks.call.mockResolvedValue(
            preview({problem: 'This file was exported from a "mysql" connection.'}),
        );
        render(<ImportTableModal {...props()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('"mysql"');
        expect(screen.getByRole('button', {name: 'tableTransfer.import'})).toBeDisabled();
    });

    it('warns about generated structures and hides Append for structure-only files', async () => {
        const structureOnly = preview();
        structureOnly.header = {
            ...structureOnly.header,
            content: 'structure_only',
            structureSource: 'generated',
            rows: 0,
        };
        mocks.call.mockResolvedValue(structureOnly);
        render(<ImportTableModal {...props()} />);
        expect(
            await screen.findByText('tableTransfer.generatedStructureWarning'),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('option', {name: 'tableTransfer.ifExistsAppend'}),
        ).not.toBeInTheDocument();
    });

    it('shows the real error when a failure mentions "cancelled" but nobody cancelled', async () => {
        mocks.call.mockImplementation((command: string) =>
            command === 'read_table_sql_header'
                ? Promise.resolve(preview())
                : Promise.reject('Import failed in data: table "cancelled_orders" is locked'),
        );
        render(<ImportTableModal {...props()} />);
        await screen.findByText('CREATE TABLE "orders" ("id" integer);');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.import'}));
        });
        expect(screen.getByText('tableTransfer.importFailed')).toBeInTheDocument();
        expect(screen.queryByText('tableTransfer.importCancelled')).not.toBeInTheDocument();
        expect(
            screen.getByText('Import failed in data: table "cancelled_orders" is locked'),
        ).toBeInTheDocument();
    });

    it('says the import was cancelled after Cancel', async () => {
        let reject: (reason: string) => void = () => {};
        mocks.call.mockImplementation((command: string) => {
            if (command === 'read_table_sql_header') return Promise.resolve(preview());
            if (command === 'import_table_from_sql')
                return new Promise((_, fail) => {
                    reject = fail;
                });
            return Promise.resolve(undefined);
        });
        render(<ImportTableModal {...props()} />);
        await screen.findByText('CREATE TABLE "orders" ("id" integer);');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'tableTransfer.import'}));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));
        });
        await act(async () => {
            reject('Import was stopped');
        });
        expect(mocks.call).toHaveBeenCalledWith('cancel_table_import', {
            connectionId: 'connection-1',
        });
        expect(screen.getByText('tableTransfer.importCancelled')).toBeInTheDocument();
    });

    it('shows a refused plain script', async () => {
        mocks.call.mockRejectedValue('This file is not a Tabularis table export.');
        render(<ImportTableModal {...props()} />);
        expect(await screen.findByText('tableTransfer.importFailed')).toBeInTheDocument();
        expect(screen.getByText('This file is not a Tabularis table export.')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', {name: 'tableTransfer.import'}),
        ).not.toBeInTheDocument();
    });
});
