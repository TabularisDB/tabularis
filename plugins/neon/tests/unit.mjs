import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identifier, text} from '../dist/database.js';
import {start} from './rpc.mjs';

test('SQL identifiers quote embedded quotes; invalid input is rejected', () => {
    assert.equal(identifier('a"b'), '"a""b"');
    assert.throws(() => text('', 'query'), /non-empty/);
    assert.throws(() => text(12, 'query'), /non-empty/);
});
test('stdio protocol responds and unsupported methods are explicit errors', async () => {
    const plugin = start();
    try {
        assert.equal(await plugin.call('initialize'), null);
        assert.equal(await plugin.call('ping'), null);
        await assert.rejects(plugin.call('unknown_method'), {code: -32601});
        await assert.rejects(plugin.call('get_create_table_sql'), {code: -32601});
    } finally {
        plugin.close();
    }
});

test('bound credentials never fall back to another connection or process environment', async () => {
    const {withCredentials, env} = await import('../dist/env.js');
    assert.throws(() => withCredentials({}, () => env('DATABASE_URL')), /Missing/);
    const results = await Promise.all(
        ['first', 'second'].map((value) =>
            withCredentials({TOKEN: value}, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return env('TOKEN');
            }),
        ),
    );
    assert.deepEqual(results, ['first', 'second']);
});

test('extension envelope rejects missing context and built-in methods', async () => {
    const plugin = start();
    try {
        await assert.rejects(
            plugin.call('extension', {method: 'neon_status', args: {}}),
            /context/,
        );
        await assert.rejects(
            plugin.call('extension', {
                method: 'execute_query',
                args: {},
                context: {plugin_id: 'neon', connection_id: 'x'},
            }),
            /Unsupported/,
        );
    } finally {
        plugin.close();
    }
});

test('row mutations quote identifiers, bind values, and reject missing primary keys', async () => {
    const {buildMutation} = await import('../dist/mutations.js');
    const insert = buildMutation(
        'insert_record',
        {table: 'odd"table', data: {'a"b': "O'Reilly"}},
        'public',
    );
    assert.equal(insert.text, 'INSERT INTO "public"."odd""table" ("a""b") VALUES ($1)');
    assert.deepEqual(insert.values, ["O'Reilly"]);
    assert.throws(
        () => buildMutation('delete_record', {table: 'notes', pk_map: {}}, 'public'),
        /primary key/,
    );
    const update = buildMutation(
        'update_record',
        {table: 'notes', pk_map: {id: 3}, col_name: 'body', new_val: null},
        'public',
    );
    assert.deepEqual(update.values, [null, 3]);
    assert.match(update.text, /"id" IS NOT DISTINCT FROM \$2/);
});

test('service metadata is available without connecting to Postgres', async () => {
    const {admin} = await import('../dist/admin.js');
    const {withCredentials} = await import('../dist/env.js');
    const result = await withCredentials(
        {DATABASE_URL: 'invalid-url', NEON_BRANCH: 'production', NEON_PROJECT_ID: 'project'},
        () => admin('neon_status', {metadataOnly: true}, {connection_id: 'offline'}),
    );
    assert.equal(result.database, null);
    assert.equal(result.services.length, 6);
    assert.equal(result.connectionId, 'offline');
});
