import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {start} from './rpc.mjs';
import pg from 'pg';
import '../dist/env.js';

const plugin = start();
const writer = plugin;
const suffix = randomUUID().replaceAll('-', '');
const table = `tabularis_e2e_${suffix}`;
const key = `tabularis-e2e/${suffix}.txt`;
const email = `tabularis-${suffix}@example.com`;
const password = randomUUID() + 'Aa1!';
let failed = false;
async function check(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        failed = true;
        console.error(`FAIL ${name}: ${error.message}`);
    }
}
const sql = (query) => writer.call('execute_query', {query});
const cookie = (cookies) => cookies.map((value) => value.split(';')[0]).join('; ');
try {
    await check('Postgres: plugin connection, SQL, schemas, tables, columns', async () => {
        assert.equal((await plugin.call('test_connection')).success, true);
        await sql(`CREATE TABLE public.${table} (id integer PRIMARY KEY, value text NOT NULL)`);
        await sql(`INSERT INTO public.${table} VALUES (1, 'before')`);
        assert((await plugin.call('get_schemas')).includes('public'));
        assert((await plugin.call('get_tables')).some((row) => row.name === table));
        assert(
            (await plugin.call('get_columns', {table})).some(
                (row) => row.name === 'id' && row.is_pk,
            ),
        );
        assert((await plugin.call('get_indexes', {table})).some((row) => row.is_primary));
        assert.deepEqual(await plugin.call('get_foreign_keys', {table}), []);
        const page = await plugin.call('execute_query', {
            query: 'SELECT generate_series(1, 5) AS n',
            limit: 2,
            page: 2,
        });
        assert.deepEqual(page.rows, [[3], [4]]);
        assert.equal(page.pagination.has_more, true);
        assert.deepEqual((await sql(`SELECT value FROM public.${table}`)).rows, [['before']]);
        assert.equal(
            await plugin.call('insert_record', {table, data: {id: 2, value: "O'Reilly"}}),
            1,
        );
        assert.equal(
            await plugin.call('update_record', {
                table,
                pk_map: {id: 2},
                col_name: 'value',
                new_val: 'edited',
            }),
            1,
        );
        assert.equal(await plugin.call('delete_record', {table, pk_map: {id: 2}}), 1);
        const plan = await plugin.call('explain_query', {
            query: `SELECT * FROM public.${table}`,
            analyze: false,
        });
        assert.equal(plan.driver, 'postgres');
        assert(plan.root);
    });
    await check('Functions: deployed hello called through plugin', async () => {
        const result = await plugin.call('neon_function');
        assert.equal(result.status, 200);
        assert.equal(result.body, 'Hello from Neon Functions');
    });
    await check('Object Storage: upload, list, download, delete through plugin', async () => {
        try {
            await plugin.call('neon_storage_put', {key, body: 'Tabularis Neon E2E'});
            assert(
                (await plugin.call('neon_storage_list', {prefix: key})).some(
                    (item) => item.Key === key,
                ),
            );
            assert.equal((await plugin.call('neon_storage_get', {key})).body, 'Tabularis Neon E2E');
        } finally {
            await plugin.call('neon_storage_delete', {key});
        }
        assert.equal((await plugin.call('neon_storage_list', {prefix: key})).length, 0);
    });
    await check('Auth: signed-out, signup, sign-in, session restoration, sign-out', async () => {
        assert.equal(await plugin.call('neon_auth_session'), null);
        await plugin.call('neon_auth_sign_up', {email, password});
        const login = await plugin.call('neon_auth_sign_in', {email, password});
        const sessionCookie = cookie(login.cookies);
        assert.equal(
            (await plugin.call('neon_auth_session', {cookie: sessionCookie})).user.email,
            email,
        );
        await plugin.call('neon_auth_sign_out', {cookie: sessionCookie});
        assert.equal(await plugin.call('neon_auth_session', {cookie: sessionCookie}), null);
    });
    await check('AI Gateway: model catalog and real completion through plugin', async () => {
        const catalog = await plugin.call('neon_ai_models');
        const enabled = catalog.data.filter((model) => model.enabled !== false);
        assert(enabled.length > 0, 'No enabled models');
        const model =
            enabled.find((model) => /gpt-4o-mini|llama.*(8b|small)|haiku/i.test(model.id)) ??
            enabled.find((model) => !/embed|codex|pro|image/i.test(model.id));
        assert(model, 'No enabled chat model');
        const response = await plugin.call('neon_ai_complete', {
            model: model.id,
            prompt: 'Reply with the word OK.',
        });
        assert(response.choices?.[0]?.message?.content, 'No completion content');
    });
    await check(
        'Realtime: initial rows and committed SQL update delivered through plugin',
        async () => {
            const query = `SELECT id, value FROM public.${table}`;
            const initial = await plugin.call('neon_realtime_snapshot', {query});
            assert.equal(initial[0].value, 'before');
            const changed = plugin.call('neon_realtime_snapshot', {
                query,
                column: 'value',
                from: 'before',
                until: 'after',
            });
            // Update through the same shared process while its live subscription is pending.
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await sql(`UPDATE public.${table} SET value = 'after' WHERE id = 1`);
            assert.equal((await changed)[0].value, 'after');
        },
    );
} finally {
    await check('Cleanup: remove only the E2E table and disposable auth user', async () => {
        await sql(`DROP TABLE IF EXISTS public.${table}`);
        const client = new pg.Client({connectionString: process.env.DATABASE_URL});
        await client.connect();
        try {
            await client.query('DELETE FROM neon_auth."user" WHERE email = $1', [email]);
        } finally {
            await client.end();
        }
    });
    plugin.close();
    writer.close();
}
process.exitCode = failed ? 1 : 0;
