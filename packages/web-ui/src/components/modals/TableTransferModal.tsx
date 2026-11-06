import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ArrowRight, CheckCircle2, Loader2, TriangleAlert, X, XCircle} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {InlineBanner} from '@/components/ui/InlineBanner';
import {useAlert} from '@/hooks/useAlert';
import {useDatabase} from '@/hooks/useDatabase';
import {useProductionGuard} from '@/hooks/useProductionGuard';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {useTableTransferCapabilities} from '@/hooks/useTableTransferCapabilities';
import {DATABASE_TRANSFER_DEADLINE_MS} from '@/utils/databaseTransfers';
import {
    buildTransferRequest,
    isPlanBlocked,
    isTransferPair,
    issueMessageKey,
    mappingsFromPlan,
    progressPercent,
    summarizeResult,
    withMapping,
} from '@/utils/tableTransfer';
import type {
    TableTransferColumnMapping,
    TableTransferConflictMode,
    TableTransferPlan,
    TableTransferResult,
} from '@/api/contract';
import type {EventPayload} from '@/api/events';

interface TableTransferModalProps {
    isOpen: boolean;
    onClose: () => void;
    sourceConnectionId: string;
    sourceTable: string;
    sourceSchema?: string;
    sourceDatabase?: string;
}

type Step = 'target' | 'review' | 'run';

const FIELD_CLASS =
    'w-full bg-base border border-strong rounded-lg px-3 py-2 text-sm text-primary focus:border-focus focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50';
const PRIMARY_BUTTON_CLASS =
    'px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const GHOST_BUTTON_CLASS =
    'px-4 py-2 rounded-lg text-sm text-secondary hover:text-primary hover:bg-surface-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50';

function selectedDatabases(database: string | string[] | undefined): string[] {
    return Array.isArray(database) && database.length > 1 ? database : [];
}

