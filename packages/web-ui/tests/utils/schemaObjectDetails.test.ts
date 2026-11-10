import {describe, expect, it, vi} from 'vitest';
import {getObjectDetailsDdl, orderedObjectRows} from '@/utils/schemaObjectDetails';
import type {SchemaObjectDetails} from '@/types/schemaObjectDetails';

const target = {
    connectionId: 'plugin-connection',
    tableName: 'orders',
    name: 'idx_orders',
    schema: 'sales',
    database: 'warehouse',
};
const index = (column_name: string, seq_in_index: number) => ({
    name: target.name,
    column_name,
    seq_in_index,
    is_unique: true,
    is_primary: false,
});
const foreignKey = {
    name: 'fk_order',
    column_name: 'customer_id',
    ref_table: 'customers',
    ref_column: 'id',
    on_delete: 'CASCADE',
    on_update: 'NO ACTION',
};
const makeClient = () => ({
    call: vi.fn().mockResolvedValue(['driver SQL']),
    callUnmigrated: vi.fn(),
});

describe('schemaObjectDetails', () => {
    it('orders index metadata and passes the complete target to the existing backend builder', async () => {
        const client = makeClient();
        const details: SchemaObjectDetails = {
            ...target,
            kind: 'index',
            rows: [index('second', 2), index('first', 1)],
        };
        expect(orderedObjectRows(details).map((row) => row.column_name)).toEqual([
            'first',
            'second',
        ]);
        expect(await getObjectDetailsDdl(client, details)).toEqual(['driver SQL']);
        expect(client.call).toHaveBeenCalledWith('get_create_index_sql', {
            connectionId: target.connectionId,
            table: target.tableName,
            schema: 'sales',
            database: 'warehouse',
            indexName: target.name,
            columns: ['first', 'second'],
            isUnique: true,
        });
        expect(details.rows[0].column_name).toBe('second');
    });

    it('preserves input order when positions are absent', () => {
        expect(
            orderedObjectRows({
                ...target,
                kind: 'foreign_key',
                rows: [foreignKey, {...foreignKey, column_name: 'other'}],
            }).map((row) => row.column_name),
        ).toEqual(['customer_id', 'other']);
    });

    it('forwards referential actions to the FK builder without frontend SQL', async () => {
        const client = makeClient();
        await getObjectDetailsDdl(client, {
            ...target,
            kind: 'foreign_key',
            name: foreignKey.name,
            rows: [foreignKey],
        });
        expect(client.call).toHaveBeenCalledWith('get_create_foreign_key_sql', {
            connectionId: target.connectionId,
            table: target.tableName,
            schema: 'sales',
            database: 'warehouse',
            fkName: foreignKey.name,
            column: 'customer_id',
            refTable: 'customers',
            refColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'NO ACTION',
        });
    });

    it.each([
        {kind: 'index' as const, rows: [{...index('id', 1), is_primary: true}]},
        {kind: 'index' as const, rows: [{...index('lower(name)', 1), is_expression: true}]},
        {kind: 'index' as const, rows: []},
        {
            kind: 'foreign_key' as const,
            rows: [foreignKey, {...foreignKey, column_name: 'tenant_id'}],
        },
    ])('does not generate a misleading partial definition for $kind', async (object) => {
        const client = makeClient();
        expect(await getObjectDetailsDdl(client, {...target, ...object})).toEqual([]);
        expect(client.call).not.toHaveBeenCalled();
    });

    it('preserves driver errors for the dialog to handle', async () => {
        const client = makeClient();
        client.call.mockRejectedValue(new Error('Unsupported'));
        await expect(
            getObjectDetailsDdl(client, {...target, kind: 'foreign_key', rows: [foreignKey]}),
        ).rejects.toThrow('Unsupported');
    });
});
