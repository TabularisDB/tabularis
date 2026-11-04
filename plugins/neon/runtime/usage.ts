import {
    isNeonError,
    raw,
    type NeonClient,
    type ConsumptionHistoryPerProjectV2,
    type ConsumptionHistoryPerBranchV2,
} from '@neon/sdk';
import {ManagementError} from './management.js';

const metrics = [
    'compute_unit_seconds',
    'root_branch_bytes_month',
    'child_branch_bytes_month',
    'instant_restore_bytes_month',
    'snapshot_storage_bytes_month',
    'public_network_transfer_bytes',
    'private_network_transfer_bytes',
    'extra_branches_month',
    'functions_active_capacity_microseconds',
    'functions_waiting_capacity_microseconds',
    'functions_invocations',
    'functions_egress_bytes',
] as const;
type Metric = (typeof metrics)[number];
type Reason =
    | 'access_or_plan'
    | 'unsupported'
    | 'request_failed'
    | 'organization_missing'
    | 'period_missing'
    | 'invalid_response';
type Probe<T> = {value: T; reason?: never} | {value?: never; reason: Reason};
type Window = {
    from: string;
    to: string;
    granularity: 'hourly' | 'daily' | 'monthly';
    partial: boolean;
};
const number = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = (value: unknown): number | null =>
    typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Align requests to completed UTC intervals within Neon's documented retention windows. */
export function usageWindow(start: unknown, end: unknown, now = new Date()): Window | null {
    const beginning = time(start);
    if (beginning === null || beginning >= now.getTime()) return null;
    const ending = Math.min(time(end) ?? now.getTime(), now.getTime());
    const hour = 3600000,
        day = 24 * hour;
    const granularity: Window['granularity'] =
        now.getTime() - Math.floor(beginning / hour) * hour <= 7 * day
            ? 'hourly'
            : now.getTime() - Math.floor(beginning / day) * day <= 60 * day
              ? 'daily'
              : 'monthly';
    const from = new Date(beginning),
        to = new Date(ending);
    let partial = false;
    if (granularity === 'hourly') {
        from.setUTCMinutes(0, 0, 0);
        to.setUTCMinutes(0, 0, 0);
    } else if (granularity === 'daily') {
        from.setUTCHours(0, 0, 0, 0);
        to.setUTCHours(0, 0, 0, 0);
    } else {
        from.setUTCDate(1);
        from.setUTCHours(0, 0, 0, 0);
        to.setUTCDate(1);
        to.setUTCHours(0, 0, 0, 0);
        const oldest = new Date(now);
        oldest.setUTCFullYear(oldest.getUTCFullYear() - 1);
        oldest.setUTCMonth(oldest.getUTCMonth() + 1, 1);
        oldest.setUTCHours(0, 0, 0, 0);
        if (from < oldest) {
            from.setTime(oldest.getTime());
            partial = true;
        }
    }
    if (from.getTime() < beginning) {
        if (granularity === 'hourly') from.setUTCHours(from.getUTCHours() + 1);
        else if (granularity === 'daily') from.setUTCDate(from.getUTCDate() + 1);
        else from.setUTCMonth(from.getUTCMonth() + 1);
        partial = true;
    }
    if (from >= to) return null;
    return {from: from.toISOString(), to: to.toISOString(), granularity, partial};
}

async function probe<T>(action: () => Promise<T>): Promise<Probe<T>> {
    try {
        return {value: await action()};
    } catch (error) {
        if (isNeonError(error) && 'status' in error) {
            if (error.status === 401) throw error;
            if (error.status === 403) return {reason: 'access_or_plan'};
            if (error.status === 404) return {reason: 'unsupported'};
        }
        return {reason: 'request_failed'};
    }
}

