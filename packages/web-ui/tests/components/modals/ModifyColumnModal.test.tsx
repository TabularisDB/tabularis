import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {ModifyColumnModal} from '@/components/modals/ModifyColumnModal';
import type {ExistingColumn} from '@/utils/columnTypes';

const clientMock = vi.hoisted(() => ({call: vi.fn()}));
// A stable value, like the real hook's state: a new object on every render
// would reset the form in a loop.
const dataTypesMock = vi.hoisted(() => ({
    dataTypes: {
        types: [
            {
                name: 'VARCHAR',
                category: 'string',
                requires_length: true,
                requires_precision: false,
                default_length: '255',
                supports_auto_increment: false,
            },
            {
                name: 'TIMESTAMP',
                category: 'date',
                requires_length: false,
                requires_precision: false,
                supports_auto_increment: false,
            },
            {
                name: 'INT',
                category: 'numeric',
                requires_length: false,
                requires_precision: false,
                supports_auto_increment: true,
            },
        ],
    },
}));

const driversMock = vi.hoisted(() => ({allDrivers: []}));
const databaseMock = vi.hoisted(() => ({
    activeSchema: null,
    connectionDataMap: {
        conn: {capabilities: {alter_column: true, alter_primary_key: true}},
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: (key: string) => key}),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => databaseMock,
}));

vi.mock('@/hooks/useDataTypes', () => ({
    useDataTypes: () => dataTypesMock,
}));

vi.mock('@/hooks/useDrivers', () => ({
    useDrivers: () => driversMock,
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => clientMock,
}));

vi.mock('@/components/ui/SqlPreview', () => ({
    SqlPreview: ({sql}: {sql: string}) => <pre>{sql}</pre>,
}));

const column = (overrides: Partial<ExistingColumn>): ExistingColumn => ({
    name: 'status',
    data_type: 'varchar',
    full_type: 'varchar(20)',
    is_nullable: false,
    is_pk: false,
    is_auto_increment: false,
    ...overrides,
});

const renderModal = (existing: ExistingColumn) =>
    render(
        <ModifyColumnModal
            isOpen
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            connectionId="conn"
            tableName="orders"
            driver="mysql"
            column={existing}
        />,
    );

type AlterRequest = {
    oldColumn: Record<string, unknown>;
    newColumn: Record<string, unknown>;
};

const lastAlterRequest = (): AlterRequest => {
    const calls = clientMock.call.mock.calls.filter(
        ([command]) => command === 'get_alter_column_sql',
    );
    return calls[calls.length - 1][1] as AlterRequest;
};

const rename = (to: string) =>
    fireEvent.change(screen.getByPlaceholderText('column_name'), {target: {value: to}});

describe('ModifyColumnModal', () => {
    beforeEach(() => {
        clientMock.call.mockReset();
        clientMock.call.mockResolvedValue(['ALTER TABLE ...']);
    });

    it('keeps the length and the default when renaming (#271)', async () => {
        renderModal(column({default_value: 'new', default_sql: "'new'"}));

        expect(screen.getByDisplayValue("'new'")).toBeInTheDocument();
        rename('state');

        await waitFor(() => expect(lastAlterRequest().newColumn.name).toBe('state'));
        const {oldColumn, newColumn} = lastAlterRequest();
        expect(newColumn).toMatchObject({
            data_type: 'VARCHAR(20)',
            is_nullable: false,
            default_value: "'new'",
        });
        expect(oldColumn).toMatchObject({
            name: 'status',
            data_type: 'VARCHAR(20)',
            default_value: "'new'",
        });
    });

    it('keeps ON UPDATE when renaming a timestamp column', async () => {
        renderModal(
            column({
                name: 'updated',
                data_type: 'timestamp',
                full_type: undefined,
                default_sql: 'CURRENT_TIMESTAMP',
                on_update: 'CURRENT_TIMESTAMP',
            }),
        );

        rename('modified_at');

        await waitFor(() => expect(lastAlterRequest().newColumn.name).toBe('modified_at'));
        const {oldColumn, newColumn} = lastAlterRequest();
        expect(newColumn).toMatchObject({
            data_type: 'TIMESTAMP',
            default_value: 'CURRENT_TIMESTAMP',
            on_update: 'CURRENT_TIMESTAMP',
        });
        expect(oldColumn.on_update).toBe('CURRENT_TIMESTAMP');
    });

    it('sends the same default in both columns when it is left alone', async () => {
        renderModal(
            column({
                data_type: 'character varying',
                full_type: 'character varying(255)',
                default_sql: "'pending'::character varying",
            }),
        );

        await waitFor(() =>
            expect(clientMock.call).toHaveBeenCalledWith('get_alter_column_sql', expect.anything()),
        );
        const {oldColumn, newColumn} = lastAlterRequest();
        expect(newColumn).toEqual(oldColumn);
        expect(newColumn.default_value).toBe("'pending'::character varying");
    });

    it('starts with an empty default when the driver sends no default_sql', async () => {
        renderModal(column({default_value: 'new'}));

        rename('state');

        await waitFor(() => expect(lastAlterRequest().newColumn.name).toBe('state'));
        expect(lastAlterRequest().newColumn.default_value).toBeNull();
        expect(lastAlterRequest().oldColumn.default_value).toBeNull();
    });
});
