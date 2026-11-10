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
        conn: {capabilities: {alter_column: true, alter_primary_key: true, column_comments: false}},
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
        databaseMock.connectionDataMap.conn.capabilities.column_comments = false;
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

    it('hides comments when the driver does not advertise support', () => {
        renderModal(column({comment: 'existing'}));
        expect(screen.queryByLabelText('modifyColumn.comment')).not.toBeInTheDocument();
    });

    it.each(["  Customer's email\n日本語  ", ''])(
        'previews and saves a comment-only edit (%s) through plugin capabilities',
        async (comment) => {
            databaseMock.connectionDataMap.conn.capabilities.column_comments = true;
            const onSuccess = vi.fn();
            const onClose = vi.fn();
            const sql = 'COMMENT ON COLUMN "sales"."orders"."status" IS NULL';
            clientMock.call.mockResolvedValue([sql]);
            render(
                <ModifyColumnModal
                    isOpen
                    onClose={onClose}
                    onSuccess={onSuccess}
                    connectionId="conn"
                    tableName="orders"
                    driver="custom-postgres-plugin"
                    schema="sales"
                    database="crm"
                    column={column({comment: 'original', default_sql: "'pending'"})}
                />,
            );
            const input = screen.getByLabelText('modifyColumn.comment');
            expect(input.tagName).toBe('TEXTAREA');
            expect(input).toHaveValue('original');
            fireEvent.change(input, {target: {value: comment}});
            await waitFor(() =>
                expect(lastAlterRequest().newColumn.comment).toBe(comment || undefined),
            );
            expect(screen.getByText(`${sql};`)).toBeInTheDocument();
            const previewRequest = lastAlterRequest();
            expect(previewRequest.newColumn).toEqual({
                ...previewRequest.oldColumn,
                comment: comment || undefined,
            });
            expect(clientMock.call).not.toHaveBeenCalledWith('execute_query', expect.anything());
            fireEvent.click(screen.getByRole('button', {name: 'modifyColumn.save'}));
            await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
            expect(lastAlterRequest()).toEqual(previewRequest);
            expect(clientMock.call).toHaveBeenCalledWith('execute_query', {
                connectionId: 'conn',
                query: sql,
                schema: 'sales',
                database: 'crm',
            });
            expect(onClose).toHaveBeenCalledOnce();
        },
    );

    it('includes a comment when adding a column', async () => {
        databaseMock.connectionDataMap.conn.capabilities.column_comments = true;
        render(
            <ModifyColumnModal
                isOpen
                onClose={vi.fn()}
                onSuccess={vi.fn()}
                connectionId="conn"
                tableName="orders"
                driver="custom-postgres-plugin"
            />,
        );
        fireEvent.change(screen.getByPlaceholderText('column_name'), {target: {value: 'email'}});
        fireEvent.change(screen.getByLabelText('modifyColumn.comment'), {
            target: {value: 'Contact'},
        });
        await waitFor(() =>
            expect(clientMock.call).toHaveBeenCalledWith(
                'get_add_column_sql',
                expect.objectContaining({
                    column: expect.objectContaining({name: 'email', comment: 'Contact'}),
                }),
            ),
        );
    });

    it('does not execute changes when the user cancels', () => {
        databaseMock.connectionDataMap.conn.capabilities.column_comments = true;
        renderModal(column({comment: 'original'}));
        fireEvent.change(screen.getByLabelText('modifyColumn.comment'), {
            target: {value: 'edited'},
        });
        fireEvent.click(screen.getByRole('button', {name: 'modifyColumn.cancel'}));
        expect(clientMock.call).not.toHaveBeenCalledWith('execute_query', expect.anything());
    });

    it('shows a database permission error without reporting success', async () => {
        databaseMock.connectionDataMap.conn.capabilities.column_comments = true;
        const onSuccess = vi.fn();
        const onClose = vi.fn();
        clientMock.call.mockImplementation(async (command: string) => {
            if (command === 'execute_query') throw new Error('permission denied');
            return ['COMMENT ON COLUMN "public"."orders"."status" IS NULL'];
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            render(
                <ModifyColumnModal
                    isOpen
                    onClose={onClose}
                    onSuccess={onSuccess}
                    connectionId="conn"
                    tableName="orders"
                    driver="postgres"
                    column={column({comment: 'original'})}
                />,
            );
            fireEvent.change(screen.getByLabelText('modifyColumn.comment'), {target: {value: ''}});
            fireEvent.click(screen.getByRole('button', {name: 'modifyColumn.save'}));
            expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
            expect(onSuccess).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
});
