import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {GenerateSQLModal} from '@/components/modals/GenerateSQLModal';
import {SchemaModal} from '@/components/modals/SchemaModal';

const invokeMock = vi.mocked(invoke);
const showAlertMock = vi.fn();
const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: translateMock}),
}));

vi.mock('lucide-react', () => {
    const Icon = () => null;

    return {
        Check: Icon,
        Copy: Icon,
        FileCode: Icon,
        Key: Icon,
        List: Icon,
        Loader2: Icon,
        PenLine: Icon,
        Play: Icon,
        Table2: Icon,
        Trash2: Icon,
        X: Icon,
    };
});

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        connectionDataMap: {
            'connection-a': {
                capabilities: 'sqlite',
            },
            'connection-b': {
                capabilities: 'postgres',
            },
        },
    }),
}));

vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: showAlertMock}),
}));

vi.mock('@/components/ui/SqlPreview', () => ({
    SqlPreview: ({sql}: {sql: string}) => <pre>{sql}</pre>,
}));

const LocationState = () => {
    const location = useLocation();

    return <pre>{JSON.stringify(location.state)}</pre>;
};

describe('table target modals', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        showAlertMock.mockReset();
    });

    it('should inspect metadata through the target connection and schema', async () => {
        invokeMock
            .mockResolvedValueOnce([
                {
                    name: 'status',
                    data_type: 'text',
                    is_pk: false,
                    is_nullable: false,
                    is_auto_increment: false,
                    comment: 'Current order status',
                },
            ])
            .mockResolvedValueOnce([{name: 'orders', comment: 'Customer orders'}]);

        render(
            <SchemaModal
                isOpen
                target={{
                    connectionId: 'connection-b',
                    tableName: 'orders',
                    schema: 'sales',
                }}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith('get_columns', {
                connectionId: 'connection-b',
                tableName: 'orders',
                schema: 'sales',
            }),
        );
        await screen.findByRole('table');
        expect(screen.getByText('Customer orders')).toBeInTheDocument();
        expect(screen.getByText('Current order status')).toBeInTheDocument();
        expect(screen.getByText('schema.colDescription')).toBeInTheDocument();
    });

    it('should generate metadata and open a console in the target connection', async () => {
        invokeMock.mockResolvedValue([]);

        render(
            <MemoryRouter>
                <GenerateSQLModal
                    isOpen
                    target={{
                        connectionId: 'connection-b',
                        tableName: 'orders',
                        schema: 'sales',
                    }}
                    onClose={vi.fn()}
                />
                <LocationState />
            </MemoryRouter>,
        );

        await waitFor(() =>
            expect(invokeMock).toHaveBeenCalledWith('get_columns', {
                connectionId: 'connection-b',
                tableName: 'orders',
                schema: 'sales',
            }),
        );

        await waitFor(() =>
            expect(screen.queryByText('generateSQL.loading')).not.toBeInTheDocument(),
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'generateSQL.runInConsole',
            }),
        );

        expect(screen.getByText(/"targetConnectionId":"connection-b"/)).toBeInTheDocument();
        expect(screen.getByText(/"schema":"sales"/)).toBeInTheDocument();
    });

    it('should open the console through the scope runtime when one is given', async () => {
        invokeMock.mockResolvedValue([]);
        const openEditor = vi.fn();

        render(
            <MemoryRouter>
                <GenerateSQLModal
                    isOpen
                    target={{
                        connectionId: 'connection-b',
                        tableName: 'orders',
                        schema: 'sales',
                    }}
                    openEditor={openEditor}
                    onClose={vi.fn()}
                />
                <LocationState />
            </MemoryRouter>,
        );

        await waitFor(() =>
            expect(screen.queryByText('generateSQL.loading')).not.toBeInTheDocument(),
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'generateSQL.runInConsole',
            }),
        );

        expect(openEditor).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'console',
                preventAutoRun: true,
                schema: 'sales',
                targetConnectionId: 'connection-b',
            }),
        );
        // A split panel owns its editor, so the router must stay untouched.
        expect(screen.queryByText(/"targetConnectionId"/)).not.toBeInTheDocument();
    });

    it('should quote the schema-qualified table and columns in every generated tab', async () => {
        invokeMock.mockImplementation(async (command) =>
            command === 'get_columns'
                ? [
                      {
                          name: 'item-id',
                          data_type: 'INT',
                          is_pk: true,
                          is_nullable: false,
                          is_auto_increment: false,
                          default_value: null,
                      },
                  ]
                : [],
        );

        render(
            <MemoryRouter>
                <GenerateSQLModal
                    isOpen
                    target={{
                        connectionId: 'connection-b',
                        tableName: 'order-items',
                        schema: 'sales',
                    }}
                    onClose={vi.fn()}
                />
            </MemoryRouter>,
        );

        await waitFor(() =>
            expect(screen.getByText(/CREATE TABLE "order-items"/)).toBeInTheDocument(),
        );

        const expected: Record<string, string> = {
            'generateSQL.tabSelectAll': 'SELECT *\nFROM "sales"."order-items";',
            'generateSQL.tabSelectFields':
                'SELECT\n  "item-id"\nFROM "sales"."order-items"\nLIMIT 100;',
            'generateSQL.tabUpdate':
                'UPDATE "sales"."order-items"\nSET\n  "item-id" = :item_id\nWHERE 1 = 0;',
            'generateSQL.tabDelete': 'DELETE\nFROM "sales"."order-items"\nWHERE 1 = 0;',
        };
        for (const [tabLabel, sql] of Object.entries(expected)) {
            fireEvent.click(screen.getByRole('button', {name: tabLabel}));
            expect(
                screen.getByText(
                    (_, element) => element?.tagName === 'PRE' && element.textContent === sql,
                ),
            ).toBeInTheDocument();
        }
    });

    it('should show an inline error when the connection dialect is unknown', () => {
        render(
            <MemoryRouter>
                <GenerateSQLModal
                    isOpen
                    target={{
                        connectionId: 'connection-unknown',
                        tableName: 'orders',
                    }}
                    onClose={vi.fn()}
                />
            </MemoryRouter>,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('generateSQL.unknownDialect');
        expect(screen.queryByText('generateSQL.copy')).not.toBeInTheDocument();
        expect(invokeMock).not.toHaveBeenCalled();
        expect(showAlertMock).not.toHaveBeenCalled();
    });
});
