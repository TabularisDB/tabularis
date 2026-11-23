import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {History, Loader2, Trash2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {ConfirmModal} from '@/components/modals/ConfirmModal';
import {useAlert} from '@/hooks/useAlert';
import {useProductionGuard} from '@/hooks/useProductionGuard';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import type {
    CellImage,
    RestorePlan,
    RestorePlanStatus,
    SaveHistoryStatus,
    SaveRecord,
} from '@/types/saveHistory';
import {
    canApplyRestore,
    describeCellImage,
    formatRecordKey,
    nonRestorableReasonKey,
    planStatusKey,
} from '@/utils/saveHistory';

interface SaveHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    table: string;
    schema?: string;
    database?: string;
    /** Called after values were written back, so the grid can reload. */
    onRestored?: () => void;
}

interface HistoryData {
    key: string;
    status: SaveHistoryStatus;
    records: SaveRecord[];
}

const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const BANNER_CLASS: Record<RestorePlanStatus, string> = {
    ready: 'text-accent-success bg-accent-success/10 border-accent-success/25',
    restored: 'text-accent-success bg-accent-success/10 border-accent-success/25',
    conflict: 'text-accent-warning bg-accent-warning/10 border-accent-warning/30',
    row_missing: 'text-accent-warning bg-accent-warning/10 border-accent-warning/30',
    not_restorable: 'text-secondary bg-surface-secondary border-default',
    already_restored: 'text-secondary bg-surface-secondary border-default',
    target_changed: 'text-accent-warning bg-accent-warning/10 border-accent-warning/30',
};

const CellValue = ({image, conflict = false}: {image: CellImage | null; conflict?: boolean}) => {
    const {t} = useTranslation();
    const view = describeCellImage(image, {
        nullLabel: t('saveHistory.plan.nullValue'),
        omittedLabel: t('saveHistory.plan.notCaptured'),
        missingLabel: t('saveHistory.plan.unavailable'),
    });
    const tone =
        view.kind === 'text'
            ? conflict
                ? 'text-accent-warning'
                : 'text-primary'
            : 'italic text-muted';
    return (
        <span className={`font-mono text-xs break-all whitespace-pre-wrap ${tone}`}>
            {view.text}
        </span>
    );
};

