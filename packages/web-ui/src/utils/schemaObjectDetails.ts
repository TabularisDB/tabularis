import type {TypedCommandCaller} from '@/api/contract';
import type {SchemaObjectDetails} from '@/types/schemaObjectDetails';

export function orderedObjectRows(details: SchemaObjectDetails) {
    return [...details.rows].sort((a, b) => {
        const position = (row: typeof a) =>
            ('seq_in_index' in row
                ? row.seq_in_index
                : 'seq_in_fk' in row
                  ? row.seq_in_fk
                  : undefined) ?? 0;
        return position(a) - position(b);
    });
}

/** Only request definitions that the existing generation contract can represent. */
export async function getObjectDetailsDdl(
    client: TypedCommandCaller,
    details: SchemaObjectDetails,
): Promise<string[]> {
    const {connectionId, tableName: table, schema, database, name} = details;
    const target = {connectionId, table, schema, database};
    if (details.rows.length === 0) return [];
    if (details.kind === 'index') {
        // The index builder quotes column names: it cannot reproduce expressions
        // or primary-key constraints (including SQLite's implicit autoindexes).
        if (details.rows.some((row) => row.is_primary || row.is_expression)) return [];
        return client.call('get_create_index_sql', {
            ...target,
            indexName: name,
            columns: orderedObjectRows(details).map((row) => row.column_name),
            isUnique: details.rows[0].is_unique,
        });
    }
    // The FK generation RPC accepts one column pair, not a composite constraint.
    if (details.rows.length !== 1) return [];
    const row = details.rows[0];
    return client.call('get_create_foreign_key_sql', {
        ...target,
        fkName: name,
        column: row.column_name,
        refTable: row.ref_table,
        refColumn: row.ref_column,
        onDelete: row.on_delete,
        onUpdate: row.on_update,
    });
}
