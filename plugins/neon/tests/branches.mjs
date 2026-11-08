import {test} from 'node:test';
import assert from 'node:assert/strict';
import {account} from '../dist/account.js';
const scope = {projectId: 'project-test123', branchId: 'br-source'};
const credentials = {NEON_API_KEY: 'branch-account-private'};
const source = {
    id: 'br-source',
    name: 'production',
    default: true,
    protected: false,
    current_state: 'ready',
};
const target = {
    id: 'br-target',
    name: 'feature',
    parent_id: source.id,
    default: false,
    protected: false,
    current_state: 'ready',
};
function api(branches = [source, target]) {
    const calls = [];
    return {
        calls,
        fetcher: async (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            const body =
                request.method === 'POST' || request.method === 'PATCH'
                    ? await request.json()
                    : undefined;
            calls.push({path: url.pathname, method: request.method, body});
            if (url.pathname.endsWith('/branches') && request.method === 'GET')
                return Response.json({branches});
            if (url.pathname.endsWith('/branches') && request.method === 'POST')
                return Response.json({
                    branch: {...target, name: body.branch.name},
                    endpoints: [],
                    operations: [],
                });
            if (url.pathname.endsWith('/branches/br-target') && request.method === 'PATCH')
                return Response.json({branch: {...target, name: body.branch.name}, operations: []});
            if (url.pathname.endsWith('/branches/br-target') && request.method === 'DELETE')
                return Response.json({branch: target, operations: []});
            if (url.pathname.includes('/branches/'))
                return Response.json({
                    branch: branches.find((row) => url.pathname.endsWith('/' + row.id)),
                });
            return Response.json({project: {id: scope.projectId, name: 'Test Project'}});
        },
    };
}
test('branch management returns bounded metadata and creates from an explicit parent', async () => {
    const mock = api();
    const listed = await account('account_branch_list', scope, credentials, mock.fetcher);
    assert.equal(listed.projectName, 'Test Project');
    assert.equal(listed.branches[0].isDefault, true);
    assert(!JSON.stringify(listed).includes(credentials.NEON_API_KEY));
    await account(
        'account_branch_create',
        {...scope, name: 'feature/new', parentId: source.id},
        credentials,
        mock.fetcher,
    );
    assert.equal(mock.calls.at(-1).body.branch.parent_id, source.id);
    assert.equal(mock.calls.at(-1).body.branch.name, 'feature/new');
    await account(
        'account_branch_rename',
        {...scope, targetBranchId: target.id, name: 'renamed'},
        credentials,
        mock.fetcher,
    );
    assert.equal(mock.calls.at(-1).body.branch.name, 'renamed');
});
test('branch deletion requires the fresh exact name and rejects protected/default/current/parent branches', async () => {
    for (const branches of [
        [source, target],
        [source, {...target, protected: true}],
        [source, {...target, default: true}],
        [source, target, {...target, id: 'br-child', parent_id: target.id}],
    ]) {
        const mock = api(branches);
        const protectedTarget = branches[1];
        if (protectedTarget.protected || protectedTarget.default || branches.length > 2) {
            await assert.rejects(
                account(
                    'account_branch_delete',
                    {...scope, targetBranchId: target.id, confirmName: 'feature'},
                    credentials,
                    mock.fetcher,
                ),
            );
            assert(!mock.calls.some((call) => call.method === 'DELETE'));
        }
    }
    for (const args of [
        {targetBranchId: source.id, confirmName: 'production'},
        {targetBranchId: target.id, confirmName: 'wrong'},
    ]) {
        const mock = api();
        await assert.rejects(
            account('account_branch_delete', {...scope, ...args}, credentials, mock.fetcher),
        );
        assert(!mock.calls.some((call) => call.method === 'DELETE'));
    }
    const mock = api();
    await account(
        'account_branch_delete',
        {...scope, targetBranchId: target.id, confirmName: 'feature'},
        credentials,
        mock.fetcher,
    );
    assert.equal(mock.calls.at(-1).method, 'DELETE');
});
test('branch names and IDs fail closed before mutations', async () => {
    for (const args of [
        {name: ''},
        {name: 'bad\nname'},
        {name: 'x'.repeat(256)},
        {name: 'valid', parentId: '../../other'},
    ]) {
        const mock = api();
        await assert.rejects(
            account('account_branch_create', {...scope, ...args}, credentials, mock.fetcher),
        );
        assert(!mock.calls.some((call) => call.method === 'POST'));
    }
});

test('closed connection branch context exposes binding metadata without SQL or service credentials', async () => {
    const {extension} = await import('../dist/scope.js');
    const result = await extension({
        method: 'neon_branch_context',
        args: {},
        params: {
            driver: 'neon',
            database: 'neondb',
            username: 'owner',
            password: 'never-return-sql-secret',
        },
        secrets: {
            NEON_PROJECT_ID: 'project-test123',
            NEON_BRANCH_ID: 'br-source',
            NEON_BRANCH: 'production',
            NEON_AI_GATEWAY_TOKEN: 'never-return-service-secret',
        },
        context: {plugin_id: 'neon', connection_id: 'closed-connection'},
    });
    assert.deepEqual(result, {
        projectId: 'project-test123',
        branchId: 'br-source',
        branchName: 'production',
        database: 'neondb',
        role: 'owner',
    });
    assert(!JSON.stringify(result).includes('secret'));
});
