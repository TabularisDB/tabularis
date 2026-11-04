import type {MetricId, UsageLimit} from '../types/usage';

export const usageMetrics: ReadonlyArray<{id: MetricId; divisor: number; unit: string}> = [
    {id: 'compute_unit_seconds', divisor: 3600, unit: 'cuHours'},
    {id: 'root_branch_bytes_month', divisor: 1e9, unit: 'gbMonths'},
    {id: 'child_branch_bytes_month', divisor: 1e9, unit: 'gbMonths'},
    {id: 'instant_restore_bytes_month', divisor: 1e9, unit: 'gbMonths'},
    {id: 'snapshot_storage_bytes_month', divisor: 1e9, unit: 'gbMonths'},
    {id: 'public_network_transfer_bytes', divisor: 1e9, unit: 'gb'},
    {id: 'private_network_transfer_bytes', divisor: 1e9, unit: 'gb'},
    {id: 'extra_branches_month', divisor: 1, unit: 'branchMonths'},
    {id: 'functions_active_capacity_microseconds', divisor: 1e6, unit: 'capacitySeconds'},
    {id: 'functions_waiting_capacity_microseconds', divisor: 1e6, unit: 'capacitySeconds'},
    {id: 'functions_invocations', divisor: 1, unit: 'invocations'},
    {id: 'functions_egress_bytes', divisor: 1e9, unit: 'gb'},
];

export function formatUsageNumber(value: number, locale: string): string {
    return new Intl.NumberFormat(
        locale,
        Number.isInteger(value) ? {maximumFractionDigits: 0} : {maximumSignificantDigits: 5},
    ).format(value);
}
export function formatLimitValue(
    value: number | null,
    unit: UsageLimit['unit'],
    locale: string,
): string | undefined {
    if (value === null || !Number.isFinite(value) || value < 0) return undefined;
    if (unit === 'seconds') return `${formatUsageNumber(value / 3600, locale)} h`;
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const power =
        value > 0 ? Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
    return `${formatUsageNumber(value / 1024 ** power, locale)} ${units[power]}`;
}
export function formatConsumption(
    id: MetricId,
    value: number | null | undefined,
    locale: string,
): string | undefined {
    if (value === null || value === undefined || !Number.isFinite(value) || value < 0)
        return undefined;
    return formatUsageNumber(
        value / (usageMetrics.find((metric) => metric.id === id)?.divisor ?? 1),
        locale,
    );
}
export function formatUsageTime(value: string | null, locale: string): string | undefined {
    if (!value || !Number.isFinite(Date.parse(value))) return undefined;
    return `${new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'}).format(new Date(value))} UTC`;
}
export function limitState({
    used,
    limit,
    limitStatus,
}: Pick<UsageLimit, 'used' | 'limit' | 'limitStatus'>): {
    severity: 'unknown' | 'normal' | 'warning' | 'exceeded';
    percent: number | null;
    remaining: number | null;
} {
    if (
        limitStatus !== 'finite' ||
        used === null ||
        limit === null ||
        !Number.isFinite(used) ||
        !Number.isFinite(limit) ||
        limit <= 0 ||
        used < 0
    )
        return {severity: 'unknown', percent: null, remaining: null};
    const ratio = used / limit;
    return {
        severity: ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : 'normal',
        percent: Math.min(100, ratio * 100),
        remaining: Math.max(0, limit - used),
    };
}
