import {createInterface} from 'node:readline';
import './env.js';
import {database, type Params} from './database.js';
import {service} from './services.js';
import {extension} from './scope.js';

const databaseMethods = new Set([
    'test_connection',
    'get_databases',
    'get_schemas',
    'get_tables',
    'get_columns',
    'get_indexes',
    'get_foreign_keys',
    'execute_query',
    'explain_query',
    'insert_record',
    'update_record',
    'delete_record',
    'get_views',
    'get_view_definition',
    'get_view_columns',
    'get_routines',
    'get_routine_parameters',
    'get_routine_definition',
    'get_schema_snapshot',
    'get_all_columns_batch',
    'get_all_foreign_keys_batch',
]);
const serviceMethods = new Set([
    'neon_auth_session',
    'neon_auth_sign_up',
    'neon_auth_sign_in',
    'neon_auth_sign_out',
    'neon_function',
    'neon_ai_models',
    'neon_ai_complete',
    'neon_storage_list',
    'neon_storage_put',
    'neon_storage_get',
    'neon_storage_delete',
    'neon_realtime_snapshot',
]);

async function handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let id: unknown = null;
    let code = -32700;
    try {
        const request: unknown = JSON.parse(line);
        code = -32600;
        if (
            !request ||
            typeof request !== 'object' ||
            !('method' in request) ||
            !('jsonrpc' in request) ||
            request.jsonrpc !== '2.0' ||
            typeof request.method !== 'string'
        )
            throw new Error('Invalid JSON-RPC request');
        id = 'id' in request ? request.id : null;
        const args =
            'params' in request && request.params && typeof request.params === 'object'
                ? (request.params as Params)
                : {};
        const method = request.method;
        code = -32601;
        if (
            !databaseMethods.has(method) &&
            !serviceMethods.has(method) &&
            !['initialize', 'ping', 'extension'].includes(method)
        )
            throw new Error(`Method '${method}' is not implemented`);
        code = -32000;
        const result =
            method === 'extension'
                ? await extension(args)
                : databaseMethods.has(method)
                  ? await database(method, args)
                  : serviceMethods.has(method)
                    ? await service(method, args)
                    : null;
        process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id, result})}\n`);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Plugin request failed';
        // Avoid leaking a supplied password or URL in driver errors.
        process.stdout.write(
            `${JSON.stringify({jsonrpc: '2.0', id, error: {code, message: message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]')}})}\n`,
        );
    }
}

// Multiple connections share this process; a live query must not block the SQL that changes it.
const pending = new Set<Promise<void>>();
for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
    if (pending.size >= 32) await Promise.race(pending);
    const task = handleLine(line);
    pending.add(task);
    void task.finally(() => pending.delete(task));
}
await Promise.all(pending);