function history(
    result: Probe<(ConsumptionHistoryPerProjectV2 | ConsumptionHistoryPerBranchV2)[]>,
    scope: {projectId: string; branchId?: string},
    window: Window | null,
    supported: readonly Metric[],
) {
    const unknown = Object.fromEntries(metrics.map((key) => [key, null])) as Record<
        Metric,
        number | null
    >;
    if (result.reason)
        return {
            status: 'unavailable' as const,
            reason: result.reason,
            values: unknown,
            reportedThrough: null,
        };
    if (!window)
        return {
            status: 'unavailable' as const,
            reason: 'period_missing' as const,
            values: unknown,
            reportedThrough: null,
        };
    const record = result.value.find(
        (row) =>
            row.project_id === scope.projectId &&
            (!scope.branchId || ('branch_id' in row && row.branch_id === scope.branchId)),
    );
    const frames =
        record?.periods
            .flatMap((period) => period.consumption)
            .filter((frame) => {
                const start = time(frame.timeframe_start),
                    end = time(frame.timeframe_end);
                return (
                    start !== null &&
                    end !== null &&
                    end > start &&
                    start >= Date.parse(window.from) &&
                    end <= Date.parse(window.to)
                );
            }) ?? [];
    if (!frames.length) return {status: 'no_data' as const, values: unknown, reportedThrough: null};
    const values = {...unknown};
    for (const key of supported) values[key] = 0;
    for (const frame of frames)
        for (const item of frame.metrics ?? []) {
            if (!supported.includes(item.metric_name as Metric)) continue;
            const value = number(item.value);
            if (value === null)
                return {
                    status: 'unavailable' as const,
                    reason: 'invalid_response' as const,
                    values: unknown,
                    reportedThrough: null,
                };
            const key = item.metric_name as Metric;
            const total = (values[key] ?? 0) + value;
            if (!Number.isFinite(total))
                return {
                    status: 'unavailable' as const,
                    reason: 'invalid_response' as const,
                    values: unknown,
                    reportedThrough: null,
                };
            values[key] = total;
        }
    return {
        status: 'ready' as const,
        values,
        reportedThrough: new Date(
            Math.max(...frames.map((frame) => time(frame.timeframe_end) ?? 0)),
        ).toISOString(),
    };
}

function cap(
    id: string,
    scope: 'project' | 'branch',
    used: unknown,
    value: unknown,
    known: boolean,
    unit: 'seconds' | 'bytes',
    period: 'billing' | 'current',
) {
    const limit = number(value);
    return {
        id,
        scope,
        used: number(used),
        limit: limit !== null && limit > 0 ? limit : null,
        limitStatus:
            limit !== null && limit > 0
                ? ('finite' as const)
                : known && (value === undefined || limit === 0)
                  ? ('not_set' as const)
                  : ('unavailable' as const),
        unit,
        period,
    };
}

