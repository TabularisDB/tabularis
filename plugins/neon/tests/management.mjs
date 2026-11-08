import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync, strFromU8} from 'fflate';
import {account} from '../dist/account.js';
import {extension} from '../dist/scope.js';
import {authDirectory} from '../dist/authDirectory.js';

const scope = {projectId: 'project-test123', branchId: 'br-test123'};

test('concurrent create-only requests cannot overwrite each other within the plugin process', async () => {
    let exists = false;
    let deployments = 0;
    const fetcher = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method === 'GET') {
            const observed = exists;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return observed
                ? Response.json({function: current})
                : Response.json({message: 'not found'}, {status: 404});
        }
        deployments += 1;
        exists = true;
        return Response.json({
            deployment: {...current.current_deployment, id: 6, status: 'pending'},
        });
    };
    const args = {
        ...scope,
        slug: 'demo',
        source: 'export default {fetch(){return new Response("ok")}}',
        createOnly: true,
    };
    const results = await Promise.allSettled([
        account('account_function_deploy', args, credentials, fetcher),
        account('account_function_deploy', args, credentials, fetcher),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(deployments, 1);
});
const credentials = {NEON_API_KEY: 'management-key-never-return'};
const branch = `/api/v2/projects/${scope.projectId}/branches/${scope.branchId}`;
const endpoint = `https://${scope.branchId}-demo.compute.cell.eu-central-1.aws.neon.tech/`;
const current = {
    id: 'fn-stable',
    slug: 'demo',
    name: 'Demo',
    invocation_url: endpoint,
    created_at: '2026-10-31T00:00:00Z',
    current_deployment: {
        id: 5,
        status: 'completed',
        runtime: 'nodejs24',
        environment: ['OLD_SECRET'],
        created_at: '2026-10-31T01:00:00Z',
    },
    private_value: 'must-not-return',
};

function mockApi(overrides = {}) {
    const calls = [];
    const fetcher = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        const call = {
            url: request.url,
            method: request.method,
            headers: request.headers,
            body: undefined,
        };
        calls.push(call);
        if (url.origin !== 'https://console.neon.tech') {
            assert.equal(request.headers.has('authorization'), false);
            assert.equal(request.redirect, 'manual');
            return new Response('Function response');
        }
        assert.equal(request.headers.get('authorization'), `Bearer ${credentials.NEON_API_KEY}`);
        if (request.headers.get('content-type')?.startsWith('multipart/'))
            call.body = await request.formData();
        else if (request.method !== 'GET' && request.method !== 'DELETE')
            call.body = await request.json();
        const route = `${request.method} ${url.pathname}`;
        if (Object.hasOwn(overrides, route)) return overrides[route].clone();
        if (route === `GET ${branch}/functions`) return Response.json({functions: [current]});
        if (route === `GET ${branch}/functions/demo`) return Response.json({function: current});
        if (route === `POST ${branch}/functions/demo/deployments`)
            return Response.json({
                deployment: {...current.current_deployment, id: 6, status: 'pending'},
            });
        if (route === `PATCH ${branch}/functions/demo`)
            return Response.json({function: {...current, name: call.body.name}});
        if (
            route === `DELETE ${branch}/functions/demo` ||
            route === `DELETE ${branch}/auth/users/user-id`
        )
            return new Response(null, {status: 204});
        if (route === `POST ${branch}/auth/users`) return Response.json({id: 'user-id'});
        if (route === `PUT ${branch}/auth/users/user-id/role`)
            return Response.json({id: 'user-id'});
        if (route === `POST ${branch}/logs/query`)
            return Response.json({
                logs: [
                    {
                        entity_id: 'fn-stable',
                        timestamp: '2026-10-31T01:00:00Z',
                        severity_text: 'INFO',
                        message: 'selected function',
                        attributes: {hidden: 'raw metadata'},
                    },
                    {
                        entity_id: 'other-function',
                        timestamp: 'now',
                        message: 'other function',
                        attributes: {},
                    },
                ],
            });
        throw new Error(`Unexpected mock route: ${route}`);
    };
    return {calls, fetcher};
}

