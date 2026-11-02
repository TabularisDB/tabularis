import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FileDown, Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {ExportProgressModal, type ExportStatus} from '@/components/modals/ExportProgressModal';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {usePlatformCapabilities} from '@/hooks/usePlatformCapabilities';
import type {TableSqlContent} from '@/api/contract';
import {formatBytes} from '@/utils/taskManager';
import {
    chooseTableExportTarget,
    deliverTableExport,
    tableExportFileName,
    TABLE_TRANSFER_DEADLINE_MS,
} from '@/utils/tableTransfer';

interface ExportTableModalProps {
    isOpen: boolean;
    onClose: () => void;
    connectionId: string;
    table: string;
    schema?: string;
    database?: string;
}

interface ExportRun {
    status: ExportStatus;
    fileName: string;
    rows: number;
    detail?: string;
    warning?: string;
    error?: string;
}

const CONTENT_OPTIONS: TableSqlContent[] = ['structure_and_data', 'structure_only'];

export const ExportTableModal = ({
    isOpen,
    onClose,
    connectionId,
    table,
    schema,
    database,
}: ExportTableModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const [content, setContent] = useState<TableSqlContent>('structure_and_data');
    const [isChoosingTarget, setIsChoosingTarget] = useState(false);
    const [run, setRun] = useState<ExportRun | null>(null);
    const runningRef = useRef(false);

    useEffect(() => {
        if (!run || run.status !== 'exporting') return;
        const subscription = client.subscribe('export_progress', (update) => {
            if (runningRef.current && update.connection_id === connectionId) {
                setRun((current) =>
                    current && current.status === 'exporting'
                        ? {...current, rows: update.rows_processed}
                        : current,
                );
            }
        });
        return () => {
            void subscription.then((unsubscribe) => unsubscribe());
        };
    }, [client, connectionId, run]);

    if (!isOpen) return null;

    const location = [database, schema].filter(Boolean).join(' / ');

    const handleExport = async () => {
        const fileName = tableExportFileName(table);
        setIsChoosingTarget(true);
        let target: {filePath?: string} | null;
        try {
            target = await chooseTableExportTarget(platform, fileName);
        } finally {
            setIsChoosingTarget(false);
        }
        if (!target) return;

        runningRef.current = true;
        setRun({status: 'exporting', fileName: target.filePath ?? fileName, rows: 0});
        try {
            const result = await client.call(
                'export_table_to_sql',
                {
                    connectionId,
                    options: {
                        table,
                        content,
                        ...(schema ? {schema} : {}),
                        ...(database ? {database} : {}),
                    },
                    ...target,
                },
                {
                    deadlineMs: TABLE_TRANSFER_DEADLINE_MS,
                    cancellationId: crypto.randomUUID(),
                },
            );
            await deliverTableExport(client, platform, result);
            setRun((current) => ({
                status: 'completed',
                fileName: current?.fileName ?? fileName,
                rows: result.rows,
                detail: t('tableTransfer.fileSize', {size: formatBytes(result.bytes)}),
                warning:
                    result.structureSource === 'generated'
                        ? t('tableTransfer.generatedStructureExported')
                        : undefined,
            }));
        } catch (e) {
            setRun((current) => ({
                status: 'error',
                fileName: current?.fileName ?? fileName,
                rows: current?.rows ?? 0,
                error: String(e),
            }));
        } finally {
            runningRef.current = false;
        }
    };

    const handleCancelRun = async () => {
        try {
            await client.call('cancel_export', {connectionId});
        } catch (e) {
            console.error('Failed to cancel table export:', e);
        }
    };

    if (run) {
        return (
            <ExportProgressModal
                isOpen
                status={run.status}
                rowsProcessed={run.rows}
                fileName={run.fileName}
                errorMessage={run.error}
                warningMessage={run.warning}
                detailMessage={run.detail}
                onCancel={handleCancelRun}
                onClose={onClose}
            />
        );
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="export-table-title"
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <FileDown size={20} className="text-accent" />
                        </div>
                        <div>
                            <h2
                                id="export-table-title"
                                className="text-lg font-semibold text-primary"
                            >
                                {t('tableTransfer.exportTitle')}
                            </h2>
                            <p className="text-xs text-secondary">
                                {t('tableTransfer.exportSubtitle')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    <div className="flex items-center justify-between bg-base p-4 rounded-lg border border-default">
                        <div className="min-w-0">
                            <div className="text-xs uppercase font-bold text-muted">
                                {t('tableTransfer.table')}
                            </div>
                            <div className="font-medium text-primary truncate" title={table}>
                                {table}
                            </div>
                        </div>
                        {location && (
                            <div className="min-w-0 text-right">
                                <div className="text-xs uppercase font-bold text-muted">
                                    {t('tableTransfer.location')}
                                </div>
                                <div
                                    className="text-sm text-secondary font-mono truncate"
                                    title={location}
                                >
                                    {location}
                                </div>
                            </div>
                        )}
                    </div>

                    <fieldset className="space-y-2">
                        <legend className="text-xs uppercase font-bold text-muted mb-2">
                            {t('tableTransfer.content')}
                        </legend>
                        {CONTENT_OPTIONS.map((option) => (
                            <label
                                key={option}
                                className="flex items-center gap-2 cursor-pointer select-none text-sm text-primary"
                            >
                                <input
                                    type="radio"
                                    name="table-export-content"
                                    value={option}
                                    checked={content === option}
                                    onChange={() => setContent(option)}
                                    className="w-4 h-4 focus:ring-focus"
                                />
                                {option === 'structure_and_data'
                                    ? t('tableTransfer.structureAndData')
                                    : t('tableTransfer.structureOnly')}
                            </label>
                        ))}
                    </fieldset>
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isChoosingTarget}
                        className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 disabled:opacity-50 text-inverse rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        {isChoosingTarget && <Loader2 size={16} className="animate-spin" />}
                        {t('tableTransfer.export')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
