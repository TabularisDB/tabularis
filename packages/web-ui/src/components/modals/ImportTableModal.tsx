import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AlertTriangle, CheckCircle2, FileUp, Loader2, X, XCircle} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import type {IfTableExists, TableImportPreview, TableImportResult} from '@/api/contract';
import type {EventPayload} from '@/api/events';
import type {ChosenInputFile} from '@/platform/capabilities';
import {
    canStartTableImport,
    ifExistsOptions,
    prepareTableImportSource,
    resolveImportSchema,
    TABLE_TRANSFER_DEADLINE_MS,
    type PreparedTableImportSource,
} from '@/utils/tableTransfer';

interface ImportTableModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    connectionName: string;
    inputFile: ChosenInputFile;
    /** Database the import runs in; the connection's own when unset. */
    database?: string;
    /** Schema pre-filled from the node that was right-clicked. */
    schema?: string;
    /** The driver has schemas, so the target schema can be changed. */
    schemaEditable: boolean;
    onSuccess?: (result: TableImportResult, schema?: string, database?: string) => void;
}

type Phase = 'reading' | 'ready' | 'importing' | 'done' | 'failed';

const IF_EXISTS_LABELS: Record<IfTableExists, string> = {
    fail: 'tableTransfer.ifExistsFail',
    drop_and_recreate: 'tableTransfer.ifExistsDrop',
    append: 'tableTransfer.ifExistsAppend',
};

