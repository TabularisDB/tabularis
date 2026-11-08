import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createNeonClient} from '@neon/sdk';
import {account} from '../dist/account.js';
import {authDirectory} from '../dist/authDirectory.js';
import {withCredentials} from '../dist/env.js';
import {cliCredential} from '../dist/cliAuth.js';

const apiKey = process.env.NEON_API_KEY;
const cliMode = !apiKey && process.env.NEON_MANAGEMENT_TEST_USE_CLI === '1';
const cliProfile = process.env.NEON_MANAGEMENT_TEST_CLI_PROFILE ?? 'DEFAULT';
assert(
    cliMode || (typeof apiKey === 'string' && apiKey),
    'Provide NEON_API_KEY or select an existing CLI profile',
);
const scope = {
    projectId: process.env.NEON_MANAGEMENT_TEST_PROJECT_ID ?? 'solitary-leaf-07190439',
    branchId: process.env.NEON_MANAGEMENT_TEST_BRANCH_ID ?? 'br-lively-scene-b9f8w1aa',
};
const slug = `tabtest${randomBytes(5).toString('hex')}`;
const email = `${slug}@example.com`;
const credentials = cliMode ? {NEON_CLI_AUTH: cliProfile} : {NEON_API_KEY: apiKey};
const call = (method, args = {}) => account(method, {...scope, ...args}, credentials);
const sdk = createNeonClient({
    apiKey: cliMode ? () => cliCredential(cliProfile) : apiKey,
    throwOnError: true,
    requestTimeoutMs: 15000,
    retries: 0,
});
const source = `export default { async fetch(request) { console.info("Tabularis disposable management test"); return Response.json({marker:${JSON.stringify(slug)},method:request.method,authorization:request.headers.get("authorization"),body:request.method === "POST" ? await request.text() : null,A:process.env.TABULARIS_TEST_A ?? null,B:process.env.TABULARIS_TEST_B ?? null}); }};`;
let functionCreated = false;
let userId;
let databaseUrl;
let checks = 0;
let environmentFailure;
async function check(name, action) {
    await action();
    checks += 1;
    console.log(`PASS ${name}`);
}
async function ready(expectedId) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        const value = await call('account_function_get', {slug});
        const raw = await sdk.functions.get({...scope, slug});
        if (value.deploymentId === expectedId && value.status === 'failed')
            throw new Error('Disposable function deployment failed');
        if (
            value.deploymentId === expectedId &&
            value.status === 'completed' &&
            String(raw.active_deployment?.id) === expectedId
        )
            return value;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Disposable function deployment readiness timed out');
}
async function invoke(method = 'GET', body) {
    const result = await call('account_function_invoke', {
        slug,
        method,
        ...(body !== undefined ? {body} : {}),
    });
    assert.equal(result.status, 200, `Disposable invocation HTTP ${result.status}`);
    return JSON.parse(result.body);
}
async function environmentReady(expected) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const value = await invoke();
        if (Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue))
            return value;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
        'Function environment update did not reach the invocation runtime within 45 seconds',
    );
}
try {
    const databases = await sdk.postgres.databases.list(scope);
    const roles = await sdk.postgres.roles.list(scope);
    const databaseName = databases.find((item) => item.name === 'neondb')?.name;
    const roleName = roles.find((item) => item.name === 'neondb_owner')?.name;
    assert(databaseName && roleName, 'Expected test database and role unavailable');
    databaseUrl = await sdk.postgres.connectionString({
        ...scope,
        databaseName,
        roleName,
        pooled: false,
    });
    const read = (method, args) =>
        withCredentials({DATABASE_URL: databaseUrl}, () => authDirectory(method, args));
    await check(
        'Create and deploy a uniquely named function with write-only environment values',
        async () => {
            const result = await call('account_function_deploy', {
                slug,
                source,
                createOnly: true,
                envChanges: {TABULARIS_TEST_A: 'alpha', TABULARIS_TEST_B: 'beta'},
            });
            functionCreated = true;
            assert(result.id);
            const value = await ready(result.id);
            assert(value.environmentKeys.includes('TABULARIS_TEST_A'));
            assert.equal(value.source, source);
            if (apiKey) assert(!JSON.stringify(value).includes(apiKey));
        },
    );
    await check(
        'Existing-slug protection and invalid JavaScript prevent unintended redeployments',
        async () => {
            await assert.rejects(
                call('account_function_deploy', {slug, source, createOnly: true}),
                /already exists/,
            );
            await assert.rejects(
                call('account_function_deploy', {slug, source: 'export default = {'}),
                /Function validation failed/,
            );
        },
    );
    await check(
        'The deployed function handles GET and POST without receiving the management key',
        async () => {
            const get = await invoke();
            assert.equal(get.marker, slug);
            assert.equal(get.authorization, null);
            assert.equal(get.A, 'alpha');
            assert.equal(get.B, 'beta');
            const post = await invoke('POST', '{"test":true}');
            assert.equal(post.method, 'POST');
            assert.equal(post.authorization, null);
            assert.equal(post.body, '{"test":true}');
        },
    );
    if (process.env.NEON_MANAGEMENT_TEST_SKIP_ENV === '1') {
        console.log(
            'SKIP Environment activation: previously reproduced provider failure; see management-activation-repro.json',
        );
    } else
        try {
            await check(
                'Function rename and environment patches preserve omitted keys and delete explicit keys',
                async () => {
                    const renamed = await call('account_function_rename', {
                        slug,
                        name: 'Tabularis disposable test',
                    });
                    assert.equal(renamed.name, 'Tabularis disposable test');
                    const envSource =
                        process.env.NEON_MANAGEMENT_TEST_WITH_SOURCE === 'changed'
                            ? {source: source + '\nexport const tabularisEnvironmentRevision = 2;'}
                            : process.env.NEON_MANAGEMENT_TEST_WITH_SOURCE === '1'
                              ? {source}
                              : {};
                    const changedDeployment = await call('account_function_deploy', {
                        slug,
                        ...envSource,
                        envChanges: {TABULARIS_TEST_B: 'changed'},
                    });
                    await ready(changedDeployment.id);
                    const patched = await environmentReady({A: 'alpha', B: 'changed'});
                    assert.equal(patched.A, 'alpha');
                    assert.equal(patched.B, 'changed');
                    const deleteSource =
                        process.env.NEON_MANAGEMENT_TEST_WITH_SOURCE === 'changed'
                            ? {source: source + '\nexport const tabularisEnvironmentRevision = 3;'}
                            : envSource;
                    const removedDeployment = await call('account_function_deploy', {
                        slug,
                        ...deleteSource,
                        envChanges: {TABULARIS_TEST_B: null},
                    });
                    await ready(removedDeployment.id);
                    const deleted = await environmentReady({A: 'alpha', B: null});
                    assert.equal(deleted.A, 'alpha');
                    assert.equal(deleted.B, null);
                },
            );
        } catch (error) {
            environmentFailure =
                error instanceof Error ? error.message : 'Environment activation failed';
            console.log('FAIL Environment activation: ' + environmentFailure);
        }
    await check(
        'Function logs return scoped records or an accurate unavailable state',
        async () => {
            const logs = await call('account_function_logs', {slug});
            assert.equal(typeof logs.available, 'boolean');
            assert(Array.isArray(logs.entries));
            if (apiKey) assert(!JSON.stringify(logs).includes(apiKey));
            if (!logs.available) assert(logs.reason);
        },
    );
    await check('Auth user creation is visible through the bound read-only directory', async () => {
        const created = await call('account_auth_create_user', {
            email,
            name: 'Tabularis disposable user',
        });
        userId = created.id;
        assert(userId);
        const page = await read('neon_auth_users_page', {search: email, limit: 20});
        assert(page.users.some((item) => item.id === userId));
        const detail = await read('neon_auth_user_details', {userId});
        assert.equal(detail.user.email, email);
        if (apiKey) assert(!JSON.stringify(detail).includes(apiKey));
    });
    await check(
        'Auth role changes and deletion operate only on the newly created user',
        async () => {
            await call('account_auth_set_role', {userId, role: 'admin'});
            assert.equal((await read('neon_auth_user_details', {userId})).user.role, 'admin');
            await call('account_auth_set_role', {userId, role: 'user'});
            assert.equal((await read('neon_auth_user_details', {userId})).user.role, 'user');
            await call('account_auth_delete_user', {userId});
            userId = undefined;
            assert.equal((await read('neon_auth_users_page', {search: email, limit: 20})).total, 0);
        },
    );
    await check(
        'Deleting the disposable function leaves no function at its test slug',
        async () => {
            await call('account_function_delete', {slug});
            functionCreated = false;
            assert(
                !(await call('account_functions_list')).functions.some(
                    (item) => item.slug === slug,
                ),
            );
        },
    );
    console.log(
        `${environmentFailure ? 'PARTIAL' : 'PASS'} ${checks} real management checks; only disposable test resources were modified`,
    );
    if (environmentFailure)
        throw new Error(
            'Provider activation failure remains after successful remaining lifecycle checks',
        );
} catch (error) {
    let message = error instanceof Error ? error.message : 'Management test failed';
    for (const secret of [apiKey, databaseUrl])
        if (secret) message = message.replaceAll(secret, '[credential]');
    console.error(message);
    process.exitCode = 1;
} finally {
    if (userId)
        await call('account_auth_delete_user', {userId}).catch(() => {
            console.error('Disposable user cleanup failed');
            process.exitCode = 1;
        });
    if (functionCreated)
        await call('account_function_delete', {slug}).catch(() => {
            console.error('Disposable function cleanup failed');
            process.exitCode = 1;
        });
}
