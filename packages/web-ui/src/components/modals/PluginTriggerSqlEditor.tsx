import {useEffect, useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Loader2} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {SqlEditorWrapper} from '@/components/ui/SqlEditorWrapper';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {useDatabase} from '@/hooks/useDatabase';
import type {TriggerEditorModalProps} from './TriggerEditorModal';

/** The driver supplies complete SQL; PSQL bodies stay one statement on save. */
export const PluginTriggerSqlEditor = ({
    isOpen,
    onClose,
    connectionId,
    triggerName,
    tableName,
    schema,
    database,
    isNewTrigger = false,
    onSuccess,
}: TriggerEditorModalProps) => {
    const client = useTabularisClient();
    const {t} = useTranslation();
    const titleId = useId();
    const {activeSchema} = useDatabase();
    const resolvedSchema = schema ?? activeSchema ?? undefined;
    const [sql, setSql] = useState('');
    const [loading, setLoading] = useState(!isNewTrigger);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || isNewTrigger) return;
        let cancelled = false;
        void client
            .call('get_trigger_definition', {
                connectionId,
                triggerName: triggerName ?? '',
                tableName: tableName ?? '',
                ...(resolvedSchema ? {schema: resolvedSchema} : {}),
                ...(database ? {database} : {}),
            })
            .then((definition) => {
                if (!cancelled) setSql(definition);
            })
            .catch((reason: unknown) => {
                if (!cancelled) setError(String(reason));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [
        client,
        connectionId,
        database,
        isNewTrigger,
        isOpen,
        resolvedSchema,
        tableName,
        triggerName,
    ]);

    const save = async () => {
        if (saving || loading || !sql.trim()) return;
        setSaving(true);
        setError(null);
        try {
            // Never drop an existing trigger before executing the driver's edit script.
            await client.call('create_trigger', {
                connectionId,
                triggerSql: sql,
                ...(resolvedSchema ? {schema: resolvedSchema} : {}),
                ...(database ? {database} : {}),
            });
            onSuccess?.();
            onClose();
        } catch (reason) {
            setError(String(reason));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => {
                if (!saving) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-[800px] max-w-[95vw] flex flex-col"
            >
                <h2 id={titleId} className="p-4 border-b border-default text-primary font-semibold">
                    {isNewTrigger
                        ? t('triggers.create')
                        : `${t('triggers.save')}: ${triggerName ?? ''}`}
                </h2>
                <div className="p-4 space-y-3">
                    <p className="text-sm text-muted">
                        {t(
                            'triggers.nativeSqlHelp',
                            'Enter a complete trigger statement in the database SQL dialect. Existing triggers are saved without dropping them first.',
                        )}
                    </p>
                    {loading ? (
                        <Loader2 className="animate-spin" aria-label={t('common.loading')} />
                    ) : (
                        <div className="h-80 border border-default rounded overflow-hidden">
                            <SqlEditorWrapper
                                initialValue={sql}
                                onChange={setSql}
                                height="100%"
                                options={{readOnly: saving}}
                                onRun={save}
                            />
                        </div>
                    )}
                    {error && (
                        <p role="alert" className="text-sm text-accent-error whitespace-pre-wrap">
                            {error}
                        </p>
                    )}
                </div>
                <div className="p-4 border-t border-default flex justify-end gap-2">
                    <button
                        disabled={saving}
                        onClick={onClose}
                        className="px-4 py-2 rounded text-secondary hover:text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        disabled={saving || loading || !sql.trim()}
                        onClick={() => {
                            void save();
                        }}
                        className="px-4 py-2 rounded bg-accent-primary text-inverse disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        {isNewTrigger ? t('triggers.create') : t('triggers.save')}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
