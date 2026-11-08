import {identifier, text, type Params} from './database.js';

function entries(value: unknown, label: string): [string, unknown][] {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    const result = Object.entries(value);
    if (!result.length) throw new Error(`A non-empty ${label} is required`);
    return result;
}

export function buildMutation(
    method: string,
    args: Params,
    schema: string,
): {text: string; values: unknown[]} {
    const table = `${identifier(schema)}.${identifier(text(args.table, 'table'))}`;
    if (method === 'insert_record') {
        const data = entries(args.data, 'record');
        return {
            text: `INSERT INTO ${table} (${data.map(([key]) => identifier(key)).join(', ')}) VALUES (${data.map((_, index) => `$${index + 1}`).join(', ')})`,
            values: data.map(([, value]) => value),
        };
    }
    const pk = entries(args.pk_map, 'primary key');
    const values: unknown[] = method === 'update_record' ? [args.new_val ?? null] : [];
    const where = pk
        .map(([key, value]) => {
            values.push(value);
            return `${identifier(key)} IS NOT DISTINCT FROM $${values.length}`;
        })
        .join(' AND ');
    if (method === 'delete_record') return {text: `DELETE FROM ${table} WHERE ${where}`, values};
    if (method === 'update_record')
        return {
            text: `UPDATE ${table} SET ${identifier(text(args.col_name, 'col_name'))} = $1 WHERE ${where}`,
            values,
        };
    throw new Error('Unsupported row mutation');
}
