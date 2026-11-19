import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router-dom';
import {
    X,
    Network,
    Loader2,
    KeyRound,
    Eye,
    History,
    ExternalLink,
    Copy,
    RotateCw,
    Square,
} from 'lucide-react';
import clsx from 'clsx';
import {Modal} from '@/components/ui/Modal';
import {SqlMatchExcerpt} from '@/components/ui/SqlMatchExcerpt';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {useDatabaseObjectNavigation} from '@/hooks/useDatabaseObjectNavigation';
import {useDatabase} from '@/hooks/useDatabase';
import {copyTextToClipboard} from '@/utils/clipboard';
import {openEditor} from '@/utils/editorNavigation';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';
import {
    collectColumnUsage,
    failPendingSources,
    formatColumnUsageSummary,
    formatUsageTarget,
    isFailedRun,
    isUsageComplete,
    sortEvidence,
    type ColumnUsageEvidence,
    type ColumnUsageLookups,
    type ColumnUsageResult,
    type UsageSourceKind,
    type UsageSourceStatus,
} from '@/utils/columnUsageCollector';
import type {ColumnUsageConfidence, ColumnUsageTarget} from '@/utils/columnUsage';
import type {DriverCapabilities} from '@/types/plugins';

interface ColumnUsageModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    driver: string;
    capabilities?: DriverCapabilities | null;
    table: string;
    column: string;
    schema?: string;
    database?: string;
}

const SOURCES: UsageSourceKind[] = ['foreignKeys', 'views', 'history'];
const GROUPS: ColumnUsageConfidence[] = ['confirmed', 'parsed', 'uncertain'];

const STATUS_TONE: Record<UsageSourceStatus, string> = {
    pending: 'text-muted',
    complete: 'text-accent-success',
    partial: 'text-accent-warning',
    unsupported: 'text-muted',
    'permission-denied': 'text-accent-error',
    failed: 'text-accent-error',
    cancelled: 'text-accent-warning',
};