test('function metadata excludes raw API fields and environment secret values', async () => {
    const mock = mockApi();
    const list = await account('account_functions_list', scope, credentials, mock.fetcher);
    assert.deepEqual(list.functions[0], {
        slug: 'demo',
        name: 'Demo',
        url: endpoint,
        status: 'completed',
        deploymentId: '5',
        updatedAt: '2026-10-31T01:00:00Z',
    });
    const details = await account(
        'account_function_get',
        {...scope, slug: 'demo'},
        credentials,
        mock.fetcher,
    );
    assert.equal(details.source, null);
    assert.deepEqual(details.environmentKeys, ['OLD_SECRET']);
    assert(!JSON.stringify(details).includes('must-not-return'));
    assert(!JSON.stringify(details).includes(credentials.NEON_API_KEY));
});

test('code deployment parses without executing source and uploads only index.mjs', async () => {
    const mock = mockApi();
    const source =
        'globalThis.MANAGEMENT_SOURCE_EXECUTED = true; export default () => new Response("ok");';
    const deployed = await account(
        'account_function_deploy',
        {...scope, slug: 'demo', source},
        credentials,
        mock.fetcher,
    );
    assert.deepEqual(deployed, {id: '6', status: 'pending'});
    assert.equal(globalThis.MANAGEMENT_SOURCE_EXECUTED, undefined);
    const upload = mock.calls[0].body;
    const archive = unzipSync(new Uint8Array(await upload.get('zip').arrayBuffer()));
    assert.deepEqual(Object.keys(archive), ['index.mjs']);
    assert.match(strFromU8(archive['index.mjs']), /export/);
    assert.equal(upload.has('environment'), false);
    assert.equal(upload.get('runtime'), 'nodejs24');
});

test('environment-only deployment sends changes only, preserving existing keys by Neon patch semantics', async () => {
    const mock = mockApi();
    await account(
        'account_function_deploy',
        {...scope, slug: 'demo', envChanges: {NEW_SECRET: 'write-only', REMOVE_ME: null}},
        credentials,
        mock.fetcher,
    );
    const body = mock.calls.find((call) => call.method === 'POST').body;
    assert.equal(body.has('zip'), false);
    assert.deepEqual(JSON.parse(body.get('environment')), {
        NEW_SECRET: 'write-only',
        REMOVE_ME: '',
    });
    assert(!JSON.parse(body.get('environment')).OLD_SECRET);
});

test('function mutation and source validation fail before sending requests', async () => {
    const mock = mockApi();
    for (const args of [
        {slug: '../other', source: 'export default ()=>{}'},
        {slug: 'has-hyphen', source: 'x'},
        {slug: 'demo', source: ''},
        {slug: 'demo', source: 'export default = {'},
        {slug: 'demo', envChanges: {'INVALID KEY': 'x'}},
        {slug: 'demo', envChanges: {EMPTY: ''}},
        {slug: 'demo'},
    ]) {
        await assert.rejects(
            account('account_function_deploy', {...scope, ...args}, credentials, mock.fetcher),
        );
    }
    assert.equal(mock.calls.length, 0);
    await account(
        'account_function_rename',
        {...scope, slug: 'demo', name: 'Renamed'},
        credentials,
        mock.fetcher,
    );
    assert.deepEqual(mock.calls.at(-1).body, {name: 'Renamed'});
    await account('account_function_delete', {...scope, slug: 'demo'}, credentials, mock.fetcher);
    assert.equal(mock.calls.at(-1).method, 'DELETE');
    const existing = mockApi();
    await assert.rejects(
        account(
            'account_function_deploy',
            {...scope, slug: 'demo', source: 'export default ()=>{}', createOnly: true},
            credentials,
            existing.fetcher,
        ),
        /already exists/,
    );
    assert(existing.calls.every((call) => call.method === 'GET'));
});

test('invocation resolves trusted metadata, strips account authorization and refuses redirects/private hosts', async () => {
    const mock = mockApi();
    assert.deepEqual(
        await account(
            'account_function_invoke',
            {...scope, slug: 'demo', method: 'GET'},
            credentials,
            mock.fetcher,
        ),
        {status: 200, body: 'Function response'},
    );
    assert.equal(mock.calls.length, 2);
    const hostile = mockApi({
        [`GET ${branch}/functions/demo`]: Response.json({
            function: {...current, invocation_url: 'https://127.0.0.1/admin'},
        }),
    });
    await assert.rejects(
        account(
            'account_function_invoke',
            {...scope, slug: 'demo', method: 'GET', url: endpoint},
            credentials,
            hostile.fetcher,
        ),
        /trusted Neon/,
    );
    assert.equal(hostile.calls.length, 1);
});

