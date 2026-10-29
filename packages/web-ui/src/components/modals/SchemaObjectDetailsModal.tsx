import {useEffect, useId, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {X, FileText, Loader2} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {copyTextToClipboard} from '@/utils/clipboard';
import {getObjectDetailsDdl, orderedObjectRows} from '@/utils/schemaObjectDetails';
import type {SchemaObjectDetails} from '@/types/schemaObjectDetails';

interface SchemaObjectDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    details: SchemaObjectDetails;
}

export const SchemaObjectDetailsModal = ({
    isOpen,
    onClose,
    details,
}: SchemaObjectDetailsModalProps) => {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const [ddl, setDdl] = useState<string[] | null>(null);
    const [copyStatus, setCopyStatus] = useState<'copied' | 'copyFailed' | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        getObjectDetailsDdl(client, details).then(
            (statements) => {
                if (!cancelled) setDdl(statements.filter((sql) => sql.trim()));
            },
            () => {
                if (!cancelled) setDdl([]);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [client, details, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const previousFocus = document.activeElement;
        const panel = panelRef.current;
        panel?.querySelector<HTMLButtonElement>('button')?.focus();
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const buttons = panel?.querySelectorAll<HTMLButtonElement>('button');
            if (!buttons?.length) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        panel?.addEventListener('keydown', trapFocus);
        return () => {
            panel?.removeEventListener('keydown', trapFocus);
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
                previousFocus.focus();
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const copy = async (text: string) => {
        try {
            await copyTextToClipboard(text);
            setCopyStatus('copied');
        } catch {
            setCopyStatus('copyFailed');
        }
    };
    const rows = orderedObjectRows(details);
    const fields: [string, string][] = [
        [t('objectDetails.name'), details.name],
        [t('objectDetails.table'), details.tableName],
        ...(details.schema
            ? [[t('objectDetails.schema'), details.schema] as [string, string]]
            : []),
        ...(details.database
            ? [[t('objectDetails.database'), details.database] as [string, string]]
            : []),
        [
            t('objectDetails.columns'),
            rows.map((row, i) => `${i + 1}. ${row.column_name}`).join('\n'),
        ],
    ];
    if (details.kind === 'index' && details.rows.length) {
        const index = details.rows[0];
        fields.push([
            t('objectDetails.type'),
            index.is_primary ? 'PRIMARY KEY' : index.is_unique ? 'UNIQUE' : 'INDEX',
        ]);
    }
    if (details.kind === 'foreign_key') {
        fields.push([
            t('objectDetails.references'),
            rows
                .map((row, i) =>
                    'ref_table' in row ? `${i + 1}. ${row.ref_table}.${row.ref_column}` : '',
                )
                .join('\n'),
        ]);
        const fk = details.rows[0];
        fields.push([t('objectDetails.onDelete'), fk?.on_delete ?? t('objectDetails.notReported')]);
        fields.push([t('objectDetails.onUpdate'), fk?.on_update ?? t('objectDetails.notReported')]);
    }
    const buttonClass =
        'px-3 py-2 text-sm text-secondary hover:text-primary border border-strong rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

    return (
        <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <FileText size={20} className="text-accent" />
                        </div>
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-lg font-semibold text-primary">
                                {t(
                                    details.kind === 'index'
                                        ? 'objectDetails.indexTitle'
                                        : 'objectDetails.fkTitle',
                                )}
                            </h2>
                            <p className="text-xs text-secondary font-mono break-all">
                                {details.name}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        aria-label={t('common.close')}
                        onClick={onClose}
                        className={buttonClass}
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    {rows.length ? (
                        <dl className="space-y-3">
                            {fields.map(([label, value]) => (
                                <div key={label}>
                                    <dt className="text-xs uppercase font-bold text-muted">
                                        {label}
                                    </dt>
                                    <dd className="text-sm text-primary font-mono whitespace-pre-wrap break-all">
                                        {value}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <p role="status" className="text-sm text-secondary">
                            {t('objectDetails.metadataUnavailable')}
                        </p>
                    )}
                    {ddl === null ? (
                        <p role="status" className="flex items-center gap-2 text-sm text-muted">
                            <Loader2 size={16} className="animate-spin" />
                            {t('common.loading')}
                        </p>
                    ) : ddl.length ? (
                        <section aria-label={t('objectDetails.ddl')} className="space-y-3">
                            <h3 className="text-sm font-semibold text-primary">
                                {t('objectDetails.ddl')}
                            </h3>
                            <p className="text-xs text-secondary">{t('objectDetails.ddlNote')}</p>
                            {ddl.map((sql, i) => (
                                <div key={i} className="space-y-2">
                                    <pre className="p-3 bg-base border border-default rounded-lg text-sm font-mono text-primary whitespace-pre-wrap break-all">
                                        {sql}
                                    </pre>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        onClick={() => void copy(sql)}
                                    >
                                        {t(
                                            /^\s*ALTER\b/i.test(sql)
                                                ? 'objectDetails.copyAlter'
                                                : /^\s*CREATE\b/i.test(sql)
                                                  ? 'objectDetails.copyCreate'
                                                  : 'objectDetails.copyDdl',
                                        )}
                                    </button>
                                </div>
                            ))}
                        </section>
                    ) : (
                        <p role="status" className="text-sm text-secondary">
                            {t('objectDetails.ddlUnavailable')}
                        </p>
                    )}
                    {copyStatus && (
                        <p role="status" className="text-sm text-secondary">
                            {t(`objectDetails.${copyStatus}`)}
                        </p>
                    )}
                </div>
                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        type="button"
                        className={buttonClass}
                        onClick={() => void copy(JSON.stringify(details, null, 2))}
                    >
                        {t('objectDetails.copyMetadata')}
                    </button>
                    <button type="button" className={buttonClass} onClick={onClose}>
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
