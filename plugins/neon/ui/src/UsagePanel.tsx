import {useCallback, useEffect} from 'react';
import {usePluginTranslation} from '@tabularis/plugin-api';
import {PanelSection} from './components/PanelSection';
import {useNeonManagement} from './hooks/useNeonManagement';
import {useTask} from './hooks/useTask';
import {
    formatConsumption,
    formatLimitValue,
    formatUsageNumber,
    formatUsageTime,
    limitState,
    usageMetrics,
} from './utils/usage';
import type {UsageSnapshot, UsageLimit} from './types/usage';

export function UsagePanel({connectionId}: {connectionId: string}) {
    const t = usePluginTranslation('neon');
    const management = useNeonManagement(connectionId);
    const task = useTask<UsageSnapshot>();
    const {scope, call} = management;
    const {run} = task;
    const load = useCallback(
        () =>
            scope ? run(() => call<UsageSnapshot>('account_usage')) : Promise.resolve(undefined),
        [scope, run, call],
    );
    useEffect(() => {
        void Promise.resolve().then(load);
    }, [load]);
    const data =
        task.data?.project.id === scope?.projectId && task.data?.branch.id === scope?.branchId
            ? task.data
            : undefined;
    return (
        <PanelSection
            title={t('usage.title')}
            actions={
                scope && (
                    <button
                        type="button"
                        className="neon-button"
                        disabled={task.pending}
                        onClick={() => void load()}
                    >
                        {t('refresh')}
                    </button>
                )
            }
        >
            {management.pending || task.pending ? (
                <p className="neon-hint neon-pending" role="status">
                    {t('usage.loading')}
                </p>
            ) : !scope ? (
                <div className="neon-feedback">
                    <p>{t('usage.accountRequired')}</p>
                    <button
                        type="button"
                        className="neon-button"
                        onClick={management.connectAccount}
                    >
                        {t('usage.connectAccount')}
                    </button>
                </div>
            ) : task.error ? (
                <div>
                    <p className="neon-feedback neon-error" role="alert">
                        {task.error}
                    </p>
                    <button
                        type="button"
                        className="neon-button"
                        onClick={management.connectAccount}
                    >
                        {t('usage.connectAccount')}
                    </button>
                </div>
            ) : data ? (
                <UsageDetails data={data} />
            ) : task.data ? (
                <p className="neon-feedback neon-error" role="alert">
                    {t('usage.scopeMismatch')}
                </p>
            ) : (
                <p className="neon-hint neon-pending" role="status">
                    {t('usage.loading')}
                </p>
            )}
        </PanelSection>
    );
}

