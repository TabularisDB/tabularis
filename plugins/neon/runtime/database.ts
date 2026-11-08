import pg from 'pg';
import {parsePostgresJson} from '@tabularis/explain';
import {env} from './env.js';
import {buildMutation} from './mutations.js';

export type Params = Record<string, unknown>;
export function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${label} must be a non-empty string`);
    return value;
}
export function identifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
}

export async function database(method: string, args: Params): Promise<unknown> {
    const params = (args.params ?? {}) as Params;
    // A desktop connection must use its own credentials, never silently fall back to another database.
    const config: pg.ClientConfig = params.host
        ? {
              host: text(params.host, 'host'),
              port: Number(params.port ?? 5432),
              user: text(params.username, 'username'),
              password: text(params.password, 'password'),
              database: text(
                  Array.isArray(params.database) ? params.database[0] : params.database,
                  'database',
              ),
              ssl: {rejectUnauthorized: true},
          }
        : {connectionString: env('DATABASE_URL')};
    if (!params.host && params.connection_id)
        throw new Error('Saved Neon connection requires a host');
    const client = new pg.Client({
        ...config,
        connectionTimeoutMillis: 15000,
        statement_timeout: 30000,
    });
    await client.connect();
    try {
        const schema = typeof args.schema === 'string' ? args.schema : 'public';
        switch (method) {
            case 'explain_query': {
                const query = text(args.query, 'query');
                await client.query(`SET search_path TO ${identifier(schema)}`);
                const result = await client.query(
                    `EXPLAIN (FORMAT JSON, ANALYZE ${args.analyze === true ? 'TRUE' : 'FALSE'}) ${query}`,
                );
                const plan = parsePostgresJson(JSON.stringify(result.rows[0]['QUERY PLAN']));
                return {...plan, original_query: query};
            }
            case 'insert_record':
            case 'update_record':
            case 'delete_record':
                return (await client.query(buildMutation(method, args, schema))).rowCount ?? 0;
            case 'get_views':
                return (
                    await client.query(
                        'SELECT table_name AS name, view_definition AS definition FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name',
                        [schema],
                    )
                ).rows;
            case 'get_view_definition':
                return (
                    (
                        await client.query(
                            'SELECT view_definition FROM information_schema.views WHERE table_schema = $1 AND table_name = $2',
                            [schema, text(args.view_name, 'view_name')],
                        )
                    ).rows[0]?.view_definition ?? ''
                );
            case 'get_view_columns':
                return database('get_columns', {...args, table: args.view_name});
            case 'get_routines':
                return (
                    await client.query(
                        'SELECT routine_name AS name, routine_type, routine_definition AS definition FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name',
                        [schema],
                    )
                ).rows;
            case 'get_routine_parameters':
                return (
                    await client.query(
                        `SELECT coalesce(parameter_name, '$' || ordinal_position) AS name, data_type, parameter_mode AS mode, ordinal_position::int
        FROM information_schema.parameters WHERE specific_schema = $1 AND specific_name IN (SELECT specific_name FROM information_schema.routines WHERE routine_schema = $1 AND routine_name = $2) ORDER BY ordinal_position`,
                        [schema, text(args.routine_name, 'routine_name')],
                    )
                ).rows;
            case 'get_routine_definition': {
                const rows = (
                    await client.query(
                        `SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = $1 AND p.proname = $2 ORDER BY p.oid`,
                        [schema, text(args.routine_name, 'routine_name')],
                    )
                ).rows;
                if (rows.length !== 1)
                    throw new Error(
                        'Routine not found or overloaded; select an exact signature in the SQL editor',
                    );
                return rows[0].definition;
            }
            case 'get_schema_snapshot':
            case 'get_all_columns_batch':
            case 'get_all_foreign_keys_batch': {
                const tables = (
                    await client.query(
                        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
                        [schema],
                    )
                ).rows;
                const snapshots = [];
                for (const row of tables) {
                    const scope = {...args, table: row.table_name};
                    const columns =
                        method === 'get_all_foreign_keys_batch'
                            ? []
                            : await database('get_columns', scope);
                    const foreign_keys =
                        method === 'get_all_columns_batch'
                            ? []
                            : await database('get_foreign_keys', scope);
                    snapshots.push({name: row.table_name, columns, foreign_keys});
                }
                if (method === 'get_schema_snapshot') return snapshots;
                return Object.fromEntries(
                    snapshots.map((table) => [
                        table.name,
                        method === 'get_all_columns_batch' ? table.columns : table.foreign_keys,
                    ]),
                );
            }

            case 'test_connection':
                await client.query('SELECT 1');
                return {success: true};
            case 'get_databases':
                return (
                    await client.query(
                        'SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname',
                    )
                ).rows.map((row) => row.datname);
            case 'get_schemas':
                return (
                    await client.query(
                        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY schema_name",
                    )
                ).rows.map((row) => row.schema_name);
            case 'get_tables':
                return (
                    await client.query(
                        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
                        [schema],
                    )
                ).rows;
            case 'get_columns':
                return (
                    await client.query(
                        `SELECT c.column_name AS name, c.data_type, c.is_nullable = 'YES' AS is_nullable,
        c.is_identity = 'YES' OR coalesce(c.column_default LIKE 'nextval(%', false) AS is_auto_increment,
        c.column_default AS default_value, c.character_maximum_length,
        EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints t
        USING (constraint_catalog, constraint_schema, constraint_name) WHERE t.constraint_type = 'PRIMARY KEY'
        AND k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name) AS is_pk
        FROM information_schema.columns c WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
                        [schema, text(args.table, 'table')],
                    )
                ).rows;
            case 'get_indexes':
                return (
                    await client.query(
                        `SELECT idx.relname AS name,
        pg_get_indexdef(i.indexrelid, key.ordinality::int, true) AS column_name,
        i.indisunique AS is_unique, i.indisprimary AS is_primary,
        key.ordinality::int AS seq_in_index, key.attnum = 0 AS is_expression
        FROM pg_index i JOIN pg_class tbl ON tbl.oid = i.indrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace JOIN pg_class idx ON idx.oid = i.indexrelid
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        WHERE ns.nspname = $1 AND tbl.relname = $2 ORDER BY idx.relname, key.ordinality`,
                        [schema, text(args.table, 'table')],
                    )
                ).rows;
            case 'get_foreign_keys':
                return (
                    await client.query(
                        `SELECT con.conname AS name, col.attname AS column_name,
        ref.relname AS ref_table, refcol.attname AS ref_column,
        CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END AS on_delete,
        CASE con.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'd' THEN 'SET DEFAULT' ELSE 'NO ACTION' END AS on_update
        FROM pg_constraint con JOIN pg_class tbl ON tbl.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace JOIN pg_class ref ON ref.oid = con.confrelid
        CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS keys(local, remote)
        JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = keys.local
        JOIN pg_attribute refcol ON refcol.attrelid = ref.oid AND refcol.attnum = keys.remote
        WHERE con.contype = 'f' AND ns.nspname = $1 AND tbl.relname = $2`,
                        [schema, text(args.table, 'table')],
                    )
                ).rows;
            case 'execute_query': {
                await client.query(`SET search_path TO ${identifier(schema)}`);
                const result = await client.query({
                    text: text(args.query, 'query'),
                    rowMode: 'array',
                });
                const results = Array.isArray(result) ? result : [result];
                const limit =
                    typeof args.limit === 'number' &&
                    Number.isSafeInteger(args.limit) &&
                    args.limit > 0
                        ? args.limit
                        : null;
                const page =
                    typeof args.page === 'number' &&
                    Number.isSafeInteger(args.page) &&
                    args.page > 0
                        ? args.page
                        : 1;
                // shortcut: pagination materializes the result; switch to cursors for large exports.
                const format = (item: pg.QueryArrayResult) => ({
                    columns: item.fields.map((field) => field.name),
                    rows: limit ? item.rows.slice((page - 1) * limit, page * limit) : item.rows,
                    affected_rows: item.rowCount ?? 0,
                    truncated: false,
                    pagination: limit
                        ? {
                              page,
                              page_size: limit,
                              total_rows: item.rows.length,
                              has_more: page * limit < item.rows.length,
                          }
                        : null,
                });
                const first = format(results[0]);
                return {...first, additional_results: results.slice(1).map(format)};
            }
            default:
                throw new Error(`Unsupported database method: ${method}`);
        }
    } finally {
        await client.end();
    }
}