export const ImportTableModal = ({
    isOpen,
    onClose,
    connectionId,
    connectionName,
    inputFile,
    database,
    schema,
    schemaEditable,
    onSuccess,
}: ImportTableModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const [phase, setPhase] = useState<Phase>('reading');
    const [source, setSource] = useState<PreparedTableImportSource | null>(null);
    const [preview, setPreview] = useState<TableImportPreview | null>(null);
    const [ifExists, setIfExists] = useState<IfTableExists>('fail');
    const [targetSchema, setTargetSchema] = useState(schema ?? '');
    const [progress, setProgress] = useState<EventPayload<'import_progress'> | null>(null);
    const [result, setResult] = useState<TableImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cancelRequested, setCancelRequested] = useState(false);
    const startedRef = useRef(false);
    const importingRef = useRef(false);

    const mountedRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Read the header once per opening: strict-mode double mounts must not
    // upload a browser file twice.
    useEffect(() => {
        if (!isOpen) {
            startedRef.current = false;
            return;
        }
        if (startedRef.current) return;
        startedRef.current = true;
        void (async () => {
            try {
                const prepared = await prepareTableImportSource(client, platform, inputFile);
                const loaded = await client.call('read_table_sql_header', {
                    connectionId,
                    ...prepared,
                });
                if (!mountedRef.current) return;
                setSource(prepared);
                setPreview(loaded);
                setPhase('ready');
            } catch (e) {
                if (!mountedRef.current) return;
                setError(String(e));
                setPhase('failed');
            }
        })();
    }, [client, connectionId, inputFile, isOpen, platform]);

    useEffect(() => {
        if (phase !== 'importing') return;
        const subscription = client.subscribe('import_progress', (update) => {
            if (importingRef.current && update.connection_id === connectionId) {
                setProgress(update);
            }
        });
        return () => {
            void subscription.then((unsubscribe) => unsubscribe());
        };
    }, [client, connectionId, phase]);

    if (!isOpen) return null;

    const header = preview?.header;
    const canImport =
        phase === 'ready' && source !== null && canStartTableImport(preview, ifExists);
    const effectiveSchema = schemaEditable ? resolveImportSchema(targetSchema, schema) : schema;

    const handleImport = async () => {
        if (!source || !canImport) return;
        importingRef.current = true;
        setProgress(null);
        setError(null);
        setCancelRequested(false);
        setPhase('importing');
        try {
            const imported = await client.call(
                'import_table_from_sql',
                {
                    connectionId,
                    ...source,
                    options: {
                        ifExists,
                        ...(effectiveSchema ? {schema: effectiveSchema} : {}),
                        ...(database ? {database} : {}),
                    },
                },
                {
                    deadlineMs: TABLE_TRANSFER_DEADLINE_MS,
                    cancellationId: crypto.randomUUID(),
                },
            );
            setResult(imported);
            setPhase('done');
            onSuccess?.(imported, effectiveSchema, database);
        } catch (e) {
            setError(String(e));
            setPhase('failed');
        } finally {
            importingRef.current = false;
        }
    };

    const handleCancelImport = async () => {
        setCancelRequested(true);
        try {
            await client.call('cancel_table_import', {connectionId});
        } catch (e) {
            console.error('Failed to cancel table import:', e);
        }
    };

    const close = phase === 'importing' ? handleCancelImport : onClose;

    const sourceRows: Array<[string, string]> = header
        ? [
              [t('tableTransfer.table'), header.table],
              [t('tableTransfer.driver'), header.driver],
              [t('tableTransfer.rows'), header.rows.toLocaleString()],
              [t('tableTransfer.source'), header.source || t('tableTransfer.unknown')],
              [t('tableTransfer.exported'), header.exported || t('tableTransfer.unknown')],
              [
                  t('tableTransfer.tabularisVersion'),
                  header.tabularisVersion || t('tableTransfer.unknown'),
              ],
              [
                  t('tableTransfer.structureSource'),
                  header.structureSource === 'generated'
                      ? t('tableTransfer.structureSourceGenerated')
                      : t('tableTransfer.structureSourceDriver'),
              ],
          ]
        : [];

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="import-table-title"
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[680px] max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-accent-secondary/15 rounded-lg">
                            <FileUp size={20} className="text-accent-secondary" />
                        </div>
                        <div className="min-w-0">
                            <h2
                                id="import-table-title"
                                className="text-lg font-semibold text-primary"
                            >
                                {t('tableTransfer.importTitle')}
                            </h2>
                            <p className="text-xs text-secondary truncate" title={inputFile.name}>
                                {inputFile.name}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={close}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                    {phase === 'reading' && (
                        <div className="text-center py-8 text-muted">
                            <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                            {t('tableTransfer.reading')}
                        </div>
                    )}

                    {header && (
                        <section className="space-y-2">
                            <h3 className="text-xs uppercase font-bold text-muted">
                                {t('tableTransfer.sourceSection')}
                            </h3>
                            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm bg-base p-3 rounded-lg border border-default">
                                {sourceRows.map(([label, value]) => (
                                    <div key={label} className="contents">
                                        <dt className="text-muted">{label}</dt>
                                        <dd
                                            className="text-primary font-mono truncate"
                                            title={value}
                                        >
                                            {value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    )}

                    {header && (
                        <section className="space-y-3">
                            <h3 className="text-xs uppercase font-bold text-muted">
                                {t('tableTransfer.targetSection')}
                            </h3>
                            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm bg-base p-3 rounded-lg border border-default">
                                <dt className="text-muted">{t('tableTransfer.connection')}</dt>
                                <dd className="text-primary truncate">{connectionName}</dd>
                                {database && (
                                    <>
                                        <dt className="text-muted">
                                            {t('tableTransfer.database')}
                                        </dt>
                                        <dd className="text-primary font-mono truncate">
                                            {database}
                                        </dd>
                                    </>
                                )}
                                {!schemaEditable && schema && (
                                    <>
                                        <dt className="text-muted">{t('tableTransfer.schema')}</dt>
                                        <dd className="text-primary font-mono truncate">
                                            {schema}
                                        </dd>
                                    </>
                                )}
                            </dl>
                            {schemaEditable && (
                                <div>
                                    <label
                                        htmlFor="import-table-schema"
                                        className="text-xs uppercase font-bold text-muted mb-1 block"
                                    >
                                        {t('tableTransfer.schema')}
                                    </label>
                                    <input
                                        id="import-table-schema"
                                        type="text"
                                        value={targetSchema}
                                        onChange={(e) => setTargetSchema(e.target.value)}
                                        disabled={phase !== 'ready'}
                                        className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none"
                                    />
                                </div>
                            )}
                            <div>
                                <label
                                    htmlFor="import-table-if-exists"
                                    className="text-xs uppercase font-bold text-muted mb-1 block"
                                >
                                    {t('tableTransfer.ifExists')}
                                </label>
                                <select
                                    id="import-table-if-exists"
                                    value={ifExists}
                                    onChange={(e) => setIfExists(e.target.value as IfTableExists)}
                                    disabled={phase !== 'ready'}
                                    className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none"
                                >
                                    {ifExistsOptions(header.content).map((option) => (
                                        <option key={option} value={option}>
                                            {t(IF_EXISTS_LABELS[option])}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </section>
                    )}

                    {header?.structureSource === 'generated' && (
                        <div className="flex items-start gap-2 rounded-lg border border-accent-warning/30 bg-accent-warning/10 px-3 py-2 text-xs text-accent-warning">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{t('tableTransfer.generatedStructureWarning')}</span>
                        </div>
                    )}

                    {preview && (
                        <section className="space-y-2">
                            <h3 className="text-xs uppercase font-bold text-muted">
                                {t('tableTransfer.structurePreview')}
                                {preview.structureTruncated &&
                                    ` (${t('tableTransfer.structureTruncated')})`}
                            </h3>
                            <pre className="max-h-48 overflow-auto bg-base border border-default rounded-lg p-3 text-xs font-mono text-secondary whitespace-pre">
                                {preview.structure}
                            </pre>
                        </section>
                    )}

                    {preview?.problem && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-lg border border-accent-error/30 bg-accent-error/10 px-3 py-2 text-sm text-accent-error"
                        >
                            <XCircle size={16} className="mt-0.5 shrink-0" />
                            <span>{preview.problem}</span>
                        </div>
                    )}

                    {phase === 'importing' && (
                        <div className="space-y-2 text-center text-sm text-muted">
                            <Loader2 size={24} className="animate-spin mx-auto text-accent" />
                            <div>{progress?.current_operation ?? t('tableTransfer.importing')}</div>
                            {progress && (
                                <div className="font-mono text-primary">
                                    {t('tableTransfer.statementsExecuted', {
                                        count: progress.statements_executed,
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {phase === 'done' && result && (
                        <div className="flex items-center justify-center gap-2 text-accent-success font-medium">
                            <CheckCircle2 size={20} />
                            {t('tableTransfer.importSuccess', {
                                rows: result.rows.toLocaleString(),
                                table: result.table,
                            })}
                        </div>
                    )}

                    {phase === 'failed' && error && (
                        <div className="space-y-2">
                            <div className="text-center text-accent-error text-sm font-medium">
                                {cancelRequested
                                    ? t('tableTransfer.importCancelled')
                                    : t('tableTransfer.importFailed')}
                            </div>
                            {!cancelRequested && (
                                <div className="max-h-40 overflow-y-auto bg-accent-error/5 border border-accent-error/20 rounded-lg p-3 text-xs text-accent-error font-mono whitespace-pre-wrap break-words">
                                    {error}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    {phase === 'importing' ? (
                        <button
                            onClick={handleCancelImport}
                            className="px-4 py-2 bg-accent-error hover:bg-accent-error/90 text-on-accent-error rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            <X size={16} />
                            {t('common.cancel')}
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
                            >
                                {phase === 'done' || phase === 'failed'
                                    ? t('common.close')
                                    : t('common.cancel')}
                            </button>
                            {phase !== 'done' && phase !== 'failed' && (
                                <button
                                    onClick={handleImport}
                                    disabled={!canImport}
                                    className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse rounded-lg text-sm font-medium transition-colors"
                                >
                                    {t('tableTransfer.import')}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </Modal>
    );
};
