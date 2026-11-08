import {test} from 'node:test';
import assert from 'node:assert/strict';
import {account} from '../dist/account.js';
import {usageWindow} from '../dist/usage.js';

const scope = {projectId: 'project-test123', branchId: 'br-source'};
const credentials = {NEON_API_KEY: 'usage-private-account'};
function api({
    denied = false,
    empty = false,
    missingQuota = false,
    foreign = false,
    splitPeriods = false,
} = {}) {
    const calls = [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 2);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const row = {
        period_id: 'period',
        period_plan: 'launch',
        period_start: start.toISOString(),
        consumption: [
            {
                timeframe_start: start.toISOString(),
                timeframe_end: new Date(start.getTime() + 3600000).toISOString(),
                metrics: [
                    {metric_name: 'compute_unit_seconds', value: 3600},
                    {metric_name: 'public_network_transfer_bytes', value: 123},
                ],
            },
        ],
    };
    const periods = [
        row,
        ...(splitPeriods
            ? [
                  {
                      ...row,
                      period_id: 'next-plan',
                      period_start: new Date(start.getTime() + 3600000).toISOString(),
                      consumption: [
                          {
                              timeframe_start: new Date(start.getTime() + 3600000).toISOString(),
                              timeframe_end: new Date(start.getTime() + 7200000).toISOString(),
                              metrics: [{metric_name: 'compute_unit_seconds', value: 1800}],
                          },
                      ],
                  },
              ]
            : []),
    ];
    return {
        calls,
        fetcher: async (input, init) => {
            const req = input instanceof Request ? input : new Request(input, init);
            const url = new URL(req.url);
            calls.push({method: req.method, url});
            if (url.pathname.endsWith('/projects/' + scope.projectId))
                return Response.json({
                    project: {
                        id: scope.projectId,
                        name: 'Usage project',
                        org_id: 'org-bound',
                        owner_id: 'org-bound',
                        owner: {email: 'private@example.test', subscription_type: 'launch_v3'},
                        consumption_period_start: start.toISOString(),
                        consumption_period_end: end.toISOString(),
                        branch_logical_size_limit_bytes: 100,
                        compute_time_seconds: 85,
                        active_time_seconds: 0,
                        data_transfer_bytes: 0,
                        written_data_bytes: 0,
                        ...(!missingQuota
                            ? {
                                  settings: {
                                      quota: {compute_time_seconds: 100, active_time_seconds: 0},
                                  },
                              }
                            : {}),
                    },
                });
            if (url.pathname.endsWith('/branches/' + scope.branchId))
                return Response.json({
                    branch: {
                        id: scope.branchId,
                        project_id: scope.projectId,
                        name: 'production',
                        logical_size: 105,
                    },
                });
            if (url.pathname.endsWith('/billing/spending_limit'))
                return denied
                    ? Response.json({message: credentials.NEON_API_KEY}, {status: 403})
                    : Response.json({spending_limit_cents: null});
            if (url.pathname.endsWith('/organizations/org-bound'))
                return Response.json({id: 'org-bound', name: 'Team', plan: 'launch'});
            if (url.pathname.includes('/consumption_history/v2/')) {
                if (denied)
                    return Response.json({message: credentials.NEON_API_KEY}, {status: 403});
                const project_id = foreign ? 'foreign-project' : scope.projectId;
                return Response.json(
                    url.pathname.endsWith('/branches')
                        ? {
                              branches: empty
                                  ? []
                                  : [{project_id, branch_id: scope.branchId, periods}],
                          }
                        : {projects: empty ? [] : [{project_id, periods}]},
                );
            }
            return Response.json({message: 'Unexpected endpoint'}, {status: 404});
        },
    };
}
test('usage uses the saved project organization and matching branch, with explicit units and no credentials', async () => {
    const mock = api();
    const result = await account(
        'account_usage',
        {...scope, orgId: 'org-other'},
        credentials,
        mock.fetcher,
    );
    assert.equal(result.organization.id, 'org-bound');
    assert.equal(result.organization.plan, 'launch');
    assert.equal(result.history.project.status, 'ready');
    assert.equal(result.history.project.values.compute_unit_seconds, 3600);
    assert.equal(
        result.history.project.values.functions_invocations,
        0,
        'documented omitted zero metrics',
    );
    assert.equal(result.limits.find((row) => row.id === 'compute_time_seconds').limit, 100);
    assert.equal(
        result.limits.find((row) => row.id === 'active_time_seconds').limitStatus,
        'not_set',
    );
    assert.equal(result.limits.find((row) => row.id === 'logical_size_bytes').used, 105);
    assert.equal(result.budget.status, 'ready');
    assert.equal(result.budget.limitCents, null);
    assert.equal(result.budget.spentCents, null);
    assert(mock.calls.every((call) => call.method === 'GET'));
    assert(!JSON.stringify(result).includes('private@example.test'));
    assert(!JSON.stringify(result).includes(credentials.NEON_API_KEY));
    for (const {url} of mock.calls.filter((call) =>
        call.url.pathname.includes('consumption_history'),
    )) {
        assert.equal(url.searchParams.get('org_id'), 'org-bound');
        assert(url.searchParams.getAll('project_ids').includes(scope.projectId));
    }
    const branchRequest = mock.calls.find((call) => call.url.pathname.endsWith('/v2/branches')).url;
    assert(branchRequest.searchParams.getAll('branch_ids').includes(scope.branchId));
});
test('missing quotas, denied metrics and unavailable budget are never reported as zero or unlimited', async () => {
    const mock = api({denied: true, missingQuota: true});
    const result = await account('account_usage', scope, credentials, mock.fetcher);
    assert.equal(result.limits[0].limitStatus, 'unavailable');
    assert.equal(result.history.project.status, 'unavailable');
    assert.equal(result.history.project.reason, 'access_or_plan');
    assert.equal(result.history.project.values.compute_unit_seconds, null);
    assert.equal(result.budget.status, 'unavailable');
    assert.equal(result.budget.spentCents, null);
    assert(!JSON.stringify(result).includes(credentials.NEON_API_KEY));
});
test('empty and foreign histories stay unknown instead of leaking another project or inventing usage', async () => {
    for (const options of [{empty: true}, {foreign: true}]) {
        const mock = api(options);
        const result = await account('account_usage', scope, credentials, mock.fetcher);
        assert.equal(result.history.project.status, 'no_data');
        assert.equal(result.history.branch.status, 'no_data');
        assert.equal(result.history.project.values.compute_unit_seconds, null);
    }
});
test('usage windows respect granularity limits, UTC rounding and missing periods', () => {
    const now = new Date('2026-11-04T18:38:00Z');
    const recent = usageWindow('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', now);
    assert.equal(recent.granularity, 'hourly');
    assert.equal(recent.to, '2026-11-04T18:00:00.000Z');
    assert.equal(
        usageWindow('2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z', now).granularity,
        'daily',
    );
    const partial = usageWindow('2026-11-01T00:15:00Z', null, now);
    assert.equal(partial.from, '2026-11-01T01:00:00.000Z');
    assert.equal(partial.partial, true);
    assert.equal(usageWindow('bad', null, now), null);
});

test('a plan transition does not discard valid consumption intervals in the requested window', async () => {
    const mock = api({splitPeriods: true});
    const result = await account('account_usage', scope, credentials, mock.fetcher);
    assert.equal(result.history.project.values.compute_unit_seconds, 5400);
});
