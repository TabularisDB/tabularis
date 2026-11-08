import {test} from 'node:test';
import assert from 'node:assert/strict';
import {account} from '../dist/account.js';
import {extension} from '../dist/scope.js';

const selection = {
    projectId: 'test-project-123',
    branchId: 'br-test-123',
    database: 'neondb',
    role: 'neondb_owner',
    createServiceCredentials: false,
};
const credential = {NEON_API_KEY: 'test-account-api-key'};
const root = '/api/v2/projects/test-project-123';
const branch = `${root}/branches/br-test-123`;

function api(overrides = {}) {
    const calls = [];
    const bodies = {
        '/api/v2/users/me/organizations': {
            organizations: [{id: 'org-test', name: 'Team', billing_secret: 'hidden'}],
        },
        '/api/v2/projects': {
            projects: [
                {
                    id: 'test-project-123',
                    name: 'App',
                    region_id: 'aws-eu-central-1',
                    org_id: 'org-test',
                    password: 'hidden',
                },
            ],
        },
        [root]: {project: {id: 'test-project-123', name: 'App'}},
        [`${root}/branches`]: {
            branches: [{id: 'br-test-123', name: 'production', secret: 'hidden'}],
        },
        [branch]: {branch: {id: 'br-test-123', name: 'production'}},
        [`${branch}/databases`]: {databases: [{name: 'neondb', owner_name: 'hidden-owner'}]},
        [`${branch}/roles`]: {
            roles: [{name: 'neondb_owner', password: 'role-password-must-not-leak'}],
        },
        [`${branch}/auth`]: {
            auth_provider: 'better_auth',
            db_name: 'neondb',
            base_url: 'https://auth.example.neon.tech',
            jwks_url: 'https://auth.example.neon.tech/jwks',
        },
        [`${branch}/storage`]: {
            enabled: true,
            s3_endpoint: 'https://storage.example.neon.tech',
            region: 'eu-central-1',
            force_path_style: true,
        },
        [`${branch}/ai_gateway`]: {enabled: true, base_url: 'https://ai.example.neon.tech'},
        [`${branch}/functions`]: {
            functions: [
                {
                    slug: 'hello',
                    invocation_url: 'https://hello.example.neon.tech/',
                    active_deployment: {status: 'completed', environment: ['SECRET_NAME']},
                },
            ],
        },
        [`${branch}/realtime`]: {
            enabled: true,
            pending: false,
            invocation_url: 'wss://live.example.neon.tech',
        },
        [`${branch}/realtime/secret`]: {secret: 'live-secret-must-not-leak', pending: false},
        [`${branch}/buckets`]: {buckets: [{name: 'assets'}]},
        [`${root}/connection_uri`]: {
            uri: 'postgresql://neondb_owner:database-password@db.example.neon.tech/neondb?sslmode=require',
        },
        [`${branch}/credentials`]: {
            token_id: 'credential-token-id',
            api_token: 'ai-token-must-not-leak',
            s3_secret_access_key: 's3-secret-must-not-leak',
            scopes: ['storage:read', 'storage:write', 'ai_gateway:invoke'],
        },
        ...overrides,
    };
    return {
        calls,
        fetcher: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            assert.equal(url.origin, 'https://console.neon.tech');
            assert.equal(request.headers.get('authorization'), `Bearer ${credential.NEON_API_KEY}`);
            calls.push({
                method: request.method,
                path: url.pathname,
                query: url.searchParams,
                body: request.method === 'GET' ? undefined : await request.json(),
            });
            const value = bodies[url.pathname];
            assert.notEqual(value, undefined, `Unexpected API path ${url.pathname}`);
            return value instanceof Response ? value.clone() : Response.json(value);
        },
    };
}

test('account metadata exposes only safe organization/project/branch names and IDs', async () => {
    const mock = api();
    const projects = await account(
        'account_projects',
        {orgId: 'org-test'},
        credential,
        mock.fetcher,
    );
    assert.deepEqual(projects, {
        organizations: [{id: 'org-test', name: 'Team'}],
        projects: [
            {id: 'test-project-123', name: 'App', regionId: 'aws-eu-central-1', orgId: 'org-test'},
        ],
    });
    assert.equal(
        mock.calls.find((call) => call.path === '/api/v2/projects').query.get('org_id'),
        'org-test',
    );
    const branches = await account('account_branches', selection, credential, mock.fetcher);
    assert.deepEqual(branches, {branches: [{id: 'br-test-123', name: 'production'}]});
    assert(mock.calls.every((call) => call.method === 'GET'));
});

test('resource discovery does not return role passwords, service secrets, URLs or raw API objects', async () => {
    const mock = api();
    const resources = await account('account_resources', selection, credential, mock.fetcher);
    assert.deepEqual(resources.databases, [{name: 'neondb'}]);
    assert.deepEqual(resources.roles, [{name: 'neondb_owner'}]);
    assert.equal(resources.services.filter((service) => service.enabled).length, 5);
    const serialized = JSON.stringify(resources);
    for (const privateValue of [
        'role-password',
        'live-secret',
        'example.neon.tech',
        'SECRET_NAME',
        credential.NEON_API_KEY,
    ])
        assert.equal(serialized.includes(privateValue), false);
    assert(mock.calls.every((call) => call.method === 'GET'));
    assert(!mock.calls.some((call) => call.path.endsWith('/secret')));
});