const focusRing =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const ColumnUsageModal = ({
    isOpen,
    onClose,
    connectionId,
    driver,
    capabilities,
    table,
    column,
    schema,
    database,
}: ColumnUsageModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const navigate = useNavigate();
    const {connections} = useDatabase();
    const objectNavigation = useDatabaseObjectNavigation(connectionId, capabilities ?? driver);
    const titleId = useId();
    const [result, setResult] = useState<ColumnUsageResult | null>(null);
    const [run, setRun] = useState(0);
    const [copyStatus, setCopyStatus] = useState<'copied' | 'copyFailed' | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    const target = useMemo<ColumnUsageTarget>(
        () => ({
            table,
            column,
            ...(schema ? {schema} : {}),
            ...(database ? {database} : {}),
        }),
        [table, column, schema, database],
    );
    const viewsSupported = capabilities?.views !== false;
    const dialect = useMemo(
        () => (capabilities ? resolveSqlSyntax(capabilities) : driver),
        [capabilities, driver],
    );

    useEffect(() => {
        if (!isOpen) return;
        const scope = {
            connectionId,
            ...(schema ? {schema} : {}),
            ...(database ? {database} : {}),
        };
        const lookups: ColumnUsageLookups = {
            getForeignKeys: () => client.call('get_foreign_keys', {...scope, tableName: table}),
            getSchemaSnapshot: () => client.call('get_schema_snapshot', scope),
            getViews: () => client.call('get_views', scope),
            getViewDefinition: (viewName) =>
                client.call('get_view_definition', {...scope, viewName}),
            getHistory: () =>
                client.call('get_query_history', {connectionId}).then((r) => r.entries),
        };
        const controller = new AbortController();
        controllerRef.current = controller;
        collectColumnUsage(lookups, {
            target,
            dialect,
            viewsSupported,
            signal: controller.signal,
            onProgress: (progress) => {
                if (controllerRef.current === controller) setResult(progress);
            },
        })
            .then((final) => {
                if (controllerRef.current === controller) setResult(final);
            })
            .catch((error: unknown) => {
                // An unexpected throw (lookup errors are handled inside):
                // never leave the panel searching with Stop on screen.
                if (controllerRef.current === controller) {
                    setResult((current) => failPendingSources(current, error));
                }
            });
        return () => controller.abort();
    }, [
        client,
        connectionId,
        database,
        dialect,
        isOpen,
        run,
        schema,
        table,
        target,
        viewsSupported,
    ]);

    if (!isOpen) return null;

    const running = !result || SOURCES.some((key) => result.sources[key].status === 'pending');
    const evidence = result ? sortEvidence(result.evidence) : [];
    const connectionName = connections.find((c) => c.id === connectionId)?.name ?? connectionId;

    const restart = () => {
        setResult(null);
        setCopyStatus(null);
        setRun((n) => n + 1);
    };

    const copySummary = async () => {
        if (!result) return;
        try {
            await copyTextToClipboard(formatColumnUsageSummary(target, result, t));
            setCopyStatus('copied');
        } catch {
            setCopyStatus('copyFailed');
        }
    };

    const openEvidence = (item: ColumnUsageEvidence) => {
        if (item.source === 'history' && item.historyEntry) {
            openEditor(navigate, {
                kind: 'console',
                initialQuery: item.historyEntry.sql,
                preventAutoRun: true,
                ...(item.historyEntry.database ? {database: item.historyEntry.database} : {}),
                targetConnectionId: connectionId,
            });
        } else if (item.objectName) {
            objectNavigation?.open(
                item.objectName,
                item.objectSchema ?? schema,
                undefined,
                database,
            );
        }
        onClose();
    };

    const evidenceTitle = (item: ColumnUsageEvidence): string => {
        if (item.source === 'foreign-key') {
            return t(
                item.direction === 'outgoing' ? 'columnUsage.fkOutgoing' : 'columnUsage.fkIncoming',
                {object: item.objectName, column: item.relatedColumn},
            );
        }
        if (item.source === 'view') return t('columnUsage.viewTitle', {view: item.objectName});
        const date = item.historyEntry ? new Date(item.historyEntry.executedAt) : null;
        return t('columnUsage.historyTitle', {
            date: date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '',
        });
    };

    const SourceIcon = ({item}: {item: ColumnUsageEvidence}) => {
        const Icon =
            item.source === 'foreign-key' ? KeyRound : item.source === 'view' ? Eye : History;
        return (
            <Icon
                size={14}
                aria-hidden="true"
                className={clsx(
                    'shrink-0 mt-0.5',
                    item.source === 'foreign-key' ? 'text-semantic-fk' : 'text-muted',
                )}
            />
        );
    };

    const buttonClass = `px-3 py-2 text-sm text-secondary hover:text-primary border border-strong rounded-lg flex items-center gap-2 disabled:opacity-50 ${focusRing}`;

    return (
        <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[720px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <Network size={20} className="text-accent" />
                        </div>
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-lg font-semibold text-primary">
                                {t('columnUsage.title')}
                            </h2>
                            <p className="text-xs text-secondary font-mono break-all">
                                {formatUsageTarget(target)}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        onClick={onClose}
                        className={`p-1 text-secondary hover:text-primary rounded ${focusRing}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                    <div className="bg-surface-secondary/50 p-3 rounded-lg border border-strong space-y-2">
                        <p className="text-xs text-secondary leading-relaxed">
                            {t('columnUsage.boundary')}
                        </p>
                        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <div className="flex gap-1">
                                <dt className="text-muted">{t('columnUsage.scopeConnection')}</dt>
                                <dd className="text-primary font-mono">{connectionName}</dd>
                            </div>
                            {database && (
                                <div className="flex gap-1">
                                    <dt className="text-muted">{t('columnUsage.scopeDatabase')}</dt>
                                    <dd className="text-primary font-mono">{database}</dd>
                                </div>
                            )}
                            {schema && (
                                <div className="flex gap-1">
                                    <dt className="text-muted">{t('columnUsage.scopeSchema')}</dt>
                                    <dd className="text-primary font-mono">{schema}</dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    <section aria-labelledby={`${titleId}-sources`}>
                        <h3
                            id={`${titleId}-sources`}
                            className="text-xs uppercase font-bold text-muted mb-2"
                        >
                            {t('columnUsage.sources')}
                        </h3>
                        <ul className="space-y-1" aria-live="polite">
                            {SOURCES.map((key) => {
                                const source = result?.sources[key] ?? {
                                    status: 'pending' as const,
                                    scanned: 0,
                                    total: null,
                                };
                                return (
                                    <li
                                        key={key}
                                        className="flex items-start justify-between gap-3 text-sm"
                                    >
                                        <span className="text-primary">
                                            {t(`columnUsage.source.${key}`)}
                                        </span>
                                        <span
                                            className={clsx(
                                                'text-xs text-right flex items-center gap-1',
                                                STATUS_TONE[source.status],
                                            )}
                                            title={source.message}
                                        >
                                            {source.status === 'pending' && (
                                                <Loader2 size={12} className="animate-spin" />
                                            )}
                                            {t(`columnUsage.status.${source.status}`, {
                                                scanned: source.scanned,
                                                total: source.total ?? '?',
                                            })}
                                            {source.message && source.status !== 'complete' && (
                                                <span className="text-muted font-mono break-all">
                                                    {` (${source.message})`}
                                                </span>
                                            )}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>

                    {GROUPS.map((group) => {
                        const items = evidence.filter((item) => item.confidence === group);
                        const headingId = `${titleId}-${group}`;
                        return (
                            <section key={group} aria-labelledby={headingId}>
                                <h3
                                    id={headingId}
                                    className="text-xs uppercase font-bold text-muted"
                                >
                                    {t(`columnUsage.confidence.${group}`)}{' '}
                                    <span className="normal-case font-normal">
                                        ({items.length})
                                    </span>
                                </h3>
                                <p className="text-xs text-muted mb-2">
                                    {t(`columnUsage.confidenceHint.${group}`)}
                                </p>
                                {items.length === 0 ? (
                                    <p className="text-xs text-muted italic">
                                        {running
                                            ? t('columnUsage.status.pending')
                                            : t('columnUsage.groupEmpty')}
                                    </p>
                                ) : (
                                    <ul className="space-y-2">
                                        {items.map((item) => (
                                            <li
                                                key={item.id}
                                                className="flex items-start gap-2 bg-base p-3 rounded-lg border border-default"
                                            >
                                                <SourceIcon item={item} />
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <div className="text-sm text-primary break-all">
                                                        {evidenceTitle(item)}
                                                        {item.constraintName && (
                                                            <span className="text-xs text-muted font-mono">
                                                                {` ${item.constraintName}`}
                                                            </span>
                                                        )}
                                                        {isFailedRun(item) && (
                                                            <span className="ml-2 px-1.5 py-0.5 text-[10px] uppercase font-semibold rounded bg-accent-error/15 text-accent-error">
                                                                {t('columnUsage.failedRun')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isFailedRun(item) &&
                                                        item.historyEntry?.error && (
                                                            <div className="text-xs text-accent-error font-mono break-all line-clamp-3">
                                                                {item.historyEntry.error}
                                                            </div>
                                                        )}
                                                    {item.reason && (
                                                        <div className="text-xs text-accent-warning">
                                                            {t(`columnUsage.reason.${item.reason}`)}
                                                        </div>
                                                    )}
                                                    {item.snippet && (
                                                        <SqlMatchExcerpt excerpt={item.snippet} />
                                                    )}
                                                    {item.matchCount !== undefined &&
                                                        item.matchCount > 1 && (
                                                            <div className="text-xs text-muted">
                                                                {t('columnUsage.matchCount', {
                                                                    count: item.matchCount,
                                                                })}
                                                            </div>
                                                        )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => openEvidence(item)}
                                                    aria-label={t('columnUsage.openAria', {
                                                        name: evidenceTitle(item),
                                                    })}
                                                    className={`shrink-0 px-2 py-1 text-xs text-accent hover:text-primary rounded flex items-center gap-1 ${focusRing}`}
                                                >
                                                    <ExternalLink size={12} aria-hidden="true" />
                                                    {item.source === 'history'
                                                        ? t('columnUsage.openHistory')
                                                        : t('columnUsage.open')}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        );
                    })}

                    {result && !running && evidence.length === 0 && (
                        <p className="text-sm text-secondary">
                            {isUsageComplete(result)
                                ? t('columnUsage.none')
                                : t('columnUsage.noneIncomplete')}
                        </p>
                    )}
                    {result && !running && evidence.length > 0 && !isUsageComplete(result) && (
                        <p className="text-xs text-accent-warning">
                            {t('columnUsage.incompleteNote')}
                        </p>
                    )}
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted" role="status">
                        {copyStatus ? t(`columnUsage.${copyStatus}`) : ''}
                    </span>
                    <div className="flex gap-2">
                        {running ? (
                            <button
                                type="button"
                                onClick={() => controllerRef.current?.abort()}
                                className={buttonClass}
                            >
                                <Square size={14} aria-hidden="true" />
                                {t('columnUsage.cancel')}
                            </button>
                        ) : (
                            <button type="button" onClick={restart} className={buttonClass}>
                                <RotateCw size={14} aria-hidden="true" />
                                {t('columnUsage.rerun')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void copySummary()}
                            disabled={!result || running}
                            className={buttonClass}
                        >
                            <Copy size={14} aria-hidden="true" />
                            {t('columnUsage.copySummary')}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            autoFocus
                            className={`px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium ${focusRing}`}
                        >
                            {t('common.close')}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