export const TableTransferModal = ({
    isOpen,
    onClose,
    sourceConnectionId,
    sourceTable,
    sourceSchema,
    sourceDatabase,
}: TableTransferModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const {connections} = useDatabase();
    const {showAlert} = useAlert();
    const guardProductionWrite = useProductionGuard();
    const capabilities = useTableTransferCapabilities();
    const titleId = useId();
    const idPrefix = useId();

    const [step, setStep] = useState<Step>('target');
    const [targetConnectionId, setTargetConnectionId] = useState('');
    const [targetDatabase, setTargetDatabase] = useState('');
    const [schemas, setSchemas] = useState<string[]>([]);
    const [targetSchema, setTargetSchema] = useState('');
    const [targetTables, setTargetTables] = useState<string[]>([]);
    const [targetTable, setTargetTable] = useState('');
    const [targetColumns, setTargetColumns] = useState<string[]>([]);
    const [conflict, setConflict] = useState<TableTransferConflictMode>('fail');
    const [mappings, setMappings] = useState<TableTransferColumnMapping[]>([]);
    const [plan, setPlan] = useState<TableTransferPlan | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transferId, setTransferId] = useState<string | null>(null);
    const [progress, setProgress] = useState<EventPayload<'table_transfer_progress'> | null>(null);
    const [result, setResult] = useState<TableTransferResult | null>(null);
    const cancelRequested = useRef(false);

    const sourceDriver = connections.find((c) => c.id === sourceConnectionId)?.params.driver ?? '';
    const targetConnections = useMemo(
        () =>
            capabilities
                ? connections.filter((c) =>
                      isTransferPair(capabilities.pairs, sourceDriver, c.params.driver),
                  )
                : [],
        [capabilities, connections, sourceDriver],
    );
    const targetConnection = connections.find((c) => c.id === targetConnectionId);
    const databaseOptions = selectedDatabases(targetConnection?.params.database);
    const running = transferId !== null && result === null && step === 'run';

    const scope = useCallback(
        (connectionId: string, database: string, schema: string) => ({
            connectionId,
            ...(database ? {database} : {}),
            ...(schema ? {schema} : {}),
        }),
        [],
    );

    const loadTables = useCallback(
        async (connectionId: string, database: string, schema: string) => {
            const tables = await client.call('get_tables', scope(connectionId, database, schema));
            setTargetTables(tables.map((table) => table.name));
            setTargetTable('');
        },
        [client, scope],
    );

    const loadSchemas = useCallback(
        async (connectionId: string, database: string) => {
            const found = await client.call('get_schemas', scope(connectionId, database, ''));
            setSchemas(found);
            const chosen = found.includes('public') ? 'public' : (found[0] ?? '');
            setTargetSchema(chosen);
            await loadTables(connectionId, database, chosen);
        },
        [client, loadTables, scope],
    );

    const guarded = useCallback(async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (failure) {
            setError(String(failure));
        } finally {
            setBusy(false);
        }
    }, []);

    const onTargetConnection = (connectionId: string) =>
        guarded(async () => {
            setTargetConnectionId(connectionId);
            setSchemas([]);
            setTargetSchema('');
            setTargetTables([]);
            setTargetTable('');
            const connection = connections.find((c) => c.id === connectionId);
            if (!connection) return;
            const databases = selectedDatabases(connection.params.database);
            const database = databases[0] ?? '';
            setTargetDatabase(database);
            await loadSchemas(connectionId, database);
        });

    const onTargetDatabase = (database: string) =>
        guarded(async () => {
            setTargetDatabase(database);
            await loadSchemas(targetConnectionId, database);
        });

    const onTargetSchema = (schema: string) =>
        guarded(async () => {
            setTargetSchema(schema);
            await loadTables(targetConnectionId, targetDatabase, schema);
        });

    const requestFor = useCallback(
        (columns: TableTransferColumnMapping[], id?: string) =>
            buildTransferRequest({
                sourceConnectionId,
                sourceDatabase,
                sourceSchema,
                targetConnectionId,
                targetDatabase,
                targetSchema,
                sourceTable,
                targetTable,
                columns,
                conflict,
                transferId: id,
            }),
        [
            conflict,
            sourceConnectionId,
            sourceDatabase,
            sourceSchema,
            sourceTable,
            targetConnectionId,
            targetDatabase,
            targetSchema,
            targetTable,
        ],
    );

    const planWith = (columns: TableTransferColumnMapping[], pin: boolean) =>
        guarded(async () => {
            const next = await client.call('plan_table_transfer', {request: requestFor(columns)});
            setPlan(next);
            if (pin) setMappings(mappingsFromPlan(next.tables[0]?.columns ?? []));
            else setMappings(columns);
            if (targetColumns.length === 0) {
                const found = await client.call('get_columns', {
                    ...scope(targetConnectionId, targetDatabase, targetSchema),
                    tableName: targetTable,
                });
                setTargetColumns(found.map((column) => column.name));
            }
            setStep('review');
        });

    const onMapColumn = (sourceColumn: string, targetColumn: string | null) =>
        planWith(withMapping(mappings, sourceColumn, targetColumn), false);

    const startTransfer = async () => {
        if (isPlanBlocked(plan)) return;
        if (!(await guardProductionWrite(targetConnectionId))) return;
        const id = crypto.randomUUID();
        cancelRequested.current = false;
        setTransferId(id);
        setProgress(null);
        setResult(null);
        setError(null);
        setStep('run');
        try {
            const outcome = await client.call(
                'run_table_transfer',
                {request: requestFor(mappings, id)},
                {deadlineMs: DATABASE_TRANSFER_DEADLINE_MS, cancellationId: crypto.randomUUID()},
            );
            setResult(outcome);
            if (outcome.status === 'completed')
                showAlert(t('tableTransfer.success'), {kind: 'info'});
        } catch (failure) {
            setError(String(failure));
            setTransferId(null);
            setStep('review');
        }
    };

    const cancelTransfer = useCallback(async () => {
        if (!transferId || cancelRequested.current) return;
        cancelRequested.current = true;
        try {
            await client.call('cancel_table_transfer', {transferId});
        } catch (failure) {
            cancelRequested.current = false;
            setError(String(failure));
        }
    }, [client, transferId]);

    const handleClose = () => {
        if (running) {
            void cancelTransfer();
            return;
        }
        onClose();
    };

    useEffect(() => {
        if (!isOpen || !transferId) return;
        const subscription = client.subscribe('table_transfer_progress', (update) => {
            if (update.transfer_id === transferId) setProgress(update);
        });
        return () => {
            void subscription.then((unsubscribe) => unsubscribe());
        };
    }, [client, isOpen, transferId]);

    if (!isOpen) return null;

    const tablePlan = plan?.tables[0];
    const issues = [...(plan?.issues ?? []), ...(tablePlan?.issues ?? [])];
    const blocked = isPlanBlocked(plan);
    const summary = result ? summarizeResult(result) : null;
    const tableResult = result?.tables[0];
    const percent = progress
        ? progressPercent(progress.rows_written + progress.rows_skipped, progress.estimated_rows)
        : null;
    const canReview = targetConnectionId !== '' && targetTable !== '' && !busy;

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            overlayClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[760px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div>
                        <h2 id={titleId} className="text-lg font-semibold text-primary">
                            {t('tableTransfer.title')}
                        </h2>
                        <p className="text-xs text-secondary font-mono flex items-center gap-1.5">
                            {sourceTable}
                            <ArrowRight size={12} aria-hidden="true" />
                            {targetTable || '…'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 overflow-y-auto flex flex-col gap-4">
                    <InlineBanner tone="neutral" icon={<TriangleAlert size={14} />}>
                        {t('tableTransfer.appendOnly')}
                    </InlineBanner>

                    {step === 'target' && (
                        <div className="flex flex-col gap-3">
                            <label className="flex flex-col gap-1 text-xs font-semibold text-muted uppercase">
                                {t('tableTransfer.targetConnection')}
                                <select
                                    className={FIELD_CLASS}
                                    value={targetConnectionId}
                                    disabled={busy}
                                    onChange={(event) =>
                                        void onTargetConnection(event.target.value)
                                    }
                                >
                                    <option value="">{t('tableTransfer.selectPlaceholder')}</option>
                                    {targetConnections.map((connection) => (
                                        <option key={connection.id} value={connection.id}>
                                            {connection.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {capabilities && targetConnections.length === 0 && (
                                <p className="text-xs text-muted">{t('tableTransfer.noTargets')}</p>
                            )}
                            {databaseOptions.length > 0 && (
                                <label className="flex flex-col gap-1 text-xs font-semibold text-muted uppercase">
                                    {t('tableTransfer.targetDatabase')}
                                    <select
                                        className={FIELD_CLASS}
                                        value={targetDatabase}
                                        disabled={busy}
                                        onChange={(event) =>
                                            void onTargetDatabase(event.target.value)
                                        }
                                    >
                                        {databaseOptions.map((database) => (
                                            <option key={database} value={database}>
                                                {database}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {schemas.length > 0 && (
                                <label className="flex flex-col gap-1 text-xs font-semibold text-muted uppercase">
                                    {t('tableTransfer.targetSchema')}
                                    <select
                                        className={FIELD_CLASS}
                                        value={targetSchema}
                                        disabled={busy}
                                        onChange={(event) =>
                                            void onTargetSchema(event.target.value)
                                        }
                                    >
                                        {schemas.map((schema) => (
                                            <option key={schema} value={schema}>
                                                {schema}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {targetConnectionId !== '' && (
                                <label className="flex flex-col gap-1 text-xs font-semibold text-muted uppercase">
                                    {t('tableTransfer.targetTable')}
                                    <select
                                        className={FIELD_CLASS}
                                        value={targetTable}
                                        disabled={busy}
                                        onChange={(event) => {
                                            setTargetTable(event.target.value);
                                            setTargetColumns([]);
                                        }}
                                    >
                                        <option value="">
                                            {t('tableTransfer.selectPlaceholder')}
                                        </option>
                                        {targetTables.map((table) => (
                                            <option key={table} value={table}>
                                                {table}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {targetConnectionId !== '' && !busy && targetTables.length === 0 && (
                                <p className="text-xs text-muted">{t('tableTransfer.noTables')}</p>
                            )}
                        </div>
                    )}

                    {step === 'review' && plan && tablePlan && (
                        <div className="flex flex-col gap-4">
                            {issues.length > 0 && (
                                <div role="alert">
                                    <InlineBanner tone="red" icon={<XCircle size={14} />}>
                                        <div className="flex flex-col gap-1">
                                            <strong>{t('tableTransfer.blocked')}</strong>
                                            <ul className="list-disc pl-4">
                                                {issues.map((issue) => (
                                                    <li key={`${issue.code}:${issue.column ?? ''}`}>
                                                        {t(issueMessageKey(issue.code))}
                                                        {issue.column && (
                                                            <span className="font-mono">
                                                                {' '}
                                                                ({issue.column})
                                                            </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </InlineBanner>
                                </div>
                            )}
                            <div className="border border-default rounded-lg overflow-auto max-h-[320px]">
                                <table className="w-full text-left text-xs">
                                    <caption className="sr-only">
                                        {t('tableTransfer.mapping')}
                                    </caption>
                                    <thead className="bg-base text-muted sticky top-0">
                                        <tr>
                                            <th scope="col" className="p-2">
                                                {t('tableTransfer.sourceColumn')}
                                            </th>
                                            <th scope="col" className="p-2">
                                                {t('tableTransfer.sourceType')}
                                            </th>
                                            <th scope="col" className="p-2">
                                                {t('tableTransfer.targetColumn')}
                                            </th>
                                            <th scope="col" className="p-2">
                                                {t('tableTransfer.targetType')}
                                            </th>
                                            <th scope="col" className="p-2">
                                                {t('tableTransfer.conversion')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tablePlan.columns.map((column) => (
                                            <tr
                                                key={column.sourceColumn}
                                                className="border-t border-default"
                                            >
                                                <td className="p-2 font-mono text-primary">
                                                    {column.sourceColumn}
                                                </td>
                                                <td className="p-2 font-mono text-secondary">
                                                    {column.sourceType}
                                                </td>
                                                <td className="p-2">
                                                    <select
                                                        aria-label={t(
                                                            'tableTransfer.targetColumnFor',
                                                            {
                                                                column: column.sourceColumn,
                                                            },
                                                        )}
                                                        className={FIELD_CLASS}
                                                        value={
                                                            column.skipped
                                                                ? ''
                                                                : (column.targetColumn ?? '')
                                                        }
                                                        disabled={busy}
                                                        onChange={(event) =>
                                                            void onMapColumn(
                                                                column.sourceColumn,
                                                                event.target.value === ''
                                                                    ? null
                                                                    : event.target.value,
                                                            )
                                                        }
                                                    >
                                                        <option value="">
                                                            {t('tableTransfer.skipColumn')}
                                                        </option>
                                                        {targetColumns.map((name) => (
                                                            <option key={name} value={name}>
                                                                {name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="p-2 font-mono text-secondary">
                                                    {column.targetType ?? '—'}
                                                </td>
                                                <td className="p-2">
                                                    {column.issue ? (
                                                        <span className="text-accent-error">
                                                            {t(issueMessageKey(column.issue))}
                                                        </span>
                                                    ) : column.rule ? (
                                                        <span
                                                            className="text-secondary"
                                                            title={t(
                                                                `tableTransfer.rule.${column.rule}Hint`,
                                                            )}
                                                        >
                                                            {t(`tableTransfer.rule.${column.rule}`)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted">
                                                            {t('tableTransfer.skipped')}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <fieldset className="flex flex-col gap-2">
                                <legend className="text-xs font-semibold text-muted uppercase mb-1">
                                    {t('tableTransfer.conflictLabel')}
                                </legend>
                                {(['fail', 'skip'] as const).map((mode) => (
                                    <label
                                        key={mode}
                                        className="flex items-start gap-2 text-sm text-primary"
                                    >
                                        <input
                                            type="radio"
                                            name={`${idPrefix}-conflict`}
                                            checked={conflict === mode}
                                            onChange={() => setConflict(mode)}
                                            className="mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                        />
                                        <span>
                                            {t(`tableTransfer.conflict.${mode}`)}
                                            <span className="block text-xs text-muted">
                                                {t(`tableTransfer.conflict.${mode}Hint`)}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                            {tablePlan.estimatedRows !== null && (
                                <p className="text-xs text-muted">
                                    {t('tableTransfer.estimatedRows', {
                                        count: tablePlan.estimatedRows.toLocaleString(),
                                    })}
                                </p>
                            )}
                        </div>
                    )}

                    {step === 'run' && (
                        <div className="flex flex-col gap-3" aria-live="polite">
                            {running && (
                                <>
                                    <div className="flex items-center gap-2 text-sm text-secondary">
                                        <Loader2 size={16} className="animate-spin" />
                                        {t('tableTransfer.running')}
                                    </div>
                                    <div
                                        role="progressbar"
                                        aria-label={t('tableTransfer.running')}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={percent ?? undefined}
                                        className="w-full bg-surface-secondary rounded-full h-2 overflow-hidden border border-default"
                                    >
                                        <div
                                            className={`h-full bg-accent-primary transition-all ${percent === null ? 'animate-pulse w-full' : ''}`}
                                            style={
                                                percent === null
                                                    ? undefined
                                                    : {width: `${percent}%`}
                                            }
                                        />
                                    </div>
                                    <p className="text-xs text-muted">
                                        {t('tableTransfer.progress', {
                                            written: (progress?.rows_written ?? 0).toLocaleString(),
                                            skipped: (progress?.rows_skipped ?? 0).toLocaleString(),
                                        })}
                                    </p>
                                </>
                            )}
                            {summary && tableResult && (
                                <div className="flex flex-col gap-2 text-sm">
                                    <div
                                        className={`flex items-center gap-2 font-medium ${summary.status === 'completed' ? 'text-accent-success' : 'text-accent-error'}`}
                                    >
                                        {summary.status === 'completed' ? (
                                            <CheckCircle2 size={18} />
                                        ) : (
                                            <XCircle size={18} />
                                        )}
                                        {t(`tableTransfer.status.${summary.status}`)}
                                    </div>
                                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                                        <dt className="text-muted">
                                            {t('tableTransfer.rowsWritten')}
                                        </dt>
                                        <dd className="font-mono text-primary">
                                            {summary.rowsWritten.toLocaleString()}
                                        </dd>
                                        <dt className="text-muted">
                                            {t('tableTransfer.rowsSkipped')}
                                        </dt>
                                        <dd className="font-mono text-primary">
                                            {summary.rowsSkipped.toLocaleString()}
                                        </dd>
                                        <dt className="text-muted">
                                            {t('tableTransfer.rowsFailed')}
                                        </dt>
                                        <dd className="font-mono text-primary">
                                            {summary.rowsFailed.toLocaleString()}
                                        </dd>
                                    </dl>
                                    {summary.leavesCommittedRows && (
                                        <InlineBanner
                                            tone="amber"
                                            role="status"
                                            icon={<TriangleAlert size={14} />}
                                        >
                                            {t('tableTransfer.committedRemain', {
                                                count: summary.rowsWritten.toLocaleString(),
                                            })}
                                        </InlineBanner>
                                    )}
                                    {tableResult.error && (
                                        <pre className="max-h-40 overflow-y-auto bg-accent-error/5 border border-accent-error/20 rounded-lg p-3 text-xs text-accent-error font-mono whitespace-pre-wrap break-words">
                                            {tableResult.error}
                                        </pre>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {error && (
                        <div
                            role="alert"
                            className="text-xs text-accent-error font-mono whitespace-pre-wrap break-words"
                        >
                            {error}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-2">
                    {step === 'target' && (
                        <>
                            <button type="button" className={GHOST_BUTTON_CLASS} onClick={onClose}>
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                className={PRIMARY_BUTTON_CLASS}
                                disabled={!canReview}
                                onClick={() => void planWith([], true)}
                            >
                                {busy && <Loader2 size={14} className="animate-spin" />}
                                {t('tableTransfer.review')}
                            </button>
                        </>
                    )}
                    {step === 'review' && (
                        <>
                            <button
                                type="button"
                                className={GHOST_BUTTON_CLASS}
                                disabled={busy}
                                onClick={() => setStep('target')}
                            >
                                {t('common.back')}
                            </button>
                            <button
                                type="button"
                                className={PRIMARY_BUTTON_CLASS}
                                disabled={blocked || busy}
                                onClick={() => void startTransfer()}
                            >
                                {t('tableTransfer.start')}
                            </button>
                        </>
                    )}
                    {step === 'run' &&
                        (running ? (
                            <button
                                type="button"
                                className="px-4 py-2 bg-accent-error hover:bg-accent-error/90 text-on-accent-error rounded-lg text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                onClick={() => void cancelTransfer()}
                            >
                                {t('common.cancel')}
                            </button>
                        ) : (
                            <button
                                type="button"
                                className={PRIMARY_BUTTON_CLASS}
                                onClick={onClose}
                            >
                                {t('common.close')}
                            </button>
                        ))}
                </div>
            </div>
        </Modal>
    );
};
