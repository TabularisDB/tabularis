import {describe, expect, it, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {SchemaObjectDetailsModal} from '@/components/modals/SchemaObjectDetailsModal';
import type {SchemaObjectDetails} from '@/types/schemaObjectDetails';

const {client, copyText} = vi.hoisted(() => ({client: {call: vi.fn()}, copyText: vi.fn()}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => client}));
vi.mock('@/utils/clipboard', () => ({copyTextToClipboard: copyText}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('lucide-react', async (importOriginal) => await importOriginal());
const details: SchemaObjectDetails = {
    connectionId: 'custom-plugin',
    tableName: 'orders',
    schema: 'sales',
    database: 'shop',
    name: 'orders_customer',
    kind: 'foreign_key',
    rows: [
        {
            name: 'orders_customer',
            column_name: 'customer_id',
            ref_table: 'customers',
            ref_column: 'id',
            on_delete: 'CASCADE',
            on_update: 'RESTRICT',
        },
    ],
};
const indexDetails: SchemaObjectDetails = {
    ...details,
    kind: 'index',
    rows: [{name: details.name, column_name: 'customer_id', is_unique: true, is_primary: false}],
};

describe('SchemaObjectDetailsModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        client.call.mockResolvedValue([
            'ALTER TABLE [sales].[orders] ADD CONSTRAINT [orders_customer] FOREIGN KEY ([customer_id]) REFERENCES [customers] ([id])',
        ]);
        copyText.mockResolvedValue(undefined);
    });

    it('shows FK metadata and copies the exact backend ALTER statement and complete metadata', async () => {
        render(<SchemaObjectDetailsModal isOpen onClose={vi.fn()} details={details} />);
        expect(screen.getByRole('dialog', {name: 'objectDetails.fkTitle'})).toBeInTheDocument();
        expect(screen.getByText('CASCADE')).toBeInTheDocument();
        expect(screen.getByText('RESTRICT')).toBeInTheDocument();
        expect(screen.getByText('1. customers.id')).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', {name: 'objectDetails.copyAlter'}));
        await waitFor(() =>
            expect(copyText).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE [sales]')),
        );
        fireEvent.click(screen.getByRole('button', {name: 'objectDetails.copyMetadata'}));
        await waitFor(() =>
            expect(copyText).toHaveBeenCalledWith(JSON.stringify(details, null, 2)),
        );
        expect(client.call.mock.calls.map(([command]) => command)).toEqual([
            'get_create_foreign_key_sql',
        ]);
    });

    it('shows and copies a CREATE index statement returned by a plugin', async () => {
        const sql = 'CREATE UNIQUE INDEX [orders_customer] ON [orders] ([customer_id])';
        client.call.mockResolvedValue([sql]);
        render(<SchemaObjectDetailsModal isOpen onClose={vi.fn()} details={indexDetails} />);
        fireEvent.click(await screen.findByRole('button', {name: 'objectDetails.copyCreate'}));
        await waitFor(() => expect(copyText).toHaveBeenCalledWith(sql));
        expect(
            screen.queryByRole('button', {name: 'objectDetails.copyAlter'}),
        ).not.toBeInTheDocument();
    });

    it.each(['reject', 'empty'])(
        'retains metadata and hides the DDL section when the backend returns %s',
        async (mode) => {
            if (mode === 'reject') client.call.mockRejectedValue(new Error('unsupported'));
            else client.call.mockResolvedValue([]);
            render(<SchemaObjectDetailsModal isOpen onClose={vi.fn()} details={details} />);
            await screen.findByText('objectDetails.ddlUnavailable');
            expect(screen.getByText('1. customer_id')).toBeInTheDocument();
            expect(
                screen.queryByRole('region', {name: 'objectDetails.ddl'}),
            ).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', {name: 'objectDetails.copyAlter'}),
            ).not.toBeInTheDocument();
        },
    );

    it('reports clipboard errors without closing the dialog', async () => {
        copyText.mockRejectedValue(new Error('denied'));
        render(<SchemaObjectDetailsModal isOpen onClose={vi.fn()} details={details} />);
        fireEvent.click(screen.getByRole('button', {name: 'objectDetails.copyMetadata'}));
        expect(await screen.findByText('objectDetails.copyFailed')).toBeInTheDocument();
    });

    it('keeps all composite FK columns ordered and avoids generating single-column DDL', async () => {
        const row = details.rows[0];
        const composite: SchemaObjectDetails = {
            ...details,
            kind: 'foreign_key',
            rows: [
                {...row, column_name: 'customer_id', ref_column: 'id', seq_in_fk: 2},
                {...row, column_name: 'tenant_id', ref_column: 'tenant_id', seq_in_fk: 1},
            ],
        };
        render(<SchemaObjectDetailsModal isOpen onClose={vi.fn()} details={composite} />);
        await screen.findByText('objectDetails.ddlUnavailable');
        expect(screen.getByText('1. tenant_id', {exact: false})).toHaveTextContent(
            '1. tenant_id 2. customer_id',
        );
        expect(screen.getByText('1. customers.tenant_id', {exact: false})).toHaveTextContent(
            '1. customers.tenant_id 2. customers.id',
        );
        expect(client.call).not.toHaveBeenCalled();
    });

    it('shows a loading state and supports focus, Escape, and backdrop dismissal', async () => {
        client.call.mockReturnValue(new Promise(() => undefined));
        const onClose = vi.fn();
        render(<SchemaObjectDetailsModal isOpen onClose={onClose} details={details} />);
        expect(screen.getByText('common.loading')).toBeInTheDocument();
        const buttons = screen.getAllByRole('button');
        expect(buttons[0]).toHaveFocus();
        fireEvent.keyDown(buttons[0], {key: 'Tab', shiftKey: true});
        expect(buttons.at(-1)).toHaveFocus();
        fireEvent.keyDown(buttons.at(-1)!, {key: 'Tab'});
        expect(buttons[0]).toHaveFocus();
        fireEvent.keyDown(window, {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.mouseDown(screen.getByRole('presentation'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