test('import resolves direct verified SQL credentials internally, without minting service credentials by default', async () => {
    const mock = api();
    const result = await account('account_import', selection, credential, mock.fetcher);
    assert.equal(result.name, 'App · production');
    assert.deepEqual(result.params, {
        driver: 'neon',
        host: 'db.example.neon.tech',
        port: 5432,
        username: 'neondb_owner',
        password: 'database-password',
        database: 'neondb',
        ssl_mode: 'verify-full',
        save_in_keychain: true,
    });
    assert.equal(result.secrets.NEON_BRANCH, 'production');
    assert.equal(result.secrets.NEON_AUTH_BASE_URL, 'https://auth.example.neon.tech');
    assert.equal(result.secrets.NEON_FUNCTION_HELLO_BASE_URL, 'https://hello.example.neon.tech/');
    assert.equal(result.secrets.NEON_REALTIME_SECRET, 'live-secret-must-not-leak');
    assert.equal(result.secrets.NEON_API_KEY, undefined);
    assert.equal(result.secrets.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(result.secrets.NEON_AI_GATEWAY_TOKEN, undefined);
    assert(result.warnings.some((value) => value.includes('Create or import service credentials')));
    assert(mock.calls.every((call) => call.method === 'GET'));
    assert.equal(
        mock.calls.find((call) => call.path.endsWith('/connection_uri')).query.get('pooled'),
        'false',
    );
});

test('explicit credential opt-in creates one named credential with only enabled service scopes', async () => {
    const mock = api();
    const result = await account(
        'account_import',
        {...selection, createServiceCredentials: true},
        credential,
        mock.fetcher,
    );
    const writes = mock.calls.filter((call) => call.method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `${branch}/credentials`);
    assert.deepEqual(writes[0].body, {
        name: 'Tabularis · production',
        principal_type: 'user',
        scopes: ['storage:read', 'storage:write', 'ai_gateway:invoke'],
    });
    assert.equal(result.secrets.AWS_ACCESS_KEY_ID, 'credential-token-id');
    assert.equal(result.secrets.AWS_SECRET_ACCESS_KEY, 's3-secret-must-not-leak');
    assert.equal(result.secrets.NEON_AI_GATEWAY_TOKEN, 'ai-token-must-not-leak');
});

test('optional forbidden services are reported and remain unconfigured while SQL import succeeds', async () => {
    const mock = api({
        [`${branch}/ai_gateway`]: Response.json({message: 'private-api-token'}, {status: 403}),
        [`${branch}/storage`]: Response.json({message: 'disabled'}, {status: 404}),
    });
    const resources = await account('account_resources', selection, credential, mock.fetcher);
    assert.equal(resources.services.find((service) => service.id === 'storage').enabled, false);
    const ai = resources.services.find((service) => service.id === 'ai');
    assert.equal(ai.enabled, false);
    assert.match(ai.warning, /permission/);
    assert(!JSON.stringify(resources).includes('private-api-token'));
    const imported = await account(
        'account_import',
        {...selection, createServiceCredentials: true},
        credential,
        mock.fetcher,
    );
    assert.equal(imported.secrets.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(imported.secrets.NEON_AI_GATEWAY_TOKEN, undefined);
    assert(mock.calls.every((call) => call.method === 'GET'));
});

test('bad account keys and permission failures never expose remote response bodies', async () => {
    for (const status of [401, 403]) {
        const mock = api({
            '/api/v2/projects': Response.json(
                {message: 'test-account-api-key postgresql://owner:password@host/db'},
                {status},
            ),
        });
        await assert.rejects(account('account_projects', {}, credential, mock.fetcher), (error) => {
            assert.match(error.message, status === 401 ? /invalid or expired/ : /permission/);
            assert.equal(error.message.includes(credential.NEON_API_KEY), false);
            assert.equal(error.message.includes('postgresql:'), false);
            return true;
        });
    }
});

test('account calls validate selectors and require explicit scoped credentials', async () => {
    const mock = api();
    for (const invalid of [
        {projectId: 'https://other.host/'},
        {branchId: '../other'},
        {database: 'db\0name'},
        {role: ''},
        {createServiceCredentials: undefined},
    ]) {
        await assert.rejects(
            account('account_import', {...selection, ...invalid}, credential, mock.fetcher),
            /Invalid|Choose/,
        );
    }
    await assert.rejects(account('account_projects', {}, {}, mock.fetcher), /API key is required/);
    await assert.rejects(
        account('neon_storage_delete', {}, credential, mock.fetcher),
        /Unsupported/,
    );
    assert.equal(mock.calls.length, 0);
});

test('account and connection extension scopes reject each other and cannot use process credentials', async () => {
    await assert.rejects(
        extension({
            method: 'account_projects',
            args: {},
            secrets: {},
            context: {plugin_id: 'neon', scope: 'account'},
        }),
        /API key is required/,
    );
    await assert.rejects(
        extension({
            method: 'neon_status',
            args: {},
            secrets: credential,
            context: {plugin_id: 'neon', scope: 'account'},
        }),
        /Unsupported/,
    );
    await assert.rejects(
        extension({
            method: 'account_projects',
            args: {},
            secrets: credential,
            context: {plugin_id: 'neon', connection_id: 'x'},
        }),
        /Unsupported/,
    );
    await assert.rejects(
        extension({
            method: 'account_projects',
            args: {},
            secrets: credential,
            context: {plugin_id: 'neon', scope: 'account', connection_id: 'x'},
        }),
        /cannot include/,
    );
    await assert.rejects(
        extension({
            method: 'account_projects',
            args: {},
            params: {},
            secrets: credential,
            context: {plugin_id: 'neon', scope: 'account'},
        }),
        /cannot include/,
    );
    await assert.rejects(
        extension({
            method: 'account_projects',
            args: {},
            secrets: credential,
            context: {plugin_id: 'other', scope: 'account'},
        }),
        /context/,
    );
});