test('logs are bounded to the selected function and explain unavailable telemetry', async () => {
    const mock = mockApi();
    const logs = await account(
        'account_function_logs',
        {...scope, slug: 'demo'},
        credentials,
        mock.fetcher,
    );
    assert.equal(logs.available, true);
    assert.deepEqual(logs.entries, [
        {timestamp: '2026-10-31T01:00:00Z', level: 'INFO', message: 'selected function'},
    ]);
    assert.equal(mock.calls.at(-1).body.limit, 100);
    const unavailable = mockApi({
        [`POST ${branch}/logs/query`]: Response.json(
            {message: 'secret-in-server-error'},
            {status: 404},
        ),
    });
    const result = await account(
        'account_function_logs',
        {...scope, slug: 'demo'},
        credentials,
        unavailable.fetcher,
    );
    assert.equal(result.available, false);
    assert(!JSON.stringify(result).includes('secret-in-server-error'));
});

test('Auth mutations create users without passwords, update roles and delete through management API only', async () => {
    const mock = mockApi();
    assert.deepEqual(
        await account(
            'account_auth_create_user',
            {...scope, email: 'test@example.com', name: 'Test'},
            credentials,
            mock.fetcher,
        ),
        {id: 'user-id'},
    );
    assert.deepEqual(mock.calls.at(-1).body, {email: 'test@example.com', name: 'Test'});
    await account(
        'account_auth_set_role',
        {...scope, userId: 'user-id', role: 'admin'},
        credentials,
        mock.fetcher,
    );
    assert.deepEqual(mock.calls.at(-1).body, {roles: ['admin']});
    await account(
        'account_auth_delete_user',
        {...scope, userId: 'user-id'},
        credentials,
        mock.fetcher,
    );
    assert.equal(mock.calls.at(-1).method, 'DELETE');
    await assert.rejects(
        account('account_auth_create_user', {...scope, email: 'bad'}, credentials, mock.fetcher),
        /email/,
    );
    await assert.rejects(
        account(
            'account_auth_create_user',
            {...scope, email: 'test@example.com', password: 'not-supported'},
            credentials,
            mock.fetcher,
        ),
        /password/,
    );
    await assert.rejects(
        account(
            'account_auth_create_user',
            {...scope, email: 'test@example.com', role: 'admin'},
            credentials,
            mock.fetcher,
        ),
        /after creating/,
    );
});

test('management permission failures remain sanitized and cannot use a connection envelope', async () => {
    const mock = mockApi({
        [`GET ${branch}/functions`]: Response.json(
            {message: credentials.NEON_API_KEY},
            {status: 403},
        ),
    });
    await assert.rejects(
        account('account_functions_list', scope, credentials, mock.fetcher),
        (error) =>
            !error.message.includes(credentials.NEON_API_KEY) && /permission/.test(error.message),
    );
    await assert.rejects(
        extension({
            method: 'account_function_delete',
            args: {...scope, slug: 'demo'},
            secrets: credentials,
            context: {plugin_id: 'neon', connection_id: 'first'},
        }),
        /Unsupported/,
    );
});

test('management context reads only bound metadata and does not require SQL credentials', async () => {
    const result = await extension({
        method: 'neon_management_context',
        args: {},
        params: {driver: 'neon'},
        secrets: {
            NEON_PROJECT_ID: scope.projectId,
            NEON_BRANCH_ID: scope.branchId,
            NEON_BRANCH: 'production',
        },
        context: {plugin_id: 'neon', connection_id: 'first'},
    });
    assert.deepEqual(result, {
        projectId: scope.projectId,
        branchId: scope.branchId,
        branchName: 'production',
    });
    const empty = await extension({
        method: 'neon_management_context',
        args: {},
        params: {driver: 'neon'},
        secrets: {},
        context: {plugin_id: 'neon', connection_id: 'second'},
    });
    assert.deepEqual(empty, {projectId: null, branchId: null, branchName: null});
});