/** Read-only, organization scope comes from the project rather than caller-supplied org IDs. */
export async function readUsage(
    client: NeonClient<true>,
    scope: {projectId: string; branchId: string},
) {
    const [project, branch] = await Promise.all([
        client.projects.get({projectId: scope.projectId}),
        client.branches.get(scope),
    ]);
    if (
        project.id !== scope.projectId ||
        branch.id !== scope.branchId ||
        branch.project_id !== scope.projectId
    )
        throw new ManagementError('Neon returned mismatched usage scope');
    const orgId =
        project.org_id ?? (project.owner_id?.startsWith('org-') ? project.owner_id : null);
    const window = usageWindow(project.consumption_period_start, project.consumption_period_end);
    const branchMetrics = metrics.filter(
        (key) => key !== 'snapshot_storage_bytes_month' && key !== 'extra_branches_month',
    );
    const query =
        orgId && window
            ? {
                  orgId,
                  project_ids: [scope.projectId],
                  from: window.from,
                  to: window.to,
                  granularity: window.granularity,
                  limit: 1,
              }
            : null;
    const [organization, budget, projectUsage, branchUsage] = await Promise.all([
        orgId
            ? probe(() =>
                  raw.getOrganization({
                      client: client.client,
                      path: {org_id: orgId},
                      throwOnError: true,
                  }),
              )
            : Promise.resolve({reason: 'organization_missing', value: undefined} as const),
        orgId
            ? probe(() =>
                  raw.getOrganizationSpendingLimit({
                      client: client.client,
                      path: {org_id: orgId},
                      throwOnError: true,
                  }),
              )
            : Promise.resolve({reason: 'organization_missing', value: undefined} as const),
        query
            ? probe(
                  async () =>
                      (
                          await client.consumption
                              .perProjectV2({...query, metrics: [...metrics]})
                              .page()
                      ).items,
              )
            : Promise.resolve({
                  reason: orgId ? 'period_missing' : 'organization_missing',
                  value: undefined,
              } as const),
        query
            ? probe(
                  async () =>
                      (
                          await client.consumption
                              .perBranchV2({
                                  ...query,
                                  branch_ids: [scope.branchId],
                                  metrics: branchMetrics,
                              })
                              .page()
                      ).items,
              )
            : Promise.resolve({
                  reason: orgId ? 'period_missing' : 'organization_missing',
                  value: undefined,
              } as const),
    ]);
    if (organization.value && organization.value.id !== orgId)
        throw new ManagementError('Neon returned mismatched organization scope');
    const quota = project.settings?.quota;
    const logicalCaps = [
        number(quota?.logical_size_bytes),
        number(project.branch_logical_size_limit_bytes),
    ].filter((value): value is number => value !== null && value > 0);
    const logicalLimit = logicalCaps.length
        ? Math.min(...logicalCaps)
        : project.branch_logical_size_limit_bytes;
    const budgetValid =
        budget.value &&
        (budget.value.spending_limit_cents === null ||
            (Number.isSafeInteger(budget.value.spending_limit_cents) &&
                (number(budget.value.spending_limit_cents) ?? 0) > 0));
    return {
        fetchedAt: new Date().toISOString(),
        project: {id: scope.projectId, name: project.name},
        branch: {id: scope.branchId, name: branch.name},
        organization: {
            id: orgId,
            name: organization.value?.name ?? null,
            plan: organization.value?.plan ?? project.owner?.subscription_type ?? null,
            status: organization.value ? 'ready' : 'unavailable',
            reason: organization.reason,
        },
        billingPeriod: {
            from:
                time(project.consumption_period_start) !== null
                    ? project.consumption_period_start
                    : null,
            to:
                time(project.consumption_period_end) !== null
                    ? project.consumption_period_end
                    : null,
        },
        window,
        limits: [
            cap(
                'compute_time_seconds',
                'project',
                project.compute_time_seconds,
                quota?.compute_time_seconds,
                quota !== undefined,
                'seconds',
                'billing',
            ),
            cap(
                'active_time_seconds',
                'project',
                project.active_time_seconds,
                quota?.active_time_seconds,
                quota !== undefined,
                'seconds',
                'billing',
            ),
            cap(
                'data_transfer_bytes',
                'project',
                project.data_transfer_bytes,
                quota?.data_transfer_bytes,
                quota !== undefined,
                'bytes',
                'billing',
            ),
            cap(
                'written_data_bytes',
                'project',
                project.written_data_bytes,
                quota?.written_data_bytes,
                quota !== undefined,
                'bytes',
                'billing',
            ),
            cap(
                'logical_size_bytes',
                'branch',
                branch.logical_size,
                logicalLimit,
                logicalLimit !== undefined,
                'bytes',
                'current',
            ),
        ],
        history: {
            project: history(projectUsage, {projectId: scope.projectId}, window, metrics),
            branch: history(branchUsage, scope, window, branchMetrics),
        },
        budget: {
            organizationId: orgId,
            status: budgetValid ? 'ready' : 'unavailable',
            reason: budget.reason ?? (!budgetValid ? 'invalid_response' : undefined),
            limitCents: budgetValid ? budget.value.spending_limit_cents : null,
            spentCents: null,
            currency: null,
            enforcement: 'notification_only',
        },
    };
}