function UsageDetails({data}: {data: UsageSnapshot}) {
    const t = usePluginTranslation('neon');
    const locale = t('usage.locale') === 'de' ? 'de' : 'en';
    const unavailable = t('usage.unavailable');
    const date = (value: string | null) => formatUsageTime(value, locale) ?? unavailable;
    const logical = data.limits.find((row) => row.id === 'logical_size_bytes');
    const warnings = data.limits.filter((row) =>
        ['warning', 'exceeded'].includes(limitState(row).severity),
    );
    const budget =
        data.budget.status === 'ready'
            ? data.budget.limitCents === null
                ? t('usage.budgetNotSet')
                : `${formatUsageNumber(data.budget.limitCents, locale)} ${t('usage.cents')}`
            : unavailable;
    return (
        <div
            className="neon-usage"
            data-usage-project-id={data.project.id}
            data-usage-branch-id={data.branch.id}
        >
            <p className="neon-hint">
                {t('usage.scopeProject')}: <strong>{data.project.name}</strong> ·{' '}
                {t('usage.scopeBranch')}: <strong>{data.branch.name}</strong>
            </p>
            <p className="neon-hint">
                {t('usage.scopeOrganization')}:{' '}
                {data.organization.name ?? data.organization.id ?? unavailable} · {t('usage.plan')}:{' '}
                {data.organization.plan ?? unavailable}
            </p>
            <dl className="neon-summary-strip neon-usage-summary">
                <div>
                    <dt>
                        {t('usage.metrics.compute_unit_seconds')} · {t('usage.scopeProject')}
                    </dt>
                    <dd>
                        {formatConsumption(
                            'compute_unit_seconds',
                            data.history.project.values.compute_unit_seconds,
                            locale,
                        ) ?? unavailable}{' '}
                        {data.history.project.values.compute_unit_seconds !== null &&
                        data.history.project.values.compute_unit_seconds !== undefined
                            ? t('usage.units.cuHours')
                            : ''}
                    </dd>
                </div>
                <div>
                    <dt>{t('usage.branchData')}</dt>
                    <dd>
                        {logical
                            ? (formatLimitValue(logical.used, 'bytes', locale) ?? unavailable)
                            : unavailable}
                    </dd>
                </div>
                <div>
                    <dt>{t('usage.budgetTitle')}</dt>
                    <dd>{budget}</dd>
                </div>
            </dl>
            {data.history.project.status !== 'ready' && (
                <p className="neon-hint">
                    {t(
                        data.history.project.status === 'no_data'
                            ? 'usage.noData'
                            : `usage.reasons.${data.history.project.reason ?? 'request_failed'}`,
                    )}
                </p>
            )}
            <p className="neon-hint">
                {t('usage.billingPeriod')}: {date(data.billingPeriod.from)} —{' '}
                {date(data.billingPeriod.to)}
            </p>
            <p className="neon-hint">
                {t('usage.updated')}: {date(data.fetchedAt)}
            </p>
            {warnings.map((row) => (
                <p
                    key={row.id}
                    className={`neon-feedback ${limitState(row).severity === 'exceeded' ? 'neon-error' : 'neon-usage-warning'}`}
                    role="alert"
                >
                    {t(`usage.limits.${row.id}`)}:{' '}
                    {t(
                        limitState(row).severity === 'exceeded'
                            ? 'usage.exceeded'
                            : 'usage.warning',
                    )}
                </p>
            ))}
            <details className="neon-disclosure">
                <summary>{t('usage.limitsTitle')}</summary>
                <p className="neon-hint">{t('usage.quotaHint')}</p>
                {data.limits.map((row) => (
                    <LimitRow key={row.id} row={row} />
                ))}
            </details>
            <details className="neon-disclosure">
                <summary>{t('usage.historyTitle')}</summary>
                <p className="neon-hint">{t('usage.historyHint')}</p>
                {data.window && (
                    <p className="neon-hint">
                        {t('usage.apiWindow')}: {date(data.window.from)} — {date(data.window.to)} ·{' '}
                        {t(`usage.granularity.${data.window.granularity}`)}
                        {data.window.partial ? ` · ${t('usage.partial')}` : ''}
                    </p>
                )}
                {(['project', 'branch'] as const).map((scope) => (
                    <p key={scope} className="neon-hint">
                        {t(scope === 'project' ? 'usage.scopeProject' : 'usage.scopeBranch')}:{' '}
                        {data.history[scope].status === 'ready'
                            ? `${t('usage.reportedThrough')} ${date(data.history[scope].reportedThrough)}`
                            : t(
                                  data.history[scope].status === 'no_data'
                                      ? 'usage.noData'
                                      : `usage.reasons.${data.history[scope].reason ?? 'request_failed'}`,
                              )}
                    </p>
                ))}
                {/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The read-only overflow table needs a focus target for keyboard scrolling. */}
                <div
                    className="neon-usage-table focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    role="region"
                    aria-label={t('usage.historyTitle')}
                    tabIndex={0}
                >
                    <table>
                        <caption className="sr-only">{t('usage.historyTitle')}</caption>
                        <thead>
                            <tr>
                                <th scope="col">{t('usage.metric')}</th>
                                <th scope="col">{t('usage.scopeProject')}</th>
                                <th scope="col">{t('usage.scopeBranch')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {usageMetrics.map((metric) => (
                                <tr key={metric.id}>
                                    <th scope="row">
                                        {t(`usage.metrics.${metric.id}`)}
                                        <small>{t(`usage.units.${metric.unit}`)}</small>
                                    </th>
                                    <td>
                                        {formatConsumption(
                                            metric.id,
                                            data.history.project.values[metric.id],
                                            locale,
                                        ) ?? unavailable}
                                    </td>
                                    <td>
                                        {formatConsumption(
                                            metric.id,
                                            data.history.branch.values[metric.id],
                                            locale,
                                        ) ?? unavailable}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
            </details>
            <details className="neon-disclosure">
                <summary>{t('usage.costsTitle')}</summary>
                <dl className="neon-meta-list">
                    <div>
                        <dt>{t('usage.budgetTitle')}</dt>
                        <dd>{budget}</dd>
                    </div>
                    <div>
                        <dt>{t('usage.invoiceTotal')}</dt>
                        <dd>{unavailable}</dd>
                    </div>
                    <div>
                        <dt>{t('usage.remainingBudget')}</dt>
                        <dd>{unavailable}</dd>
                    </div>
                </dl>
                <p className="neon-hint">{t('usage.budgetHint')}</p>
                {data.budget.status === 'unavailable' && (
                    <p className="neon-hint">
                        {t(`usage.reasons.${data.budget.reason ?? 'request_failed'}`)}
                    </p>
                )}
                {data.budget.status === 'ready' && data.budget.limitCents !== null && (
                    <p className="neon-hint">{t('usage.currencyHint')}</p>
                )}
            </details>
            <p className="neon-hint">{t('usage.invoiceUnavailable')}</p>
            <details className="neon-disclosure">
                <summary>{t('usage.coverageTitle')}</summary>
                <p className="neon-hint">{t('usage.coverageHint')}</p>
            </details>
        </div>
    );
}

function LimitRow({row}: {row: UsageLimit}) {
    const t = usePluginTranslation('neon');
    const locale = t('usage.locale') === 'de' ? 'de' : 'en';
    const state = limitState(row);
    const unavailable = t('usage.unavailable');
    const value = (amount: number | null) =>
        formatLimitValue(amount, row.unit, locale) ?? unavailable;
    return (
        <div className="neon-usage-limit" data-tone={state.severity}>
            <div className="neon-section-header">
                <h4>{t(`usage.limits.${row.id}`)}</h4>
                <span className="neon-count">
                    {t(row.scope === 'project' ? 'usage.scopeProject' : 'usage.scopeBranch')} ·{' '}
                    {t(row.period === 'current' ? 'usage.currentSize' : 'usage.billingPeriod')}
                </span>
            </div>
            <dl className="neon-usage-values">
                <div>
                    <dt>{t('usage.used')}</dt>
                    <dd>{value(row.used)}</dd>
                </div>
                <div>
                    <dt>{t('usage.cap')}</dt>
                    <dd>
                        {row.limitStatus === 'finite'
                            ? value(row.limit)
                            : t(
                                  row.limitStatus === 'not_set'
                                      ? 'usage.capNotSet'
                                      : 'usage.unavailable',
                              )}
                    </dd>
                </div>
                <div>
                    <dt>{t('usage.remaining')}</dt>
                    <dd>{value(state.remaining)}</dd>
                </div>
            </dl>
            {state.percent !== null && (
                <div
                    className="neon-usage-meter"
                    role="progressbar"
                    aria-label={t(`usage.limits.${row.id}`)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={state.percent}
                    aria-valuetext={`${value(row.used)} / ${value(row.limit)}`}
                >
                    <span style={{width: `${state.percent}%`}} />
                </div>
            )}
        </div>
    );
}