test('Auth directory binds search/IDs and returns no session tokens', async () => {
    const calls = [];
    const row = {
        id: 'user-id',
        name: 'Test',
        email: 'test@example.com',
        emailVerified: true,
        createdAt: new Date('2026-10-31T00:00:00Z'),
        role: 'user',
        token: 'not-returned',
    };
    const query = async (sql, values) => {
        calls.push({sql, values});
        if (sql.startsWith('SELECT column_name'))
            return {
                rows: (values[1] === 'user'
                    ? ['id', 'email', 'role']
                    : ['id', 'userId', 'createdAt', 'expiresAt']
                ).map((column_name) => ({column_name})),
            };
        if (sql.startsWith('SELECT count')) return {rows: [{total: 1}]};
        if (sql.includes('FROM neon_auth.session'))
            return {
                rows: [
                    {
                        id: 'session-id',
                        createdAt: 'now',
                        expiresAt: 'later',
                        token: 'session-secret',
                    },
                ],
            };
        return {rows: [row]};
    };
    const search = "O'Reilly%'; DELETE FROM neon_auth.user; --";
    const page = await authDirectory('neon_auth_users_page', {search, offset: 0, limit: 20}, query);
    assert.equal(page.total, 1);
    assert.equal(page.users[0].role, 'user');
    assert(!calls.some((call) => call.sql.includes(search)));
    assert(calls.some((call) => call.values?.includes(`%${search.replace(/[\\%_]/g, '\\$&')}%`)));
    const details = await authDirectory('neon_auth_user_details', {userId: "x';--"}, query);
    assert.equal(details.sessions[0].id, 'session-id');
    assert(!JSON.stringify(details).includes('secret'));
    assert(!JSON.stringify(details).includes('not-returned'));
    assert(calls.some((call) => call.values?.[0] === "x';--"));
    assert.deepEqual(details.capabilities, {
        profileUpdate: false,
        sessionRevoke: false,
        passwordReset: false,
    });
});

test('Auth directory tolerates absent optional role/session fields and bounds pagination', async () => {
    const query = async (sql) =>
        sql.startsWith('SELECT column_name')
            ? {rows: ['id', 'email'].map((column_name) => ({column_name}))}
            : sql.startsWith('SELECT count')
              ? {rows: [{total: 0}]}
              : {rows: [{id: 'id', email: 'test@example.com', role: null}]};
    assert.equal(
        (await authDirectory('neon_auth_user_details', {userId: 'id'}, query)).user.role,
        null,
    );
    assert.deepEqual(
        (await authDirectory('neon_auth_user_details', {userId: 'id'}, query)).sessions,
        [],
    );
    for (const args of [
        {limit: 101},
        {limit: 0},
        {offset: -1},
        {offset: 1000001},
        {search: 'x'.repeat(201)},
    ])
        await assert.rejects(authDirectory('neon_auth_users_page', args, query));
});

test('function validation compiles TypeScript without uploading or executing and reports positions', async () => {
    const mock = mockApi();
    const result = await account(
        'account_function_validate',
        {
            ...scope,
            source: 'const value: string = "ok"; export default { fetch(request: Request) { return new Response(value); } };',
            language: 'typescript',
        },
        credentials,
        mock.fetcher,
    );
    assert.equal(result.valid, true);
    assert(result.bundleBytes > 0);
    assert.equal(mock.calls.length, 0);
    const invalid = await account(
        'account_function_validate',
        {...scope, source: 'export default = {', language: 'javascript'},
        credentials,
        mock.fetcher,
    );
    assert.equal(invalid.valid, false);
    assert.equal(invalid.diagnostics[0].line, 1);
    assert(invalid.diagnostics[0].column > 0);
    assert.equal(mock.calls.length, 0);
});

test('TypeScript deploy strips annotations and missing exports/imports fail before upload', async () => {
    const mock = mockApi();
    await account(
        'account_function_deploy',
        {
            ...scope,
            slug: 'demo',
            source: 'export default {fetch(request: Request): Response { return new Response(request.url); }}',
            language: 'typescript',
        },
        credentials,
        mock.fetcher,
    );
    const archive = unzipSync(new Uint8Array(await mock.calls[0].body.get('zip').arrayBuffer()));
    assert(!strFromU8(archive['index.mjs']).includes(': Request'));
    for (const source of [
        'const value = 1;',
        'import value from "./env.js"; export default value;',
        'import {z} from "zod"; export default z;',
        'import value from "https://example.com/x.js"; export default value;',
    ]) {
        const unsafe = mockApi();
        await assert.rejects(
            account(
                'account_function_deploy',
                {...scope, slug: 'demo', source},
                credentials,
                unsafe.fetcher,
            ),
        );
        assert.equal(unsafe.calls.length, 0);
    }
    const builtin = mockApi();
    await account(
        'account_function_deploy',
        {
            ...scope,
            slug: 'demo',
            source: 'import {randomUUID} from "node:crypto"; export default {fetch(){return new Response(randomUUID())}}',
        },
        credentials,
        builtin.fetcher,
    );
    assert.equal(builtin.calls.length, 1);
});