export const SaveHistoryModal = ({
    isOpen,
    onClose,
    connectionId,
    table,
    schema,
    database,
    onRestored,
}: SaveHistoryModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const {showAlert} = useAlert();
    const guardProductionWrite = useProductionGuard();
    const titleId = useId();
    const recordingId = useId();

    const requestKey = `${connectionId}|${table}|${schema ?? ''}|${database ?? ''}`;
    const [data, setData] = useState<HistoryData | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [planState, setPlanState] = useState<RestorePlan | null>(null);
    const [planFailed, setPlanFailed] = useState<string | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [clearOpen, setClearOpen] = useState(false);

    const failure = useCallback(
        (prefix: string, error: unknown) =>
            showAlert(t(prefix) + String(error), {title: t('common.error'), kind: 'error'}),
        [showAlert, t],
    );

    // Responses of superseded requests are dropped.
    const loadGeneration = useRef(0);
    const planGeneration = useRef(0);

    const reload = useCallback(async () => {
        const generation = ++loadGeneration.current;
        try {
            const [status, records] = await Promise.all([
                client.call('get_save_history_status', {connectionId}),
                client.call('list_save_history', {
                    connectionId,
                    table,
                    ...(schema ? {schema} : {}),
                    ...(database ? {database} : {}),
                }),
            ]);
            if (generation !== loadGeneration.current) return;
            setData({key: requestKey, status, records});
        } catch (error) {
            if (generation !== loadGeneration.current) return;
            failure('saveHistory.errors.load', error);
        }
    }, [client, connectionId, table, schema, database, requestKey, failure]);

    useEffect(() => {
        if (isOpen) {
            void reload();
        } else {
            loadGeneration.current++;
            planGeneration.current++;
        }
    }, [isOpen, reload]);

    const current = data?.key === requestKey ? data : null;
    const selected = current?.records.find((record) => record.id === selectedId) ?? null;
    const plan = planState && planState.recordId === selectedId ? planState : null;
    const planLoading = !!selected && !plan && !planFailed;

    const handleClose = useCallback(() => {
        loadGeneration.current++;
        planGeneration.current++;
        setSelectedId(null);
        setPlanState(null);
        setPlanFailed(null);
        onClose();
    }, [onClose]);

    const loadPlan = useCallback(
        async (recordId: string) => {
            const generation = ++planGeneration.current;
            try {
                const next = await client.call('plan_save_restore', {connectionId, recordId});
                if (generation !== planGeneration.current) return;
                setPlanState(next);
                setPlanFailed(null);
            } catch (error) {
                if (generation !== planGeneration.current) return;
                setPlanFailed(String(error));
                failure('saveHistory.errors.plan', error);
            }
        },
        [client, connectionId, failure],
    );

    const selectRecord = (record: SaveRecord) => {
        setSelectedId(record.id);
        setPlanState(null);
        setPlanFailed(null);
        void loadPlan(record.id);
    };

    const toggleRecording = async (enabled: boolean) => {
        try {
            const status = await client.call('set_save_history_enabled', {connectionId, enabled});
            setData((previous) => (previous ? {...previous, status} : previous));
        } catch (error) {
            failure('saveHistory.errors.toggle', error);
        }
    };

    const restore = async () => {
        if (!selected || !canApplyRestore(plan?.status)) return;
        if (!(await guardProductionWrite(connectionId))) return;
        setRestoring(true);
        try {
            const result = await client.call('apply_save_restore', {
                connectionId,
                recordId: selected.id,
            });
            setPlanState(result);
            await reload();
            if (result.status === 'restored') onRestored?.();
        } catch (error) {
            failure('saveHistory.errors.restore', error);
        } finally {
            setRestoring(false);
        }
    };

    const deleteRecord = async (record: SaveRecord) => {
        try {
            await client.call('delete_save_history', {connectionId, recordId: record.id});
            if (selectedId === record.id) {
                setSelectedId(null);
                setPlanState(null);
            }
            await reload();
        } catch (error) {
            failure('saveHistory.errors.load', error);
        }
    };

    const clearAll = async () => {
        setClearOpen(false);
        try {
            await client.call('delete_save_history', {connectionId});
            setSelectedId(null);
            setPlanState(null);
            await reload();
        } catch (error) {
            failure('saveHistory.errors.load', error);
        }
    };

    const records = current?.records ?? [];
    const status = current?.status;

    return (
        <>
            <Modal isOpen={isOpen} onClose={handleClose} closeOnBackdrop>
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    className="bg-elevated border border-strong rounded-xl shadow-2xl w-[min(96vw,64rem)] max-h-[85vh] overflow-hidden flex flex-col"
                >
                    <div className="flex items-center justify-between p-4 border-b border-default bg-base shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-accent-primary/15 rounded-lg">
                                <History size={20} className="text-accent" />
                            </div>
                            <div>
                                <h2 id={titleId} className="text-lg font-semibold text-primary">
                                    {t('saveHistory.title')}
                                </h2>
                                <p className="text-xs text-secondary">
                                    {t('saveHistory.subtitle')}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            className={`text-secondary hover:text-primary transition-colors p-1 rounded ${FOCUS_RING}`}
                            aria-label={t('saveHistory.close')}
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-4 space-y-3 border-b border-default shrink-0">
                        <div className="flex items-start gap-3">
                            <input
                                id={recordingId}
                                type="checkbox"
                                checked={!!status?.enabled}
                                disabled={!status || !status.supported}
                                onChange={(event) => void toggleRecording(event.target.checked)}
                                className={`mt-1 w-4 h-4 cursor-pointer accent-primary ${FOCUS_RING}`}
                            />
                            <div className="min-w-0">
                                <label
                                    htmlFor={recordingId}
                                    className="text-sm font-medium text-primary cursor-pointer"
                                >
                                    {t('saveHistory.recording.label')}
                                </label>
                                <p className="text-xs text-secondary mt-1">
                                    {t('saveHistory.recording.description')}
                                </p>
                                <p className="text-xs text-muted mt-1">
                                    {status && !status.supported
                                        ? t('saveHistory.recording.unsupported')
                                        : t('saveHistory.recording.storage')}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
                        <div className="border-b md:border-b-0 md:border-r border-default overflow-y-auto max-h-48 md:max-h-none">
                            {!current && (
                                <div className="flex items-center gap-2 p-4 text-sm text-secondary">
                                    <Loader2 size={16} className="animate-spin" />
                                    {t('saveHistory.loading')}
                                </div>
                            )}
                            {current && records.length === 0 && (
                                <p className="p-4 text-sm text-secondary">
                                    {status?.enabled
                                        ? t('saveHistory.empty')
                                        : t('saveHistory.emptyDisabled')}
                                </p>
                            )}
                            {records.length > 0 && (
                                <ul className="divide-y divide-default">
                                    {records.map((record) => (
                                        <li key={record.id} className="flex items-stretch">
                                            <button
                                                type="button"
                                                onClick={() => selectRecord(record)}
                                                aria-pressed={record.id === selectedId}
                                                className={`flex-1 min-w-0 text-left px-4 py-3 hover:bg-surface-secondary transition-colors ${FOCUS_RING} ${
                                                    record.id === selectedId
                                                        ? 'bg-surface-secondary'
                                                        : ''
                                                }`}
                                            >
                                                <div className="text-xs text-muted">
                                                    {new Date(record.savedAt).toLocaleString()}
                                                </div>
                                                <div className="text-sm text-primary font-mono truncate">
                                                    {t('saveHistory.list.row')}:{' '}
                                                    {formatRecordKey(record.key)}
                                                </div>
                                                <div className="text-xs text-secondary truncate">
                                                    {t('saveHistory.list.columns', {
                                                        columns: record.columns
                                                            .map((column) => column.name)
                                                            .join(', '),
                                                    })}
                                                </div>
                                                {record.restoredAt && (
                                                    <div className="text-xs text-accent-success mt-1">
                                                        {t('saveHistory.list.restoredAt', {
                                                            date: new Date(
                                                                record.restoredAt,
                                                            ).toLocaleString(),
                                                        })}
                                                    </div>
                                                )}
                                                {!record.restorable && (
                                                    <div className="text-xs text-accent-warning mt-1">
                                                        {t('saveHistory.list.reviewOnly')}
                                                    </div>
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="overflow-y-auto p-4 space-y-3 min-h-[12rem]">
                            {!selected && (
                                <p className="text-sm text-muted">
                                    {records.length > 0 ? t('saveHistory.plan.intro') : ''}
                                </p>
                            )}
                            {selected && (
                                <>
                                    <h3 className="text-sm font-semibold text-primary">
                                        {t('saveHistory.plan.title')}
                                    </h3>
                                    <p className="text-xs text-secondary">
                                        {t('saveHistory.plan.intro')}
                                    </p>
                                    {planLoading && (
                                        <div className="flex items-center gap-2 text-sm text-secondary">
                                            <Loader2 size={16} className="animate-spin" />
                                            {t('saveHistory.loading')}
                                        </div>
                                    )}
                                    {plan && (
                                        <div
                                            role="status"
                                            className={`text-sm border rounded px-3 py-2 ${BANNER_CLASS[plan.status]}`}
                                        >
                                            {t(planStatusKey(plan.status))}
                                            {plan.status === 'not_restorable' && (
                                                <> {t(nonRestorableReasonKey(plan.reason))}</>
                                            )}
                                        </div>
                                    )}
                                    <div className="overflow-x-auto border border-default rounded">
                                        <table className="min-w-full text-left border-collapse">
                                            <thead className="bg-surface-secondary">
                                                <tr>
                                                    {[
                                                        'plan.column',
                                                        'plan.saved',
                                                        'plan.current',
                                                        'plan.restoreTo',
                                                    ].map((key) => (
                                                        <th
                                                            key={key}
                                                            scope="col"
                                                            className="px-3 py-2 text-xs font-medium text-secondary"
                                                        >
                                                            {t(`saveHistory.${key}`)}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selected.columns.map((column, index) => {
                                                    const row = plan?.columns[index];
                                                    return (
                                                        <tr
                                                            key={column.name}
                                                            className="border-t border-default align-top"
                                                        >
                                                            <th
                                                                scope="row"
                                                                className="px-3 py-2 text-xs font-medium text-primary"
                                                            >
                                                                {column.name}
                                                                <div className="font-normal text-muted">
                                                                    {column.dataType}
                                                                </div>
                                                            </th>
                                                            <td className="px-3 py-2">
                                                                <CellValue image={column.post} />
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <CellValue
                                                                    image={row?.current ?? null}
                                                                    conflict={row?.conflict}
                                                                />
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <CellValue image={column.pre} />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void deleteRecord(selected)}
                                            className={`flex items-center gap-1.5 px-3 py-2 text-sm text-secondary hover:text-accent-error transition-colors rounded ${FOCUS_RING}`}
                                        >
                                            <Trash2 size={14} />
                                            {t('saveHistory.actions.delete')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void loadPlan(selected.id)}
                                            disabled={restoring}
                                            className={`px-3 py-2 text-sm text-secondary hover:text-primary transition-colors rounded disabled:opacity-50 ${FOCUS_RING}`}
                                        >
                                            {t('saveHistory.actions.compare')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void restore()}
                                            disabled={restoring || !canApplyRestore(plan?.status)}
                                            className={`px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`}
                                        >
                                            {restoring
                                                ? t('saveHistory.actions.restoring')
                                                : t('saveHistory.actions.restore')}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="p-4 border-t border-default bg-base/50 flex justify-between gap-3 shrink-0">
                        <button
                            type="button"
                            onClick={() => setClearOpen(true)}
                            disabled={records.length === 0}
                            className={`px-3 py-2 text-sm text-secondary hover:text-accent-error transition-colors rounded disabled:opacity-40 ${FOCUS_RING}`}
                        >
                            {t('saveHistory.actions.clearAll')}
                        </button>
                        <button
                            type="button"
                            onClick={handleClose}
                            className={`px-4 py-2 text-secondary hover:text-primary transition-colors text-sm rounded ${FOCUS_RING}`}
                        >
                            {t('saveHistory.close')}
                        </button>
                    </div>
                </div>
            </Modal>
            <ConfirmModal
                isOpen={clearOpen}
                onClose={() => setClearOpen(false)}
                title={t('saveHistory.clear.title')}
                message={t('saveHistory.clear.message')}
                confirmLabel={t('saveHistory.clear.confirm')}
                onConfirm={() => void clearAll()}
            />
        </>
    );
};
