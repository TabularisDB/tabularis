import {useId, useMemo, useState, type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {Database, Layers, Loader2, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';
import {useDatabase} from '@/hooks/useDatabase';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {toErrorMessage} from '@/utils/errors';
import {
    buildCreateDatabaseSql,
    buildCreateSchemaSql,
    type CreateContainerKind,
} from '@/utils/createContainer';

interface CreateContainerModalProps {
    isOpen: boolean;
    kind: CreateContainerKind;
    /** Nested schema-based multi-db target. Omitted for a single-database connection. */
    database?: string;
    onClose: () => void;
    onSuccess: (name: string) => void | Promise<void>;
}

type FormProps = Omit<CreateContainerModalProps, 'isOpen'>;

const ContainerForm = ({kind, database, onClose, onSuccess}: FormProps) => {
    const client = useTabularisClient();
    const {t} = useTranslation();
    const {activeConnectionId, activeCapabilities, activeDriver} = useDatabase();
    const titleId = useId();
    const nameId = useId();
    const errorId = useId();
    const sqlId = useId();
    const [name, setName] = useState('');
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const quotingDriver = activeCapabilities ?? activeDriver;
    const trimmed = name.trim();
    const ns = kind === 'database' ? 'createDatabase' : 'createSchema';
    const sql = useMemo(() => {
        if (!trimmed) return '';
        return kind === 'database'
            ? buildCreateDatabaseSql(trimmed, quotingDriver)
            : buildCreateSchemaSql(trimmed, quotingDriver);
    }, [kind, quotingDriver, trimmed]);

    const emptyError = touched && !trimmed ? t(`${ns}.nameRequired`) : '';
    const visibleError = error || emptyError;
    const Icon = kind === 'database' ? Database : Layers;

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (!trimmed || !activeConnectionId) {
            if (!trimmed) setError(t(`${ns}.nameRequired`));
            return;
        }
        setBusy(true);
        setError('');
        try {
            await client.call('execute_query', {
                connectionId: activeConnectionId,
                query: sql,
                ...(database ? {database} : {}),
            });
            await onSuccess(trimmed);
            onClose();
        } catch (err: unknown) {
            setError(t(`${ns}.failCreate`) + toErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col"
        >
            <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-accent-primary/15 rounded-lg">
                        <Icon size={20} className="text-accent" />
                    </div>
                    <div>
                        <h2 id={titleId} className="text-lg font-semibold text-primary">
                            {t(`${ns}.title`)}
                        </h2>
                        <p className="text-xs text-secondary">{t(`${ns}.subtitle`)}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('common.cancel')}
                    className="text-secondary hover:text-primary transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                    <X size={20} />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
                <div className="p-6 space-y-6 overflow-y-auto">
                    <div>
                        <label
                            htmlFor={nameId}
                            className="block text-xs uppercase font-bold text-muted mb-2"
                        >
                            {t(`${ns}.name`)}
                        </label>
                        <input
                            id={nameId}
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setError('');
                            }}
                            onBlur={() => setTouched(true)}
                            placeholder={t(`${ns}.namePlaceholder`)}
                            aria-invalid={visibleError ? true : undefined}
                            aria-describedby={visibleError ? errorId : sql ? sqlId : undefined}
                            className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary placeholder:text-muted font-mono focus:border-focus focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                        />
                        {sql ? (
                            <p id={sqlId} className="mt-2 text-xs text-muted font-mono break-all">
                                {sql}
                            </p>
                        ) : null}
                        {visibleError ? (
                            <div
                                id={errorId}
                                role="alert"
                                className="text-accent-error text-xs mt-2"
                            >
                                {visibleError}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={busy || !trimmed}
                        className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus inline-flex items-center gap-2"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                        {t(`${ns}.create`)}
                    </button>
                </div>
            </form>
        </div>
    );
};

export const CreateContainerModal = ({isOpen, onClose, ...props}: CreateContainerModalProps) => (
    <Modal isOpen={isOpen} onClose={onClose}>
        <ContainerForm key={`${props.kind}:${props.database ?? ''}`} onClose={onClose} {...props} />
    </Modal>
);
