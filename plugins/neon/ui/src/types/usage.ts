export type UsageReason =
    | 'access_or_plan'
    | 'unsupported'
    | 'request_failed'
    | 'organization_missing'
    | 'period_missing'
    | 'invalid_response';
export type MetricId =
    | 'compute_unit_seconds'
    | 'root_branch_bytes_month'
    | 'child_branch_bytes_month'
    | 'instant_restore_bytes_month'
    | 'snapshot_storage_bytes_month'
    | 'public_network_transfer_bytes'
    | 'private_network_transfer_bytes'
    | 'extra_branches_month'
    | 'functions_active_capacity_microseconds'
    | 'functions_waiting_capacity_microseconds'
    | 'functions_invocations'
    | 'functions_egress_bytes';
export interface UsageLimit {
    id:
        | 'compute_time_seconds'
        | 'active_time_seconds'
        | 'data_transfer_bytes'
        | 'written_data_bytes'
        | 'logical_size_bytes';
    scope: 'project' | 'branch';
    used: number | null;
    limit: number | null;
    limitStatus: 'finite' | 'not_set' | 'unavailable';
    unit: 'seconds' | 'bytes';
    period: 'billing' | 'current';
}
export interface UsageHistory {
    status: 'ready' | 'unavailable' | 'no_data';
    reason?: UsageReason;
    values: Record<MetricId, number | null>;
    reportedThrough: string | null;
}
export interface UsageSnapshot {
    fetchedAt: string;
    project: {id: string; name: string};
    branch: {id: string; name: string};
    organization: {
        id: string | null;
        name: string | null;
        plan: string | null;
        status: 'ready' | 'unavailable';
        reason?: UsageReason;
    };
    billingPeriod: {from: string | null; to: string | null};
    window: {
        from: string;
        to: string;
        granularity: 'hourly' | 'daily' | 'monthly';
        partial: boolean;
    } | null;
    limits: UsageLimit[];
    history: {project: UsageHistory; branch: UsageHistory};
    budget: {
        organizationId: string | null;
        status: 'ready' | 'unavailable';
        reason?: UsageReason;
        limitCents: number | null;
        spentCents: null;
        currency: null;
        enforcement: 'notification_only';
    };
}
